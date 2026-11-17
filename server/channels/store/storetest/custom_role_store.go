// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestCustomRoleStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGetAll", func(t *testing.T) { testCustomRoleSaveGetAll(t, ss) })
	t.Run("SetPositions", func(t *testing.T) { testCustomRoleSetPositions(t, ss) })
	t.Run("UserRolesLong", func(t *testing.T) { testUserRolesLong(t, rctx, ss) })
	t.Run("RemoveRoleFromAll", func(t *testing.T) { testRemoveRoleFromAll(t, rctx, ss) })
}

func clearCustomRoles(t *testing.T, ss store.Store) {
	all, err := ss.CustomRole().GetAll()
	require.NoError(t, err)
	for _, r := range all {
		require.NoError(t, ss.CustomRole().Delete(r.Id, model.GetMillis()))
	}
}

func saveCustomRole(t *testing.T, ss store.Store, name string, position int) *model.CustomRole {
	r, err := ss.CustomRole().Save(&model.CustomRole{DisplayName: name, Color: "#112233", Position: position})
	require.NoError(t, err)
	return r
}

func customRoleIDs(roles []*model.CustomRole) []string {
	ids := make([]string, len(roles))
	for i, r := range roles {
		ids[i] = r.Id
	}
	return ids
}

func testCustomRoleSaveGetAll(t *testing.T, ss store.Store) {
	clearCustomRoles(t, ss)
	b := saveCustomRole(t, ss, "B", 1)
	a := saveCustomRole(t, ss, "A", 0)
	c := saveCustomRole(t, ss, "C", 2)
	assert.Equal(t, model.CustomRoleNameFromId(a.Id), a.RoleName)

	got, err := ss.CustomRole().Get(b.Id)
	require.NoError(t, err)
	assert.Equal(t, "B", got.DisplayName)

	b.Department = "Animation"
	_, err = ss.CustomRole().Update(b)
	require.NoError(t, err)
	got, err = ss.CustomRole().Get(b.Id)
	require.NoError(t, err)
	assert.Equal(t, "Animation", got.Department)

	all, err := ss.CustomRole().GetAll()
	require.NoError(t, err)
	assert.Equal(t, []string{a.Id, b.Id, c.Id}, customRoleIDs(all))

	require.NoError(t, ss.CustomRole().Delete(b.Id, model.GetMillis()))
	all, err = ss.CustomRole().GetAll()
	require.NoError(t, err)
	assert.Equal(t, []string{a.Id, c.Id}, customRoleIDs(all))

	_, err = ss.CustomRole().Get(model.NewId())
	var nf *store.ErrNotFound
	assert.ErrorAs(t, err, &nf)
}

func testCustomRoleSetPositions(t *testing.T, ss store.Store) {
	clearCustomRoles(t, ss)
	a := saveCustomRole(t, ss, "A", 0)
	b := saveCustomRole(t, ss, "B", 1)
	c := saveCustomRole(t, ss, "C", 2)

	require.NoError(t, ss.CustomRole().SetPositions([]string{c.Id, a.Id, b.Id}, model.GetMillis()))
	all, err := ss.CustomRole().GetAll()
	require.NoError(t, err)
	assert.Equal(t, []string{c.Id, a.Id, b.Id}, customRoleIDs(all))
	for i, r := range all {
		assert.Equal(t, i, r.Position)
	}

	var invalid *store.ErrInvalidInput
	err = ss.CustomRole().SetPositions([]string{a.Id, b.Id}, model.GetMillis())
	assert.ErrorAs(t, err, &invalid, "missing id")
	err = ss.CustomRole().SetPositions([]string{a.Id, b.Id, c.Id, model.NewId()}, model.GetMillis())
	assert.ErrorAs(t, err, &invalid, "unknown id")
	err = ss.CustomRole().SetPositions([]string{a.Id, a.Id, b.Id}, model.GetMillis())
	assert.ErrorAs(t, err, &invalid, "duplicate id")

	all, err = ss.CustomRole().GetAll()
	require.NoError(t, err)
	assert.Equal(t, []string{c.Id, a.Id, b.Id}, customRoleIDs(all), "a rejected order changes nothing")
}

func testUserRolesLong(t *testing.T, rctx request.CTX, ss store.Store) {
	roles := []string{model.SystemUserRoleId}
	for range 30 {
		roles = append(roles, model.CustomRoleNameFromId(model.NewId()))
	}
	long := strings.Join(roles, " ")
	require.Greater(t, len(long), 850)

	u, err := ss.User().Save(rctx, &model.User{Email: MakeEmail(), Username: model.NewUsername(), Roles: long})
	require.NoError(t, err)
	defer func() { require.NoError(t, ss.User().PermanentDelete(rctx, u.Id)) }()
	got, err := ss.User().Get(rctx, u.Id)
	require.NoError(t, err)
	assert.Equal(t, long, got.Roles)
}

func testRemoveRoleFromAll(t *testing.T, rctx request.CTX, ss store.Store) {
	save := func(roles string) *model.User {
		u, err := ss.User().Save(rctx, &model.User{Email: MakeEmail(), Username: model.NewUsername(), Roles: roles})
		require.NoError(t, err)
		t.Cleanup(func() { _ = ss.User().PermanentDelete(rctx, u.Id) })
		return u
	}
	holder := save("system_user cr_a cr_ab")
	last := save("system_user cr_ab cr_a")
	other := save("system_user cr_ab")

	affected, err := ss.User().RemoveRoleFromAll("cr_a")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{holder.Id, last.Id}, affected)

	for _, u := range []*model.User{holder, last, other} {
		got, err := ss.User().Get(rctx, u.Id)
		require.NoError(t, err)
		assert.Equal(t, "system_user cr_ab", got.Roles)
	}
}
