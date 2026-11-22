// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
)

func TestAppUsagePrepare(t *testing.T) {
	now := int64(10 * 60 * 60 * 1000)
	day := int64(24 * 60 * 60 * 1000)
	fiveMin := int64(5 * 60 * 1000)
	row := func(edit func(u *AppUsage)) *AppUsage {
		u := &AppUsage{UserId: "other", App: "chrome", Title: "Docs", StartAt: now - 60000, EndAt: now}
		edit(u)
		return u
	}

	t.Run("valid row gets an id and the session user", func(t *testing.T) {
		u := row(func(*AppUsage) {})
		require.True(t, u.Prepare("u1", now))
		require.True(t, IsValidId(u.Id))
		require.Equal(t, "u1", u.UserId)
	})

	for name, edit := range map[string]func(u *AppUsage){
		"empty app":         func(u *AppUsage) { u.App = "" },
		"zero length":       func(u *AppUsage) { u.EndAt = u.StartAt },
		"ends before start": func(u *AppUsage) { u.EndAt = u.StartAt - 1 },
		"longer than a day": func(u *AppUsage) { u.StartAt = 0; u.EndAt = day + 1 },
		"too far in future": func(u *AppUsage) { u.EndAt = now + fiveMin + 1 },
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			require.False(t, row(edit).Prepare("u1", now))
		})
	}

	t.Run("accepts an end exactly five minutes ahead", func(t *testing.T) {
		require.True(t, row(func(u *AppUsage) { u.EndAt = now + fiveMin }).Prepare("u1", now))
	})

	t.Run("truncates by runes", func(t *testing.T) {
		u := row(func(u *AppUsage) {
			u.App = strings.Repeat("ş", 130)
			u.Title = strings.Repeat("😀", 600)
		})
		require.True(t, u.Prepare("u1", now))
		require.Equal(t, 128, utf8.RuneCountInString(u.App))
		require.Equal(t, 512, utf8.RuneCountInString(u.Title))
		require.True(t, utf8.ValidString(u.Title))
	})
}
