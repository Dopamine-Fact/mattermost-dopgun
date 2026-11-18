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

func TestRankOutranksTarget(t *testing.T) {
	studioID, animID, modID := model.NewId(), model.NewId(), model.NewId()
	studio := map[string]bool{studioID: true}
	mk := func(dept string, pos int) *model.CustomRole {
		return &model.CustomRole{Id: model.NewId(), DepartmentId: dept, Position: pos}
	}
	producer, coordinator := mk(studioID, 0), mk(studioID, 1)
	animLead, animSenior, animMid := mk(animID, 0), mk(animID, 1), mk(animID, 2)
	modLead, modMid := mk(modID, 0), mk(modID, 1)
	r := func(rs ...*model.CustomRole) []*model.CustomRole { return rs }

	cases := []struct {
		name   string
		rank   *model.CustomRole
		target []*model.CustomRole
		want   bool
	}{
		{"same department, above", animLead, r(animMid), true},
		{"same department, below", animMid, r(animLead), false},
		{"peer", animLead, r(animLead), false},
		{"different departments", animLead, r(modMid), false},
		{"studio over a department", coordinator, r(animLead), true},
		{"department under studio", animLead, r(coordinator), false},
		{"higher studio rank", producer, r(coordinator), true},
		{"lower studio rank", coordinator, r(producer), false},
		{"target without ranks", animMid, r(), true},
		{"Animasyon Senior + Modelleme Mid, by the Animasyon Lead", animLead, r(animSenior, modMid), true},
		{"Animasyon Senior + Modelleme Mid, by the Modelleme Lead", modLead, r(animSenior, modMid), true},
		{"Animasyon Senior + Modelleme Mid, by a Modelleme peer", modMid, r(animSenior, modMid), false},
		{"Producer + Animasyon Mid, by the Animasyon Lead", animLead, r(producer, animMid), false},
		{"Coordinator + Animasyon Mid, by the Producer", producer, r(coordinator, animMid), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, rankOutranksTarget(c.rank, c.target, studio))
		})
	}

	assert.True(t, rankOutranks(producer, animLead, studio))
	assert.False(t, rankOutranks(animLead, producer, studio))
	assert.False(t, rankOutranks(animLead, animLead, studio))
	assert.False(t, rankOutranks(modLead, animMid, studio))
}

func TestCanActOnUserPermissionFromOutrankingRank(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam
	anim := newDepartment(t, th, team.Id, "Animasyon")
	mod := newDepartment(t, th, team.Id, "Modelleme")
	animSenior := newRank(t, th, team.Id, anim.Id, "Senior")
	animMid := newRank(t, th, team.Id, anim.Id, "Mid")
	modLead := newRank(t, th, team.Id, mod.Id, "Lead", model.PermissionManageTasks.Id)
	modMid := newRank(t, th, team.Id, mod.Id, "Mid")

	mert := rankedUser(t, th, team, animSenior, modLead)
	animator := rankedUser(t, th, team, animMid)
	modeler := rankedUser(t, th, team, modMid)

	assert.False(t, th.App.CanActOnUser(th.Context, mert.Id, animator.Id, team.Id, model.PermissionManageTasks),
		"the rank that outranks the animator does not carry manage_tasks")
	assert.True(t, th.App.CanActOnUser(th.Context, mert.Id, modeler.Id, team.Id, model.PermissionManageTasks))
	assert.False(t, th.App.CanActOnUser(th.Context, mert.Id, modeler.Id, team.Id, model.PermissionManageDailyReports))
	assert.True(t, th.App.CanActOnUser(th.Context, mert.Id, mert.Id, team.Id, model.PermissionManageTasks), "self")

	ids := th.App.ActionableUserIDs(th.Context, mert.Id, team.Id, []string{mert.Id, animator.Id, modeler.Id}, model.PermissionManageTasks)
	assert.Equal(t, []string{mert.Id, modeler.Id}, ids)

	other := th.CreateTeam(t)
	th.LinkUserToTeam(t, mert, other)
	th.LinkUserToTeam(t, modeler, other)
	assert.False(t, th.App.CanActOnUser(th.Context, mert.Id, modeler.Id, other.Id, model.PermissionManageTasks), "ranks count only in their team")
}

func TestStudioRankShieldsTarget(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam
	anim := newDepartment(t, th, team.Id, "Animasyon")
	producerRank := newRank(t, th, team.Id, studioOf(t, th, team.Id).Id, "Producer", model.PermissionManageTasks.Id)
	animLead := newRank(t, th, team.Id, anim.Id, "Lead", model.PermissionManageTasks.Id)
	animMid := newRank(t, th, team.Id, anim.Id, "Mid")

	producer := rankedUser(t, th, team, producerRank, animMid)
	lead := rankedUser(t, th, team, animLead)
	animator := rankedUser(t, th, team, animMid)

	assert.False(t, th.App.CanActOnUser(th.Context, lead.Id, producer.Id, team.Id, model.PermissionManageTasks))
	assert.True(t, th.App.CanActOnUser(th.Context, lead.Id, animator.Id, team.Id, model.PermissionManageTasks))
	assert.True(t, th.App.CanActOnUser(th.Context, producer.Id, lead.Id, team.Id, model.PermissionManageTasks))
}

func TestAdminsRankAboveRanks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	team := th.BasicTeam
	anim := newDepartment(t, th, team.Id, "Animasyon")
	leadRank := newRank(t, th, team.Id, anim.Id, "Lead", model.PermissionAssignCustomRoles.Id, model.PermissionManageTasks.Id)
	low := newRank(t, th, team.Id, anim.Id, "Low")

	lead := rankedUser(t, th, team, leadRank)
	teamAdmin := th.CreateUser(t)
	th.LinkUserToTeam(t, teamAdmin, team)
	_, appErr := th.App.UpdateTeamMemberRoles(th.Context, team.Id, teamAdmin.Id, model.TeamUserRoleId+" "+model.TeamAdminRoleId)
	require.Nil(t, appErr)

	assert.False(t, th.App.CanActOnUser(th.Context, lead.Id, th.SystemAdminUser.Id, team.Id, model.PermissionManageTasks))
	assert.False(t, th.App.CanActOnUser(th.Context, lead.Id, teamAdmin.Id, team.Id, model.PermissionManageTasks))
	ids := th.App.ActionableUserIDs(th.Context, lead.Id, team.Id, []string{lead.Id, th.SystemAdminUser.Id, teamAdmin.Id}, model.PermissionManageTasks)
	assert.Equal(t, []string{lead.Id}, ids)

	assert.True(t, th.App.CanActOnUser(th.Context, teamAdmin.Id, lead.Id, team.Id, model.PermissionManageTasks))
	other := th.CreateTeam(t)
	th.LinkUserToTeam(t, teamAdmin, other)
	th.LinkUserToTeam(t, lead, other)
	assert.False(t, th.App.CanActOnUser(th.Context, teamAdmin.Id, lead.Id, other.Id, model.PermissionManageTasks), "team admin only in their team")

	_, appErr = th.App.SetMemberRanks(th.Context, lead.Id, team.Id, teamAdmin.Id, []string{low.Id})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusForbidden, appErr.StatusCode)
}
