// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/platform/shared/filestore"
)

var testNow = time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)

const (
	newFolder = "mattermost-backups/20261117-030000"
	oldFolder = "mattermost-backups/20261001-030000"
)

func setupBackupTest(t *testing.T) (*model.Config, filestore.FileBackend) {
	t.Helper()
	cfg := &model.Config{}
	cfg.SetDefaults()
	cfg.SqlSettings.DriverName = new(model.DatabaseDriverPostgres)
	cfg.SqlSettings.DataSource = new("postgres://u:pw@h/db")
	dataDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "x.txt"), []byte("X"), 0600))
	cfg.FileSettings.DriverName = new(model.ImageDriverLocal)
	cfg.FileSettings.Directory = new(dataDir)

	store, err := filestore.NewFileBackend(filestore.FileBackendSettings{DriverName: model.ImageDriverLocal, Directory: t.TempDir()})
	require.NoError(t, err)

	// A pre-existing complete backup older than the 14-day retention.
	_, err = store.WriteFile(strings.NewReader("{}"), oldFolder+"/manifest.json")
	require.NoError(t, err)
	return cfg, store
}

func fakeDump(content string) dumpFunc {
	return func(_ context.Context, _ string, w io.Writer) error {
		_, err := io.WriteString(w, content)
		return err
	}
}

func readManifest(t *testing.T, store filestore.FileBackend, folder string) manifest {
	t.Helper()
	b, err := store.ReadFile(folder + "/manifest.json")
	require.NoError(t, err)
	var m manifest
	require.NoError(t, json.Unmarshal(b, &m))
	return m
}

func TestRunBackupSuccess(t *testing.T) {
	cfg, store := setupBackupTest(t)

	data, err := runBackup(context.Background(), cfg, store, fakeDump("DUMP"), testNow)
	require.NoError(t, err)

	dump, err := store.ReadFile(newFolder + "/database.dump")
	require.NoError(t, err)
	assert.Equal(t, "DUMP", string(dump))

	tgz, err := store.ReadFile(newFolder + "/data.tar.gz")
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"x.txt": "X"}, readTarGz(t, tgz))

	cfgJSON, err := store.ReadFile(newFolder + "/config.json")
	require.NoError(t, err)
	var saved model.Config
	require.NoError(t, json.Unmarshal(cfgJSON, &saved))
	assert.Equal(t, "mattermost-backups", *saved.BackupSettings.AmazonS3PathPrefix)

	m := readManifest(t, store, newFolder)
	assert.Equal(t, model.CurrentVersion, m.ServerVersion)
	assert.False(t, m.FilesSkipped)

	for _, k := range []string{"folder", "db_bytes", "files_bytes", "duration_ms"} {
		assert.Contains(t, data, k)
	}
	assert.Equal(t, "20261117-030000", data["folder"])

	exists, err := store.FileExists(oldFolder + "/manifest.json")
	require.NoError(t, err)
	assert.False(t, exists, "expired backup should be pruned")
}

func TestRunBackupDumpFailure(t *testing.T) {
	assertFailedRun := func(t *testing.T, store filestore.FileBackend) {
		t.Helper()
		exists, err := store.FileExists(newFolder + "/manifest.json")
		require.NoError(t, err)
		assert.False(t, exists)
		entries, err := store.ListDirectory(newFolder)
		require.NoError(t, err)
		assert.Empty(t, entries, "failed run should remove its own folder")
		exists, err = store.FileExists(oldFolder + "/manifest.json")
		require.NoError(t, err)
		assert.True(t, exists, "a failed run must not prune older backups")
	}

	t.Run("dump error", func(t *testing.T) {
		cfg, store := setupBackupTest(t)
		failing := func(context.Context, string, io.Writer) error {
			return errors.New("pg_dump: connection refused")
		}
		_, err := runBackup(context.Background(), cfg, store, failing, testNow)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "pg_dump")
		assertFailedRun(t, store)
	})

	t.Run("pg_dump missing from PATH", func(t *testing.T) {
		cfg, store := setupBackupTest(t)
		t.Setenv("PATH", t.TempDir())
		_, err := runBackup(context.Background(), cfg, store, execPgDump, testNow)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "pg_dump not found")
		assertFailedRun(t, store)
	})
}

func TestRedact(t *testing.T) {
	assert.Equal(t, "auth failed for ****", redact("auth failed for s3cr!t", "s3cr!t"))
	assert.Equal(t, "unchanged", redact("unchanged", ""))
}

func TestRunBackupSkipsFilesForS3Store(t *testing.T) {
	cfg, store := setupBackupTest(t)
	cfg.FileSettings.DriverName = new(model.ImageDriverS3)

	_, err := runBackup(context.Background(), cfg, store, fakeDump("DUMP"), testNow)
	require.NoError(t, err)

	exists, err := store.FileExists(newFolder + "/data.tar.gz")
	require.NoError(t, err)
	assert.False(t, exists)
	assert.True(t, readManifest(t, store, newFolder).FilesSkipped)
}

func TestRunBackupRejectsNonPostgres(t *testing.T) {
	cfg, store := setupBackupTest(t)
	cfg.SqlSettings.DriverName = new("mysql")

	_, err := runBackup(context.Background(), cfg, store, fakeDump("DUMP"), testNow)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "only postgres")
}

func TestSchedulerAndWorkerEnabled(t *testing.T) {
	cfg := &model.Config{}
	cfg.SetDefaults()

	scheduler := MakeScheduler(nil)
	assert.False(t, scheduler.Enabled(cfg))
	assert.False(t, workerEnabled(cfg))

	cfg.BackupSettings.AmazonS3Bucket = new("b")
	assert.True(t, workerEnabled(cfg), "manual backups work while the schedule is off")
	assert.False(t, scheduler.Enabled(cfg))

	cfg.BackupSettings.Enable = new(true)
	assert.True(t, scheduler.Enabled(cfg))
}

// s3LikeStore mimics the S3 behaviour the local backend hides: HEAD needs s3:GetObject (absent
// from the runbook policy), RemoveDirectory deletes by string prefix, and a write can fail
// without reading its input.
type s3LikeStore struct {
	filestore.FileBackend
	writeErr error
}

func (s *s3LikeStore) FileExists(string) (bool, error) {
	return false, errors.New("403 Forbidden")
}

func (s *s3LikeStore) RemoveDirectory(p string) error {
	keys, err := s.FileBackend.ListDirectoryRecursively(path.Dir(p))
	if err != nil {
		return err
	}
	for _, k := range keys {
		if strings.HasPrefix(filepath.ToSlash(k), p) {
			if err := s.RemoveFile(k); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *s3LikeStore) WriteFile(r io.Reader, p string) (int64, error) {
	if s.writeErr != nil {
		return 0, s.writeErr
	}
	return s.FileBackend.WriteFile(r, p)
}

func TestRunBackupPrunesWithoutGetObject(t *testing.T) {
	cfg, local := setupBackupTest(t)
	store := &s3LikeStore{FileBackend: local}

	_, err := runBackup(context.Background(), cfg, store, fakeDump("DUMP"), testNow)
	require.NoError(t, err)

	ok, err := local.FileExists(oldFolder + "/manifest.json")
	require.NoError(t, err)
	assert.False(t, ok, "expired backup should be pruned")
}

func TestRunBackupPruneKeepsPrefixSiblings(t *testing.T) {
	cfg, local := setupBackupTest(t)
	store := &s3LikeStore{FileBackend: local}
	kept := oldFolder + "-pre-upgrade/manifest.json"
	_, err := local.WriteFile(strings.NewReader("{}"), kept)
	require.NoError(t, err)

	_, err = runBackup(context.Background(), cfg, store, fakeDump("DUMP"), testNow)
	require.NoError(t, err)

	ok, err := local.FileExists(kept)
	require.NoError(t, err)
	assert.True(t, ok, "a folder outside the timestamp pattern must never be deleted")
}

func TestRunBackupReportsUploadFailure(t *testing.T) {
	cfg, local := setupBackupTest(t)
	store := &s3LikeStore{FileBackend: local, writeErr: errors.New("NoSuchBucket")}
	// Like pg_dump: a write error surfaces only as an exit status, not wrapped.
	dump := func(_ context.Context, _ string, w io.Writer) error {
		if _, err := io.WriteString(w, strings.Repeat("x", 1<<20)); err != nil {
			return errors.New("pg_dump failed: exit status 1: could not write to output file: Broken pipe")
		}
		return nil
	}

	_, err := runBackup(context.Background(), cfg, store, dump, testNow)
	require.ErrorContains(t, err, "NoSuchBucket")
}
