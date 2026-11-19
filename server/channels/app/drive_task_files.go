// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"path"
	"slices"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
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
	if task.FolderId == "" {
		return
	}
	if folder, err := a.Srv().Store().DriveItem().Get(task.FolderId); err == nil && folder.ChannelId == post.ChannelId {
		a.publishDriveChanged(post.ChannelId, task.FolderId)
	}
}

// resolveDriveTaskFile finds the live message file fileID that the folder of one of channel's tasks lists, and the
// post it belongs to; anything else is not found. The caller's permission is judged here too (403).
func (a *App) resolveDriveTaskFile(rctx request.CTX, session model.Session, channel *model.Channel, fileID string) (*model.FileInfo, *model.Post, string, *model.AppError) {
	notFound := driveError("resolveDriveTaskFile", "not_found", http.StatusNotFound)
	info, err := a.Srv().Store().FileInfo().Get(fileID)
	if err != nil || info.DeleteAt != 0 || info.PostId == "" {
		return nil, nil, "", notFound
	}
	post, err := a.Srv().Store().Post().GetSingle(rctx, info.PostId, false)
	if err != nil || post.DeleteAt != 0 || post.ChannelId != channel.Id || post.Type == model.PostTypeBurnOnRead || !slices.Contains(post.FileIds, fileID) {
		return nil, nil, "", notFound
	}
	taskID, _ := post.GetProp(postTaskProp).(string)
	if taskID == "" {
		return nil, nil, "", notFound
	}
	task, err := a.Srv().Store().Task().Get(taskID)
	if err != nil || task.FolderId == "" {
		return nil, nil, "", notFound
	}
	folder, appErr := a.GetDriveItem(channel, task.FolderId)
	if appErr != nil || !folder.IsFolder() {
		return nil, nil, "", notFound
	}
	ancestors, err := a.Srv().Store().DriveItem().GetAncestors(folder.Id)
	if err != nil || slices.ContainsFunc(ancestors, func(it *model.DriveItem) bool { return it.DeleteAt > 0 }) {
		return nil, nil, "", notFound // a trashed ancestor trashes the folder too
	}
	item := &model.DriveItem{ChannelId: channel.Id, ParentId: task.FolderId, Type: model.DriveItemTypeFile, CreatorId: info.CreatorId}
	if !a.DriveCan(rctx, session, channel, DriveModify, item) {
		return nil, nil, "", driveError("resolveDriveTaskFile", "forbidden", http.StatusForbidden)
	}
	return info, post, task.FolderId, nil
}

// RenameDriveTaskFile renames a message file listed in a task's folder. Only the file's name changes: attachments are
// not drive items, so names need not be unique.
func (a *App) RenameDriveTaskFile(rctx request.CTX, session model.Session, channel *model.Channel, fileID, name string) (*model.FileInfo, *model.AppError) {
	info, post, folderID, appErr := a.resolveDriveTaskFile(rctx, session, channel, fileID)
	if appErr != nil {
		return nil, appErr
	}
	if !model.IsValidDriveItemName(name) {
		return nil, driveError("RenameDriveTaskFile", "invalid_name", http.StatusBadRequest)
	}
	info.Name = name
	info.Extension = strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	updated, err := a.Srv().Store().FileInfo().Upsert(rctx, info)
	if err != nil {
		return nil, driveStoreError("RenameDriveTaskFile", err)
	}
	// open chat views read the post's files through this cache
	a.Srv().Store().FileInfo().InvalidateFileInfosForPostCache(post.Id, false)
	a.Srv().Store().FileInfo().InvalidateFileInfosForPostCache(post.Id, true)
	a.invalidateCacheForChannelPosts(post.ChannelId)
	a.publishDriveChanged(channel.Id, folderID)
	return updated, nil
}

// DeleteDriveTaskFile drops a message file from its post: the post is edited (the edit history keeps the old
// version), or deleted when nothing is left of it and no replies hang on it. UpdatePost and DeletePost tell the explorers.
func (a *App) DeleteDriveTaskFile(rctx request.CTX, session model.Session, channel *model.Channel, fileID string) *model.AppError {
	_, post, _, appErr := a.resolveDriveTaskFile(rctx, session, channel, fileID)
	if appErr != nil {
		return appErr
	}
	rest := slices.DeleteFunc(slices.Clone(post.FileIds), func(id string) bool { return id == fileID })
	// DeletePost removes the whole thread under a root, so a root that has replies is edited instead.
	if len(rest) == 0 && strings.TrimSpace(post.Message) == "" && (post.RootId != "" || post.ReplyCount == 0) {
		_, appErr = a.DeletePost(rctx, post.Id, session.UserId)
		return appErr
	}
	edit := post.Clone()
	edit.FileIds = rest
	_, _, appErr = a.UpdatePost(rctx, edit, model.DefaultUpdatePostOptions())
	return appErr
}
