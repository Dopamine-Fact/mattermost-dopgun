// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestDailyReportStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGetUpdate", func(t *testing.T) { testDailyReportSaveGetUpdate(t, ss) })
	t.Run("Conflict", func(t *testing.T) { testDailyReportConflict(t, ss) })
	t.Run("GetForTeam", func(t *testing.T) { testDailyReportGetForTeam(t, ss) })
	t.Run("GetPendingBefore", func(t *testing.T) { testDailyReportGetPendingBefore(t, ss) })
}

func newDailyReport(teamID, userID, date string) *model.DailyReport {
	return &model.DailyReport{TeamId: teamID, UserId: userID, Date: date, Message: "msg " + date}
}

func testDailyReportSaveGetUpdate(t *testing.T, ss store.Store) {
	teamID, userID := model.NewId(), model.NewId()

	r := newDailyReport(teamID, userID, "2026-11-16")
	r.Tasks = []model.DailyReportTask{{Id: model.NewId(), Title: "write tests", SectionName: "Sprint"}, {Id: model.NewId(), Title: "ship"}}
	saved, err := ss.DailyReport().Save(r)
	require.NoError(t, err)

	got, err := ss.DailyReport().Get(saved.Id)
	require.NoError(t, err)
	require.Equal(t, saved, got)
	require.Equal(t, model.DailyReportStatusPending, got.Status)
	require.Equal(t, r.Tasks, got.Tasks)

	byDate, err := ss.DailyReport().GetForUserDate(teamID, userID, "2026-11-16")
	require.NoError(t, err)
	require.Equal(t, saved.Id, byDate.Id)

	// A report saved without tasks reads back as an empty list, not nil.
	empty, err := ss.DailyReport().Save(newDailyReport(teamID, userID, "2026-11-17"))
	require.NoError(t, err)
	got, err = ss.DailyReport().Get(empty.Id)
	require.NoError(t, err)
	require.NotNil(t, got.Tasks)
	require.Empty(t, got.Tasks)

	got.Message = "edited"
	got.Status = model.DailyReportStatusApproved
	got.AutoApproved = true
	got.ApprovedBy = model.NewId()
	got.ApprovedAt = model.GetMillis()
	got.Tasks = []model.DailyReportTask{{Id: model.NewId(), Title: "new"}}
	_, err = ss.DailyReport().Update(got)
	require.NoError(t, err)

	again, err := ss.DailyReport().Get(empty.Id)
	require.NoError(t, err)
	require.Equal(t, got, again)

	_, err = ss.DailyReport().Get(model.NewId())
	var nfErr *store.ErrNotFound
	require.ErrorAs(t, err, &nfErr)

	_, err = ss.DailyReport().GetForUserDate(teamID, userID, "2030-01-01")
	require.ErrorAs(t, err, &nfErr)

	_, err = ss.DailyReport().Save(newDailyReport(teamID, "", "2026-11-18"))
	require.Error(t, err)
}

func testDailyReportConflict(t *testing.T, ss store.Store) {
	teamID, userID := model.NewId(), model.NewId()

	_, err := ss.DailyReport().Save(newDailyReport(teamID, userID, "2026-11-16"))
	require.NoError(t, err)

	_, err = ss.DailyReport().Save(newDailyReport(teamID, userID, "2026-11-16"))
	var conflict *store.ErrConflict
	require.ErrorAs(t, err, &conflict)

	// A different day or user does not conflict.
	_, err = ss.DailyReport().Save(newDailyReport(teamID, userID, "2026-11-17"))
	require.NoError(t, err)
	_, err = ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)
}

func testDailyReportGetForTeam(t *testing.T, ss store.Store) {
	teamID, userA, userB := model.NewId(), model.NewId(), model.NewId()

	for _, d := range []string{"2026-11-10", "2026-11-12", "2026-11-14"} {
		_, err := ss.DailyReport().Save(newDailyReport(teamID, userA, d))
		require.NoError(t, err)
	}
	_, err := ss.DailyReport().Save(newDailyReport(teamID, userB, "2026-11-12"))
	require.NoError(t, err)
	_, err = ss.DailyReport().Save(newDailyReport(model.NewId(), userA, "2026-11-12"))
	require.NoError(t, err)

	all, err := ss.DailyReport().GetForTeam(teamID, "2026-11-11", "2026-11-14", "")
	require.NoError(t, err)
	require.Len(t, all, 3)
	require.Equal(t, "2026-11-14", all[0].Date)
	require.Equal(t, "2026-11-12", all[1].Date)
	require.Equal(t, "2026-11-12", all[2].Date)
	// Same date: oldest created first.
	require.Equal(t, userA, all[1].UserId)
	require.Equal(t, userB, all[2].UserId)

	mine, err := ss.DailyReport().GetForTeam(teamID, "2026-11-01", "2026-11-30", userB)
	require.NoError(t, err)
	require.Len(t, mine, 1)
	require.Equal(t, userB, mine[0].UserId)

	none, err := ss.DailyReport().GetForTeam(teamID, "2027-01-01", "2027-01-31", "")
	require.NoError(t, err)
	require.NotNil(t, none)
	require.Empty(t, none)
}

func testDailyReportGetPendingBefore(t *testing.T, ss store.Store) {
	teamID := model.NewId()

	old, err := ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)
	approved, err := ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)
	approved.Status = model.DailyReportStatusApproved
	_, err = ss.DailyReport().Update(approved)
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)
	cutoff := model.GetMillis()
	time.Sleep(5 * time.Millisecond)
	newer, err := ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)

	list, err := ss.DailyReport().GetPendingBefore(cutoff)
	require.NoError(t, err)
	ids := map[string]bool{}
	for _, r := range list {
		ids[r.Id] = true
	}
	require.True(t, ids[old.Id])
	require.False(t, ids[approved.Id])
	require.False(t, ids[newer.Id], "rows created after the cutoff are excluded")
}
