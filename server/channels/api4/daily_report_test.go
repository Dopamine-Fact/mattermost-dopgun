// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

func TestDailyReportsAPI(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	// Assigning to or reviewing BasicUser2 needs a rank that outranks them and carries the permission.
	rank := giveRankingRole(t, th, th.BasicUser)
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

		_, resp, err = th.Client.ApproveDailyReport(ctx, report.Id, 0)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// A team admin of a different daily-reports team cannot approve it.
		otherTeam := th.CreateTeamWithClient(t, th.SystemAdminClient)
		enableTeam(otherTeam.Id)
		outsiderClient, _ := teamAdminClient(otherTeam)
		_, resp, err = outsiderClient.ApproveDailyReport(ctx, report.Id, 0)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		still, appErr := th.App.GetDailyReport(report.Id)
		require.Nil(t, appErr)
		require.Equal(t, model.DailyReportStatusPending, still.Status)

		// A non-sysadmin team admin of the report's team can.
		adminClient, admin := teamAdminClient(th.BasicTeam)
		_, resp, err = adminClient.ApproveDailyReport(ctx, report.Id, report.UpdateAt-1)
		require.Error(t, err)
		require.Equal(t, http.StatusConflict, resp.StatusCode)
		approved, _, err := adminClient.ApproveDailyReport(ctx, report.Id, report.UpdateAt)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusApproved, approved.Status)
		require.Equal(t, admin.Id, approved.ApprovedBy)

		edited, _, err := th.Client.SubmitDailyReport(ctx, teamID, "late edit")
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusPending, edited.Status)
		require.True(t, edited.Edited)
		require.Equal(t, "my day", edited.PreviousMessage)
	})

	t.Run("reject, update, assignees", func(t *testing.T) {
		report, _, err := th.Client.SubmitDailyReport(ctx, teamID, "v1")
		require.NoError(t, err)

		_, resp, err := th.Client.RejectDailyReport(ctx, report.Id, "nope", 0)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		adminClient, admin := teamAdminClient(th.BasicTeam)
		_, resp, err = adminClient.RejectDailyReport(ctx, report.Id, "  ", 0)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		_, resp, err = adminClient.RejectDailyReport(ctx, report.Id, "add details", report.UpdateAt-1)
		require.Error(t, err)
		require.Equal(t, http.StatusConflict, resp.StatusCode)
		rejected, _, err := adminClient.RejectDailyReport(ctx, report.Id, "add details", report.UpdateAt)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusRejected, rejected.Status)
		require.Equal(t, admin.Id, rejected.RejectedBy)
		require.Equal(t, "add details", rejected.RejectReason)

		_, resp, err = th.SystemAdminClient.UpdateDailyReport(ctx, report.Id, "hijack")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		updated, _, err := th.Client.UpdateDailyReport(ctx, report.Id, "v2")
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusPending, updated.Status)
		require.True(t, updated.Edited)
		require.Equal(t, "v2", updated.Message)

		_, resp, err = th.Client.SetDailyReportAssignees(ctx, teamID, []string{th.BasicUser.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		ids, _, err := adminClient.SetDailyReportAssignees(ctx, teamID, []string{th.BasicUser.Id, th.BasicUser.Id})
		require.NoError(t, err)
		require.Equal(t, []string{th.BasicUser.Id}, ids)
		ids, _, err = th.Client.GetDailyReportAssignees(ctx, teamID)
		require.NoError(t, err)
		require.Equal(t, []string{th.BasicUser.Id}, ids)

		// Not on the list: cannot submit.
		_, resp, err = th.SystemAdminClient.SubmitDailyReport(ctx, teamID, "x")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		ids, _, err = adminClient.SetDailyReportAssignees(ctx, teamID, nil)
		require.NoError(t, err, "nil means everyone, like an empty list")
		require.Empty(t, ids)
	})

	t.Run("manage_daily_reports alone approves; manage_tasks alone does not", func(t *testing.T) {
		client2 := th.CreateClient()
		th.LoginBasic2WithClient(t, client2)
		report, _, err := client2.SubmitDailyReport(ctx, teamID, "split day")
		require.NoError(t, err)

		th.AddPermissionToRole(t, model.PermissionManageTasks.Id, rank.RoleName)
		_, resp, err := th.Client.ApproveDailyReport(ctx, report.Id, report.UpdateAt)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		th.RemovePermissionFromRole(t, model.PermissionManageTasks.Id, rank.RoleName)

		th.AddPermissionToRole(t, model.PermissionManageDailyReports.Id, rank.RoleName)
		defer th.RemovePermissionFromRole(t, model.PermissionManageDailyReports.Id, rank.RoleName)
		list, _, err := th.Client.GetDailyReports(ctx, teamID, "", "", th.BasicUser2.Id)
		require.NoError(t, err)
		require.NotEmpty(t, list)
		approved, _, err := th.Client.ApproveDailyReport(ctx, report.Id, report.UpdateAt)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusApproved, approved.Status)
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

func TestDailyReportFilesAPI(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id
	team, _, err := th.SystemAdminClient.PatchTeam(ctx, teamID, &model.TeamPatch{
		TasksEnabled: new(true), DailyReportsEnabled: new(true),
		DailyReportTime: new("18:00"), DailyReportTimezone: new("Europe/Istanbul"),
	})
	require.NoError(t, err)
	// BasicUser reviews: a rank that outranks BasicUser2 and carries manage_daily_reports.
	rank := giveRankingRole(t, th, th.BasicUser)
	th.AddPermissionToRole(t, model.PermissionManageDailyReports.Id, rank.RoleName)
	reviewer := th.Client
	author := th.CreateClient()
	th.LoginBasic2WithClient(t, author)
	member := th.CreateClient()
	memberUser := th.CreateUser(t)
	th.LinkUserToTeam(t, memberUser, th.BasicTeam)
	_, _, err = member.Login(ctx, memberUser.Email, memberUser.Password)
	require.NoError(t, err)

	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	pngData := buf.Bytes()

	info, _, err := author.AddMyDailyReportFile(ctx, teamID, "progress.png", pngData)
	require.NoError(t, err)
	mine, _, err := author.GetDailyReports(ctx, teamID, "", "", "")
	require.NoError(t, err)
	require.Len(t, mine, 1)
	draft := mine[0]
	require.Equal(t, model.DailyReportStatusDraft, draft.Status)
	require.Len(t, draft.Files, 1)

	t.Run("a draft stays hidden from the reviewer", func(t *testing.T) {
		_, resp, err := reviewer.GetDailyReportFile(ctx, draft.Id, info.Id)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
		for _, userID := range []string{"", th.BasicUser2.Id} {
			list, _, err := reviewer.GetDailyReports(ctx, teamID, "", "", userID)
			require.NoError(t, err)
			for _, r := range list {
				require.NotEqual(t, draft.Id, r.Id)
			}
		}
	})

	t.Run("only the author removes", func(t *testing.T) {
		resp, err := reviewer.RemoveDailyReportFile(ctx, draft.Id, info.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	sent, _, err := author.SubmitDailyReport(ctx, teamID, "")
	require.NoError(t, err, "files alone make a report")
	require.Equal(t, model.DailyReportStatusPending, sent.Status)

	t.Run("after sending the reviewer reads the file", func(t *testing.T) {
		data, resp, err := reviewer.GetDailyReportFile(ctx, sent.Id, info.Id)
		require.NoError(t, err)
		require.Equal(t, pngData, data)
		require.Equal(t, "image/png", resp.Header.Get("Content-Type"))

		r, err := reviewer.DoAPIRequestWithHeaders(ctx, http.MethodGet, "/daily_reports/"+sent.Id+"/files/"+info.Id, "", map[string]string{"Range": "bytes=0-3"})
		require.NoError(t, err)
		defer r.Body.Close()
		require.Equal(t, http.StatusPartialContent, r.StatusCode)

		r2, err := reviewer.DoAPIRequestWithHeaders(ctx, http.MethodGet, "/daily_reports/"+sent.Id+"/files/"+info.Id+"/thumbnail", "", nil)
		require.NoError(t, err)
		defer r2.Body.Close()
		require.Equal(t, http.StatusOK, r2.StatusCode)
		require.Equal(t, "image/jpeg", r2.Header.Get("Content-Type"))
	})

	t.Run("a member who cannot review gets 403", func(t *testing.T) {
		_, resp, err := member.GetDailyReportFile(ctx, sent.Id, info.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("a file over the default 300 KB request cap uploads", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, 400, 400))
		x := uint32(1)
		for i := range img.Pix { // noise, so the PNG does not compress below the cap
			x = x*1664525 + 1013904223
			img.Pix[i] = byte(x >> 24)
		}
		var big bytes.Buffer
		require.NoError(t, png.Encode(&big, img))
		require.Greater(t, big.Len(), 300*1024)
		_, _, err := author.AddDailyReportFile(ctx, sent.Id, "big.png", big.Bytes())
		require.NoError(t, err)
	})

	t.Run("excuse", func(t *testing.T) {
		today, err := app.DailyReportDate(team, time.Now())
		require.NoError(t, err)
		absent := th.CreateUser(t)
		th.LinkUserToTeam(t, absent, th.BasicTeam)
		excused, _, err := reviewer.ExcuseDailyReport(ctx, teamID, absent.Id, today)
		require.NoError(t, err)
		require.Equal(t, model.DailyReportStatusExcused, excused.Status)
		require.Equal(t, th.BasicUser.Id, excused.ApprovedBy)

		_, resp, err := reviewer.ExcuseDailyReport(ctx, teamID, th.BasicUser.Id, today)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = member.ExcuseDailyReport(ctx, teamID, absent.Id, today)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		outsider := th.CreateUser(t)
		_, resp, err = reviewer.ExcuseDailyReport(ctx, teamID, outsider.Id, today)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})
}
