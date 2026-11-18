// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestDepartmentStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGetForTeam", func(t *testing.T) { testDepartmentSaveGetForTeam(t, ss) })
	t.Run("NameUnique", func(t *testing.T) { testDepartmentNameUnique(t, ss) })
	t.Run("SetPositions", func(t *testing.T) { testDepartmentSetPositions(t, ss) })
}

func saveDepartment(t *testing.T, ss store.Store, teamID, name string, position int) *model.Department {
	d, err := ss.Department().Save(&model.Department{TeamId: teamID, Name: name, Color: "#112233", Position: position})
	require.NoError(t, err)
	return d
}

func departmentIDs(ds []*model.Department) []string {
	ids := make([]string, len(ds))
	for i, d := range ds {
		ids[i] = d.Id
	}
	return ids
}

func testDepartmentSaveGetForTeam(t *testing.T, ss store.Store) {
	team, otherTeam := model.NewId(), model.NewId()
	b := saveDepartment(t, ss, team, "B", 1)
	a := saveDepartment(t, ss, team, "A", 0)
	c := saveDepartment(t, ss, team, "C", 2)
	saveDepartment(t, ss, otherTeam, "A", 0)

	got, err := ss.Department().Get(b.Id)
	require.NoError(t, err)
	assert.Equal(t, "B", got.Name)

	b.Name = "Animasyon"
	_, err = ss.Department().Update(b)
	require.NoError(t, err)
	got, err = ss.Department().Get(b.Id)
	require.NoError(t, err)
	assert.Equal(t, "Animasyon", got.Name)

	all, err := ss.Department().GetForTeam(team)
	require.NoError(t, err)
	assert.Equal(t, []string{a.Id, b.Id, c.Id}, departmentIDs(all))

	require.NoError(t, ss.Department().Delete(b.Id, model.GetMillis()))
	all, err = ss.Department().GetForTeam(team)
	require.NoError(t, err)
	assert.Equal(t, []string{a.Id, c.Id}, departmentIDs(all))

	var nf *store.ErrNotFound
	_, err = ss.Department().Get(b.Id)
	assert.ErrorAs(t, err, &nf, "deleted is not found")
	_, err = ss.Department().Update(b)
	assert.ErrorAs(t, err, &nf, "deleted cannot be updated")
}

func testDepartmentNameUnique(t *testing.T, ss store.Store) {
	team := model.NewId()
	saveDepartment(t, ss, team, "Animasyon", 0)

	var conflict *store.ErrConflict
	_, err := ss.Department().Save(&model.Department{TeamId: team, Name: "ANIMASYON", Color: "#112233", Position: 1})
	assert.ErrorAs(t, err, &conflict)

	saveDepartment(t, ss, model.NewId(), "Animasyon", 0)

	other := saveDepartment(t, ss, team, "Modelleme", 1)
	other.Name = "animasyon"
	_, err = ss.Department().Update(other)
	assert.ErrorAs(t, err, &conflict)

	_, err = ss.Department().Save(&model.Department{TeamId: team, Name: "Studio", Color: "#112233", IsStudio: true})
	require.NoError(t, err)
	_, err = ss.Department().Save(&model.Department{TeamId: team, Name: "Studio 2", Color: "#112233", IsStudio: true})
	assert.ErrorAs(t, err, &conflict, "one studio department per team")
}

func testDepartmentSetPositions(t *testing.T, ss store.Store) {
	team := model.NewId()
	a := saveDepartment(t, ss, team, "A", 0)
	b := saveDepartment(t, ss, team, "B", 1)
	c := saveDepartment(t, ss, team, "C", 2)
	other := saveDepartment(t, ss, model.NewId(), "A", 0)

	require.NoError(t, ss.Department().SetPositions(team, []string{c.Id, a.Id, b.Id}, model.GetMillis()))
	all, err := ss.Department().GetForTeam(team)
	require.NoError(t, err)
	assert.Equal(t, []string{c.Id, a.Id, b.Id}, departmentIDs(all))

	var invalid *store.ErrInvalidInput
	assert.ErrorAs(t, ss.Department().SetPositions(team, []string{a.Id, b.Id}, model.GetMillis()), &invalid, "missing id")
	assert.ErrorAs(t, ss.Department().SetPositions(team, []string{a.Id, b.Id, c.Id, other.Id}, model.GetMillis()), &invalid, "other team's id")
	assert.ErrorAs(t, ss.Department().SetPositions(team, []string{a.Id, a.Id, b.Id}, model.GetMillis()), &invalid, "duplicate id")

	all, err = ss.Department().GetForTeam(team)
	require.NoError(t, err)
	assert.Equal(t, []string{c.Id, a.Id, b.Id}, departmentIDs(all), "a rejected order changes nothing")
}
