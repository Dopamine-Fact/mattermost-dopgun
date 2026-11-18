// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDepartmentIsValid(t *testing.T) {
	valid := func() *Department {
		d := &Department{TeamId: NewId(), Name: "  Animasyon ", Color: "#336699"}
		d.PreSave()
		return d
	}
	d := valid()
	require.Nil(t, d.IsValid())
	assert.Equal(t, "Animasyon", d.Name, "name is trimmed")

	d = valid()
	d.Name = "   "
	assert.NotNil(t, d.IsValid())
	d.Name = strings.Repeat("ş", 65)
	assert.NotNil(t, d.IsValid())
	d.Name = strings.Repeat("ş", 64)
	assert.Nil(t, d.IsValid())

	d = valid()
	d.Color = "#ABCDEF"
	assert.NotNil(t, d.IsValid())

	d = valid()
	d.TeamId = ""
	assert.NotNil(t, d.IsValid())

	d = valid()
	d.Position = -1
	assert.NotNil(t, d.IsValid())

	d = valid()
	name, color := "Modelleme", "#112233"
	d.Patch(&DepartmentPatch{Name: &name, Color: &color})
	assert.Equal(t, "Modelleme", d.Name)
	assert.Equal(t, "#112233", d.Color)
}
