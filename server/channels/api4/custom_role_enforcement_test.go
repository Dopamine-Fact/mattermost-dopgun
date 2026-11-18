// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestCustomRoleEnforcement(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamID, &model.TeamPatch{
		TasksEnabled: new(true), RevisionsEnabled: new(true),
		DailyReportsEnabled: new(true), DailyReportTime: new("18:00"), DailyReportTimezone: new("Europe/Istanbul"),
	})
	require.NoError(t, err)

	animDept := newTestDepartment(t, th, teamID, "Anim")
	progDept := newTestDepartment(t, th, teamID, "Prog")
	leadAnim := newTestRank(t, th, teamID, animDept.Id, "LeadAnim", model.PermissionManageTasks.Id, model.PermissionManageRevisions.Id, model.PermissionManageDailyReports.Id)
	leadProg := newTestRank(t, th, teamID, progDept.Id, "LeadProg")
	anim := newTestRank(t, th, teamID, animDept.Id, "Anim")
	prog := newTestRank(t, th, teamID, progDept.Id, "Prog")
	member := func(ranks ...*model.CustomRole) (*model.Client4, *model.User) {
		return rankedClient(t, th, th.BasicTeam, ranks...)
	}
	leadClient, lead := member(leadAnim)
	animClient, animUser := member(anim)
	progClient, progUser := member(prog)
	_, leadProgUser := member(leadProg)

	adminClient, admin := member()
	_, appErr := th.App.UpdateTeamMemberRoles(th.Context, teamID, admin.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
	require.Nil(t, appErr)

	t.Run("task assignee must be outranked", func(t *testing.T) {
		task, resp, err := leadClient.CreateTask(ctx, &model.Task{TeamId: teamID, Title: "anim", AssigneeId: animUser.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, resp, err = leadClient.CreateTask(ctx, &model.Task{TeamId: teamID, Title: "prog", AssigneeId: progUser.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = leadClient.CreateTask(ctx, &model.Task{TeamId: teamID, Title: "mine", AssigneeId: lead.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, resp, err = leadClient.PatchTask(ctx, task.Id, &model.TaskPatch{AssigneeId: &leadProgUser.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		section, _, err := leadClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamID, Name: "rev", ChannelId: th.BasicChannel.Id})
		require.NoError(t, err)
		section = uploadSectionVideo(t, leadClient, section.Id)
		rev, resp, err := leadClient.CreateTask(ctx, &model.Task{TeamId: teamID, SectionId: section.Id, Title: "frame 12", AssigneeId: animUser.Id, VideoFileId: section.VideoFileId})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, resp, err = leadClient.CreateTask(ctx, &model.Task{TeamId: teamID, SectionId: section.Id, Title: "frame 13", AssigneeId: progUser.Id, VideoFileId: section.VideoFileId})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = leadClient.PatchTask(ctx, rev.Id, &model.TaskPatch{AssigneeId: &progUser.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// A team admin without custom roles keeps every action.
		_, resp, err = adminClient.CreateTask(ctx, &model.Task{TeamId: teamID, Title: "admin", AssigneeId: progUser.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, _, err = adminClient.PatchTask(ctx, task.Id, &model.TaskPatch{AssigneeId: &leadProgUser.Id})
		require.NoError(t, err)
	})

	t.Run("daily reports are limited to outranked users", func(t *testing.T) {
		animReport, _, err := animClient.SubmitDailyReport(ctx, teamID, "anim day")
		require.NoError(t, err)
		progReport, _, err := progClient.SubmitDailyReport(ctx, teamID, "prog day")
		require.NoError(t, err)
		leadReport, _, err := leadClient.SubmitDailyReport(ctx, teamID, "lead day")
		require.NoError(t, err)
		adminReport, _, err := adminClient.SubmitDailyReport(ctx, teamID, "admin day")
		require.NoError(t, err)

		// A lead reviews the people below them, never their own report or an admin's.
		_, resp, err := leadClient.ApproveDailyReport(ctx, leadReport.Id, leadReport.UpdateAt)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = leadClient.RejectDailyReport(ctx, adminReport.Id, "no", adminReport.UpdateAt)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, _, err = adminClient.ApproveDailyReport(ctx, adminReport.Id, adminReport.UpdateAt)
		require.NoError(t, err, "team admins still review their own report")

		authors := func(list []*model.DailyReport) map[string]bool {
			m := map[string]bool{}
			for _, r := range list {
				m[r.UserId] = true
			}
			return m
		}
		list, _, err := leadClient.GetDailyReports(ctx, teamID, "", "", "")
		require.NoError(t, err)
		require.Equal(t, map[string]bool{lead.Id: true, animUser.Id: true}, authors(list))

		list, _, err = leadClient.GetDailyReports(ctx, teamID, "", "", animUser.Id)
		require.NoError(t, err)
		require.Len(t, list, 1)
		_, resp, err = leadClient.GetDailyReports(ctx, teamID, "", "", progUser.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		csv, _, err := leadClient.ExportDailyReports(ctx, teamID, "", "")
		require.NoError(t, err)
		require.Contains(t, string(csv), animUser.Username)
		require.NotContains(t, string(csv), progUser.Username)

		_, resp, err = leadClient.ApproveDailyReport(ctx, progReport.Id, progReport.UpdateAt)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = leadClient.RejectDailyReport(ctx, progReport.Id, "no", progReport.UpdateAt)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		approved, _, err := leadClient.ApproveDailyReport(ctx, animReport.Id, animReport.UpdateAt)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusApproved, approved.Status)

		list, _, err = adminClient.GetDailyReports(ctx, teamID, "", "", "")
		require.NoError(t, err)
		require.True(t, authors(list)[progUser.Id])
		_, _, err = adminClient.ApproveDailyReport(ctx, progReport.Id, progReport.UpdateAt)
		require.NoError(t, err)
	})
}
