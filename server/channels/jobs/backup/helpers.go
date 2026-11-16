// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const folderLayout = "20060102-150405"

// libpq query params pg_dump understands; driver-only params (e.g. binary_parameters) are dropped.
var allowedDSNParams = []string{"sslmode", "connect_timeout", "sslrootcert", "sslcert", "sslkey", "application_name", "target_session_attrs"}

func folderName(t time.Time) string {
	return t.UTC().Format(folderLayout)
}

// pgDumpCommand turns a Postgres URL DSN into pg_dump args and env, keeping the password out of argv.
func pgDumpCommand(dsn string) (args []string, env []string, err error) {
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return nil, nil, fmt.Errorf("backup needs SqlSettings.DataSource in URL form (postgres://...)")
	}

	if u.User != nil {
		if pw, ok := u.User.Password(); ok && pw != "" {
			env = append(env, "PGPASSWORD="+pw)
		}
		u.User = url.User(u.User.Username())
	}

	q := u.Query()
	kept := url.Values{}
	for _, k := range allowedDSNParams {
		if v, ok := q[k]; ok {
			kept[k] = v
		}
	}
	u.RawQuery = kept.Encode()

	return []string{"--format=custom", "--no-owner", "--dbname=" + u.String()}, env, nil
}

// selectExpired returns the backup folders older than retentionDays, never the newest complete one.
func selectExpired(folders []string, complete map[string]bool, now time.Time, retentionDays int) []string {
	cutoff := now.AddDate(0, 0, -retentionDays)

	newestComplete := ""
	var newestTime time.Time
	for _, f := range folders {
		t, err := time.Parse(folderLayout, f)
		if err == nil && complete[f] && t.After(newestTime) {
			newestComplete, newestTime = f, t
		}
	}

	var expired []string
	for _, f := range folders {
		t, err := time.Parse(folderLayout, f)
		if err != nil || f == newestComplete {
			continue
		}
		if t.Before(cutoff) {
			expired = append(expired, f)
		}
	}
	return expired
}

// writeTarGz streams the regular files under dir into w as a gzipped tar.
func writeTarGz(w io.Writer, dir string) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)

	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		return addFile(tw, path, filepath.ToSlash(rel))
	})
	if err != nil {
		return err
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// addFile writes one file; a file that vanished since the walk listed it is skipped.
func addFile(tw *tar.Writer, path, name string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	h, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return err
	}
	h.Name = name
	if err := tw.WriteHeader(h); err != nil {
		return err
	}
	// Copy exactly the header size so a file growing mid-copy cannot corrupt the archive.
	_, err = io.CopyN(tw, f, h.Size)
	return err
}
