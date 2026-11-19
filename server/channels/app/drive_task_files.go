// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

const driveTaskFilesLimit = 500 // shortcut: no paging, the listing shows the newest 500; page them when a folder outgrows it

// driveTaskFiles returns the message files of the tasks seeded into the folder; never nil.
func (a *App) driveTaskFiles(channelID, folderID string) ([]*model.DriveTaskFile, *model.AppError) {
	files, err := a.Srv().Store().Task().GetFolderTaskFiles(channelID, folderID, driveTaskFilesLimit)
	if err != nil {
		return nil, driveStoreError("driveTaskFiles", err)
	}
	return files, nil
}

// publishTaskFolderChanged tells explorers that a post with files, about a task with a drive folder, changed what
// that folder lists. It never fails the post operation.
func (a *App) publishTaskFolderChanged(post *model.Post) {
	if len(post.FileIds) == 0 {
		return
	}
	taskID, _ := post.GetProp("task_id").(string)
	if taskID == "" {
		return
	}
	task, err := a.Srv().Store().Task().Get(taskID)
	if err != nil {
		var nfErr *store.ErrNotFound
		if !errors.As(err, &nfErr) {
			a.Log().Warn("Failed to load the task of a post with files", mlog.String("task_id", taskID), mlog.Err(err))
		}
		return
	}
	if task.FolderId != "" {
		a.publishDriveChanged(post.ChannelId, task.FolderId)
	}
}
