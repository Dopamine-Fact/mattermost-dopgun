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
		r := &CustomRole{DisplayName: "Lead Animator", Color: "#ff00aa", Department: "Animation"}
		r.PreSave()
		return r
	}
	require.Nil(t, valid().IsValid())
	assert.Equal(t, "cr_", CustomRoleNamePrefix)

	r := valid()
	assert.Equal(t, CustomRoleNameFromId(r.Id), r.RoleName)

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
	r.Department = strings.Repeat("d", 65)
	assert.NotNil(t, r.IsValid())

	r = valid()
	r.Position = -1
	assert.NotNil(t, r.IsValid())

	r = valid()
	r.RoleName = "system_admin"
	assert.NotNil(t, r.IsValid())
}

func TestCustomRoleNames(t *testing.T) {
	assert.Equal(t, []string{"abc", "def"}, CustomRoleIdsFromRoles("system_user cr_abc cr_def"))
	assert.Empty(t, CustomRoleIdsFromRoles("system_user system_admin"))
	assert.True(t, IsCustomRoleName("cr_abc"))
	assert.False(t, IsCustomRoleName("cr_"))
	assert.False(t, IsCustomRoleName("system_user"))
	assert.ElementsMatch(t, []string{PermissionManageTasks.Id, PermissionManageDailyReports.Id, PermissionManageRevisions.Id, PermissionAssignCustomRoles.Id}, CustomRolePermissionWhitelist)
}
