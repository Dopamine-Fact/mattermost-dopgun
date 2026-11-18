// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

// newCustomRole creates a custom role with a unique display name, since the CustomRoles table outlives a single test.
func newCustomRole(t *testing.T, th *TestHelper, name, dept string, perms ...string) *model.CustomRole {
	t.Helper()
	r, appErr := th.App.CreateCustomRole(th.Context, &model.CustomRole{
		DisplayName: name + " " + model.NewId()[:6],
		Color:       "#ff00aa",
		Department:  dept,
		Permissions: perms,
	})
	require.Nil(t, appErr)
	return r
}

func giveCustomRoles(t *testing.T, th *TestHelper, user *model.User, roles ...*model.CustomRole) *model.User {
	t.Helper()
	ids := make([]string, 0, len(roles))
	for _, r := range roles {
		ids = append(ids, r.Id)
	}
	updated, appErr := th.App.SetUserCustomRoles(th.Context, th.SystemAdminUser.Id, user.Id, ids)
	require.Nil(t, appErr)
	return updated
}

func TestCreateCustomRole(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	created := newCustomRole(t, th, "Animator", "Anim", model.PermissionManageTasks.Id)
	require.True(t, model.IsCustomRoleName(created.RoleName))
	require.Equal(t, []string{model.PermissionManageTasks.Id}, created.Permissions)

	native, appErr := th.App.GetRoleByName(th.Context, created.RoleName)
	require.Nil(t, appErr)
	require.Equal(t, []string{model.PermissionManageTasks.Id}, native.Permissions)
	require.False(t, native.BuiltIn)
	require.False(t, native.SchemeManaged)

	all, appErr := th.App.GetCustomRoles()
	require.Nil(t, appErr)
	require.Equal(t, created.Id, all[len(all)-1].Id, "new roles go to the end of the list")
	require.Equal(t, []string{model.PermissionManageTasks.Id}, all[len(all)-1].Permissions)

	_, appErr = th.App.CreateCustomRole(th.Context, &model.CustomRole{DisplayName: "Poster " + model.NewId(), Color: "#ff00aa", Permissions: []string{model.PermissionCreatePost.Id}})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	require.Equal(t, "app.custom_role.permission_not_allowed.app_error", appErr.Id)

	_, appErr = th.App.CreateCustomRole(th.Context, &model.CustomRole{DisplayName: "  " + strings.ToUpper(created.DisplayName) + " ", Color: "#00ff00"})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	require.Equal(t, "app.custom_role.name_taken.app_error", appErr.Id)
}

func TestPatchAndReorderCustomRoles(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	a := newCustomRole(t, th, "A", "")
	b := newCustomRole(t, th, "B", "")

	perms := []string{model.PermissionManageRevisions.Id}
	color := "#00aa00"
	patched, appErr := th.App.PatchCustomRole(th.Context, a.Id, &model.CustomRolePatch{Color: &color, Permissions: &perms})
	require.Nil(t, appErr)
	require.Equal(t, color, patched.Color)
	require.Equal(t, perms, patched.Permissions)
	native, appErr := th.App.GetRoleByName(th.Context, a.RoleName)
	require.Nil(t, appErr)
	require.Equal(t, perms, native.Permissions)

	bad := []string{model.PermissionManageSystem.Id}
	_, appErr = th.App.PatchCustomRole(th.Context, a.Id, &model.CustomRolePatch{Permissions: &bad})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	taken := " " + strings.ToLower(b.DisplayName)
	_, appErr = th.App.PatchCustomRole(th.Context, a.Id, &model.CustomRolePatch{DisplayName: &taken})
	require.NotNil(t, appErr)
	require.Equal(t, "app.custom_role.name_taken.app_error", appErr.Id)

	_, appErr = th.App.PatchCustomRole(th.Context, model.NewId(), &model.CustomRolePatch{Color: &color})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusNotFound, appErr.StatusCode)

	all, appErr := th.App.GetCustomRoles()
	require.Nil(t, appErr)
	ids := make([]string, len(all))
	for i, r := range all {
		ids[len(all)-1-i] = r.Id
	}
	reordered, appErr := th.App.ReorderCustomRoles(th.Context, ids)
	require.Nil(t, appErr)
	for i, r := range reordered {
		require.Equal(t, ids[i], r.Id)
		require.Equal(t, i, r.Position)
	}

	_, appErr = th.App.ReorderCustomRoles(th.Context, ids[1:])
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
}

func TestCustomRoleGrantsTeamPermission(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	role := newCustomRole(t, th, "Tasker", "", model.PermissionManageTasks.Id)
	user := th.CreateUser(t)
	other := th.CreateTeam(t)
	th.LinkUserToTeam(t, user, th.BasicTeam)
	th.LinkUserToTeam(t, user, other)

	session := model.Session{UserId: user.Id, Roles: user.Roles}
	require.False(t, th.App.SessionHasPermissionToTeam(session, th.BasicTeam.Id, model.PermissionManageTasks))

	user = giveCustomRoles(t, th, user, role)
	session.Roles = user.Roles
	require.True(t, th.App.SessionHasPermissionToTeam(session, th.BasicTeam.Id, model.PermissionManageTasks))
	require.True(t, th.App.SessionHasPermissionToTeam(session, other.Id, model.PermissionManageTasks))
	require.False(t, th.App.SessionHasPermissionToTeam(session, other.Id, model.PermissionManageRevisions))
}

func TestDeleteCustomRoleStripsUsers(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	a := newCustomRole(t, th, "A", "")
	b := newCustomRole(t, th, "B", "")
	user := giveCustomRoles(t, th, th.CreateUser(t), a, b)
	require.Equal(t, model.SystemUserRoleId+" "+a.RoleName+" "+b.RoleName, user.Roles)

	session, appErr := th.App.CreateSession(th.Context, &model.Session{UserId: user.Id, Roles: user.Roles})
	require.Nil(t, appErr)

	require.Nil(t, th.App.DeleteCustomRole(th.Context, a.Id))

	got, appErr := th.App.GetUser(th.Context, user.Id)
	require.Nil(t, appErr)
	require.Equal(t, model.SystemUserRoleId+" "+b.RoleName, got.Roles)

	stored, err := th.App.Srv().Store().Session().Get(th.Context, session.Id)
	require.NoError(t, err)
	require.Equal(t, model.SystemUserRoleId+" "+b.RoleName, stored.Roles)

	all, appErr := th.App.GetCustomRoles()
	require.Nil(t, appErr)
	for i, r := range all {
		require.NotEqual(t, a.Id, r.Id)
		require.Equal(t, i, r.Position, "positions are compacted")
	}

	native, appErr := th.App.GetRoleByName(th.Context, a.RoleName)
	require.Nil(t, appErr)
	require.NotZero(t, native.DeleteAt, "native role is soft-deleted")

	appErr = th.App.DeleteCustomRole(th.Context, a.Id)
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusNotFound, appErr.StatusCode)
}

func TestUpdateUserRolesKeepsCustomRoles(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	a := newCustomRole(t, th, "A", "")
	user := giveCustomRoles(t, th, th.CreateUser(t), a)

	updated, appErr := th.App.UpdateUserRoles(th.Context, user.Id, model.SystemUserRoleId+" "+model.SystemManagerRoleId, false)
	require.Nil(t, appErr)
	require.Equal(t, model.SystemUserRoleId+" "+model.SystemManagerRoleId+" "+a.RoleName, updated.Roles)

	// Removing every custom role through SetUserCustomRoles really removes them.
	updated = giveCustomRoles(t, th, updated)
	require.Equal(t, model.SystemUserRoleId+" "+model.SystemManagerRoleId, updated.Roles)
}

func TestCanAssignRole(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	leadAnim := newCustomRole(t, th, "LeadAnim", "Anim", model.PermissionAssignCustomRoles.Id)
	leadProg := newCustomRole(t, th, "LeadProg", "Prog")
	anim := newCustomRole(t, th, "Anim", "Anim")
	prog := newCustomRole(t, th, "Prog", "Prog")

	actor := giveCustomRoles(t, th, th.CreateUser(t), leadAnim)
	assert.True(t, th.App.CanAssignRole(th.Context, actor.Id, anim.Id))
	assert.False(t, th.App.CanAssignRole(th.Context, actor.Id, leadAnim.Id))
	assert.False(t, th.App.CanAssignRole(th.Context, actor.Id, prog.Id))
	assert.False(t, th.App.CanAssignRole(th.Context, actor.Id, model.NewId()))
	assert.True(t, th.App.CanAssignRole(th.Context, th.SystemAdminUser.Id, leadAnim.Id))

	animator := th.CreateUser(t)
	updated, appErr := th.App.SetUserCustomRoles(th.Context, actor.Id, animator.Id, []string{anim.Id})
	require.Nil(t, appErr)
	require.Equal(t, model.SystemUserRoleId+" "+anim.RoleName, updated.Roles)

	_, appErr = th.App.SetUserCustomRoles(th.Context, actor.Id, animator.Id, []string{anim.Id, leadAnim.Id})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)
	require.Equal(t, "app.custom_role.not_outranked.app_error", appErr.Id)

	progLead := giveCustomRoles(t, th, th.CreateUser(t), leadProg, anim)
	_, appErr = th.App.SetUserCustomRoles(th.Context, actor.Id, progLead.Id, []string{leadProg.Id})
	require.NotNil(t, appErr, "cannot remove Anim from a LeadProg holder")
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)

	_, appErr = th.App.SetUserCustomRoles(th.Context, actor.Id, animator.Id, []string{model.NewId()})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
}

func TestSetUserCustomRolesGuest(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	role := newCustomRole(t, th, "A", "")
	_, appErr := th.App.SetUserCustomRoles(th.Context, th.SystemAdminUser.Id, th.CreateGuest(t).Id, []string{role.Id})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	bot := th.CreateBot(t)
	_, appErr = th.App.SetUserCustomRoles(th.Context, th.SystemAdminUser.Id, bot.UserId, []string{role.Id})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
}

func TestCanActOnUser(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	leadAnim := newCustomRole(t, th, "LeadAnim", "Anim")
	anim := newCustomRole(t, th, "Anim", "Anim")
	prog := newCustomRole(t, th, "Prog", "Prog")

	lead := giveCustomRoles(t, th, th.CreateUser(t), leadAnim)
	animator := giveCustomRoles(t, th, th.CreateUser(t), anim)
	programmer := giveCustomRoles(t, th, th.CreateUser(t), prog)
	plain := th.CreateUser(t)

	assert.True(t, th.App.CanActOnUser(th.Context, lead.Id, animator.Id, ""))
	assert.False(t, th.App.CanActOnUser(th.Context, lead.Id, programmer.Id, ""))
	assert.False(t, th.App.CanActOnUser(th.Context, animator.Id, lead.Id, ""))
	assert.True(t, th.App.CanActOnUser(th.Context, lead.Id, plain.Id, ""))
	assert.False(t, th.App.CanActOnUser(th.Context, plain.Id, animator.Id, ""))
	assert.True(t, th.App.CanActOnUser(th.Context, plain.Id, plain.Id, ""), "self")
	assert.True(t, th.App.CanActOnUser(th.Context, th.SystemAdminUser.Id, lead.Id, ""))

	// A team admin without custom roles bypasses the hierarchy only in their own team.
	teamAdmin := th.CreateUser(t)
	th.LinkUserToTeam(t, teamAdmin, th.BasicTeam)
	_, appErr := th.App.UpdateTeamMemberRoles(th.Context, th.BasicTeam.Id, teamAdmin.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
	require.Nil(t, appErr)
	assert.True(t, th.App.CanActOnUser(th.Context, teamAdmin.Id, lead.Id, th.BasicTeam.Id))
	assert.False(t, th.App.CanActOnUser(th.Context, teamAdmin.Id, lead.Id, th.CreateTeam(t).Id))
	assert.False(t, th.App.CanActOnUser(th.Context, teamAdmin.Id, lead.Id, ""))

	ids := th.App.ActionableUserIDs(th.Context, lead.Id, th.BasicTeam.Id, []string{lead.Id, animator.Id, programmer.Id, plain.Id})
	assert.Equal(t, []string{lead.Id, animator.Id, plain.Id}, ids)
	ids = th.App.ActionableUserIDs(th.Context, teamAdmin.Id, th.BasicTeam.Id, []string{animator.Id, programmer.Id})
	assert.Equal(t, []string{animator.Id, programmer.Id}, ids)
}
