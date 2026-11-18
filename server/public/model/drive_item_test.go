// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDriveItemIsValid(t *testing.T) {
	valid := func() *DriveItem {
		item := &DriveItem{ChannelId: NewId(), Type: DriveItemTypeFile, Name: "a.png", FileId: NewId(), CreatorId: NewId()}
		item.PreSave()
		return item
	}

	require.Nil(t, valid().IsValid())

	for _, name := range []string{"", ".", "..", "a/b", "a\\b", "a:b", "x ", "x.", " x", strings.Repeat("a", 256), "a\x00b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b"} {
		item := valid()
		item.Name = name
		require.NotNil(t, item.IsValid(), "name %q should be invalid", name)
		require.False(t, IsValidDriveItemName(name), "name %q", name)
	}
	require.True(t, IsValidDriveItemName(strings.Repeat("ç", 255)))
	require.True(t, IsValidDriveItemName("Kampanya 2026 (2).final.pdf"))

	item := valid()
	item.Type = "link"
	require.NotNil(t, item.IsValid())

	item = valid()
	item.FileId = ""
	require.NotNil(t, item.IsValid())

	folder := &DriveItem{ChannelId: NewId(), Type: DriveItemTypeFolder, Name: "Docs", CreatorId: NewId()}
	folder.PreSave()
	require.Nil(t, folder.IsValid())
	folder.FileId = NewId()
	require.NotNil(t, folder.IsValid(), "folder must not reference a file")

	item = valid()
	item.ParentId = "bad"
	require.NotNil(t, item.IsValid())

	item = valid()
	item.ChannelId = ""
	require.NotNil(t, item.IsValid())
}

func TestDriveItemRulesIsValid(t *testing.T) {
	item := func(typ string, r DriveRules) *DriveItem {
		i := &DriveItem{ChannelId: NewId(), Type: typ, Name: "a", CreatorId: NewId(), DriveRules: r}
		if typ == DriveItemTypeFile {
			i.FileId = NewId()
		}
		i.PreSave()
		return i
	}
	const key = "model.drive_item.is_valid.rules.app_error"

	require.Equal(t, key, item(DriveItemTypeFile, DriveRules{ReadOnly: true}).IsValid().Id)
	require.Equal(t, key, item(DriveItemTypeFile, DriveRules{ViewDepartments: StringArray{NewId()}}).IsValid().Id)
	require.Equal(t, key, item(DriveItemTypeFolder, DriveRules{ViewDepartments: StringArray{"x"}}).IsValid().Id)
	require.Equal(t, key, item(DriveItemTypeFolder, DriveRules{WriteDepartments: StringArray{"x"}}).IsValid().Id)
	require.Equal(t, key, item(DriveItemTypeFolder, DriveRules{MirrorOf: "x"}).IsValid().Id)
	require.Nil(t, item(DriveItemTypeFolder, DriveRules{ViewDepartments: StringArray{NewId()}, WriteDepartments: StringArray{NewId()}, ReadOnly: true, MirrorOf: NewId()}).IsValid())
	require.False(t, DriveRules{}.HasRules())
	require.True(t, DriveRules{ReadOnly: true}.HasRules())
}

func TestEpisodeFolderRules(t *testing.T) {
	bg := "bg"
	r := (&EpisodeFolder{Path: "a", ViewDepartments: []string{bg}}).Rules()
	require.Equal(t, StringArray{bg}, r.ViewDepartments)
	require.Equal(t, StringArray{bg}, r.WriteDepartments)
	require.False(t, r.ReadOnly)

	r = (&EpisodeFolder{Path: "a", ViewDepartments: []string{bg}, ReadOnly: true}).Rules()
	require.Equal(t, StringArray{bg}, r.ViewDepartments)
	require.Empty(t, r.WriteDepartments)
	require.True(t, r.ReadOnly)

	require.Equal(t, DriveRules{}, (&EpisodeFolder{Path: "a"}).Rules())

	r = (&EpisodeFolder{Path: "a", WriteDepartments: []string{bg}, MirrorOf: "b"}).Rules()
	require.Equal(t, StringArray{bg}, r.WriteDepartments)
	require.Empty(t, r.MirrorOf)
}
