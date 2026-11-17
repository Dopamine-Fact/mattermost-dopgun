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
	t.Run("Reject", func(t *testing.T) { testDailyReportReject(t, ss) })
	t.Run("SeenUpdateAt", func(t *testing.T) { testDailyReportSeenUpdateAt(t, ss) })
	t.Run("Assignees", func(t *testing.T) { testDailyReportAssignees(t, ss) })
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

	// An approved report can be edited back to pending; Approve only acts on pending reports.
	var conflictErr *store.ErrConflict
	require.ErrorAs(t, ss.DailyReport().Approve(again.Id, model.NewId(), false, 1, 0), &conflictErr)
	edited := *again
	edited.Message = "late edit"
	edited.PreviousMessage = again.Message
	edited.Edited = true
	edited.Status = model.DailyReportStatusPending
	edited.AutoApproved, edited.ApprovedBy, edited.ApprovedAt = false, "", 0
	_, err = ss.DailyReport().Update(&edited)
	require.NoError(t, err)
	reread, err := ss.DailyReport().Get(again.Id)
	require.NoError(t, err)
	require.Equal(t, &edited, reread)
	_, err = ss.DailyReport().Update(&model.DailyReport{Id: model.NewId(), TeamId: teamID, UserId: userID, Date: "2026-11-20", Status: model.DailyReportStatusPending, CreateAt: 1})
	require.ErrorAs(t, err, &nfErr)
	require.ErrorAs(t, ss.DailyReport().Approve(model.NewId(), model.NewId(), false, 1, 0), &nfErr)

	pending, err := ss.DailyReport().Save(newDailyReport(teamID, userID, "2026-11-19"))
	require.NoError(t, err)
	require.NoError(t, ss.DailyReport().Approve(pending.Id, "approver", true, 42, 0))
	approved, err := ss.DailyReport().Get(pending.Id)
	require.NoError(t, err)
	require.Equal(t, model.DailyReportStatusApproved, approved.Status)
	require.True(t, approved.AutoApproved)
	require.Equal(t, "approver", approved.ApprovedBy)
	require.EqualValues(t, 42, approved.ApprovedAt)
	require.Equal(t, pending.Message, approved.Message)

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
	require.False(t, ids[newer.Id], "rows updated after the cutoff are excluded")

	// Editing restarts the clock: the cutoff is measured from UpdateAt, not CreateAt.
	old.Message = "edited"
	_, err = ss.DailyReport().Update(old)
	require.NoError(t, err)
	list, err = ss.DailyReport().GetPendingBefore(cutoff)
	require.NoError(t, err)
	for _, r := range list {
		require.NotEqual(t, old.Id, r.Id)
	}
}

func testDailyReportReject(t *testing.T, ss store.Store) {
	teamID := model.NewId()
	var conflictErr *store.ErrConflict
	var nfErr *store.ErrNotFound

	pending, err := ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)
	require.NoError(t, ss.DailyReport().Reject(pending.Id, "boss", "missing details", 77, 0))
	got, err := ss.DailyReport().Get(pending.Id)
	require.NoError(t, err)
	require.Equal(t, model.DailyReportStatusRejected, got.Status)
	require.Equal(t, "boss", got.RejectedBy)
	require.Equal(t, "missing details", got.RejectReason)
	require.EqualValues(t, 77, got.RejectedAt)
	require.Equal(t, pending.Message, got.Message)

	require.ErrorAs(t, ss.DailyReport().Reject(pending.Id, "boss", "again", 78, 0), &conflictErr)
	require.ErrorAs(t, ss.DailyReport().Reject(model.NewId(), "boss", "x", 1, 0), &nfErr)

	approved, err := ss.DailyReport().Save(newDailyReport(teamID, model.NewId(), "2026-11-16"))
	require.NoError(t, err)
	require.NoError(t, ss.DailyReport().Approve(approved.Id, "", true, 5, 0))
	require.NoError(t, ss.DailyReport().Reject(approved.Id, "boss", "not really done", 80, 0))
	got, err = ss.DailyReport().Get(approved.Id)
	require.NoError(t, err)
	require.Equal(t, model.DailyReportStatusRejected, got.Status)
}

func testDailyReportSeenUpdateAt(t *testing.T, ss store.Store) {
	var conflictErr *store.ErrConflict
	r, err := ss.DailyReport().Save(newDailyReport(model.NewId(), model.NewId(), "2026-11-16"))
	require.NoError(t, err)

	require.ErrorAs(t, ss.DailyReport().Approve(r.Id, "boss", false, 1, r.UpdateAt-1), &conflictErr)
	require.ErrorAs(t, ss.DailyReport().Reject(r.Id, "boss", "why", 1, r.UpdateAt-1), &conflictErr)
	require.NoError(t, ss.DailyReport().Approve(r.Id, "boss", false, 1, r.UpdateAt))
}

func testDailyReportAssignees(t *testing.T, ss store.Store) {
	teamID, otherTeam := model.NewId(), model.NewId()
	a, b, c := model.NewId(), model.NewId(), model.NewId()

	got, err := ss.DailyReport().GetAssignees(teamID)
	require.NoError(t, err)
	require.Empty(t, got)

	require.NoError(t, ss.DailyReport().SetAssignees(otherTeam, []string{c}))
	require.NoError(t, ss.DailyReport().SetAssignees(teamID, []string{b, a}))
	got, err = ss.DailyReport().GetAssignees(teamID)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{a, b}, got)

	require.NoError(t, ss.DailyReport().SetAssignees(teamID, []string{c}))
	got, err = ss.DailyReport().GetAssignees(teamID)
	require.NoError(t, err)
	require.Equal(t, []string{c}, got)

	require.NoError(t, ss.DailyReport().SetAssignees(teamID, []string{}))
	got, err = ss.DailyReport().GetAssignees(teamID)
	require.NoError(t, err)
	require.Empty(t, got)

	got, err = ss.DailyReport().GetAssignees(otherTeam)
	require.NoError(t, err)
	require.Equal(t, []string{c}, got)
}
