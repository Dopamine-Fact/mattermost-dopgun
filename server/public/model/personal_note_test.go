// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validPersonalNote() *PersonalNote {
	n := &PersonalNote{
		TeamId:        NewId(),
		UserId:        NewId(),
		Title:         "Send report",
		Date:          "2026-11-25",
		Time:          "10:00",
		RemindMinutes: PersonalNoteNoReminder,
	}
	n.PreSave()
	return n
}

func TestPersonalNoteIsValid(t *testing.T) {
	for name, tc := range map[string]struct {
		mutate func(n *PersonalNote)
		errID  string
	}{
		"valid timed":           {func(n *PersonalNote) {}, ""},
		"valid all-day":         {func(n *PersonalNote) { n.Time = "" }, ""},
		"valid undated":         {func(n *PersonalNote) { n.Date, n.Time = "", "" }, ""},
		"valid team":            {func(n *PersonalNote) { n.Visibility = PersonalNoteVisibilityTeam }, ""},
		"valid reminder":        {func(n *PersonalNote) { n.RemindMinutes = 10080 }, ""},
		"title 200 runes":       {func(n *PersonalNote) { n.Title = strings.Repeat("ş", 200) }, ""},
		"bad id":                {func(n *PersonalNote) { n.Id = "x" }, "model.personal_note.is_valid.id.app_error"},
		"bad team":              {func(n *PersonalNote) { n.TeamId = "" }, "model.personal_note.is_valid.team_id.app_error"},
		"bad user":              {func(n *PersonalNote) { n.UserId = "" }, "model.personal_note.is_valid.user_id.app_error"},
		"blank title":           {func(n *PersonalNote) { n.Title = "   "; n.PreUpdate() }, "model.personal_note.is_valid.title.app_error"},
		"title 201 runes":       {func(n *PersonalNote) { n.Title = strings.Repeat("ş", 201) }, "model.personal_note.is_valid.title.app_error"},
		"message 4001 runes":    {func(n *PersonalNote) { n.Message = strings.Repeat("ş", 4001) }, "model.personal_note.is_valid.message.app_error"},
		"bad visibility":        {func(n *PersonalNote) { n.Visibility = "public" }, "model.personal_note.is_valid.visibility.app_error"},
		"month 13":              {func(n *PersonalNote) { n.Date = "2026-13-01" }, "model.personal_note.is_valid.date.app_error"},
		"wrong date order":      {func(n *PersonalNote) { n.Date = "25-11-2026" }, "model.personal_note.is_valid.date.app_error"},
		"time 24:00":            {func(n *PersonalNote) { n.Time = "24:00" }, "model.personal_note.is_valid.time.app_error"},
		"single digit hour":     {func(n *PersonalNote) { n.Time = "9:00" }, "model.personal_note.is_valid.time.app_error"},
		"time without date":     {func(n *PersonalNote) { n.Date = "" }, "model.personal_note.is_valid.time.app_error"},
		"reminder without date": {func(n *PersonalNote) { n.Date, n.Time, n.RemindMinutes = "", "", 0 }, "model.personal_note.is_valid.remind_minutes.app_error"},
		"reminder -2":           {func(n *PersonalNote) { n.RemindMinutes = -2 }, "model.personal_note.is_valid.remind_minutes.app_error"},
		"reminder 10081":        {func(n *PersonalNote) { n.RemindMinutes = 10081 }, "model.personal_note.is_valid.remind_minutes.app_error"},
	} {
		t.Run(name, func(t *testing.T) {
			n := validPersonalNote()
			tc.mutate(n)
			err := n.IsValid()
			if tc.errID == "" {
				require.Nil(t, err)
				return
			}
			require.NotNil(t, err)
			assert.Equal(t, tc.errID, err.Id)
		})
	}
}

func TestPersonalNotePreSave(t *testing.T) {
	n := &PersonalNote{Title: "  hello  "}
	n.PreSave()
	assert.True(t, IsValidId(n.Id))
	assert.Equal(t, "hello", n.Title)
	assert.Equal(t, PersonalNoteVisibilityPrivate, n.Visibility)
	assert.NotZero(t, n.CreateAt)
	assert.Equal(t, n.CreateAt, n.UpdateAt)
}

func TestPersonalNoteComputeRemindAt(t *testing.T) {
	ist, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)
	now := time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC).UnixMilli()

	note := func(date, tm string, minutes int) *PersonalNote {
		return &PersonalNote{Date: date, Time: tm, RemindMinutes: minutes}
	}

	n := note("2026-11-25", "10:00", 15)
	n.ComputeRemindAt(ist, now)
	assert.Equal(t, time.Date(2026, 11, 25, 9, 45, 0, 0, ist).UnixMilli(), n.RemindAt)

	n = note("2026-11-25", "", 1440)
	n.ComputeRemindAt(ist, now)
	assert.Equal(t, time.Date(2026, 11, 24, 9, 0, 0, 0, ist).UnixMilli(), n.RemindAt)

	n = note("2026-11-25", "", 1440)
	n.ComputeRemindAt(time.UTC, now)
	assert.Equal(t, time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC).UnixMilli(), n.RemindAt)

	for name, n := range map[string]*PersonalNote{
		"no reminder": note("2026-11-25", "10:00", PersonalNoteNoReminder),
		"in the past": note("2026-11-23", "10:00", 0),
		"done":        {Date: "2026-11-25", Time: "10:00", RemindMinutes: 0, DoneAt: 1},
		"undated":     note("", "", 0),
	} {
		t.Run(name, func(t *testing.T) {
			n.RemindAt = 123
			n.ComputeRemindAt(ist, now)
			assert.Zero(t, n.RemindAt)
		})
	}
}

func TestPersonalNotePatch(t *testing.T) {
	n := validPersonalNote()
	done := true
	n.Patch(&PersonalNotePatch{Done: &done})
	first := n.DoneAt
	require.NotZero(t, first)
	time.Sleep(2 * time.Millisecond)
	n.Patch(&PersonalNotePatch{Done: &done})
	assert.Equal(t, first, n.DoneAt)

	undone := false
	n.Patch(&PersonalNotePatch{Done: &undone})
	assert.Zero(t, n.DoneAt)

	title := "New title"
	minutes := 30
	n.Patch(&PersonalNotePatch{Title: &title, RemindMinutes: &minutes})
	assert.Equal(t, "New title", n.Title)
	assert.Equal(t, 30, n.RemindMinutes)
	assert.Equal(t, "2026-11-25", n.Date)
	assert.Equal(t, "10:00", n.Time)
}
