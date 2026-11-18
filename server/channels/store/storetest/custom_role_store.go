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
	t.Run("GetForTeam", func(t *testing.T) { testCustomRoleGetForTeam(t, ss) })
	t.Run("NameUniqueInDepartment", func(t *testing.T) { testCustomRoleNameUniqueInDepartment(t, ss) })
	t.Run("SetPositionsPerDepartment", func(t *testing.T) { testCustomRoleSetPositionsPerDepartment(t, ss) })
	t.Run("UserRolesLong", func(t *testing.T) { testUserRolesLong(t, rctx, ss) })
}

func saveRank(t *testing.T, ss store.Store, d *model.Department, name string, position int) *model.CustomRole {
	r, err := ss.CustomRole().Save(&model.CustomRole{TeamId: d.TeamId, DepartmentId: d.Id, DisplayName: name, Color: "#112233", Position: position})
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

func testCustomRoleGetForTeam(t *testing.T, ss store.Store) {
	team := model.NewId()
	d1 := saveDepartment(t, ss, team, "D1", 0)
	d2 := saveDepartment(t, ss, team, "D2", 1)
	otherDept := saveDepartment(t, ss, model.NewId(), "D1", 0)

	d2b := saveRank(t, ss, d2, "B", 1)
	d1b := saveRank(t, ss, d1, "B", 1)
	d2a := saveRank(t, ss, d2, "A", 0)
	d1a := saveRank(t, ss, d1, "A", 0)
	saveRank(t, ss, otherDept, "A", 0)
	assert.Equal(t, model.RankRoleNameFromId(d1a.Id), d1a.RoleName)

	d1b.DisplayName = "Senior"
	_, err := ss.CustomRole().Update(d1b)
	require.NoError(t, err)
	got, err := ss.CustomRole().Get(d1b.Id)
	require.NoError(t, err)
	assert.Equal(t, "Senior", got.DisplayName)
	assert.Equal(t, team, got.TeamId)
	assert.Equal(t, d1.Id, got.DepartmentId)

	all, err := ss.CustomRole().GetForTeam(team)
	require.NoError(t, err)
	// Grouped by department, then Position; the order of the groups is the caller's to decide.
	byDept := map[string][]string{}
	for _, r := range all {
		byDept[r.DepartmentId] = append(byDept[r.DepartmentId], r.Id)
	}
	assert.Equal(t, map[string][]string{d1.Id: {d1a.Id, d1b.Id}, d2.Id: {d2a.Id, d2b.Id}}, byDept)

	require.NoError(t, ss.CustomRole().Delete(d2b.Id, model.GetMillis()))
	all, err = ss.CustomRole().GetForTeam(team)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{d1a.Id, d1b.Id, d2a.Id}, customRoleIDs(all))

	var nf *store.ErrNotFound
	_, err = ss.CustomRole().Get(d2b.Id)
	assert.ErrorAs(t, err, &nf)
}

func testCustomRoleNameUniqueInDepartment(t *testing.T, ss store.Store) {
	team := model.NewId()
	d1 := saveDepartment(t, ss, team, "D1", 0)
	d2 := saveDepartment(t, ss, team, "D2", 1)
	saveRank(t, ss, d1, "Lead", 0)

	var conflict *store.ErrConflict
	_, err := ss.CustomRole().Save(&model.CustomRole{TeamId: team, DepartmentId: d1.Id, DisplayName: "LEAD", Color: "#112233", Position: 1})
	assert.ErrorAs(t, err, &conflict)

	saveRank(t, ss, d2, "Lead", 0)

	junior := saveRank(t, ss, d1, "Junior", 1)
	junior.DisplayName = "lead"
	_, err = ss.CustomRole().Update(junior)
	assert.ErrorAs(t, err, &conflict)
}

func testCustomRoleSetPositionsPerDepartment(t *testing.T, ss store.Store) {
	team := model.NewId()
	d1 := saveDepartment(t, ss, team, "D1", 0)
	d2 := saveDepartment(t, ss, team, "D2", 1)
	a := saveRank(t, ss, d1, "A", 0)
	b := saveRank(t, ss, d1, "B", 1)
	c := saveRank(t, ss, d1, "C", 2)
	x := saveRank(t, ss, d2, "X", 0)

	require.NoError(t, ss.CustomRole().SetPositions(d1.Id, []string{c.Id, a.Id, b.Id}, model.GetMillis()))
	for id, want := range map[string]int{c.Id: 0, a.Id: 1, b.Id: 2, x.Id: 0} {
		got, err := ss.CustomRole().Get(id)
		require.NoError(t, err)
		assert.Equal(t, want, got.Position)
	}

	var invalid *store.ErrInvalidInput
	assert.ErrorAs(t, ss.CustomRole().SetPositions(d1.Id, []string{a.Id, b.Id}, model.GetMillis()), &invalid, "missing id")
	assert.ErrorAs(t, ss.CustomRole().SetPositions(d1.Id, []string{a.Id, b.Id, c.Id, x.Id}, model.GetMillis()), &invalid, "other department's id")
	assert.ErrorAs(t, ss.CustomRole().SetPositions(d1.Id, []string{a.Id, a.Id, b.Id}, model.GetMillis()), &invalid, "duplicate id")
}

func testUserRolesLong(t *testing.T, rctx request.CTX, ss store.Store) {
	roles := []string{model.SystemUserRoleId}
	for range 30 {
		roles = append(roles, model.RankRoleNameFromId(model.NewId()))
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
