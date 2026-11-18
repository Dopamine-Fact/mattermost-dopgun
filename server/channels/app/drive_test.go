// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"bytes"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func setupDrive(t *testing.T) *TestHelper {
	t.Helper()
	th := Setup(t).InitBasic(t)
	th.BasicTeam.FilesEnabled = true
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team
	return th
}

func driveSession(u *model.User) model.Session {
	return model.Session{UserId: u.Id, Roles: u.GetRawRoles()}
}

func driveUpload(t *testing.T, th *TestHelper, user *model.User, channel *model.Channel, name string, data []byte) *model.FileInfo {
	t.Helper()
	info, appErr := th.App.UploadFileX(th.Context, channel.Id, name, bytes.NewReader(data),
		UploadFileSetTeamId("noteam"), UploadFileSetUserId(user.Id), UploadFileSetTimestamp(time.Now()),
		UploadFileSetContentLength(int64(len(data))))
	require.Nil(t, appErr)
	return info
}

func driveAddFile(t *testing.T, th *TestHelper, user *model.User, channel *model.Channel, parentID, name string) *model.DriveItem {
	t.Helper()
	info := driveUpload(t, th, user, channel, name, []byte("content of "+name))
	item, appErr := th.App.AddDriveFile(th.Context, user.Id, channel, parentID, info.Id)
	require.Nil(t, appErr)
	return item
}

func driveFolder(t *testing.T, th *TestHelper, user *model.User, channel *model.Channel, parentID, name string) *model.DriveItem {
	t.Helper()
	item, appErr := th.App.CreateDriveFolder(th.Context, user.Id, channel, parentID, name)
	require.Nil(t, appErr)
	return item
}

func driveListNames(t *testing.T, th *TestHelper, channel *model.Channel, parentID string) []string {
	t.Helper()
	listing, appErr := th.App.ListDriveFolder(th.Context, driveSession(th.BasicUser), channel, parentID)
	require.Nil(t, appErr)
	names := []string{}
	for _, i := range listing.Items {
		names = append(names, i.Name)
	}
	return names
}

func TestDriveDisabledTeam(t *testing.T) {
	th := Setup(t).InitBasic(t)
	_, appErr := th.App.RequireDriveChannel(th.Context, th.BasicChannel.Id)
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)
	require.Equal(t, "app.drive.disabled.app_error", appErr.Id)
}

func TestDriveCreateAndList(t *testing.T) {
	th := setupDrive(t)
	ch, appErr := th.App.RequireDriveChannel(th.Context, th.BasicChannel.Id)
	require.Nil(t, appErr)

	driveAddFile(t, th, th.BasicUser, ch, "", "b.txt")
	docs := driveFolder(t, th, th.BasicUser, ch, "", "Docs")
	sub := driveFolder(t, th, th.BasicUser, ch, docs.Id, "Sub")
	driveAddFile(t, th, th.BasicUser, ch, sub.Id, "deep.txt")

	require.Equal(t, []string{"Docs", "b.txt"}, driveListNames(t, th, ch, ""))

	listing, appErr := th.App.ListDriveFolder(th.Context, driveSession(th.BasicUser), ch, sub.Id)
	require.Nil(t, appErr)
	require.Len(t, listing.Items, 1)
	require.NotNil(t, listing.Items[0].FileInfo)
	require.Equal(t, []string{"Docs", "Sub"}, []string{listing.Path[0].Name, listing.Path[1].Name})

	// a folder from another channel is not a valid parent
	other := th.CreateChannel(t, th.BasicTeam)
	_, appErr = th.App.CreateDriveFolder(th.Context, th.BasicUser.Id, other, docs.Id, "x")
	require.NotNil(t, appErr)
}

func TestDriveNameClash(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel

	driveAddFile(t, th, th.BasicUser, ch, "", "a.png")
	clash := driveAddFile(t, th, th.BasicUser, ch, "", "A.PNG")
	require.Equal(t, "A (2).PNG", clash.Name)

	driveFolder(t, th, th.BasicUser, ch, "", "Docs")
	second := driveFolder(t, th, th.BasicUser, ch, "", "Docs")
	require.Equal(t, "Docs (2)", second.Name)

	// a file whose FileInfo is already in the drive cannot be added twice
	_, appErr := th.App.AddDriveFile(th.Context, th.BasicUser.Id, ch, "", clash.FileId)
	require.NotNil(t, appErr)
}

func TestDriveConcurrentSameName(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel

	const n = 8
	var wg sync.WaitGroup
	errs := make([]*model.AppError, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = th.App.CreateDriveFolder(th.Context, th.BasicUser.Id, ch, "", "Docs")
		}()
	}
	wg.Wait()
	for _, appErr := range errs {
		require.Nil(t, appErr)
	}
	require.Len(t, driveListNames(t, th, ch, ""), n)
}

func TestDriveOnlyOpenAndPrivateChannels(t *testing.T) {
	th := setupDrive(t)
	for _, typ := range []model.ChannelType{model.ChannelTypeSpace, model.ChannelTypeOpenBoard, model.ChannelTypePrivateBoard} {
		ch := th.CreateChannel(t, th.BasicTeam)
		ch.Type = typ
		_, err := th.App.Srv().Store().Channel().Update(th.Context, ch)
		require.NoError(t, err)
		th.App.Srv().Store().Channel().InvalidateChannel(ch.Id)

		_, appErr := th.App.RequireDriveChannel(th.Context, ch.Id)
		require.NotNil(t, appErr, string(typ))
	}
}

func TestDriveRenameRules(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	a := driveAddFile(t, th, th.BasicUser, ch, "", "a.txt")
	driveAddFile(t, th, th.BasicUser, ch, "", "b.txt")

	_, appErr := th.App.RenameDriveItem(th.Context, a, "bad/name")
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	_, appErr = th.App.RenameDriveItem(th.Context, a, "B.txt")
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusBadRequest, appErr.StatusCode)

	renamed, appErr := th.App.RenameDriveItem(th.Context, a, "c.txt")
	require.Nil(t, appErr)
	require.Equal(t, "c.txt", renamed.Name)
	info, err := th.App.Srv().Store().FileInfo().Get(a.FileId)
	require.NoError(t, err)
	require.Equal(t, "c.txt", info.Name)
}

func TestDrivePermissions(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	th.AddUserToChannel(t, th.BasicUser2, ch)
	item := driveAddFile(t, th, th.BasicUser, ch, "", "mine.txt")

	s2 := driveSession(th.BasicUser2)
	require.True(t, th.App.DriveCan(th.Context, s2, ch, DriveRead, item))
	require.True(t, th.App.DriveCan(th.Context, s2, ch, DriveCreate, nil))
	require.False(t, th.App.DriveCan(th.Context, s2, ch, DriveModify, item))
	appErr := th.App.DeleteDriveItems(th.Context, s2, ch, []string{item.Id}, false)
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)

	_, appErr = th.App.UpdateChannelMemberSchemeRoles(th.Context, ch.Id, th.BasicUser2.Id, false, true, true)
	require.Nil(t, appErr)
	require.True(t, th.App.DriveCan(th.Context, s2, ch, DriveModify, item))
	require.Nil(t, th.App.DeleteDriveItems(th.Context, s2, ch, []string{item.Id}, false))

	// non-members cannot read a private channel
	priv := th.CreatePrivateChannel(t, th.BasicTeam)
	outsider := th.CreateUser(t)
	th.LinkUserToTeam(t, outsider, th.BasicTeam)
	require.False(t, th.App.DriveCan(th.Context, driveSession(outsider), priv, DriveRead, nil))
}

func TestDriveFolderDeleteWithOthersFiles(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	th.AddUserToChannel(t, th.BasicUser2, ch)
	folder := driveFolder(t, th, th.BasicUser2, ch, "", "Shared")
	driveAddFile(t, th, th.BasicUser, ch, folder.Id, "theirs.txt")

	appErr := th.App.DeleteDriveItems(th.Context, driveSession(th.BasicUser2), ch, []string{folder.Id}, false)
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)
	require.Equal(t, []string{"Shared"}, driveListNames(t, th, ch, ""))
	require.Equal(t, []string{"theirs.txt"}, driveListNames(t, th, ch, folder.Id))
}

func TestDriveMoveIntoDescendant(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	a := driveFolder(t, th, th.BasicUser, ch, "", "a")
	b := driveFolder(t, th, th.BasicUser, ch, a.Id, "b")

	s := driveSession(th.BasicUser)
	for _, dst := range []string{a.Id, b.Id} {
		appErr := th.App.MoveDriveItems(th.Context, s, ch, []string{a.Id}, ch, dst)
		require.NotNil(t, appErr)
		require.Equal(t, http.StatusBadRequest, appErr.StatusCode)
	}

	f := driveAddFile(t, th, th.BasicUser, ch, "", "f.txt")
	require.Nil(t, th.App.MoveDriveItems(th.Context, s, ch, []string{f.Id}, ch, b.Id))
	require.Equal(t, []string{"f.txt"}, driveListNames(t, th, ch, b.Id))
}

func TestDriveCrossChannelMove(t *testing.T) {
	th := setupDrive(t)
	src := th.BasicChannel
	dst := th.CreateChannel(t, th.BasicTeam)
	s := driveSession(th.BasicUser)

	folder := driveFolder(t, th, th.BasicUser, src, "", "Folder")
	f := driveAddFile(t, th, th.BasicUser, src, folder.Id, "f.txt")

	// BasicUser2 is a member of src only
	th.AddUserToChannel(t, th.BasicUser2, src)
	f2 := driveAddFile(t, th, th.BasicUser2, src, "", "f2.txt")
	appErr := th.App.MoveDriveItems(th.Context, driveSession(th.BasicUser2), src, []string{f2.Id}, dst, "")
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)
	appErr = th.App.MoveDriveItems(th.Context, driveSession(th.BasicUser2), src, []string{folder.Id}, dst, "")
	require.NotNil(t, appErr)

	require.Nil(t, th.App.MoveDriveItems(th.Context, s, src, []string{folder.Id}, dst, ""))
	require.Equal(t, []string{"f2.txt"}, driveListNames(t, th, src, ""))
	require.Equal(t, []string{"Folder"}, driveListNames(t, th, dst, ""))

	moved, err := th.App.Srv().Store().DriveItem().Get(f.Id)
	require.NoError(t, err)
	require.Equal(t, dst.Id, moved.ChannelId)
	info, err := th.App.Srv().Store().FileInfo().Get(f.FileId)
	require.NoError(t, err)
	require.Equal(t, dst.Id, info.ChannelId)
}

func TestDriveCopyDuplicatesBytes(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	dst := th.CreateChannel(t, th.BasicTeam)
	s := driveSession(th.BasicUser)

	// a chat attachment, copied into the drive
	info := driveUpload(t, th, th.BasicUser, ch, "chat.txt", []byte("chat bytes"))
	post := th.CreatePost(t, ch)
	require.NoError(t, th.App.Srv().Store().FileInfo().AttachToPost(th.Context, info.Id, post.Id, ch.Id, th.BasicUser.Id))

	require.Nil(t, th.App.CopyDriveItems(th.Context, s, ch, nil, []string{info.Id}, dst, ""))
	listing, appErr := th.App.ListDriveFolder(th.Context, driveSession(th.BasicUser), dst, "")
	require.Nil(t, appErr)
	require.Len(t, listing.Items, 1)
	copied := listing.Items[0].FileInfo
	require.NotEqual(t, info.Id, copied.Id)
	require.NotEqual(t, info.Path, copied.Path)
	require.Equal(t, th.BasicUser.Id, copied.CreatorId)
	require.Equal(t, dst.Id, copied.ChannelId)
	require.Empty(t, copied.PostId)

	require.Nil(t, th.App.PermanentDeleteFilesByPost(th.Context, post.Id, nil))
	data, appErr := th.App.ReadFile(copied.Path)
	require.Nil(t, appErr)
	require.Equal(t, []byte("chat bytes"), data)

	// a drive folder copy duplicates the subtree, with a unique name on clash
	folder := driveFolder(t, th, th.BasicUser, ch, "", "Folder")
	driveAddFile(t, th, th.BasicUser, ch, folder.Id, "in.txt")
	require.Nil(t, th.App.CopyDriveItems(th.Context, s, ch, []string{folder.Id}, nil, ch, ""))
	require.Equal(t, []string{"Folder", "Folder (2)"}, driveListNames(t, th, ch, ""))
}

func TestDriveCopyChatFileRules(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	s := driveSession(th.BasicUser)

	// burn-on-read: the post lives in TemporaryPosts
	bor := driveUpload(t, th, th.BasicUser, ch, "secret.txt", []byte("secret"))
	borPostID := model.NewId()
	require.NoError(t, th.App.Srv().Store().FileInfo().AttachToPost(th.Context, bor.Id, borPostID, ch.Id, th.BasicUser.Id))
	_, err := th.App.Srv().Store().TemporaryPost().Save(th.Context, &model.TemporaryPost{ID: borPostID, Type: model.PostTypeBurnOnRead, ExpireAt: model.GetMillis() + 60000, Message: "x"})
	require.NoError(t, err)
	appErr := th.App.CopyDriveItems(th.Context, s, ch, nil, []string{bor.Id}, ch, "")
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)

	// a chat file from another channel
	other := th.CreateChannel(t, th.BasicTeam)
	foreign := driveUpload(t, th, th.BasicUser, other, "foreign.txt", []byte("x"))
	post := th.CreatePost(t, other)
	require.NoError(t, th.App.Srv().Store().FileInfo().AttachToPost(th.Context, foreign.Id, post.Id, other.Id, th.BasicUser.Id))
	appErr = th.App.CopyDriveItems(th.Context, s, ch, nil, []string{foreign.Id}, ch, "")
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusForbidden, appErr.StatusCode)

	// an unattached upload is not a chat file
	loose := driveUpload(t, th, th.BasicUser, ch, "loose.txt", []byte("x"))
	appErr = th.App.CopyDriveItems(th.Context, s, ch, nil, []string{loose.Id}, ch, "")
	require.NotNil(t, appErr)
}

func TestDriveTrashRestore(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	s := driveSession(th.BasicUser)
	folder := driveFolder(t, th, th.BasicUser, ch, "", "Folder")
	f := driveAddFile(t, th, th.BasicUser, ch, folder.Id, "f.txt")

	require.Nil(t, th.App.DeleteDriveItems(th.Context, s, ch, []string{f.Id}, false))
	trash, appErr := th.App.GetDriveTrash(th.Context, driveSession(th.BasicUser), ch)
	require.Nil(t, appErr)
	require.Len(t, trash, 1)

	// the parent is permanently deleted; the file comes back at the root
	require.Nil(t, th.App.DeleteDriveItems(th.Context, s, ch, []string{folder.Id}, true))
	require.Nil(t, th.App.RestoreDriveItems(th.Context, s, ch, []string{f.Id}))
	require.Equal(t, []string{"f.txt"}, driveListNames(t, th, ch, ""))

	// empty trash removes the bytes
	require.Nil(t, th.App.DeleteDriveItems(th.Context, s, ch, []string{f.Id}, false))
	require.Nil(t, th.App.EmptyDriveTrash(th.Context, s, ch))
	trash, appErr = th.App.GetDriveTrash(th.Context, driveSession(th.BasicUser), ch)
	require.Nil(t, appErr)
	require.Empty(t, trash)
	infos, err := th.App.Srv().Store().FileInfo().GetByIds([]string{f.FileId}, true, false, true)
	require.NoError(t, err)
	require.Len(t, infos, 1)
	info := infos[0]
	require.NotZero(t, info.DeleteAt)
	_, appErr = th.App.ReadFile(info.Path)
	require.NotNil(t, appErr)
}

func TestDrivePurge(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	old := driveAddFile(t, th, th.BasicUser, ch, "", "old.txt")
	recent := driveAddFile(t, th, th.BasicUser, ch, "", "recent.txt")
	dangling, err := th.App.Srv().Store().DriveItem().Save(&model.DriveItem{ChannelId: ch.Id, Type: model.DriveItemTypeFile, Name: "ghost.txt", FileId: model.NewId(), CreatorId: th.BasicUser.Id})
	require.NoError(t, err)

	now := time.Now()
	day := 24 * time.Hour
	old.DeleteAt = now.Add(-31 * day).UnixMilli()
	recent.DeleteAt = now.Add(-29 * day).UnixMilli()
	require.NoError(t, th.App.Srv().Store().DriveItem().UpdateMany([]*model.DriveItem{old, recent}))

	th.App.RunDriveTrashPurge(th.Context, now)

	_, err = th.App.Srv().Store().DriveItem().Get(old.Id)
	require.Error(t, err)
	_, err = th.App.Srv().Store().DriveItem().Get(dangling.Id)
	require.Error(t, err)
	_, err = th.App.Srv().Store().DriveItem().Get(recent.Id)
	require.NoError(t, err)
}

func TestDriveArchivedReadOnly(t *testing.T) {
	th := setupDrive(t)
	ch := th.CreateChannel(t, th.BasicTeam)
	item := driveAddFile(t, th, th.BasicUser, ch, "", "f.txt")
	require.Nil(t, th.App.DeleteChannel(th.Context, ch, th.BasicUser.Id))
	ch, appErr := th.App.GetChannel(th.Context, ch.Id)
	require.Nil(t, appErr)

	s := driveSession(th.BasicUser)
	require.True(t, th.App.DriveCan(th.Context, s, ch, DriveRead, item))
	require.False(t, th.App.DriveCan(th.Context, s, ch, DriveCreate, nil))
	require.False(t, th.App.DriveCan(th.Context, s, ch, DriveModify, item))
}

func TestDriveZipCap(t *testing.T) {
	th := setupDrive(t)
	ch := th.BasicChannel
	s := driveSession(th.BasicUser)
	folder := driveFolder(t, th, th.BasicUser, ch, "", "Folder")
	small := driveAddFile(t, th, th.BasicUser, ch, folder.Id, "small.txt")

	var buf bytes.Buffer
	require.Nil(t, th.App.WriteDriveZip(th.Context, s, ch, []string{folder.Id}, &buf))
	require.NotZero(t, buf.Len())

	info, err := th.App.Srv().Store().FileInfo().Get(small.FileId)
	require.NoError(t, err)
	info.Size = 201 * 1024 * 1024
	_, err = th.App.Srv().Store().FileInfo().Upsert(th.Context, info)
	require.NoError(t, err)
	th.App.Srv().Store().FileInfo().ClearCaches()

	appErr := th.App.WriteDriveZip(th.Context, s, ch, []string{folder.Id}, &bytes.Buffer{})
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusRequestEntityTooLarge, appErr.StatusCode)
	require.Equal(t, "app.drive.zip_too_large.app_error", appErr.Id)
}

func TestDrivePermanentDeleteChannel(t *testing.T) {
	th := setupDrive(t)
	ch := th.CreateChannel(t, th.BasicTeam)
	folder := driveFolder(t, th, th.BasicUser, ch, "", "Folder")
	f := driveAddFile(t, th, th.BasicUser, ch, folder.Id, "f.txt")
	trashed := driveAddFile(t, th, th.BasicUser, ch, "", "t.txt")
	require.Nil(t, th.App.DeleteDriveItems(th.Context, driveSession(th.BasicUser), ch, []string{trashed.Id}, false))

	require.Nil(t, th.App.PermanentDeleteChannel(th.Context, ch))

	for _, it := range []*model.DriveItem{folder, f, trashed} {
		_, err := th.App.Srv().Store().DriveItem().Get(it.Id)
		require.Error(t, err)
	}
	infos, err := th.App.Srv().Store().FileInfo().GetByIds([]string{f.FileId, trashed.FileId}, true, false, true)
	require.NoError(t, err)
	for _, info := range infos {
		require.NotZero(t, info.DeleteAt)
		_, appErr := th.App.ReadFile(info.Path)
		require.NotNil(t, appErr)
	}
}
