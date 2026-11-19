// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
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
			RejectedBy: th.BasicUser2.Id, RejectReason: "=bad", CreateAt: 4000}}
	var sb strings.Builder
	require.Nil(t, th.App.ExportDailyReportsCSV(&sb, reports))

	assert.True(t, strings.HasPrefix(sb.String(),
		"date,user,message,finished_tasks,status,rejected_by,reject_reason,edited,auto_approved,approved_by,approved_at,submitted_at\n"))
	assert.Contains(t, sb.String(), `2026-11-16,`+th.BasicUser.Username+`,"line one, ""quoted""`)
	assert.Contains(t, sb.String(), `'=cmd|' /c calc`)
	assert.Contains(t, sb.String(), `A; B,approved,,,false,false,`+th.BasicUser2.Username+`,1970-01-01T00:00:01Z,1970-01-01T00:00:02Z`)
	assert.Contains(t, sb.String(), `,rejected,`+th.BasicUser2.Username+`,'=bad,true,false,`)
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
