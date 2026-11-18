// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestCustomRoleHierarchyCore(t *testing.T) {
	mk := func(name string, pos int, dept string) *model.CustomRole {
		return &model.CustomRole{Id: model.NewId(), DisplayName: name, Position: pos, Department: dept}
	}
	producer := mk("Producer", 0, "")
	leadAnim := mk("LeadAnim", 1, "Anim")
	leadProg := mk("LeadProg", 2, "Prog")
	anim := mk("Anim", 3, "Anim")
	prog := mk("Prog", 4, "Prog")
	freelance := mk("Freelance", 5, "")
	r := func(rs ...*model.CustomRole) []*model.CustomRole { return rs }

	cases := []struct {
		name          string
		actor, target []*model.CustomRole
		want          bool
	}{
		{"lead animator on animator", r(leadAnim), r(anim), true},
		{"lead animator on programmer", r(leadAnim), r(prog), false},
		{"lead animator on freelance", r(leadAnim), r(freelance), true},
		{"lead animator on lead programmer", r(leadAnim), r(leadProg), false},
		{"peers", r(leadAnim), r(leadAnim), false},
		{"producer on lead animator", r(producer), r(leadAnim), true},
		{"producer on lead programmer", r(producer), r(leadProg), true},
		{"producer on animator", r(producer), r(anim), true},
		{"producer on freelance", r(producer), r(freelance), true},
		{"animator on lead animator", r(anim), r(leadAnim), false},
		{"target with two departments, lead of one", r(leadAnim), r(anim, prog), false},
		{"target with two departments, producer", r(producer), r(anim, prog), true},
		{"role-less target, actor with a role", r(freelance), r(), true},
		{"role-less target, role-less actor", r(), r(), false},
		{"role-less actor on animator", r(), r(anim), false},
		{"lead + intern holder still bound by every role", r(anim, leadAnim), r(prog), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, canActOn(c.actor, c.target))
		})
	}

	assert.True(t, outranks(producer, freelance))
	assert.False(t, outranks(freelance, producer))
	assert.True(t, outranks(leadAnim, freelance), "department-less target")
	assert.False(t, outranks(anim, anim))
}
