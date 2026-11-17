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
