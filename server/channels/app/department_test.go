// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func newDepartment(t *testing.T, th *TestHelper, teamID, name string) *model.Department {
	t.Helper()
	d, appErr := th.App.CreateDepartment(th.Context, teamID, name, "#3366ff")
	require.Nil(t, appErr)
	return d
}

func studioOf(t *testing.T, th *TestHelper, teamID string) *model.Department {
	t.Helper()
	deps, appErr := th.App.GetTeamDepartments(th.Context, teamID)
	require.Nil(t, appErr)
	require.True(t, deps[0].IsStudio)
	return deps[0].Department
}

func departmentIDs(deps []*model.DepartmentWithRanks) []string {
	ids := make([]string, len(deps))
	for i, d := range deps {
		ids[i] = d.Id
	}
	return ids
}

func TestGetTeamDepartmentsCreatesStudio(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	// A team saved straight to the store, as teams created before departments existed were.
	team, err := th.App.Srv().Store().Team().Save(&model.Team{DisplayName: "Old", Name: "z" + model.NewId(), Email: "success+" + model.NewId() + "@simulator.amazonses.com", Type: model.TeamOpen})
	require.NoError(t, err)

	deps, appErr := th.App.GetTeamDepartments(th.Context, team.Id)
	require.Nil(t, appErr)
	require.Len(t, deps, 1)
	assert.True(t, deps[0].IsStudio)
	assert.Equal(t, model.StudioDepartmentName, deps[0].Name)
	assert.NotNil(t, deps[0].Ranks)

	again, appErr := th.App.GetTeamDepartments(th.Context, team.Id)
	require.Nil(t, appErr)
	require.Len(t, again, 1, "a second call does not duplicate it")
	assert.Equal(t, deps[0].Id, again[0].Id)

	stored, err := th.App.Srv().Store().Department().GetForTeam(th.BasicTeam.Id)
	require.NoError(t, err)
	require.Len(t, stored, 1, "CreateTeam adds the studio department")
	assert.True(t, stored[0].IsStudio)
}

func TestReorderDepartmentsKeepsStudioFirst(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id

	studio := studioOf(t, th, team)
	anim := newDepartment(t, th, team, "Animasyon")
	mod := newDepartment(t, th, team, "Modelleme")
	assert.Equal(t, 2, mod.Position, "new departments go to the bottom")

	deps, appErr := th.App.ReorderDepartments(th.Context, team, []string{studio.Id, mod.Id, anim.Id})
	require.Nil(t, appErr)
	assert.Equal(t, []string{studio.Id, mod.Id, anim.Id}, departmentIDs(deps))
	for i, d := range deps {
		assert.Equal(t, i, d.Position)
	}

	_, appErr = th.App.ReorderDepartments(th.Context, team, []string{mod.Id, studio.Id, anim.Id})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	assert.Equal(t, "app.department.studio_first.app_error", appErr.Id)

	_, appErr = th.App.ReorderDepartments(th.Context, team, []string{studio.Id, mod.Id})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	name := "  modelleme "
	_, appErr = th.App.PatchDepartment(th.Context, team, anim.Id, &model.DepartmentPatch{Name: &name})
	require.NotNil(t, appErr)
	assert.Equal(t, "app.custom_role.name_taken.app_error", appErr.Id)

	name = "Rigging"
	color := "#00aa00"
	patched, appErr := th.App.PatchDepartment(th.Context, team, anim.Id, &model.DepartmentPatch{Name: &name, Color: &color})
	require.Nil(t, appErr)
	assert.Equal(t, name, patched.Name)
	assert.Equal(t, color, patched.Color)
}

func TestDeleteStudioRefused(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	appErr := th.App.DeleteDepartment(th.Context, th.BasicTeam.Id, studioOf(t, th, th.BasicTeam.Id).Id)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	assert.Equal(t, "app.department.studio_delete.app_error", appErr.Id)

	elsewhere := newDepartment(t, th, th.CreateTeam(t).Id, "Animasyon")
	appErr = th.App.DeleteDepartment(th.Context, th.BasicTeam.Id, elsewhere.Id)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode, "another team's department")
}

func TestDeleteDepartmentStripsMembers(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam.Id

	studio := studioOf(t, th, team)
	anim := newDepartment(t, th, team, "Animasyon")
	mod := newDepartment(t, th, team, "Modelleme")
	sound := newDepartment(t, th, team, "Ses")
	lead := newRank(t, th, team, anim.Id, "Lead", model.PermissionManageTasks.Id)
	modMid := newRank(t, th, team, mod.Id, "Mid")

	user := th.CreateUser(t)
	th.LinkUserToTeam(t, user, th.BasicTeam)
	giveRanks(t, th, team, user, lead, modMid)
	token := newSessionToken(t, th, user)
	require.True(t, hasTeamPermission(t, th, token, team, model.PermissionManageTasks))

	require.Nil(t, th.App.DeleteDepartment(th.Context, team, anim.Id))

	member, appErr := th.App.GetTeamMember(th.Context, team, user.Id)
	require.Nil(t, appErr)
	assert.Equal(t, modMid.RoleName, member.ExplicitRoles)
	assert.False(t, hasTeamPermission(t, th, token, team, model.PermissionManageTasks))

	deps, appErr := th.App.GetTeamDepartments(th.Context, team)
	require.Nil(t, appErr)
	assert.Equal(t, []string{studio.Id, mod.Id, sound.Id}, departmentIDs(deps))
	for i, d := range deps {
		assert.Equal(t, i, d.Position, "positions are compacted")
	}

	native, appErr := th.App.GetRoleByName(th.Context, lead.RoleName)
	require.Nil(t, appErr)
	assert.NotZero(t, native.DeleteAt, "the rank's native role is soft-deleted")

	appErr = th.App.DeleteDepartment(th.Context, team, anim.Id)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)
}
