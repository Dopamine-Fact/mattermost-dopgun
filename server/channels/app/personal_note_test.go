// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestCheckNoteReminders(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	teamID := th.BasicTeam.Id
	_, appErr := th.App.PatchTeam(teamID, &model.TeamPatch{NotesEnabled: new(true)})
	require.Nil(t, appErr)
	bot, appErr := th.App.GetSystemBot(th.Context)
	require.Nil(t, appErr)

	dueNote := func(user *model.User, title string) *model.PersonalNote {
		note, err := th.App.Srv().Store().PersonalNote().Save(&model.PersonalNote{
			TeamId: teamID, UserId: user.Id, Title: title, Date: "2026-11-25", Time: "10:00",
			RemindMinutes: 0, RemindAt: model.GetMillis() - 1000,
		})
		require.NoError(t, err)
		return note
	}
	dmPosts := func(user *model.User) *model.PostList {
		ch, appErr := th.App.GetOrCreateDirectChannel(th.Context, user.Id, bot.UserId)
		require.Nil(t, appErr)
		posts, appErr := th.App.GetPosts(th.Context, ch.Id, 0, 100)
		require.Nil(t, appErr)
		return posts
	}
	reminderPosts := func(user *model.User, noteID string) int {
		n := 0
		for _, p := range dmPosts(user).Posts {
			if p.UserId == bot.UserId && strings.Contains(p.Message, "/calendar?note="+noteID) {
				n++
			}
		}
		return n
	}
	remindAt := func(id string) int64 {
		note, err := th.App.Srv().Store().PersonalNote().Get(id)
		require.NoError(t, err)
		return note.RemindAt
	}

	t.Run("due reminder is sent once to the owner", func(t *testing.T) {
		note := dueNote(th.BasicUser, "Send report")
		th.App.CheckNoteReminders(th.Context)
		require.Equal(t, 1, reminderPosts(th.BasicUser, note.Id))
		require.Zero(t, remindAt(note.Id))
		posts := dmPosts(th.BasicUser)
		require.Contains(t, posts.Posts[posts.Order[0]].Message, "Send report")

		th.App.CheckNoteReminders(th.Context)
		require.Equal(t, 1, reminderPosts(th.BasicUser, note.Id))
		require.Zero(t, reminderPosts(th.BasicUser2, note.Id))
	})

	t.Run("future reminder is left alone", func(t *testing.T) {
		note, err := th.App.Srv().Store().PersonalNote().Save(&model.PersonalNote{
			TeamId: teamID, UserId: th.BasicUser.Id, Title: "later", Date: "2099-01-01",
			RemindMinutes: 0, RemindAt: model.GetMillis() + 60*60*1000,
		})
		require.NoError(t, err)
		th.App.CheckNoteReminders(th.Context)
		require.Zero(t, reminderPosts(th.BasicUser, note.Id))
		require.Equal(t, note.RemindAt, remindAt(note.Id))
	})

	t.Run("disabled team clears without sending, and turning it back on sends nothing", func(t *testing.T) {
		note := dueNote(th.BasicUser, "while off")
		_, appErr := th.App.PatchTeam(teamID, &model.TeamPatch{NotesEnabled: new(false)})
		require.Nil(t, appErr)
		th.App.CheckNoteReminders(th.Context)
		require.Zero(t, reminderPosts(th.BasicUser, note.Id))
		require.Zero(t, remindAt(note.Id))

		_, appErr = th.App.PatchTeam(teamID, &model.TeamPatch{NotesEnabled: new(true)})
		require.Nil(t, appErr)
		th.App.CheckNoteReminders(th.Context)
		require.Zero(t, reminderPosts(th.BasicUser, note.Id))
	})

	t.Run("owner who left the team gets nothing", func(t *testing.T) {
		user := th.CreateUser(t)
		th.LinkUserToTeam(t, user, th.BasicTeam)
		note := dueNote(user, "left")
		require.Nil(t, th.App.RemoveUserFromTeam(th.Context, teamID, user.Id, ""))
		th.App.CheckNoteReminders(th.Context)
		require.Zero(t, reminderPosts(user, note.Id))
		require.Zero(t, remindAt(note.Id))
	})

	t.Run("deactivated owner gets nothing", func(t *testing.T) {
		user := th.CreateUser(t)
		th.LinkUserToTeam(t, user, th.BasicTeam)
		note := dueNote(user, "deactivated")
		_, appErr := th.App.UpdateActive(th.Context, user, false)
		require.Nil(t, appErr)
		th.App.CheckNoteReminders(th.Context)
		require.Zero(t, remindAt(note.Id))
		require.Zero(t, reminderPosts(user, note.Id))
	})
}
