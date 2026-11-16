// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
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

	_, appErr = th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id)
	require.Nil(t, appErr)
	_, appErr = th.App.SubmitDailyReport(th.Context, team.Id, th.BasicUser.Id, "third")
	require.NotNil(t, appErr)
	assert.Equal(t, "app.daily_report.approved.app_error", appErr.Id)
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

	approved, appErr := th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser2.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DailyReportStatusApproved, approved.Status)
	assert.Equal(t, th.BasicUser2.Id, approved.ApprovedBy)
	assert.False(t, approved.AutoApproved)
	assert.NotZero(t, approved.ApprovedAt)

	again, appErr := th.App.ApproveDailyReport(th.Context, report.Id, th.BasicUser.Id)
	require.Nil(t, appErr)
	assert.Equal(t, th.BasicUser2.Id, again.ApprovedBy, "re-approving keeps the first approver")
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
	}, {Date: "2026-11-17", UserId: th.BasicUser.Id, Message: "=cmd|' /c calc", Status: model.DailyReportStatusPending, CreateAt: 3000}}
	var sb strings.Builder
	require.Nil(t, th.App.ExportDailyReportsCSV(&sb, reports))

	assert.True(t, strings.HasPrefix(sb.String(), "date,user,message,finished_tasks,status,auto_approved,approved_by,approved_at,submitted_at\n"))
	assert.Contains(t, sb.String(), `2026-11-16,`+th.BasicUser.Username+`,"line one, ""quoted""`)
	assert.Contains(t, sb.String(), `'=cmd|' /c calc`)
	assert.Contains(t, sb.String(), `A; B,approved,false,`+th.BasicUser2.Username+`,1970-01-01T00:00:01Z,1970-01-01T00:00:02Z`)
}
