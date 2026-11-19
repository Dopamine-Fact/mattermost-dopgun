// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func newRank(t *testing.T, th *TestHelper, teamID, departmentID, name string, perms ...string) *model.CustomRole {
	t.Helper()
	r, appErr := th.App.CreateRank(th.Context, teamID, departmentID, &model.CustomRole{DisplayName: name, Color: "#ff00aa", Permissions: perms})
	require.Nil(t, appErr)
	return r
}

// giveRanks sets a team member's ranks as a system admin.
func giveRanks(t *testing.T, th *TestHelper, teamID string, user *model.User, ranks ...*model.CustomRole) *model.TeamMember {
	t.Helper()
	ids := make([]string, 0, len(ranks))
	for _, r := range ranks {
		ids = append(ids, r.Id)
	}
	member, appErr := th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, teamID, user.Id, ids)
	require.Nil(t, appErr)
	return member
}

// rankedUser creates a member of team holding ranks.
func rankedUser(t *testing.T, th *TestHelper, team *model.Team, ranks ...*model.CustomRole) *model.User {
	t.Helper()
	user := th.CreateUser(t)
	th.LinkUserToTeam(t, user, team)
	giveRanks(t, th, team.Id, user, ranks...)
	return user
}

func newSessionToken(t *testing.T, th *TestHelper, user *model.User) string {
	t.Helper()
	session, appErr := th.App.CreateSession(th.Context, &model.Session{UserId: user.Id, Roles: user.Roles})
	require.Nil(t, appErr)
	return session.Token
}

// hasTeamPermission reads the session back, as a request would, and checks the permission in teamID.
func hasTeamPermission(t *testing.T, th *TestHelper, token, teamID string, permission *model.Permission) bool {
	t.Helper()
	session, appErr := th.App.GetSession(token)
	require.Nil(t, appErr)
	return th.App.SessionHasPermissionToTeam(*session, teamID, permission)
}

func TestCreateRankIsTeamScoped(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id
	anim := newDepartment(t, th, team, "Animasyon")

	lead := newRank(t, th, team, anim.Id, "Lead", model.PermissionManageTasks.Id)
	assert.True(t, model.IsRankRoleName(lead.RoleName))
	assert.Equal(t, team, lead.TeamId)
	assert.Equal(t, anim.Id, lead.DepartmentId)
	assert.Equal(t, []string{model.PermissionManageTasks.Id}, lead.Permissions)

	native, appErr := th.App.GetRoleByName(th.Context, lead.RoleName)
	require.Nil(t, appErr)
	assert.Equal(t, []string{model.PermissionManageTasks.Id}, native.Permissions)
	assert.False(t, native.BuiltIn)
	assert.False(t, native.SchemeManaged)

	mid := newRank(t, th, team, anim.Id, "Mid")
	assert.Equal(t, 1, mid.Position, "new ranks go to the bottom of their department")

	deps, appErr := th.App.GetTeamDepartments(th.Context, team)
	require.Nil(t, appErr)
	require.Len(t, deps, 2)
	require.Len(t, deps[1].Ranks, 2)
	assert.Equal(t, lead.Id, deps[1].Ranks[0].Id)
	assert.Equal(t, []string{model.PermissionManageTasks.Id}, deps[1].Ranks[0].Permissions)
	assert.Equal(t, []string{}, deps[1].Ranks[1].Permissions)

	_, appErr = th.App.CreateRank(th.Context, team, anim.Id, &model.CustomRole{DisplayName: "Poster", Color: "#ff00aa", Permissions: []string{model.PermissionCreatePost.Id}})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	assert.Equal(t, "app.custom_role.permission_not_allowed.app_error", appErr.Id)

	_, appErr = th.App.CreateRank(th.Context, team, anim.Id, &model.CustomRole{DisplayName: " LEAD ", Color: "#ff00aa"})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	assert.Equal(t, "app.custom_role.name_taken.app_error", appErr.Id)

	_, appErr = th.App.CreateRank(th.Context, th.CreateTeam(t).Id, anim.Id, &model.CustomRole{DisplayName: "Lead", Color: "#ff00aa"})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode, "another team's department")
}

func TestRankGrantsOnlyInItsTeam(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam
	other := th.CreateTeam(t)

	lead := newRank(t, th, team.Id, newDepartment(t, th, team.Id, "Animasyon").Id, "Lead", model.PermissionManageTasks.Id)
	user := th.CreateUser(t)
	th.LinkUserToTeam(t, user, team)
	th.LinkUserToTeam(t, user, other)
	token := newSessionToken(t, th, user)
	require.False(t, hasTeamPermission(t, th, token, team.Id, model.PermissionManageTasks))

	giveRanks(t, th, team.Id, user, lead)
	assert.True(t, hasTeamPermission(t, th, token, team.Id, model.PermissionManageTasks))
	assert.False(t, hasTeamPermission(t, th, token, other.Id, model.PermissionManageTasks))
	assert.False(t, hasTeamPermission(t, th, token, team.Id, model.PermissionManageRevisions))

	deps, appErr := th.App.GetTeamDepartments(th.Context, team.Id)
	require.Nil(t, appErr)
	assert.Equal(t, int64(1), deps[1].Ranks[0].MemberCount)
	assert.Equal(t, []string{user.Id}, deps[1].Ranks[0].MemberIds)
}

func TestGetTeamDepartmentsEmptyRankHasNoMembers(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	newRank(t, th, th.BasicTeam.Id, newDepartment(t, th, th.BasicTeam.Id, "Animasyon").Id, "Lead")

	deps, appErr := th.App.GetTeamDepartments(th.Context, th.BasicTeam.Id)
	require.Nil(t, appErr)
	assert.NotNil(t, deps[1].Ranks[0].MemberIds, "encodes as [], not null")
	assert.Empty(t, deps[1].Ranks[0].MemberIds)
	assert.Zero(t, deps[1].Ranks[0].MemberCount)
}

func TestPatchRankRenamesNativeRole(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id
	anim := newDepartment(t, th, team, "Animasyon")
	lead := newRank(t, th, team, anim.Id, "Lead")
	mid := newRank(t, th, team, anim.Id, "Mid")

	name := "Baş Animatör"
	perms := []string{model.PermissionManageRevisions.Id}
	patched, appErr := th.App.PatchRank(th.Context, team, lead.Id, &model.CustomRolePatch{DisplayName: &name, Permissions: &perms})
	require.Nil(t, appErr)
	assert.Equal(t, name, patched.DisplayName)
	assert.Equal(t, perms, patched.Permissions)
	native, appErr := th.App.GetRoleByName(th.Context, lead.RoleName)
	require.Nil(t, appErr)
	assert.Equal(t, name, native.DisplayName)
	assert.Equal(t, perms, native.Permissions)

	bad := []string{model.PermissionManageSystem.Id}
	_, appErr = th.App.PatchRank(th.Context, team, lead.Id, &model.CustomRolePatch{Permissions: &bad})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	taken := " " + strings.ToUpper(mid.DisplayName)
	_, appErr = th.App.PatchRank(th.Context, team, lead.Id, &model.CustomRolePatch{DisplayName: &taken})
	require.NotNil(t, appErr)
	assert.Equal(t, "app.custom_role.name_taken.app_error", appErr.Id)

	_, appErr = th.App.PatchRank(th.Context, th.CreateTeam(t).Id, lead.Id, &model.CustomRolePatch{DisplayName: &name})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode, "another team's rank")
}

func TestReorderAndDeleteRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id
	anim := newDepartment(t, th, team, "Animasyon")
	a := newRank(t, th, team, anim.Id, "A")
	b := newRank(t, th, team, anim.Id, "B")
	c := newRank(t, th, team, anim.Id, "C")

	deps, appErr := th.App.ReorderRanks(th.Context, team, anim.Id, []string{c.Id, a.Id, b.Id})
	require.Nil(t, appErr)
	require.Len(t, deps[1].Ranks, 3)
	for i, id := range []string{c.Id, a.Id, b.Id} {
		assert.Equal(t, id, deps[1].Ranks[i].Id)
		assert.Equal(t, i, deps[1].Ranks[i].Position)
	}

	_, appErr = th.App.ReorderRanks(th.Context, team, anim.Id, []string{c.Id, a.Id})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	user := rankedUser(t, th, th.BasicTeam, a)
	require.Nil(t, th.App.DeleteRank(th.Context, team, a.Id))
	member, appErr := th.App.GetTeamMember(th.Context, team, user.Id)
	require.Nil(t, appErr)
	assert.Empty(t, member.ExplicitRoles)

	deps, appErr = th.App.GetTeamDepartments(th.Context, team)
	require.Nil(t, appErr)
	require.Len(t, deps[1].Ranks, 2)
	for i, id := range []string{c.Id, b.Id} {
		assert.Equal(t, id, deps[1].Ranks[i].Id)
		assert.Equal(t, i, deps[1].Ranks[i].Position, "positions are compacted")
	}

	appErr = th.App.DeleteRank(th.Context, team, a.Id)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)
}

// rankStripFailingStore makes RemoveRoleFromAllMembers fail, so a delete stops halfway.
type rankStripFailingStore struct{ store.Store }

type rankStripFailingTeamStore struct{ store.TeamStore }

func (s rankStripFailingStore) Team() store.TeamStore {
	return rankStripFailingTeamStore{s.Store.Team()}
}

func (rankStripFailingTeamStore) RemoveRoleFromAllMembers(string, string) ([]string, error) {
	return nil, errors.New("strip failed")
}

func TestDeleteRankFailureDropsPermissions(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id

	rank := newRank(t, th, team, newDepartment(t, th, team, "Animasyon").Id, "Lead", model.PermissionManageTasks.Id)
	user := rankedUser(t, th, th.BasicTeam, rank)
	token := newSessionToken(t, th, user)
	require.True(t, hasTeamPermission(t, th, token, team, model.PermissionManageTasks))

	original := th.App.Srv().Store()
	th.App.Srv().SetStore(rankStripFailingStore{original})
	t.Cleanup(func() { th.App.Srv().SetStore(original) })
	require.NotNil(t, th.App.DeleteRank(th.Context, team, rank.Id))
	th.App.Srv().SetStore(original)

	require.False(t, hasTeamPermission(t, th, token, team, model.PermissionManageTasks),
		"a delete that stops halfway must not leave the rank's permissions live")
}

func TestSetMemberRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam
	anim := newDepartment(t, th, team.Id, "Animasyon")
	mod := newDepartment(t, th, team.Id, "Modelleme")
	animLead := newRank(t, th, team.Id, anim.Id, "Lead", model.PermissionAssignCustomRoles.Id)
	animSenior := newRank(t, th, team.Id, anim.Id, "Senior", model.PermissionAssignCustomRoles.Id)
	animMid := newRank(t, th, team.Id, anim.Id, "Mid")
	modMid := newRank(t, th, team.Id, mod.Id, "Mid")

	lead := rankedUser(t, th, team, animLead)
	recruit := rankedUser(t, th, team, modMid)

	member, appErr := th.App.SetMemberRanks(th.Context, lead.Id, team.Id, recruit.Id, []string{modMid.Id, animMid.Id})
	require.Nil(t, appErr, "a lead brings a member of another department into theirs")
	assert.Equal(t, animMid.RoleName+" "+modMid.RoleName, member.ExplicitRoles, "ranks sorted by department order")
	assert.True(t, member.SchemeUser, "scheme flags are kept")

	_, appErr = th.App.SetMemberRanks(th.Context, lead.Id, team.Id, recruit.Id, []string{modMid.Id})
	require.Nil(t, appErr, "unchanged ranks are not checked")

	senior := rankedUser(t, th, team, animSenior)
	_, appErr = th.App.SetMemberRanks(th.Context, senior.Id, team.Id, recruit.Id, []string{modMid.Id, animLead.Id})
	require.NotNil(t, appErr, "cannot give a rank above one's own")
	assert.Equal(t, http.StatusForbidden, appErr.StatusCode)

	peer := rankedUser(t, th, team, animLead)
	_, appErr = th.App.SetMemberRanks(th.Context, lead.Id, team.Id, peer.Id, []string{animMid.Id})
	require.NotNil(t, appErr, "cannot demote a peer")
	assert.Equal(t, http.StatusForbidden, appErr.StatusCode)
	assert.Equal(t, "app.custom_role.not_outranked.app_error", appErr.Id)

	_, appErr = th.App.SetMemberRanks(th.Context, lead.Id, team.Id, lead.Id, []string{animLead.Id, modMid.Id})
	require.NotNil(t, appErr, "cannot change one's own ranks")
	assert.Equal(t, http.StatusForbidden, appErr.StatusCode)

	elsewhere := th.CreateTeam(t).Id
	badRequests := map[string][]string{
		"two ranks of one department": {animMid.Id, animLead.Id},
		"unknown rank":                {model.NewId()},
		"another team's rank":         {newRank(t, th, elsewhere, newDepartment(t, th, elsewhere, "X").Id, "X").Id},
	}
	for name, ids := range badRequests {
		_, appErr = th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, team.Id, recruit.Id, ids)
		require.NotNil(t, appErr, name)
		assert.Equal(t, http.StatusBadRequest, appErr.StatusCode, name)
	}

	guest := th.CreateGuest(t)
	th.LinkUserToTeam(t, guest, team)
	targets := map[string]string{"guest": guest.Id, "bot": th.CreateBot(t).UserId, "non-member": th.CreateUser(t).Id}
	for name, id := range targets {
		_, appErr = th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, team.Id, id, []string{animMid.Id})
		require.NotNil(t, appErr, name)
		assert.Equal(t, http.StatusBadRequest, appErr.StatusCode, name)
	}
}

func TestUpdateTeamMemberRolesKeepsRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	mid := newRank(t, th, th.BasicTeam.Id, newDepartment(t, th, th.BasicTeam.Id, "Animasyon").Id, "Mid")
	user := rankedUser(t, th, th.BasicTeam, mid)

	member, appErr := th.App.UpdateTeamMemberRoles(th.Context, th.BasicTeam.Id, user.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
	require.Nil(t, appErr)
	assert.True(t, member.SchemeAdmin)
	assert.Equal(t, mid.RoleName, member.ExplicitRoles)

	// A rank named in newRoles is ignored: ranks change only through SetMemberRanks.
	other := th.CreateTeam(t)
	foreign := newRank(t, th, other.Id, newDepartment(t, th, other.Id, "Modelleme").Id, "Lead", model.PermissionManageTasks.Id)
	member, appErr = th.App.UpdateTeamMemberRoles(th.Context, th.BasicTeam.Id, user.Id, model.TeamUserRoleId+" "+foreign.RoleName)
	require.Nil(t, appErr)
	assert.Equal(t, mid.RoleName, member.ExplicitRoles)
}

func TestDemoteUserToGuestStripsRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	lead := newRank(t, th, th.BasicTeam.Id, newDepartment(t, th, th.BasicTeam.Id, "Animasyon").Id, "Lead", model.PermissionManageTasks.Id)
	user := rankedUser(t, th, th.BasicTeam, lead)

	require.Nil(t, th.App.DemoteUserToGuest(th.Context, user))

	member, appErr := th.App.GetTeamMember(th.Context, th.BasicTeam.Id, user.Id)
	require.Nil(t, appErr)
	assert.True(t, member.SchemeGuest)
	assert.NotContains(t, member.ExplicitRoles, model.RankRoleNamePrefix)
}

func TestLeaveTeamStripsRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	mid := newRank(t, th, th.BasicTeam.Id, newDepartment(t, th, th.BasicTeam.Id, "Animasyon").Id, "Mid")
	user := rankedUser(t, th, th.BasicTeam, mid)

	require.Nil(t, th.App.LeaveTeam(th.Context, th.BasicTeam, user, ""))
	_, appErr := th.App.JoinUserToTeam(th.Context, th.BasicTeam, user, "")
	require.Nil(t, appErr)

	member, appErr := th.App.GetTeamMember(th.Context, th.BasicTeam.Id, user.Id)
	require.Nil(t, appErr)
	assert.NotContains(t, member.ExplicitRoles, model.RankRoleNamePrefix)
}
