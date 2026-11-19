// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

// taskFilePost posts a message with one uploaded file under taskID and returns the file.
func taskFilePost(t *testing.T, th *TestHelper, ch *model.Channel, taskID, name string) *model.FileInfo {
	t.Helper()
	info := driveUpload(t, th, th.BasicUser, ch, name, []byte("content of "+name))
	_, _, appErr := th.App.CreatePost(th.Context, &model.Post{UserId: th.BasicUser.Id, ChannelId: ch.Id, Message: "m", FileIds: []string{info.Id}, Props: model.StringInterface{"task_id": taskID}}, ch, model.CreatePostFlags{})
	require.Nil(t, appErr)
	return info
}

// driveTestTask makes the basic channel a task-list channel (posts keep their task_id there) with a task in folderID.
func driveTestTask(t *testing.T, th *TestHelper, folderID string) *model.Task {
	t.Helper()
	section := newRevisionSection(t, th)
	task, err := th.App.Srv().Store().Task().Save(&model.Task{TeamId: th.BasicTeam.Id, SectionId: section.Id, CreatorId: th.BasicUser.Id, Title: "t", FolderId: folderID})
	require.NoError(t, err)
	return task
}

func TestListDriveFolderTaskFiles(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	folderID := f.Folders["BG/Layout"].Id
	task := driveTestTask(t, th, folderID)
	info := taskFilePost(t, th, f.Channel, task.Id, "shot.txt")
	taskIDs := func(l *DriveListing) []string {
		out := []string{}
		for _, tf := range l.TaskFiles {
			assert.Equal(t, task.Id, tf.TaskId)
			out = append(out, tf.Id)
		}
		return out
	}

	listing, appErr := listAs(t, th, f.BGMember, f.Channel, folderID)
	require.Nil(t, appErr)
	assert.Equal(t, []string{info.Id}, taskIDs(listing))

	listing, appErr = listAs(t, th, f.AnimUser, f.Channel, f.Folders["Anim/Layout"].Id)
	require.Nil(t, appErr)
	assert.Equal(t, []string{info.Id}, taskIDs(listing), "through the mirror")

	_, appErr = listAs(t, th, f.AnimUser, f.Channel, f.Folders["BG"].Id) // task files ride on the folder's own visibility
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)

	listing, appErr = listAs(t, th, f.BGMember, f.Channel, f.Folders["BG/Layout/sub"].Id)
	require.Nil(t, appErr)
	assert.NotNil(t, listing.TaskFiles)
	assert.Empty(t, listing.TaskFiles, "not in subfolders")
	listing, appErr = listAs(t, th, f.BGMember, f.Channel, "")
	require.Nil(t, appErr)
	assert.NotNil(t, listing.TaskFiles)
	assert.Empty(t, listing.TaskFiles)

	var buf bytes.Buffer
	require.Nil(t, th.App.WriteDriveZip(th.Context, driveSession(f.BGMember), f.Channel, []string{folderID}, &buf))
	assert.Equal(t, []string{"Layout/shot.txt"}, zipNames(t, &buf))
}

func TestTaskFolderChangedEvent(t *testing.T) {
	th := setupDrive(t)
	w := driveWriteFixture(t, th)
	folderID := w.Folders["Open"].Id
	task := driveTestTask(t, th, folderID)

	data := driveChangedEvent(t, th, func() { taskFilePost(t, th, w.Channel, task.Id, "a.txt") })
	assert.Equal(t, `["`+folderID+`"]`, data["parent_ids"])
}
