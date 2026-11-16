// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func validDailyReport() *DailyReport {
	r := &DailyReport{TeamId: NewId(), UserId: NewId(), Date: "2026-11-16", Message: "did things"}
	r.PreSave()
	return r
}

func TestDailyReportIsValid(t *testing.T) {
	require.Nil(t, validDailyReport().IsValid())

	r := validDailyReport()
	require.Equal(t, DailyReportStatusPending, r.Status)
	require.NotNil(t, r.Tasks)

	r = validDailyReport()
	r.Date = "2026-13-01"
	require.NotNil(t, r.IsValid())

	r = validDailyReport()
	r.UserId = ""
	require.NotNil(t, r.IsValid())

	r = validDailyReport()
	r.TeamId = ""
	require.NotNil(t, r.IsValid())

	r = validDailyReport()
	r.Message = strings.Repeat("a", DailyReportMessageMaxRunes+1)
	require.NotNil(t, r.IsValid())

	r = validDailyReport()
	r.Status = "bogus"
	require.NotNil(t, r.IsValid())
}

func TestParseDailyReportTime(t *testing.T) {
	h, m, ok := ParseDailyReportTime("18:00")
	require.True(t, ok)
	require.Equal(t, 18, h)
	require.Equal(t, 0, m)

	for _, s := range []string{"24:00", "9:5", "", "12:60", "ab:cd"} {
		_, _, ok := ParseDailyReportTime(s)
		require.False(t, ok, s)
	}
}

func TestTeamIsValidDailyReport(t *testing.T) {
	newTeam := func() *Team {
		o := &Team{DisplayName: "name", Name: "team" + NewId()[:8], Email: "test@example.com", Type: TeamOpen}
		o.PreSave()
		o.PreUpdate()
		return o
	}

	o := newTeam()
	require.Nil(t, o.IsValid())

	o.DailyReportsEnabled = true
	o.DailyReportTime = "18:00"
	o.DailyReportTimezone = "Europe/Istanbul"
	require.Nil(t, o.IsValid())

	o.DailyReportTime = "25:00"
	require.NotNil(t, o.IsValid())

	o.DailyReportTime = "18:00"
	o.DailyReportTimezone = "Mars/Phobos"
	require.NotNil(t, o.IsValid())

	// Oversized values are rejected even while disabled, so they never reach the DB column limit.
	o = newTeam()
	o.DailyReportTime = "123456"
	require.NotNil(t, o.IsValid())
	o = newTeam()
	o.DailyReportTimezone = strings.Repeat("a", 65)
	require.NotNil(t, o.IsValid())

	o = newTeam()
	o.DailyReportsEnabled = false
	o.DailyReportTime = ""
	o.DailyReportTimezone = ""
	require.Nil(t, o.IsValid())
}
