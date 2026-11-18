// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestDriveItemStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGet", func(t *testing.T) { testDriveItemSaveGet(t, ss) })
	t.Run("ChildrenFoldersFirstSortedByName", func(t *testing.T) { testDriveItemChildrenSorted(t, ss) })
	t.Run("ChildrenHideDeleted", func(t *testing.T) { testDriveItemChildrenHideDeleted(t, ss) })
	t.Run("DescendantsRecursive", func(t *testing.T) { testDriveItemDescendants(t, ss) })
	t.Run("AncestorsOrder", func(t *testing.T) { testDriveItemAncestors(t, ss) })
	t.Run("NameExistsCaseInsensitiveLiveOnly", func(t *testing.T) { testDriveItemNameExists(t, ss) })
	t.Run("UpdateMany", func(t *testing.T) { testDriveItemUpdateMany(t, ss) })
	t.Run("TrashAndExpired", func(t *testing.T) { testDriveItemTrash(t, ss) })
	t.Run("GetByFileId", func(t *testing.T) { testDriveItemGetByFileId(t, ss) })
	t.Run("Dangling", func(t *testing.T) { testDriveItemDangling(t, rctx, ss) })
	t.Run("PermanentDeleteByChannel", func(t *testing.T) { testDriveItemPermanentDeleteByChannel(t, ss) })
	t.Run("Rules", func(t *testing.T) { testDriveItemRules(t, ss) })
	t.Run("GetMirrors", func(t *testing.T) { testDriveItemGetMirrors(t, ss) })
}

func saveDriveFolder(t *testing.T, ss store.Store, channelID, parentID, name string) *model.DriveItem {
	t.Helper()
	item, err := ss.DriveItem().Save(&model.DriveItem{ChannelId: channelID, ParentId: parentID, Type: model.DriveItemTypeFolder, Name: name, CreatorId: model.NewId()})
	require.NoError(t, err)
	return item
}

func saveDriveFile(t *testing.T, ss store.Store, channelID, parentID, name, fileID string) *model.DriveItem {
	t.Helper()
	if fileID == "" {
		fileID = model.NewId()
	}
	item, err := ss.DriveItem().Save(&model.DriveItem{ChannelId: channelID, ParentId: parentID, Type: model.DriveItemTypeFile, Name: name, FileId: fileID, CreatorId: model.NewId()})
	require.NoError(t, err)
	return item
}

func driveNames(items []*model.DriveItem) []string {
	names := make([]string, 0, len(items))
	for _, i := range items {
		names = append(names, i.Name)
	}
	return names
}

func testDriveItemSaveGet(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	saved := saveDriveFile(t, ss, channelID, "", "a.png", "")

	got, err := ss.DriveItem().Get(saved.Id)
	require.NoError(t, err)
	require.Equal(t, saved, got)

	_, err = ss.DriveItem().Get(model.NewId())
	var nf *store.ErrNotFound
	require.ErrorAs(t, err, &nf)

	many, err := ss.DriveItem().GetMany([]string{saved.Id, model.NewId()})
	require.NoError(t, err)
	require.Len(t, many, 1)

	// a live duplicate name in the same folder violates the unique index
	_, err = ss.DriveItem().Save(&model.DriveItem{ChannelId: channelID, Type: model.DriveItemTypeFile, Name: "A.PNG", FileId: model.NewId(), CreatorId: model.NewId()})
	var conflict *store.ErrConflict
	require.ErrorAs(t, err, &conflict)
}

func testDriveItemChildrenSorted(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	saveDriveFile(t, ss, channelID, "", "b.txt", "")
	saveDriveFolder(t, ss, channelID, "", "zeta")
	saveDriveFile(t, ss, channelID, "", "A.txt", "")
	saveDriveFolder(t, ss, channelID, "", "Alpha")
	saveDriveFile(t, ss, model.NewId(), "", "other-channel.txt", "")

	items, err := ss.DriveItem().GetChildren(channelID, "", 100)
	require.NoError(t, err)
	require.Equal(t, []string{"Alpha", "zeta", "A.txt", "b.txt"}, driveNames(items))

	items, err = ss.DriveItem().GetChildren(channelID, "", 2)
	require.NoError(t, err)
	require.Len(t, items, 2)
}

func testDriveItemChildrenHideDeleted(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	gone := saveDriveFile(t, ss, channelID, "", "gone.txt", "")
	saveDriveFile(t, ss, channelID, "", "kept.txt", "")
	gone.DeleteAt = model.GetMillis()
	gone.DeletedBy = model.NewId()
	_, err := ss.DriveItem().Update(gone)
	require.NoError(t, err)

	items, err := ss.DriveItem().GetChildren(channelID, "", 100)
	require.NoError(t, err)
	require.Equal(t, []string{"kept.txt"}, driveNames(items))
}

func testDriveItemDescendants(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	root := saveDriveFolder(t, ss, channelID, "", "root")
	sub := saveDriveFolder(t, ss, channelID, root.Id, "sub")
	saveDriveFile(t, ss, channelID, root.Id, "one.txt", "")
	saveDriveFile(t, ss, channelID, sub.Id, "two.txt", "")
	saveDriveFile(t, ss, channelID, "", "outside.txt", "")

	items, err := ss.DriveItem().GetDescendants(channelID, root.Id)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"sub", "one.txt", "two.txt"}, driveNames(items))
}

func testDriveItemAncestors(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	a := saveDriveFolder(t, ss, channelID, "", "a")
	b := saveDriveFolder(t, ss, channelID, a.Id, "b")
	c := saveDriveFolder(t, ss, channelID, b.Id, "c")

	items, err := ss.DriveItem().GetAncestors(c.Id)
	require.NoError(t, err)
	require.Equal(t, []string{"a", "b"}, driveNames(items))

	items, err = ss.DriveItem().GetAncestors(a.Id)
	require.NoError(t, err)
	require.Empty(t, items)
}

func testDriveItemNameExists(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	item := saveDriveFile(t, ss, channelID, "", "A.png", "")

	exists, err := ss.DriveItem().NameExists(channelID, "", "a.PNG", "")
	require.NoError(t, err)
	require.True(t, exists)

	exists, err = ss.DriveItem().NameExists(channelID, "", "a.PNG", item.Id)
	require.NoError(t, err)
	require.False(t, exists, "excludeID ignores the item itself")

	item.DeleteAt = model.GetMillis()
	_, err = ss.DriveItem().Update(item)
	require.NoError(t, err)
	exists, err = ss.DriveItem().NameExists(channelID, "", "a.PNG", "")
	require.NoError(t, err)
	require.False(t, exists, "a deleted twin does not count")
}

func testDriveItemUpdateMany(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	dst := saveDriveFolder(t, ss, channelID, "", "dst")
	x := saveDriveFile(t, ss, channelID, "", "x.txt", "")
	y := saveDriveFile(t, ss, channelID, "", "y.txt", "")
	x.ParentId, y.ParentId = dst.Id, dst.Id
	require.NoError(t, ss.DriveItem().UpdateMany([]*model.DriveItem{x, y}))

	items, err := ss.DriveItem().GetChildren(channelID, dst.Id, 100)
	require.NoError(t, err)
	require.Equal(t, []string{"x.txt", "y.txt"}, driveNames(items))

	// a cross-channel move changes ChannelId
	otherID := model.NewId()
	x.ChannelId, x.ParentId = otherID, ""
	require.NoError(t, ss.DriveItem().UpdateMany([]*model.DriveItem{x}))
	got, err := ss.DriveItem().Get(x.Id)
	require.NoError(t, err)
	require.Equal(t, otherID, got.ChannelId)
}

func testDriveItemTrash(t *testing.T, ss store.Store) {
	channelID := model.NewId()
	old := saveDriveFile(t, ss, channelID, "", "old.txt", "")
	recent := saveDriveFile(t, ss, channelID, "", "recent.txt", "")
	saveDriveFile(t, ss, channelID, "", "live.txt", "")

	now := model.GetMillis()
	old.DeleteAt = now - model.DriveTrashRetention.Milliseconds() - 1000
	recent.DeleteAt = now
	require.NoError(t, ss.DriveItem().UpdateMany([]*model.DriveItem{old, recent}))

	trash, err := ss.DriveItem().GetTrash(channelID)
	require.NoError(t, err)
	require.Equal(t, []string{"recent.txt", "old.txt"}, driveNames(trash))

	expired, err := ss.DriveItem().GetExpiredTrash(now-model.DriveTrashRetention.Milliseconds(), 1000)
	require.NoError(t, err)
	ids := map[string]bool{}
	for _, i := range expired {
		ids[i.Id] = true
	}
	require.True(t, ids[old.Id])
	require.False(t, ids[recent.Id])
}

func testDriveItemGetByFileId(t *testing.T, ss store.Store) {
	fileID := model.NewId()
	item := saveDriveFile(t, ss, model.NewId(), "", "f.txt", fileID)
	got, err := ss.DriveItem().GetByFileId(fileID)
	require.NoError(t, err)
	require.Equal(t, item.Id, got.Id)

	_, err = ss.DriveItem().GetByFileId(model.NewId())
	var nf *store.ErrNotFound
	require.ErrorAs(t, err, &nf)

	// one FileInfo belongs to one drive item, even when two adds race
	_, err = ss.DriveItem().Save(&model.DriveItem{ChannelId: item.ChannelId, Type: model.DriveItemTypeFile, Name: "g.txt", FileId: fileID, CreatorId: model.NewId()})
	var unique *store.ErrUniqueConstraint
	require.ErrorAs(t, err, &unique)
}

func testDriveItemDangling(t *testing.T, rctx request.CTX, ss store.Store) {
	channelID := model.NewId()
	live, err := ss.FileInfo().Save(rctx, &model.FileInfo{CreatorId: model.NewId(), Path: "live.txt", ChannelId: channelID})
	require.NoError(t, err)
	softDeleted, err := ss.FileInfo().Save(rctx, &model.FileInfo{CreatorId: model.NewId(), Path: "deleted.txt", ChannelId: channelID, DeleteAt: model.GetMillis()})
	require.NoError(t, err)
	defer ss.FileInfo().PermanentDelete(rctx, live.Id)
	defer ss.FileInfo().PermanentDelete(rctx, softDeleted.Id)

	okItem := saveDriveFile(t, ss, channelID, "", "ok.txt", live.Id)
	softItem := saveDriveFile(t, ss, channelID, "", "soft.txt", softDeleted.Id)
	missingItem := saveDriveFile(t, ss, channelID, "", "missing.txt", "")
	saveDriveFolder(t, ss, channelID, "", "folder")

	dangling, err := ss.DriveItem().GetDangling(1000)
	require.NoError(t, err)
	ids := map[string]bool{}
	for _, i := range dangling {
		ids[i.Id] = true
	}
	require.True(t, ids[softItem.Id])
	require.True(t, ids[missingItem.Id])
	require.False(t, ids[okItem.Id])
	for _, i := range dangling {
		require.Equal(t, model.DriveItemTypeFile, i.Type)
	}
}

func testDriveItemPermanentDeleteByChannel(t *testing.T, ss store.Store) {
	channelID, otherID := model.NewId(), model.NewId()
	a := saveDriveFolder(t, ss, channelID, "", "a")
	saveDriveFile(t, ss, channelID, a.Id, "b.txt", "")
	other := saveDriveFile(t, ss, otherID, "", "c.txt", "")

	require.NoError(t, ss.DriveItem().PermanentDeleteByChannel(channelID))
	items, err := ss.DriveItem().GetDescendants(channelID, a.Id)
	require.NoError(t, err)
	require.Empty(t, items)
	_, err = ss.DriveItem().Get(a.Id)
	require.Error(t, err)

	require.NoError(t, ss.DriveItem().PermanentDelete([]string{other.Id}))
	_, err = ss.DriveItem().Get(other.Id)
	require.Error(t, err)
}

func testDriveItemRules(t *testing.T, ss store.Store) {
	ch := model.NewId()
	rules := model.DriveRules{ViewDepartments: model.StringArray{model.NewId()}, WriteDepartments: model.StringArray{model.NewId(), model.NewId()}, ReadOnly: true, MirrorOf: model.NewId()}
	f, err := ss.DriveItem().Save(&model.DriveItem{ChannelId: ch, Type: model.DriveItemTypeFolder, Name: "r", CreatorId: model.NewId(), DriveRules: rules})
	require.NoError(t, err)
	got, err := ss.DriveItem().Get(f.Id)
	require.NoError(t, err)
	require.Equal(t, rules, got.DriveRules)

	got.DriveRules = model.DriveRules{}
	_, err = ss.DriveItem().Update(got)
	require.NoError(t, err)
	got, err = ss.DriveItem().Get(f.Id)
	require.NoError(t, err)
	require.False(t, got.HasRules())
	require.Empty(t, got.ViewDepartments)

	plain := saveDriveFolder(t, ss, ch, "", "plain")
	got, err = ss.DriveItem().Get(plain.Id)
	require.NoError(t, err)
	require.False(t, got.HasRules())
}

func testDriveItemGetMirrors(t *testing.T, ss store.Store) {
	ch1, ch2, src := model.NewId(), model.NewId(), model.NewId()
	mirror := func(ch, name string) *model.DriveItem {
		i, err := ss.DriveItem().Save(&model.DriveItem{ChannelId: ch, Type: model.DriveItemTypeFolder, Name: name, CreatorId: model.NewId(), DriveRules: model.DriveRules{MirrorOf: src}})
		require.NoError(t, err)
		return i
	}
	live := mirror(ch1, "live")
	trashed := mirror(ch1, "trashed")
	trashed.DeleteAt = model.GetMillis()
	_, err := ss.DriveItem().Update(trashed)
	require.NoError(t, err)
	mirror(ch2, "other")

	got, err := ss.DriveItem().GetMirrors(ch1, []string{src})
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, live.Id, got[0].Id)

	got, err = ss.DriveItem().GetMirrors(ch1, nil)
	require.NoError(t, err)
	require.Empty(t, got)
}
