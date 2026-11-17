// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFolderName(t *testing.T) {
	ts := time.Date(2026, 11, 17, 3, 0, 5, 0, time.FixedZone("TR", 3*3600))
	assert.Equal(t, "20261117-000005", folderName(ts))
}

func TestPgDumpCommand(t *testing.T) {
	t.Run("url with password and extra params", func(t *testing.T) {
		args, env, err := pgDumpCommand("postgres://mmuser:s3cr%21t@postgres:5432/mattermost?sslmode=disable&connect_timeout=10&binary_parameters=yes")
		require.NoError(t, err)
		assert.Equal(t, []string{
			"--format=custom",
			"--no-owner",
			"--dbname=postgres://mmuser@postgres:5432/mattermost?connect_timeout=10&sslmode=disable",
		}, args)
		assert.Equal(t, []string{"PGPASSWORD=s3cr!t"}, env)
		for _, a := range args {
			assert.NotContains(t, a, "s3cr")
		}
	})

	t.Run("url without password", func(t *testing.T) {
		args, env, err := pgDumpCommand("postgresql://u@h/db")
		require.NoError(t, err)
		assert.Empty(t, env)
		assert.Equal(t, "--dbname=postgresql://u@h/db", args[2])
	})

	t.Run("keyword form is rejected", func(t *testing.T) {
		_, _, err := pgDumpCommand("host=h user=u dbname=d")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "URL form")
	})
}

func TestSelectExpired(t *testing.T) {
	now := time.Date(2026, 11, 17, 3, 0, 0, 0, time.UTC)

	t.Run("expired complete and incomplete, skips unknown and recent", func(t *testing.T) {
		folders := []string{"20261020-030000", "20261101-030000", "20261110-030000", "notes", "20261116-030000"}
		complete := map[string]bool{"20261020-030000": true, "20261110-030000": true}
		assert.Equal(t, []string{"20261020-030000", "20261101-030000"}, selectExpired(folders, complete, now, 14))
	})

	t.Run("never deletes the newest complete backup", func(t *testing.T) {
		folders := []string{"20261001-030000"}
		complete := map[string]bool{"20261001-030000": true}
		assert.Empty(t, selectExpired(folders, complete, now, 14))
	})
}

func readTarGz(t *testing.T, data []byte) map[string]string {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(data))
	require.NoError(t, err)
	tr := tar.NewReader(gz)
	files := map[string]string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		b, err := io.ReadAll(tr)
		require.NoError(t, err)
		files[h.Name] = string(b)
	}
	return files
}

func TestWriteTarGzRoundTrip(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("A"), 0600))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "sub"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "sub", "b.txt"), []byte("B"), 0600))

	var buf bytes.Buffer
	require.NoError(t, writeTarGz(&buf, dir))

	assert.Equal(t, map[string]string{"a.txt": "A", "sub/b.txt": "B"}, readTarGz(t, buf.Bytes()))
}

func TestWriteTarGzSkipsVanishedAndSpecialFiles(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "real.txt"), []byte("R"), 0600))
	symlinkErr := os.Symlink(filepath.Join(dir, "real.txt"), filepath.Join(dir, "link.txt"))

	var buf bytes.Buffer
	require.NoError(t, writeTarGz(&buf, dir))
	files := readTarGz(t, buf.Bytes())
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	if symlinkErr == nil {
		assert.Equal(t, []string{"real.txt"}, names)
	}

	// A file listed by the walk but removed before it is opened is skipped, not an error.
	tw := tar.NewWriter(io.Discard)
	assert.NoError(t, addFile(tw, filepath.Join(dir, "gone.txt"), "gone.txt"))
	assert.False(t, strings.Contains(strings.Join(names, ","), "gone"))
}
