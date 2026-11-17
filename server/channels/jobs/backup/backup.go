// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/platform/shared/filestore"
)

// 64 MiB parts lift the unknown-size upload cap from ~50 GB (10,000 x 5 MB) to ~640 GB.
const uploadPartSize = 64 << 20

type dumpFunc func(ctx context.Context, dsn string, w io.Writer) error

type manifest struct {
	CreatedAt     string `json:"created_at"`
	ServerVersion string `json:"server_version"`
	DBBytes       int64  `json:"db_bytes"`
	FilesBytes    int64  `json:"files_bytes"`
	FilesSkipped  bool   `json:"files_skipped"`
}

func newBackupStore(s *model.BackupSettings) (filestore.FileBackend, error) {
	return filestore.NewExportFileBackend(filestore.FileBackendSettings{
		DriverName:                         model.ImageDriverS3,
		AmazonS3AccessKeyId:                *s.AmazonS3AccessKeyId,
		AmazonS3SecretAccessKey:            *s.AmazonS3SecretAccessKey,
		AmazonS3Bucket:                     *s.AmazonS3Bucket,
		AmazonS3Region:                     *s.AmazonS3Region,
		AmazonS3Endpoint:                   *s.AmazonS3Endpoint,
		AmazonS3SSL:                        *s.AmazonS3SSL,
		AmazonS3SSE:                        *s.AmazonS3SSE,
		AmazonS3RequestTimeoutMilliseconds: 30000,
		AmazonS3UploadPartSizeBytes:        uploadPartSize,
	})
}

func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	return strings.ReplaceAll(s, secret, "****")
}

func execPgDump(ctx context.Context, dsn string, w io.Writer) error {
	bin, err := exec.LookPath("pg_dump")
	if err != nil {
		return errors.New("pg_dump not found on PATH: install postgresql-client-17")
	}
	args, env, err := pgDumpCommand(dsn)
	if err != nil {
		return err
	}

	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout = w
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		password := ""
		if len(env) > 0 {
			password = strings.TrimPrefix(env[0], "PGPASSWORD=")
		}
		return fmt.Errorf("pg_dump failed: %w: %s", err, redact(strings.TrimSpace(stderr.String()), password))
	}
	return nil
}

// streamUpload pipes what produce writes straight into the store, without buffering the whole object.
func streamUpload(ctx context.Context, store filestore.FileBackend, p string, produce func(io.Writer) error) (int64, error) {
	pr, pw := io.Pipe()
	var produceErr error
	produced := make(chan struct{})
	done := make(chan struct{})
	go func() {
		produceErr = produce(pw)
		close(produced)
		pw.CloseWithError(produceErr)
		close(done)
	}()

	n, uploadErr := filestore.TryWriteFileContext(ctx, store, pr, p)
	producerFinished := false
	select {
	case <-produced:
		producerFinished = true
	default:
	}
	// Unblock the producer if the upload stopped before reading everything.
	pr.CloseWithError(errors.Join(uploadErr, io.ErrClosedPipe))
	<-done

	// An upload that failed while the producer was still writing is the cause; the producer's
	// broken-pipe error is only the symptom.
	if uploadErr != nil && !producerFinished {
		return n, uploadErr
	}
	if produceErr != nil {
		return n, produceErr
	}
	return n, uploadErr
}

// runBackup writes one backup folder and prunes expired ones. A failed run removes its own
// folder and never prunes.
func runBackup(ctx context.Context, cfg *model.Config, store filestore.FileBackend, dump dumpFunc, now time.Time) (model.StringMap, error) {
	if *cfg.SqlSettings.DriverName != model.DatabaseDriverPostgres {
		return nil, errors.New("backup supports only postgres")
	}

	start := time.Now()
	prefix := *cfg.BackupSettings.AmazonS3PathPrefix
	name := folderName(now)
	folder := path.Join(prefix, name)

	m, err := writeBackup(ctx, cfg, store, dump, folder, now)
	if err != nil {
		_ = removeFolder(store, folder)
		return nil, err
	}

	if err := prune(store, prefix, now, *cfg.BackupSettings.RetentionDays); err != nil {
		return nil, fmt.Errorf("backup %s was written, but pruning old backups failed: %w", name, err)
	}

	return model.StringMap{
		"folder":      name,
		"db_bytes":    strconv.FormatInt(m.DBBytes, 10),
		"files_bytes": strconv.FormatInt(m.FilesBytes, 10),
		"duration_ms": strconv.FormatInt(time.Since(start).Milliseconds(), 10),
	}, nil
}

func writeBackup(ctx context.Context, cfg *model.Config, store filestore.FileBackend, dump dumpFunc, folder string, now time.Time) (*manifest, error) {
	m := &manifest{
		CreatedAt:     now.UTC().Format(time.RFC3339),
		ServerVersion: model.CurrentVersion,
		FilesSkipped:  *cfg.FileSettings.DriverName != model.ImageDriverLocal,
	}

	var err error
	m.DBBytes, err = streamUpload(ctx, store, folder+"/database.dump", func(w io.Writer) error {
		return dump(ctx, *cfg.SqlSettings.DataSource, w)
	})
	if err != nil {
		return nil, fmt.Errorf("database dump: %w", err)
	}

	if !m.FilesSkipped {
		m.FilesBytes, err = streamUpload(ctx, store, folder+"/data.tar.gz", func(w io.Writer) error {
			return writeTarGz(w, *cfg.FileSettings.Directory)
		})
		if err != nil {
			return nil, fmt.Errorf("files archive: %w", err)
		}
	}

	cfgJSON, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	if _, err := filestore.TryWriteFileContext(ctx, store, bytes.NewReader(cfgJSON), folder+"/config.json"); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}

	manifestJSON, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	if _, err := filestore.TryWriteFileContext(ctx, store, bytes.NewReader(manifestJSON), folder+"/manifest.json"); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	return m, nil
}

func prune(store filestore.FileBackend, prefix string, now time.Time, retentionDays int) error {
	// One listing finds complete backups; FileExists would be a HEAD, which needs s3:GetObject.
	keys, err := store.ListDirectoryRecursively(prefix)
	if err != nil {
		return err
	}

	var names []string
	complete := map[string]bool{}
	for _, k := range keys {
		rel := strings.TrimPrefix(strings.TrimPrefix(filepath.ToSlash(k), prefix), "/")
		name, rest, ok := strings.Cut(rel, "/")
		if !ok {
			continue
		}
		if _, err := time.Parse(folderLayout, name); err != nil {
			continue
		}
		if _, seen := complete[name]; !seen {
			names = append(names, name)
			complete[name] = false
		}
		if rest == "manifest.json" {
			complete[name] = true
		}
	}

	for _, name := range selectExpired(names, complete, now, retentionDays) {
		if err := removeFolder(store, path.Join(prefix, name)); err != nil {
			return err
		}
	}
	return nil
}

// removeFolder deletes the folder's keys one by one: S3 RemoveDirectory matches a bare string
// prefix, so it would also take sibling folders such as "<name>-pre-upgrade".
func removeFolder(store filestore.FileBackend, folder string) error {
	keys, err := store.ListDirectoryRecursively(folder)
	if err != nil {
		return err
	}
	for _, k := range keys {
		if err := store.RemoveFile(k); err != nil {
			return err
		}
	}
	return nil
}
