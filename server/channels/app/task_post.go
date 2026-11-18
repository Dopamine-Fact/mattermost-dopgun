// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// postTaskProp names the task a message in a task-list channel is about; the task's comments are those messages.
const postTaskProp = "task_id"

// channelTaskSection returns the channel's task section while the channel is a live task-list channel: not archived,
// linked to a section, and in a team with tasks and revisions turned on. Otherwise nil, and the channel is a normal one.
// shortcut: one indexed TaskSections lookup per user post; add a cache if post latency shows it.
func (a *App) channelTaskSection(rctx request.CTX, channel *model.Channel) *model.TaskSection {
	if channel.DeleteAt != 0 || channel.TeamId == "" {
		return nil
	}
	section, err := a.Srv().Store().Task().GetSectionByChannel(channel.Id)
	if err != nil {
		var nfErr *store.ErrNotFound
		if !errors.As(err, &nfErr) {
			rctx.Logger().Warn("channelTaskSection: failed to load the channel's task section", mlog.String("channel_id", channel.Id), mlog.Err(err))
		}
		return nil
	}
	if a.RequireRevisionsEnabled(channel.TeamId) != nil {
		return nil
	}
	return section
}

// applyTaskPostRule makes a user's message in a live task-list channel name one of that channel's tasks. A reply
// takes its root's task, whatever it sent, and needs none when the root has none (a message from before the rule).
func (a *App) applyTaskPostRule(rctx request.CTX, post *model.Post, channel *model.Channel, rootPost *model.Post) *model.AppError {
	if rootPost != nil {
		if taskID, ok := rootPost.GetProp(postTaskProp).(string); ok && taskID != "" {
			post.AddProp(postTaskProp, taskID)
		} else {
			post.DelProp(postTaskProp)
		}
		return nil
	}

	section := a.channelTaskSection(rctx, channel)
	if section == nil {
		// Outside a task-list channel a message names no task, so it never joins a task's conversation.
		post.DelProp(postTaskProp)
		return nil
	}
	taskID, _ := post.GetProp(postTaskProp).(string)
	if taskID == "" {
		return model.NewAppError("applyTaskPostRule", "app.post.task_required.app_error", nil, "channel_id="+channel.Id, http.StatusBadRequest)
	}
	task, err := a.Srv().Store().Task().Get(taskID)
	if err != nil || task.SectionId != section.Id {
		return model.NewAppError("applyTaskPostRule", "app.post.task_invalid.app_error", nil, "task_id="+taskID, http.StatusBadRequest)
	}
	return nil
}
