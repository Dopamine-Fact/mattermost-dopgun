// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func newTestDepartment(t *testing.T, th *TestHelper, teamID, name string) *model.Department {
	d, appErr := th.App.CreateDepartment(th.Context, teamID, name+" "+model.NewId()[:6], "")
	require.Nil(t, appErr)
	return d
}

func newTestRank(t *testing.T, th *TestHelper, teamID, departmentID, name string, perms ...string) *model.CustomRole {
	r, appErr := th.App.CreateRank(th.Context, teamID, departmentID, &model.CustomRole{DisplayName: name + " " + model.NewId()[:6], Color: "#123456", Permissions: perms})
	require.Nil(t, appErr)
	return r
}

func rankIDs(ranks ...*model.CustomRole) []string {
	ids := []string{}
	for _, r := range ranks {
		ids = append(ids, r.Id)
	}
	return ids
}

// rankedClient creates a member of team holding ranks and logs them in after the ranks are set.
func rankedClient(t *testing.T, th *TestHelper, team *model.Team, ranks ...*model.CustomRole) (*model.Client4, *model.User) {
	u := th.CreateUser(t)
	th.LinkUserToTeam(t, u, team)
	th.AddUserToChannel(t, u, th.BasicChannel)
	_, appErr := th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, team.Id, u.Id, rankIDs(ranks...))
	require.Nil(t, appErr)
	client := th.CreateClient()
	_, _, err := client.Login(context.Background(), u.Email, u.Password)
	require.NoError(t, err)
	return client, u
}

// giveRankingRole gives user a rank in a department of their own, so they outrank the rank-less users of the basic
// setup when acting with perms.
func giveRankingRole(t *testing.T, th *TestHelper, user *model.User, perms ...string) *model.CustomRole {
	r := newTestRank(t, th, th.BasicTeam.Id, newTestDepartment(t, th, th.BasicTeam.Id, "Rank").Id, "Rank", perms...)
	_, appErr := th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, th.BasicTeam.Id, user.Id, []string{r.Id})
	require.Nil(t, appErr)
	return r
}

func TestDepartmentRoutes(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	team := th.BasicTeam

	adminClient, admin := rankedClient(t, th, team)
	_, appErr := th.App.UpdateTeamMemberRoles(th.Context, team.Id, admin.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
	require.Nil(t, appErr)

	anim, resp, err := adminClient.CreateDepartment(ctx, team.Id, &model.Department{Name: "Animasyon", Color: "#aa0000"})
	require.NoError(t, err)
	CheckCreatedStatus(t, resp)
	lead, resp, err := adminClient.CreateRank(ctx, team.Id, anim.Id, &model.CustomRole{DisplayName: "Lead", Color: "#aa0000", Permissions: []string{model.PermissionManageTasks.Id}})
	require.NoError(t, err)
	CheckCreatedStatus(t, resp)
	require.Equal(t, []string{model.PermissionManageTasks.Id}, lead.Permissions)
	mid, _, err := adminClient.CreateRank(ctx, team.Id, anim.Id, &model.CustomRole{DisplayName: "Mid", Color: "#00aa00"})
	require.NoError(t, err)

	t.Run("team admin manages departments and ranks", func(t *testing.T) {
		name := "Animasyon 2D"
		patched, _, err := adminClient.PatchDepartment(ctx, team.Id, anim.Id, &model.DepartmentPatch{Name: &name})
		require.NoError(t, err)
		require.Equal(t, name, patched.Name)
		rankName := "Senior"
		patchedRank, _, err := adminClient.PatchRank(ctx, team.Id, mid.Id, &model.CustomRolePatch{DisplayName: &rankName})
		require.NoError(t, err)
		require.Equal(t, rankName, patchedRank.DisplayName)

		deps, _, err := adminClient.ReorderRanks(ctx, team.Id, anim.Id, []string{mid.Id, lead.Id})
		require.NoError(t, err)
		require.True(t, deps[0].IsStudio)
		require.Equal(t, anim.Id, deps[1].Id)
		require.Equal(t, []string{mid.Id, lead.Id}, rankIDs(deps[1].Ranks...))

		deps, _, err = adminClient.ReorderDepartments(ctx, team.Id, []string{deps[0].Id, anim.Id})
		require.NoError(t, err)
		require.Len(t, deps, 2)
	})

	t.Run("a plain member reads but cannot write", func(t *testing.T) {
		deps, resp, err := th.Client.GetTeamDepartments(ctx, team.Id)
		require.NoError(t, err)
		CheckOKStatus(t, resp)
		require.True(t, deps[0].IsStudio)

		_, resp, err = th.Client.CreateDepartment(ctx, team.Id, &model.Department{Name: "Nope"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		name := "Nope"
		_, resp, err = th.Client.PatchDepartment(ctx, team.Id, anim.Id, &model.DepartmentPatch{Name: &name})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.ReorderDepartments(ctx, team.Id, []string{deps[0].Id, anim.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteDepartment(ctx, team.Id, anim.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.CreateRank(ctx, team.Id, anim.Id, &model.CustomRole{DisplayName: "Nope"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.PatchRank(ctx, team.Id, mid.Id, &model.CustomRolePatch{DisplayName: &name})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.ReorderRanks(ctx, team.Id, anim.Id, []string{lead.Id, mid.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteRank(ctx, team.Id, mid.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	other := th.CreateTeamWithClient(t, th.SystemAdminClient)

	t.Run("another team's members cannot read", func(t *testing.T) {
		outsider := th.CreateUser(t)
		th.LinkUserToTeam(t, outsider, other)
		client := th.CreateClient()
		_, _, err := client.Login(ctx, outsider.Email, outsider.Password)
		require.NoError(t, err)
		_, resp, err := client.GetTeamDepartments(ctx, team.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("a system admin works in any team; ranks stay in their team", func(t *testing.T) {
		d, resp, err := th.SystemAdminClient.CreateDepartment(ctx, other.Id, &model.Department{Name: "Modelleme"})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		foreign, _, err := th.SystemAdminClient.CreateRank(ctx, other.Id, d.Id, &model.CustomRole{DisplayName: "Lead", Color: "#0000aa"})
		require.NoError(t, err)

		name := "Stolen"
		_, resp, err = adminClient.PatchRank(ctx, team.Id, foreign.Id, &model.CustomRolePatch{DisplayName: &name})
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
	})

	t.Run("team admin deletes", func(t *testing.T) {
		_, err := adminClient.DeleteRank(ctx, team.Id, mid.Id)
		require.NoError(t, err)
		_, err = adminClient.DeleteDepartment(ctx, team.Id, anim.Id)
		require.NoError(t, err)
		deps, _, err := th.Client.GetTeamDepartments(ctx, team.Id)
		require.NoError(t, err)
		require.Len(t, deps, 1)
	})
}

func TestSetMemberRanksRoute(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	team := th.BasicTeam
	anim := newTestDepartment(t, th, team.Id, "Animasyon")
	mod := newTestDepartment(t, th, team.Id, "Modelleme")
	animLead := newTestRank(t, th, team.Id, anim.Id, "Lead", model.PermissionAssignCustomRoles.Id)
	animMid := newTestRank(t, th, team.Id, anim.Id, "Mid", model.PermissionManageRevisions.Id)
	modMid := newTestRank(t, th, team.Id, mod.Id, "Mid")

	leadClient, lead := rankedClient(t, th, team, animLead)
	recruitClient, recruit := rankedClient(t, th, team, modMid)
	hasRevisions := func() bool {
		session, appErr := th.App.GetSession(recruitClient.AuthToken)
		require.Nil(t, appErr)
		return th.App.SessionHasPermissionToTeam(*session, team.Id, model.PermissionManageRevisions)
	}

	t.Run("needs assign_custom_roles", func(t *testing.T) {
		_, resp, err := th.Client.SetMemberRanks(ctx, team.Id, recruit.Id, []string{modMid.Id, animMid.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("a lead recruits from another department", func(t *testing.T) {
		require.False(t, hasRevisions())
		member, resp, err := leadClient.SetMemberRanks(ctx, team.Id, recruit.Id, []string{modMid.Id, animMid.Id})
		require.NoError(t, err)
		CheckOKStatus(t, resp)
		require.Contains(t, member.ExplicitRoles, animMid.RoleName)
		require.True(t, hasRevisions(), "the recruit's session gets the rank's permission at once")

		_, resp, err = leadClient.SetMemberRanks(ctx, team.Id, recruit.Id, []string{animMid.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("assignable ranks", func(t *testing.T) {
		ids, _, err := leadClient.GetAssignableRanks(ctx, team.Id, recruit.Id)
		require.NoError(t, err)
		require.Equal(t, []string{animMid.Id}, ids)
		ids, _, err = leadClient.GetAssignableRanks(ctx, team.Id, lead.Id)
		require.NoError(t, err)
		require.Empty(t, ids, "not their own ranks")
		ids, _, err = th.SystemAdminClient.GetAssignableRanks(ctx, team.Id, recruit.Id)
		require.NoError(t, err)
		require.ElementsMatch(t, rankIDs(animLead, animMid, modMid), ids)
	})
}

// Mert is Animasyon Senior without manage_tasks and Modelleme Lead with it: the Animasyon Mid stays out of reach for
// plain tasks. His Senior rank carries manage_revisions, so revision tasks go the other way.
func TestActionableUserIdsPermission(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	team := th.BasicTeam
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, team.Id, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)
	anim := newTestDepartment(t, th, team.Id, "Animasyon")
	mod := newTestDepartment(t, th, team.Id, "Modelleme")
	animSenior := newTestRank(t, th, team.Id, anim.Id, "Senior", model.PermissionManageRevisions.Id)
	animMid := newTestRank(t, th, team.Id, anim.Id, "Mid")
	modLead := newTestRank(t, th, team.Id, mod.Id, "Lead", model.PermissionManageTasks.Id)
	modMid := newTestRank(t, th, team.Id, mod.Id, "Mid")

	mertClient, mert := rankedClient(t, th, team, animSenior, modLead)
	_, animator := rankedClient(t, th, team, animMid)
	_, modeler := rankedClient(t, th, team, modMid)

	ids, _, err := mertClient.GetActionableUserIds(ctx, team.Id, model.PermissionManageTasks.Id)
	require.NoError(t, err)
	require.Contains(t, ids, mert.Id)
	require.Contains(t, ids, modeler.Id)
	require.NotContains(t, ids, animator.Id)

	_, resp, err := mertClient.CreateTask(ctx, &model.Task{TeamId: team.Id, Title: "rig", AssigneeId: animator.Id})
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
	_, resp, err = mertClient.CreateTask(ctx, &model.Task{TeamId: team.Id, Title: "model", AssigneeId: modeler.Id})
	require.NoError(t, err)
	CheckCreatedStatus(t, resp)

	ids, _, err = mertClient.GetActionableUserIds(ctx, team.Id, model.PermissionManageRevisions.Id)
	require.NoError(t, err)
	require.Contains(t, ids, animator.Id)
	require.NotContains(t, ids, modeler.Id)
	section, _, err := mertClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: team.Id, Name: "rev", ChannelId: th.BasicChannel.Id})
	require.NoError(t, err)
	_, resp, err = mertClient.CreateTask(ctx, &model.Task{TeamId: team.Id, SectionId: section.Id, Title: "frame 12", AssigneeId: animator.Id})
	require.NoError(t, err)
	CheckCreatedStatus(t, resp)
	_, resp, err = mertClient.CreateTask(ctx, &model.Task{TeamId: team.Id, SectionId: section.Id, Title: "frame 13", AssigneeId: modeler.Id})
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)

	for _, p := range []string{"", "bogus", model.PermissionManageTeam.Id} {
		_, resp, err = mertClient.GetActionableUserIds(ctx, team.Id, p)
		require.Error(t, err, p)
		CheckBadRequestStatus(t, resp)
	}

	other := th.CreateTeamWithClient(t, th.SystemAdminClient)
	_, resp, err = mertClient.GetActionableUserIds(ctx, other.Id, model.PermissionManageTasks.Id)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
}
