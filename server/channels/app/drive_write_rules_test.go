// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

// driveWriteWorld adds to the fixture: BG/Layout writable by BG only, Anim/Ref read-only, a rule-less "Open" folder,
// and a second non-manager BG member. user1 is that member, user2 is AnimUser, user3 is BGMember.
type driveWriteWorld struct {
	*driveRulesWorld
	user1 *model.User
}

func driveWriteFixture(t *testing.T, th *TestHelper) *driveWriteWorld {
	t.Helper()
	f := driveRulesFixture(t, th)
	w := &driveWriteWorld{driveRulesWorld: f, user1: th.CreateUser(t)}
	th.LinkUserToTeam(t, w.user1, th.BasicTeam)
	th.AddUserToChannel(t, w.user1, th.BasicChannel)
	giveRanks(t, th, th.BasicTeam.Id, w.user1, newRank(t, th, th.BasicTeam.Id, f.BG.Id, "Inker"))

	layout, err := th.App.Srv().Store().DriveItem().Get(f.Folders["BG/Layout"].Id)
	require.NoError(t, err)
	layout.WriteDepartments = []string{f.BG.Id}
	_, err = th.App.Srv().Store().DriveItem().Update(layout)
	require.NoError(t, err)
	for key, item := range map[string]*model.DriveItem{
		"Anim/Ref": {ParentId: f.Folders["Anim"].Id, Name: "Ref", DriveRules: model.DriveRules{ReadOnly: true}},
		"Open":     {Name: "Open"},
	} {
		item.ChannelId, item.Type, item.CreatorId = f.Channel.Id, model.DriveItemTypeFolder, th.BasicUser.Id
		saved, err := th.App.Srv().Store().DriveItem().Save(item)
		require.NoError(t, err)
		f.Folders[key] = saved
	}
	return w
}

func TestDriveWriteRules(t *testing.T) {
	th := setupDrive(t)
	w := driveWriteFixture(t, th)
	ch := w.Channel
	layoutID := w.Folders["BG/Layout"].Id
	user1, user2, user3 := w.user1, w.AnimUser, w.BGMember
	s1, s2, s3 := driveSession(user1), driveSession(user2), driveSession(user3)
	admin := driveSession(w.Admin)

	forbidden := func(t *testing.T, appErr *model.AppError) {
		t.Helper()
		require.NotNil(t, appErr)
		assert.Equal(t, http.StatusForbidden, appErr.StatusCode)
	}

	t.Run("create", func(t *testing.T) {
		assert.True(t, th.App.DriveCanCreateIn(th.Context, s1, ch, layoutID))
		assert.False(t, th.App.DriveCanCreateIn(th.Context, s2, ch, layoutID))
		for _, s := range []model.Session{s1, s2, s3} {
			assert.False(t, th.App.DriveCanCreateIn(th.Context, s, ch, w.Folders["Anim/Layout"].Id))
		}
		assert.False(t, th.App.DriveCanCreateIn(th.Context, s2, ch, w.Folders["Anim/Ref"].Id))
		assert.False(t, th.App.DriveCanCreateIn(th.Context, admin, ch, w.Folders["Anim/Layout"].Id), "a mirror is read-only for managers too")
		assert.True(t, th.App.DriveCanCreateIn(th.Context, s2, ch, w.Folders["Open"].Id))
		_, appErr := th.App.CreateDriveFolder(th.Context, user1.Id, ch, layoutID, "Made", model.DriveRules{ReadOnly: true})
		require.Nil(t, appErr)
	})

	t.Run("delete a colleague's file", func(t *testing.T) {
		file := driveAddFile(t, th, user1, ch, layoutID, "mine.txt")
		forbidden(t, th.App.DeleteDriveItems(th.Context, s2, ch, []string{file.Id}, false))
		require.Nil(t, th.App.DeleteDriveItems(th.Context, s3, ch, []string{file.Id}, false))
	})

	t.Run("rename and delete a plain folder", func(t *testing.T) {
		folder := driveFolder(t, th, user1, ch, layoutID, "Plain")
		driveAddFile(t, th, user1, ch, folder.Id, "inside.txt")
		require.True(t, th.App.DriveCan(th.Context, s3, ch, DriveModify, folder))
		_, appErr := th.App.RenameDriveItem(th.Context, folder, "Renamed")
		require.Nil(t, appErr)
		require.Nil(t, th.App.DeleteDriveItems(th.Context, s3, ch, []string{folder.Id}, false))
	})

	t.Run("restore", func(t *testing.T) {
		file := driveAddFile(t, th, user1, ch, layoutID, "back.txt")
		require.Nil(t, th.App.DeleteDriveItems(th.Context, s1, ch, []string{file.Id}, false))
		forbidden(t, th.App.RestoreDriveItems(th.Context, s2, ch, []string{file.Id}))
		require.Nil(t, th.App.RestoreDriveItems(th.Context, s3, ch, []string{file.Id}))
		assert.Contains(t, driveListNames(t, th, ch, layoutID), "back.txt")
	})

	t.Run("own items stay where no rule applies", func(t *testing.T) {
		file := driveAddFile(t, th, user1, ch, w.Folders["Open"].Id, "open.txt")
		forbidden(t, th.App.DeleteDriveItems(th.Context, s2, ch, []string{file.Id}, false))
		require.Nil(t, th.App.DeleteDriveItems(th.Context, s1, ch, []string{file.Id}, false))
	})

	t.Run("rule folders and their ancestors", func(t *testing.T) {
		for _, key := range []string{"BG/Layout", "BG"} {
			item, err := th.App.Srv().Store().DriveItem().Get(w.Folders[key].Id)
			require.NoError(t, err)
			assert.False(t, th.App.DriveCan(th.Context, s1, ch, DriveModify, item), key)
			assert.True(t, th.App.DriveCan(th.Context, admin, ch, DriveModify, item), key)
			forbidden(t, th.App.MoveDriveItems(th.Context, s1, ch, []string{item.Id}, ch, w.Folders["Open"].Id))
			forbidden(t, th.App.DeleteDriveItems(th.Context, s1, ch, []string{item.Id}, false))
		}
	})

	t.Run("move destinations", func(t *testing.T) {
		file := driveAddFile(t, th, user1, ch, layoutID, "mover.txt")
		for _, dst := range []string{w.Folders["Anim/Layout"].Id, w.Folders["Anim"].Id} {
			forbidden(t, th.App.MoveDriveItems(th.Context, s1, ch, []string{file.Id}, ch, dst))
		}
	})

	t.Run("copy into a folder the caller cannot see", func(t *testing.T) {
		file := driveAddFile(t, th, user2, ch, w.Folders["Open"].Id, "copyme.txt")
		forbidden(t, th.App.CopyDriveItems(th.Context, s2, ch, []string{file.Id}, nil, ch, layoutID))
	})

	t.Run("empty trash leaves a hidden folder's items", func(t *testing.T) {
		file := driveAddFile(t, th, user1, ch, layoutID, "hidden.txt")
		require.Nil(t, th.App.DeleteDriveItems(th.Context, s1, ch, []string{file.Id}, false))
		require.Nil(t, th.App.EmptyDriveTrash(th.Context, s2, ch))
		trash, err := th.App.Srv().Store().DriveItem().GetTrash(ch.Id)
		require.NoError(t, err)
		assert.Contains(t, itemNames(trash), "hidden.txt")
	})
}

func TestDriveCrossTeamMoveDropsRules(t *testing.T) {
	th := setupDrive(t)
	w := driveWriteFixture(t, th)
	team2 := th.CreateTeam(t)
	th.LinkUserToTeam(t, w.Admin, team2)
	ch2 := th.CreateChannel(t, team2)
	th.AddUserToChannel(t, w.Admin, ch2)
	admin := driveSession(w.Admin)
	layoutID := w.Folders["BG/Layout"].Id

	require.Nil(t, th.App.MoveDriveItems(th.Context, admin, w.Channel, []string{layoutID}, w.Channel, ""))
	kept, err := th.App.Srv().Store().DriveItem().Get(layoutID)
	require.NoError(t, err)
	assert.Equal(t, []string{w.BG.Id}, []string(kept.WriteDepartments))

	require.Nil(t, th.App.MoveDriveItems(th.Context, admin, w.Channel, []string{w.Folders["BG"].Id, layoutID}, ch2, ""))
	for _, key := range []string{"BG", "BG/Layout", "BG/Layout/secret"} {
		moved, err := th.App.Srv().Store().DriveItem().Get(w.Folders[key].Id)
		require.NoError(t, err)
		assert.Equal(t, ch2.Id, moved.ChannelId, key)
		assert.False(t, moved.HasRules(), key)
	}
}

func TestDriveRestoreKeepsRules(t *testing.T) {
	th := setupDrive(t)
	w := driveWriteFixture(t, th)
	admin := driveSession(w.Admin)
	id := w.Folders["BG/Layout"].Id
	require.Nil(t, th.App.DeleteDriveItems(th.Context, admin, w.Channel, []string{id}, false))
	require.Nil(t, th.App.RestoreDriveItems(th.Context, admin, w.Channel, []string{id}))
	got, err := th.App.Srv().Store().DriveItem().Get(id)
	require.NoError(t, err)
	assert.Equal(t, []string{w.BG.Id}, []string(got.WriteDepartments))
	assert.Equal(t, w.Folders["BG"].Id, got.ParentId)
}

func TestDriveChangedNamesMirrors(t *testing.T) {
	th := setupDrive(t)
	w := driveWriteFixture(t, th)
	messages, closeWS := connectFakeWebSocket(t, th, th.BasicUser.Id, "", []model.WebsocketEventType{model.WebsocketEventDriveChanged})
	defer closeWS()

	driveAddFile(t, th, w.user1, w.Channel, w.Folders["BG/Layout"].Id, "live.txt")
	select {
	case msg := <-messages:
		assert.Contains(t, msg.GetData()["parent_ids"], w.Folders["BG/Layout"].Id)
		assert.Contains(t, msg.GetData()["parent_ids"], w.Folders["Anim/Layout"].Id)
	case <-time.After(10 * time.Second):
		t.Fatal("no drive_changed event")
	}
}
