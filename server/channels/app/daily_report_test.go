// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func enableDailyReports(t *testing.T, th *TestHelper) *model.Team {
	t.Helper()
	clone := *th.BasicTeam
	team := &clone
	team.TasksEnabled = true
	team.DailyReportsEnabled = true
	team.DailyReportTime = "18:00"
	team.DailyReportTimezone = "Europe/Istanbul"
	updated, err := th.App.Srv().Store().Team().Update(team)
	require.NoError(t, err)
	return updated
}

func systemBotDMTexts(t *testing.T, th *TestHelper, user *model.User) []string {
	t.Helper()
	bot, appErr := th.App.GetSystemBot(th.Context)
	require.Nil(t, appErr)
	channel, appErr := th.App.GetOrCreateDirectChannel(th.Context, user.Id, bot.UserId)
	require.Nil(t, appErr)
	list, appErr := th.App.GetPostsPage(th.Context, model.GetPostsOptions{ChannelId: channel.Id, PerPage: 50})
	require.Nil(t, appErr)
	var texts []string
	for _, id := range list.Order {
		texts = append(texts, list.Posts[id].Message)
	}
	return texts
}

func TestDailyReportDate(t *testing.T) {
	team := &model.Team{DailyReportTimezone: "Europe/Istanbul"}
	date, err := DailyReportDate(team, time.Date(2026, 11, 16, 21, 30, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.Equal(t, "2026-11-17", date)

	_, err = DailyReportDate(&model.Team{DailyReportTimezone: "Nope/Nowhere"}, time.Now())
	assert.Error(t, err)
}

func TestSubmitDailyReport(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	mkTask := func(title, assignee, status string) {
		_, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: team.Id, Title: title, AssigneeId: assignee, Status: status, CreatorId: th.BasicUser.Id}, "")
		require.Nil(t, appErr)
	}
	mkTask("shipped", th.BasicUser.Id, model.TaskStatusDone)
	mkTask("still open", th.BasicUser.Id, model.TaskStatusTodo)
	mkTask("someone else's", th.BasicUser2.Id, model.TaskStatusDone)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "first")
	require.Nil(t, appErr)
	require.Len(t, report.Tasks, 1)
	assert.Equal(t, "shipped", report.Tasks[0].Title)
	assert.Equal(t, model.DailyReportStatusPending, report.Status)

	again, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "second")
	require.Nil(t, appErr)
	assert.Equal(t, report.Id, again.Id)
	assert.Equal(t, "second", again.Message)

	_, appErr = th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id, 0)
	require.Nil(t, appErr)
	edited, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "third")
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusPending, edited.Status)
	assert.True(t, edited.Edited)
	assert.Equal(t, "second", edited.PreviousMessage, "previous is the text the reviewer approved")
	assert.Empty(t, edited.ApprovedBy)
	assert.Zero(t, edited.ApprovedAt)
}

func TestEditPendingKeepsFirstPrevious(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	for _, msg := range []string{"A", "B", "C"} {
		_, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, msg)
		require.Nil(t, appErr)
	}
	date, err := DailyReportDate(team, time.Now())
	require.NoError(t, err)
	got, err := th.App.Srv().Store().DailyReport().GetForUserDate(team.Id, th.BasicUser.Id, date)
	require.NoError(t, err)
	assert.Equal(t, "C", got.Message)
	assert.Equal(t, "A", got.PreviousMessage, "nobody reviewed B, so the reviewer last saw nothing newer than A")
	assert.True(t, got.Edited)
}

func TestRejectDailyReport(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)

	_, appErr = th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, "   ", 0)
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.reject_reason.app_error", appErr.Id)
	assert.Equal(t, 400, appErr.StatusCode)

	// An auto-approved report can still be rejected.
	th.App.RunDailyReportTick(th.Context, time.UnixMilli(report.UpdateAt).Add(31*time.Minute))
	approved, appErr := th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	require.True(t, approved.AutoApproved)

	rejected, appErr := th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, " add the ticket links ", approved.UpdateAt)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusRejected, rejected.Status)
	assert.Equal(t, "add the ticket links", rejected.RejectReason)
	assert.Equal(t, th.BasicUser2.Id, rejected.RejectedBy)
	assert.NotZero(t, rejected.RejectedAt)

	dms := func() int {
		n := 0
		for _, m := range systemBotDMTexts(t, th, th.BasicUser) {
			if strings.Contains(m, "add the ticket links") {
				n++
			}
		}
		return n
	}
	assert.Equal(t, 1, dms())

	again, appErr := th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser.Id, "other", 0)
	require.Nil(t, appErr)
	assert.Equal(t, th.BasicUser2.Id, again.RejectedBy, "a second reject leaves the first one")
	assert.Equal(t, 1, dms(), "no second DM")

	// The author fixes it: pending again, edited, previous = the rejected text, the last rejection kept.
	fixed, appErr := th.App.UpdateDailyReport(th.Context, report.Id, th.BasicUser.Id, "msg with links")
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusPending, fixed.Status)
	assert.Equal(t, "msg", fixed.PreviousMessage)
	assert.Equal(t, "add the ticket links", fixed.RejectReason)
}

func TestReviewDailyReportStale(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)

	_, appErr = th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id, report.UpdateAt-1)
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.changed.app_error", appErr.Id)
	assert.Equal(t, 409, appErr.StatusCode)
	_, appErr = th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, "why", report.UpdateAt-1)
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.changed.app_error", appErr.Id)

	approved, appErr := th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id, report.UpdateAt)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusApproved, approved.Status)
}

func TestRejectedNotAutoApproved(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	rejected, appErr := th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, "no", 0)
	require.Nil(t, appErr)

	th.App.RunDailyReportTick(th.Context, time.UnixMilli(rejected.UpdateAt).Add(31*time.Minute))
	got, appErr := th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusRejected, got.Status)
}

func TestRejectDailyReportMultilineReason(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	_, appErr = th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, "first line\nsecond line", 0)
	require.Nil(t, appErr)
	dms := strings.Join(systemBotDMTexts(t, th, th.BasicUser), "\n")
	assert.Contains(t, dms, "> first line\n> second line", "every line of the reason stays in the quote")
}

func TestApproveRejectedDailyReport(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	_, appErr = th.App.RejectDailyReport(th.Context, report.Id, th.BasicUser2.Id, "no", 0)
	require.Nil(t, appErr)
	_, appErr = th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id, 0)
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.approve_rejected.app_error", appErr.Id)
	assert.Equal(t, 409, appErr.StatusCode)
}

func TestDailyReportAssigneesIgnoreDeparted(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	_, appErr := th.App.SetDailyReportAssignees(th.Context, team.Id, []string{th.BasicUser2.Id})
	require.Nil(t, appErr)
	require.Nil(t, th.App.RemoveUserFromTeam(th.Context, team.Id, th.BasicUser2.Id, th.SystemAdminUser.Id))

	ids, appErr := th.App.GetDailyReportAssignees(th.Context, team.Id)
	require.Nil(t, appErr)
	assert.Empty(t, ids, "a listed user who left the team no longer counts")
	ok, appErr := th.App.IsDailyReportAssignee(th.Context, team.Id, th.BasicUser.Id)
	require.Nil(t, appErr)
	assert.True(t, ok, "nobody left on the list means everyone reports")

	// 2026-11-16 is a Monday, 10 minutes before the 18:00 deadline.
	loc, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)
	th.App.RunDailyReportTick(th.Context, time.Date(2026, 11, 16, 17, 50, 0, 0, loc))
	assert.Contains(t, strings.Join(systemBotDMTexts(t, th, th.BasicUser), "\n"), "18:00")
}

func TestUpdateDailyReportNotAuthor(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	_, appErr = th.App.UpdateDailyReport(th.Context, report.Id, th.BasicUser2.Id, "hijack")
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.not_author.app_error", appErr.Id)
	assert.Equal(t, 403, appErr.StatusCode)
}

func TestDailyReportAssignees(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	outsider := th.CreateUser(t)
	bot := th.CreateBot(t)
	_, _, appErr := th.App.AddUserToTeam(th.Context, team.Id, bot.UserId, "")
	require.Nil(t, appErr)

	ok, appErr := th.App.IsDailyReportAssignee(th.Context, team.Id, th.BasicUser.Id)
	require.Nil(t, appErr)
	assert.True(t, ok, "an empty list means everyone")

	ids, appErr := th.App.SetDailyReportAssignees(th.Context, team.Id, []string{th.BasicUser2.Id, outsider.Id, bot.UserId, th.BasicUser2.Id})
	require.Nil(t, appErr)
	assert.Equal(t, []string{th.BasicUser2.Id}, ids, "non-members and bots are dropped, duplicates collapsed")
	got, appErr := th.App.GetDailyReportAssignees(th.Context, team.Id)
	require.Nil(t, appErr)
	assert.Equal(t, ids, got)

	_, appErr = th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "not expected")
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.not_assignee.app_error", appErr.Id)
	assert.Equal(t, 403, appErr.StatusCode)

	// 2026-11-16 is a Monday: only the assignee is reminded.
	loc, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)
	th.App.RunDailyReportTick(th.Context, time.Date(2026, 11, 16, 17, 50, 0, 0, loc))
	reminded := func(u *model.User) bool {
		return strings.Contains(strings.Join(systemBotDMTexts(t, th, u), "\n"), "18:00")
	}
	assert.True(t, reminded(th.BasicUser2))
	assert.False(t, reminded(th.BasicUser))

	ids, appErr = th.App.SetDailyReportAssignees(th.Context, team.Id, []string{})
	require.Nil(t, appErr)
	assert.Empty(t, ids)
	_, appErr = th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "back to everyone")
	require.Nil(t, appErr)
}

func TestAutoApproveUsesUpdateAt(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "first")
	require.Nil(t, appErr)
	time.Sleep(5 * time.Millisecond)
	edited, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "second")
	require.Nil(t, appErr)
	require.Greater(t, edited.UpdateAt, report.CreateAt+1)

	// 30 minutes after the first submit but not after the edit: still pending.
	th.App.RunDailyReportTick(th.Context, time.UnixMilli(report.CreateAt+1).Add(30*time.Minute))
	got, appErr := th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusPending, got.Status)

	th.App.RunDailyReportTick(th.Context, time.UnixMilli(edited.UpdateAt).Add(31*time.Minute))
	got, appErr = th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusApproved, got.Status)
}

func TestSubmitDailyReportDisabled(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	_, appErr := th.App.SubmitDailyReport(th.Context, th.BasicTeam.Id, th.BasicUser.Id, "x")
	require.NotNil(t, appErr)
	assert.Equal(t, 403, appErr.StatusCode)
}

func TestApproveDailyReport(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)

	approved, appErr := th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id, 0)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusApproved, approved.Status)
	assert.Equal(t, th.BasicUser2.Id, approved.ApprovedBy)
	assert.False(t, approved.AutoApproved)
	assert.NotZero(t, approved.ApprovedAt)

	approvedDMs := func() int {
		n := 0
		for _, m := range systemBotDMTexts(t, th, th.BasicUser) {
			if strings.Contains(m, "approved by @"+th.BasicUser2.Username) && strings.Contains(m, report.Date) {
				n++
			}
		}
		return n
	}
	assert.Equal(t, 1, approvedDMs(), "the author is told by the system bot")

	again, appErr := th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser.Id, 0)
	require.Nil(t, appErr)
	assert.Equal(t, th.BasicUser2.Id, again.ApprovedBy, "re-approving keeps the first approver")
	assert.Equal(t, 1, approvedDMs(), "no second DM")
}

func TestAutoApproveSendsNoDM(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	th.App.RunDailyReportTick(th.Context, time.UnixMilli(report.UpdateAt).Add(31*time.Minute))
	approved, appErr := th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	require.True(t, approved.AutoApproved)

	for _, m := range systemBotDMTexts(t, th, th.BasicUser) {
		assert.NotContains(t, m, "approved by")
	}
}

func TestRunDailyReportTick(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	loc, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)

	// 2026-11-16 is a Monday; BasicUser has already reported that day, BasicUser2 has not.
	_, err = th.App.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: team.Id, UserId: th.BasicUser.Id, Date: "2026-11-16", Message: "done"})
	require.NoError(t, err)
	deadline := time.Date(2026, 11, 16, 18, 0, 0, 0, loc)

	reminders := func(u *model.User) int {
		n := 0
		for _, m := range systemBotDMTexts(t, th, u) {
			if strings.Contains(m, "18:00") {
				n++
			}
		}
		return n
	}

	th.App.RunDailyReportTick(th.Context, deadline.Add(-7*time.Minute))
	assert.Equal(t, 0, reminders(th.BasicUser2), "7 minutes before is not a reminder slot")

	th.App.RunDailyReportTick(th.Context, deadline.AddDate(0, 0, 5).Add(-10*time.Minute)) // Saturday
	assert.Equal(t, 0, reminders(th.BasicUser2), "no reminders on weekends")

	// Real ticks land a few ms after the minute boundary; that must not shift the slot.
	th.App.RunDailyReportTick(th.Context, deadline.Add(-11*time.Minute+50*time.Millisecond))
	assert.Equal(t, 0, reminders(th.BasicUser2), "11 minutes before is not a reminder slot")

	th.App.RunDailyReportTick(th.Context, deadline.Add(-10*time.Minute+50*time.Millisecond))
	assert.Equal(t, 1, reminders(th.BasicUser2))
	th.App.RunDailyReportTick(th.Context, deadline.Add(-5*time.Minute+50*time.Millisecond))
	assert.Equal(t, 2, reminders(th.BasicUser2))
	assert.Equal(t, 0, reminders(th.BasicUser), "a user with a report that day is not reminded")
	assert.Contains(t, strings.Join(systemBotDMTexts(t, th, th.BasicUser2), "\n"), "/"+team.Name+"/daily_reports")
}

func TestRunDailyReportTickAutoApprove(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "msg")
	require.Nil(t, appErr)
	created := time.UnixMilli(report.CreateAt)

	th.App.RunDailyReportTick(th.Context, created.Add(29*time.Minute))
	got, appErr := th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusPending, got.Status)

	at := created.Add(31 * time.Minute)
	th.App.RunDailyReportTick(th.Context, at)
	got, appErr = th.App.GetDailyReport(report.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusApproved, got.Status)
	assert.True(t, got.AutoApproved)
	assert.Equal(t, at.UnixMilli(), got.ApprovedAt)
}

func TestExportDailyReportsCSV(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	reports := []*model.DailyReport{{
		Date: "2026-11-16", UserId: th.BasicUser.Id, Message: "line one, \"quoted\"\nline two",
		Tasks:  []model.DailyReportTask{{Title: "A"}, {Title: "B"}},
		Status: model.DailyReportStatusApproved, ApprovedBy: th.BasicUser2.Id, ApprovedAt: 1000, CreateAt: 2000,
	}, {Date: "2026-11-17", UserId: th.BasicUser.Id, Message: "=cmd|' /c calc", Status: model.DailyReportStatusPending, CreateAt: 3000},
		{Date: "2026-11-18", UserId: th.BasicUser.Id, Message: "m", Status: model.DailyReportStatusRejected, Edited: true,
			RejectedBy: th.BasicUser2.Id, RejectReason: "=bad", CreateAt: 4000,
			Files: []*model.FileInfo{{Name: "a.png"}, {Name: "b.mp4"}}},
		{Date: "2026-11-19", UserId: th.BasicUser.Id, Message: "unsent", Status: model.DailyReportStatusDraft, CreateAt: 5000}}
	var sb strings.Builder
	require.Nil(t, th.App.ExportDailyReportsCSV(&sb, reports))

	assert.True(t, strings.HasPrefix(sb.String(),
		"date,user,message,finished_tasks,status,rejected_by,reject_reason,edited,auto_approved,approved_by,approved_at,submitted_at,attachments\n"))
	assert.Contains(t, sb.String(), `2026-11-16,`+th.BasicUser.Username+`,"line one, ""quoted""`)
	assert.Contains(t, sb.String(), `'=cmd|' /c calc`)
	assert.Contains(t, sb.String(), `A; B,approved,,,false,false,`+th.BasicUser2.Username+`,1970-01-01T00:00:01Z,1970-01-01T00:00:02Z`)
	assert.Contains(t, sb.String(), `,rejected,`+th.BasicUser2.Username+`,'=bad,true,false,`)
	assert.Contains(t, sb.String(), `,"a.png, b.mp4"`)
	assert.NotContains(t, sb.String(), "unsent", "drafts are not exported")
}

func TestDailyReportEventHasNoContent(t *testing.T) {
	r := &model.DailyReport{Id: "i", TeamId: "t", UserId: "u", Date: "2026-11-16", Message: "secret", Tasks: []model.DailyReportTask{{Title: "private"}}}
	data, err := json.Marshal(dailyReportEvent(r))
	require.NoError(t, err)
	assert.JSONEq(t, `{"id":"i","team_id":"t","user_id":"u","date":"2026-11-16"}`, string(data))
}

func TestSubmitDailyReportConcurrentFirstSubmit(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)

	// Two first submits racing: one Save hits the unique constraint and must fall back to an update, not a 409.
	done := make(chan *model.AppError, 2)
	for _, msg := range []string{"two", "three"} {
		go func() {
			_, e := th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, msg)
			done <- e
		}()
	}
	require.Nil(t, <-done)
	require.Nil(t, <-done)
	date, err := DailyReportDate(team, time.Now())
	require.NoError(t, err)
	reports, appErr := th.App.GetDailyReports(team.Id, date, date, th.BasicUser.Id)
	require.Nil(t, appErr)
	assert.Len(t, reports, 1)
}

func dailyReportPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	return buf.Bytes()
}

func TestDailyReportFiles(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	pngData := dailyReportPNG(t)

	newAuthor := func(t *testing.T) *model.User {
		u := th.CreateUser(t)
		_, _, appErr := th.App.AddUserToTeam(th.Context, team.Id, u.Id, "")
		require.Nil(t, appErr)
		return u
	}
	linked := func(t *testing.T, reportID string) []string {
		ids, err := th.App.Srv().Store().DailyReport().GetFileIds([]string{reportID})
		require.NoError(t, err)
		return ids[reportID]
	}
	today, err := DailyReportDate(team, time.Now())
	require.NoError(t, err)

	t.Run("first upload creates the day's draft, second joins it", func(t *testing.T) {
		u := newAuthor(t)
		first, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		second, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "b.png", pngData)
		require.Nil(t, appErr)

		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		require.Len(t, reports, 1)
		assert.Equal(t, model.DailyReportStatusDraft, reports[0].Status)
		require.Len(t, reports[0].Files, 2)
		assert.Equal(t, []string{first.Id, second.Id}, []string{reports[0].Files[0].Id, reports[0].Files[1].Id})
	})

	t.Run("concurrent first uploads share one draft", func(t *testing.T) {
		u := newAuthor(t)
		done := make(chan *model.AppError, 2)
		for _, name := range []string{"a.png", "b.png"} {
			go func() {
				_, e := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, name, pngData)
				done <- e
			}()
		}
		require.Nil(t, <-done)
		require.Nil(t, <-done)
		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		require.Len(t, reports, 1)
		assert.Len(t, reports[0].Files, 2)
	})

	t.Run("a past unsent day stays closed to its author", func(t *testing.T) {
		day, err := time.Parse(time.DateOnly, today)
		require.NoError(t, err)
		yesterday := day.AddDate(0, 0, -1).Format(time.DateOnly)
		for _, status := range []string{model.DailyReportStatusDraft, model.DailyReportStatusExcused} {
			u := newAuthor(t)
			r, err := th.App.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: team.Id, UserId: u.Id, Date: yesterday, Status: status, Message: "late"})
			require.NoError(t, err)
			_, appErr := th.App.UpdateDailyReport(th.Context, r.Id, u.Id, "late")
			require.NotNil(t, appErr, status)
			assert.Equal(t, "app.daily_report.day_closed.app_error", appErr.Id)
			_, appErr = th.App.AddDailyReportFile(th.Context, r.Id, u.Id, "a.png", pngData)
			require.NotNil(t, appErr, status)
			assert.Equal(t, "app.daily_report.day_closed.app_error", appErr.Id)
			assert.Empty(t, linked(t, r.Id))
		}
	})

	t.Run("a file change keeps a newer message", func(t *testing.T) {
		u := newAuthor(t)
		sent, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "first")
		require.Nil(t, appErr)
		stale, appErr := th.App.GetDailyReport(sent.Id)
		require.Nil(t, appErr)
		_, appErr = th.App.UpdateDailyReport(th.Context, sent.Id, u.Id, "second")
		require.Nil(t, appErr)

		require.Nil(t, th.App.dailyReportFilesChanged(th.Context, "test", stale))
		got, appErr := th.App.GetDailyReport(sent.Id)
		require.Nil(t, appErr)
		assert.Equal(t, "second", got.Message)
	})

	t.Run("refused files", func(t *testing.T) {
		u := newAuthor(t)
		_, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "x.png", []byte("<html><body>hi</body></html>"))
		require.NotNil(t, appErr)
		assert.Equal(t, "app.daily_report.file_type.app_error", appErr.Id)
		assert.Equal(t, 400, appErr.StatusCode)
		_, appErr = th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "x.exe", []byte("MZ"))
		require.NotNil(t, appErr)
		assert.Equal(t, 400, appErr.StatusCode)

		for i := range model.DailyReportMaxFiles {
			_, appErr = th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, fmt.Sprintf("%d.png", i), pngData)
			require.Nil(t, appErr)
		}
		before, err := th.App.Srv().Store().FileInfo().GetForUser(u.Id)
		require.NoError(t, err)
		_, appErr = th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "eleventh.png", pngData)
		require.NotNil(t, appErr)
		assert.Equal(t, "app.daily_report.too_many_files.app_error", appErr.Id)
		assert.Equal(t, 400, appErr.StatusCode)
		after, err := th.App.Srv().Store().FileInfo().GetForUser(u.Id)
		require.NoError(t, err)
		assert.Len(t, after, len(before), "a refused 11th file leaves nothing stored")
	})

	t.Run("concurrent uploads stop at the limit", func(t *testing.T) {
		u := newAuthor(t)
		for i := range model.DailyReportMaxFiles - 1 {
			_, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, fmt.Sprintf("%d.png", i), pngData)
			require.Nil(t, appErr)
		}
		const racers = 3
		done := make(chan *model.AppError, racers)
		for i := range racers {
			go func() {
				_, e := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, fmt.Sprintf("race%d.png", i), pngData)
				done <- e
			}()
		}
		refused := 0
		for range racers {
			if e := <-done; e != nil {
				assert.Equal(t, "app.daily_report.too_many_files.app_error", e.Id)
				refused++
			}
		}
		assert.Equal(t, racers-1, refused)
		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		assert.Len(t, linked(t, reports[0].Id), model.DailyReportMaxFiles)
	})

	t.Run("the last file of a sent report without text stays", func(t *testing.T) {
		u := newAuthor(t)
		info, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		sent, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "")
		require.Nil(t, appErr)
		appErr = th.App.RemoveDailyReportFile(th.Context, sent.Id, info.Id, u.Id)
		require.NotNil(t, appErr)
		assert.Equal(t, "app.daily_report.empty.app_error", appErr.Id)
		assert.Equal(t, 400, appErr.StatusCode)
		assert.Equal(t, []string{info.Id}, linked(t, sent.Id))
		_, appErr = th.App.GetFileInfo(th.Context, info.Id)
		require.Nil(t, appErr, "the file itself is kept")
	})

	t.Run("sending a draft stamps the send time", func(t *testing.T) {
		u := newAuthor(t)
		_, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		draftAt := reports[0].CreateAt
		time.Sleep(5 * time.Millisecond)
		sent, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "done")
		require.Nil(t, appErr)
		assert.Greater(t, sent.CreateAt, draftAt)
		stored, appErr := th.App.GetDailyReport(sent.Id)
		require.Nil(t, appErr)
		assert.Equal(t, sent.CreateAt, stored.CreateAt)
	})

	t.Run("file changes on a sent report are an edit, on a draft they are not", func(t *testing.T) {
		u := newAuthor(t)
		draftFile, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		extra, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "b.png", pngData)
		require.Nil(t, appErr)
		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		reportID := reports[0].Id
		require.Nil(t, th.App.RemoveDailyReportFile(th.Context, reportID, extra.Id, u.Id))
		report, appErr := th.App.GetDailyReport(reportID)
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusDraft, report.Status)

		_, appErr = th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "done")
		require.Nil(t, appErr)
		_, appErr = th.App.ApproveDailyReport(th.Context, reportID, th.BasicUser.Id, 0)
		require.Nil(t, appErr)
		_, appErr = th.App.AddDailyReportFile(th.Context, reportID, u.Id, "c.png", pngData)
		require.Nil(t, appErr)
		report, appErr = th.App.GetDailyReport(reportID)
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusPending, report.Status)
		assert.True(t, report.Edited)
		assert.Empty(t, report.ApprovedBy)

		_, appErr = th.App.ApproveDailyReport(th.Context, reportID, th.BasicUser.Id, 0)
		require.Nil(t, appErr)
		require.Nil(t, th.App.RemoveDailyReportFile(th.Context, reportID, draftFile.Id, u.Id))
		report, appErr = th.App.GetDailyReport(reportID)
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusPending, report.Status)
		assert.True(t, report.Edited)
	})

	t.Run("only the author attaches", func(t *testing.T) {
		u := newAuthor(t)
		report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "mine")
		require.Nil(t, appErr)
		_, appErr = th.App.AddDailyReportFile(th.Context, report.Id, th.BasicUser.Id, "a.png", pngData)
		require.NotNil(t, appErr)
		assert.Equal(t, 403, appErr.StatusCode)
		info, appErr := th.App.AddDailyReportFile(th.Context, report.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		appErr = th.App.RemoveDailyReportFile(th.Context, report.Id, info.Id, th.BasicUser.Id)
		require.NotNil(t, appErr)
		assert.Equal(t, 403, appErr.StatusCode)
	})

	t.Run("remove deletes the file and the link", func(t *testing.T) {
		u := newAuthor(t)
		info, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		require.Nil(t, th.App.RemoveDailyReportFile(th.Context, reports[0].Id, info.Id, u.Id))
		_, appErr = th.App.GetFileInfo(th.Context, info.Id)
		require.NotNil(t, appErr)
		assert.Equal(t, 404, appErr.StatusCode)
		assert.Empty(t, linked(t, reports[0].Id))
	})

	t.Run("a file is read only through its own report", func(t *testing.T) {
		u, other := newAuthor(t), newAuthor(t)
		info, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		otherReport, appErr := th.App.SubmitDailyReport(th.Context, team.Id, other.Id, "other")
		require.Nil(t, appErr)
		_, appErr = th.App.GetDailyReportFile(th.Context, otherReport.Id, info.Id)
		require.NotNil(t, appErr)
		assert.Equal(t, 404, appErr.StatusCode)

		reports, appErr := th.App.GetDailyReports(team.Id, today, today, u.Id)
		require.Nil(t, appErr)
		got, appErr := th.App.GetDailyReportFile(th.Context, reports[0].Id, info.Id)
		require.Nil(t, appErr)
		assert.Equal(t, info.Id, got.Id)
	})

	t.Run("sending a draft is a first submission and may carry no text", func(t *testing.T) {
		u := newAuthor(t)
		_, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "  ")
		require.NotNil(t, appErr)
		assert.Equal(t, "app.daily_report.empty.app_error", appErr.Id)
		assert.Equal(t, 400, appErr.StatusCode)

		_, appErr = th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", pngData)
		require.Nil(t, appErr)
		report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "")
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusPending, report.Status)
		assert.False(t, report.Edited)
		assert.Empty(t, report.PreviousMessage)
		assert.Len(t, report.Files, 1)
	})

	t.Run("sending over an excused day", func(t *testing.T) {
		u := newAuthor(t)
		_, err := th.App.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: team.Id, UserId: u.Id, Date: today,
			Status: model.DailyReportStatusExcused, ApprovedBy: th.BasicUser.Id, ApprovedAt: model.GetMillis(), Tasks: []model.DailyReportTask{}})
		require.NoError(t, err)
		report, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "came in after all")
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusPending, report.Status)
		assert.Empty(t, report.ApprovedBy)
		assert.Zero(t, report.ApprovedAt)
		assert.False(t, report.Edited)
	})
}

func TestExcuseDailyReport(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	reviewer := th.BasicUser.Id
	today, err := DailyReportDate(team, time.Now())
	require.NoError(t, err)
	newAuthor := func(t *testing.T) *model.User {
		u := th.CreateUser(t)
		_, _, appErr := th.App.AddUserToTeam(th.Context, team.Id, u.Id, "")
		require.Nil(t, appErr)
		return u
	}

	t.Run("no report", func(t *testing.T) {
		u := newAuthor(t)
		report, appErr := th.App.ExcuseDailyReport(th.Context, team.Id, u.Id, today, reviewer)
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusExcused, report.Status)
		assert.Equal(t, reviewer, report.ApprovedBy)
		assert.NotZero(t, report.ApprovedAt)
		assert.Empty(t, report.Message)
	})

	t.Run("a draft keeps its files, unseen by the reviewer", func(t *testing.T) {
		u := newAuthor(t)
		info, appErr := th.App.AddMyDailyReportFile(th.Context, team.Id, u.Id, "a.png", dailyReportPNG(t))
		require.Nil(t, appErr)
		report, appErr := th.App.ExcuseDailyReport(th.Context, team.Id, u.Id, today, reviewer)
		require.Nil(t, appErr)
		assert.Equal(t, model.DailyReportStatusExcused, report.Status)
		assert.Equal(t, reviewer, report.ApprovedBy)
		assert.Empty(t, report.Files)
		ids, err := th.App.Srv().Store().DailyReport().GetFileIds([]string{report.Id})
		require.NoError(t, err)
		assert.Equal(t, []string{info.Id}, ids[report.Id])
	})

	t.Run("a sent report cannot be excused", func(t *testing.T) {
		u := newAuthor(t)
		_, appErr := th.App.SubmitDailyReport(th.Context, team.Id, u.Id, "here")
		require.Nil(t, appErr)
		_, appErr = th.App.ExcuseDailyReport(th.Context, team.Id, u.Id, today, reviewer)
		require.NotNil(t, appErr)
		assert.Equal(t, "app.daily_report.already_sent.app_error", appErr.Id)
		assert.Equal(t, 409, appErr.StatusCode)
	})

	t.Run("future days cannot be excused", func(t *testing.T) {
		u := newAuthor(t)
		day, err := time.Parse(time.DateOnly, today)
		require.NoError(t, err)
		_, appErr := th.App.ExcuseDailyReport(th.Context, team.Id, u.Id, day.AddDate(0, 0, 1).Format(time.DateOnly), reviewer)
		require.NotNil(t, appErr)
		assert.Equal(t, 400, appErr.StatusCode)
		_, appErr = th.App.ExcuseDailyReport(th.Context, team.Id, u.Id, "not-a-date", reviewer)
		require.NotNil(t, appErr)
		assert.Equal(t, 400, appErr.StatusCode)
	})
}

func TestDailyReportRemindersIgnoreDrafts(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	loc, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)

	// 2026-11-16 is a Monday: BasicUser only has a draft, BasicUser2 was excused.
	for _, r := range []*model.DailyReport{
		{TeamId: team.Id, UserId: th.BasicUser.Id, Date: "2026-11-16", Status: model.DailyReportStatusDraft},
		{TeamId: team.Id, UserId: th.BasicUser2.Id, Date: "2026-11-16", Status: model.DailyReportStatusExcused, ApprovedBy: th.SystemAdminUser.Id, ApprovedAt: 1},
	} {
		_, err = th.App.Srv().Store().DailyReport().Save(r)
		require.NoError(t, err)
	}
	th.App.RunDailyReportTick(th.Context, time.Date(2026, 11, 16, 17, 50, 0, 0, loc))
	assert.Contains(t, strings.Join(systemBotDMTexts(t, th, th.BasicUser), "\n"), "18:00", "a draft is not a report")
	assert.NotContains(t, strings.Join(systemBotDMTexts(t, th, th.BasicUser2), "\n"), "18:00", "an excused day needs no report")
}

func TestDailyReportTickCleansUp(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := enableDailyReports(t, th)
	loc, err := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, err)
	pngData := dailyReportPNG(t)

	// A row with one file, linked the way an upload links it.
	withFile := func(userID, date, status string) (*model.DailyReport, *model.FileInfo) {
		r, err := th.App.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: team.Id, UserId: userID, Date: date, Status: status})
		require.NoError(t, err)
		info, appErr := th.App.UploadFileForUserAndTeam(th.Context, pngData, "", "a.png", userID, team.Id)
		require.Nil(t, appErr)
		require.NoError(t, th.App.Srv().Store().DailyReport().AddFile(r.Id, info.Id, info.CreateAt, model.DailyReportMaxFiles))
		return r, info
	}
	oldDraft, oldDraftFile := withFile(th.BasicUser.Id, "2026-11-17", model.DailyReportStatusDraft)
	todayDraft, todayDraftFile := withFile(th.BasicUser.Id, "2026-11-18", model.DailyReportStatusDraft)
	oldExcused, oldExcusedFile := withFile(th.BasicUser2.Id, "2026-11-17", model.DailyReportStatusExcused)

	th.App.RunDailyReportTick(th.Context, time.Date(2026, 11, 18, 9, 0, 0, 0, loc))

	_, appErr := th.App.GetDailyReport(oldDraft.Id)
	require.NotNil(t, appErr)
	assert.Equal(t, 404, appErr.StatusCode, "yesterday's unsent draft is gone")
	_, appErr = th.App.GetFileInfo(th.Context, oldDraftFile.Id)
	require.NotNil(t, appErr, "with its file")

	got, appErr := th.App.GetDailyReport(todayDraft.Id)
	require.Nil(t, appErr)
	require.Len(t, got.Files, 1)
	assert.Equal(t, todayDraftFile.Id, got.Files[0].Id)

	got, appErr = th.App.GetDailyReport(oldExcused.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusExcused, got.Status)
	assert.Empty(t, got.Files)
	_, appErr = th.App.GetFileInfo(th.Context, oldExcusedFile.Id)
	require.NotNil(t, appErr)
}
