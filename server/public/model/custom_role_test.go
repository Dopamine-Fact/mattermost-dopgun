// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomRoleIsValid(t *testing.T) {
	valid := func() *CustomRole {
		r := &CustomRole{TeamId: NewId(), DepartmentId: NewId(), DisplayName: "Lead", Color: "#ff00aa"}
		r.PreSave()
		return r
	}
	require.Nil(t, valid().IsValid())
	assert.Equal(t, "rk_", RankRoleNamePrefix)

	r := valid()
	assert.Equal(t, RankRoleNameFromId(r.Id), r.RoleName)

	r = valid()
	r.Color = "#FFF"
	assert.NotNil(t, r.IsValid())
	r.Color = "#FF00AA"
	assert.NotNil(t, r.IsValid(), "uppercase is not accepted")

	r = valid()
	r.DisplayName = strings.Repeat("ş", 65)
	assert.NotNil(t, r.IsValid())
	r.DisplayName = strings.Repeat("ş", 64)
	assert.Nil(t, r.IsValid())
	r.DisplayName = "  "
	assert.NotNil(t, r.IsValid())

	r = valid()
	r.TeamId = ""
	assert.NotNil(t, r.IsValid(), "a rank belongs to a team")

	r = valid()
	r.DepartmentId = ""
	assert.NotNil(t, r.IsValid(), "a rank belongs to a department")

	r = valid()
	r.Position = -1
	assert.NotNil(t, r.IsValid())

	r = valid()
	r.RoleName = "cr_" + r.Id
	assert.NotNil(t, r.IsValid())
}

func TestRankRoleNames(t *testing.T) {
	assert.Equal(t, []string{"a", "c"}, RankIdsFromRoles("team_user rk_a cr_b rk_c"))
	assert.Empty(t, RankIdsFromRoles("team_user team_admin"))
	assert.True(t, IsRankRoleName("rk_abc"))
	assert.False(t, IsRankRoleName("rk_"))
	assert.False(t, IsRankRoleName("cr_abc"))
	assert.Equal(t, "team_user team_admin", RemoveRankRoles("team_user rk_a team_admin"))
	assert.Equal(t, "", RemoveRankRoles("rk_a rk_b"))
	assert.ElementsMatch(t, []string{PermissionManageTasks.Id, PermissionManageDailyReports.Id, PermissionManageRevisions.Id, PermissionAssignCustomRoles.Id}, CustomRolePermissionWhitelist)
}

func TestAssignCustomRolesIsTeamScoped(t *testing.T) {
	assert.Equal(t, PermissionScopeTeam, PermissionAssignCustomRoles.Scope)
	assert.Contains(t, MakeDefaultRoles()[TeamAdminRoleId].Permissions, PermissionAssignCustomRoles.Id)
}
