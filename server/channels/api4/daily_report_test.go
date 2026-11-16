// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestDailyReportsAPI(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id

	t.Run("disabled team returns 403", func(t *testing.T) {
		_, resp, err := th.Client.GetDailyReports(ctx, teamID, "", "", "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.SubmitDailyReport(ctx, teamID, "x")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	enableTeam := func(id string) {
		_, _, err := th.SystemAdminClient.PatchTeam(ctx, id, &model.TeamPatch{
			TasksEnabled: new(true), DailyReportsEnabled: new(true),
			DailyReportTime: new("18:00"), DailyReportTimezone: new("Europe/Istanbul"),
		})
		require.NoError(t, err)
	}
	enableTeam(teamID)

	// teamAdminClient returns a client for a fresh non-sysadmin user who is team admin of the team.
	teamAdminClient := func(team *model.Team) (*model.Client4, *model.User) {
		u := th.CreateUser(t)
		th.LinkUserToTeam(t, u, team)
		_, appErr := th.App.UpdateTeamMemberRoles(th.Context, team.Id, u.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
		require.Nil(t, appErr)
		client := th.CreateClient()
		_, _, err := client.Login(ctx, u.Email, u.Password)
		require.NoError(t, err)
		return client, u
	}

	t.Run("non-member gets 403", func(t *testing.T) {
		other := th.CreateTeamWithClient(t, th.SystemAdminClient)
		enableTeam(other.Id) // enabled, so 403 can only come from the membership check
		_, resp, err := th.Client.GetDailyReports(ctx, other.Id, "", "", "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.SubmitDailyReport(ctx, other.Id, "x")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.ExportDailyReports(ctx, other.Id, "", "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("submit, visibility, approval, export", func(t *testing.T) {
		report, _, err := th.Client.SubmitDailyReport(ctx, teamID, "my day")
		require.NoError(t, err)
		require.Equal(t, th.BasicUser.Id, report.UserId)
		_, _, err = th.SystemAdminClient.SubmitDailyReport(ctx, teamID, "admin day")
		require.NoError(t, err)

		_, resp, err := th.Client.SubmitDailyReport(ctx, teamID, "")
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		_, resp, err = th.Client.SubmitDailyReport(ctx, teamID, strings.Repeat("a", model.DailyReportMessageMaxRunes+1))
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		list, _, err := th.Client.GetDailyReports(ctx, teamID, "", "", "")
		require.NoError(t, err)
		require.Len(t, list, 1)
		list, _, err = th.Client.GetDailyReports(ctx, teamID, "", "", th.SystemAdminUser.Id)
		require.NoError(t, err)
		require.Len(t, list, 1)
		require.Equal(t, th.BasicUser.Id, list[0].UserId)

		list, _, err = th.SystemAdminClient.GetDailyReports(ctx, teamID, "", "", "")
		require.NoError(t, err)
		require.Len(t, list, 2)

		csv, _, err := th.Client.ExportDailyReports(ctx, teamID, "", "")
		require.NoError(t, err)
		require.Contains(t, string(csv), th.BasicUser.Username)
		require.NotContains(t, string(csv), th.SystemAdminUser.Username)

		_, resp, err = th.Client.ApproveDailyReport(ctx, report.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// A team admin of a different daily-reports team cannot approve it.
		otherTeam := th.CreateTeamWithClient(t, th.SystemAdminClient)
		enableTeam(otherTeam.Id)
		outsiderClient, _ := teamAdminClient(otherTeam)
		_, resp, err = outsiderClient.ApproveDailyReport(ctx, report.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		still, appErr := th.App.GetDailyReport(report.Id)
		require.Nil(t, appErr)
		require.Equal(t, model.DailyReportStatusPending, still.Status)

		// A non-sysadmin team admin of the report's team can.
		adminClient, admin := teamAdminClient(th.BasicTeam)
		approved, _, err := adminClient.ApproveDailyReport(ctx, report.Id)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusApproved, approved.Status)
		require.Equal(t, admin.Id, approved.ApprovedBy)

		_, resp, err = th.Client.SubmitDailyReport(ctx, teamID, "late edit")
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("bad dates return 400", func(t *testing.T) {
		for _, c := range [][2]string{{"nope", ""}, {"2026-01-02", "2026-01-01"}, {"2024-01-01", "2026-01-01"}} {
			_, resp, err := th.Client.GetDailyReports(ctx, teamID, c[0], c[1], "")
			require.Error(t, err)
			CheckBadRequestStatus(t, resp)
			_, resp, err = th.Client.ExportDailyReports(ctx, teamID, c[0], c[1])
			require.Error(t, err)
			CheckBadRequestStatus(t, resp)
		}
	})
}
