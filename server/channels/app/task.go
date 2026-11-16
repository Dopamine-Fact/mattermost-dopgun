// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/i18n"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// RequireTasksEnabled returns 403 unless the team exists, is active and has the task list turned on.
func (a *App) RequireTasksEnabled(teamID string) *model.AppError {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return appErr
	}
	if !team.TasksEnabled || team.DeleteAt != 0 {
		return model.NewAppError("RequireTasksEnabled", "app.task.disabled.app_error", nil, "team_id="+teamID, http.StatusForbidden)
	}
	return nil
}

// RequireRevisionsEnabled returns 403 unless the team has both tasks and revision channels turned on.
func (a *App) RequireRevisionsEnabled(teamID string) *model.AppError {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return appErr
	}
	if !team.TasksEnabled || !team.RevisionsEnabled || team.DeleteAt != 0 {
		return model.NewAppError("RequireRevisionsEnabled", "app.task.revisions_disabled.app_error", nil, "team_id="+teamID, http.StatusForbidden)
	}
	return nil
}

func taskStoreError(where string, id string, err error) *model.AppError {
	var nfErr *store.ErrNotFound
	var appErr *model.AppError
	switch {
	case errors.As(err, &appErr):
		return appErr
	case errors.As(err, &nfErr):
		return model.NewAppError(where, "app.task.not_found.app_error", nil, "id="+id, http.StatusNotFound).Wrap(err)
	default:
		return model.NewAppError(where, "app.task.store.app_error", nil, "id="+id, http.StatusInternalServerError).Wrap(err)
	}
}

// validateTaskRefs keeps a task's section and assignee inside the task's own team.
func (a *App) validateTaskRefs(rctx request.CTX, task *model.Task) *model.AppError {
	if task.SectionId != "" {
		section, err := a.Srv().Store().Task().GetSection(task.SectionId)
		if err != nil || section.TeamId != task.TeamId {
			return model.NewAppError("validateTaskRefs", "app.task.invalid_section.app_error", nil, "section_id="+task.SectionId, http.StatusBadRequest)
		}
	}
	if task.AssigneeId != "" {
		member, appErr := a.GetTeamMember(rctx, task.TeamId, task.AssigneeId)
		if appErr != nil || member.DeleteAt != 0 {
			return model.NewAppError("validateTaskRefs", "app.task.invalid_assignee.app_error", nil, "assignee_id="+task.AssigneeId, http.StatusBadRequest)
		}
	}
	return nil
}

func (a *App) GetTask(taskID string) (*model.Task, *model.AppError) {
	task, err := a.Srv().Store().Task().Get(taskID)
	if err != nil {
		return nil, taskStoreError("GetTask", taskID, err)
	}
	return task, nil
}

func (a *App) GetTasksForTeam(teamID string) ([]*model.Task, *model.AppError) {
	if appErr := a.RequireTasksEnabled(teamID); appErr != nil {
		return nil, appErr
	}
	tasks, err := a.Srv().Store().Task().GetForTeam(teamID)
	if err != nil {
		return nil, taskStoreError("GetTasksForTeam", teamID, err)
	}
	return tasks, nil
}

func (a *App) CreateTask(rctx request.CTX, task *model.Task, connectionID string) (*model.Task, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	if appErr := a.validateTaskRefs(rctx, task); appErr != nil {
		return nil, appErr
	}
	saved, err := a.Srv().Store().Task().Save(task)
	if err != nil {
		return nil, taskStoreError("CreateTask", task.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, saved.TeamId, "task", saved, connectionID)
	a.notifyTaskAssignee(rctx, saved, "", saved.CreatorId)
	a.postRevisionActivity(rctx, saved, func(link string) *model.Post {
		return &model.Post{
			UserId:  saved.CreatorId,
			Type:    model.PostTypeRevision,
			Message: i18n.T("app.task.revision_added", map[string]any{"Title": saved.Title, "Time": formatVideoTime(saved.VideoTime), "Link": link}),
			Props:   model.StringInterface{"task_id": saved.Id},
		}
	})
	return saved, nil
}

func (a *App) PatchTask(rctx request.CTX, task *model.Task, patch *model.TaskPatch, connectionID string) (*model.Task, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	patched := *task
	patched.Patch(patch)
	if appErr := a.validateTaskRefs(rctx, &patched); appErr != nil {
		return nil, appErr
	}
	updated, err := a.Srv().Store().Task().Update(&patched)
	if err != nil {
		return nil, taskStoreError("PatchTask", task.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, updated.TeamId, "task", updated, connectionID)
	actorID := ""
	if session := rctx.Session(); session != nil {
		actorID = session.UserId
	}
	a.notifyTaskAssignee(rctx, updated, task.AssigneeId, actorID)
	return updated, nil
}

// notifyTaskAssignee DMs a newly assigned user from the system bot; failures are only logged because the task is already saved.
func (a *App) notifyTaskAssignee(rctx request.CTX, task *model.Task, previousAssigneeID, actorID string) {
	if task.AssigneeId == "" || task.AssigneeId == previousAssigneeID || task.AssigneeId == actorID {
		return
	}
	if appErr := a.postTaskAssignedMessage(rctx, task, actorID); appErr != nil {
		rctx.Logger().Warn("notifyTaskAssignee: failed to send the assignment message", mlog.String("task_id", task.Id), mlog.Err(appErr))
	}
}

// postRevisionActivity posts to the revision's channel, so its chat follows the revision; ordinary tasks post nothing.
// Failures are only logged because the task or comment is already saved.
func (a *App) postRevisionActivity(rctx request.CTX, task *model.Task, makePost func(link string) *model.Post) {
	channel := a.taskRevisionChannel(task)
	if channel == nil {
		return
	}
	team, appErr := a.GetTeam(task.TeamId)
	if appErr != nil {
		rctx.Logger().Warn("postRevisionActivity: failed to load the team", mlog.String("task_id", task.Id), mlog.Err(appErr))
		return
	}
	post := makePost(a.revisionLink(team, channel, task))
	post.ChannelId = channel.Id
	if _, _, appErr := a.CreatePost(rctx, post, channel, model.CreatePostFlags{}); appErr != nil {
		rctx.Logger().Warn("postRevisionActivity: failed to post to the revision channel", mlog.String("task_id", task.Id), mlog.Err(appErr))
	}
}

// revisionLink opens the revision channel's Revisions tab on the task.
func (a *App) revisionLink(team *model.Team, channel *model.Channel, task *model.Task) string {
	return fmt.Sprintf("%s/%s/channels/%s?revision=%s", a.GetSiteURL(), team.Name, channel.Name, task.Id)
}

// formatVideoTime shows a revision's place in its video as m:ss.cc, like the webapp.
func formatVideoTime(ms int64) string {
	centis := ms / 10
	seconds := centis / 100
	return fmt.Sprintf("%d:%02d.%02d", seconds/60, seconds%60, centis%100)
}

// taskRevisionChannel returns the channel a revision belongs to, or nil for an ordinary task.
func (a *App) taskRevisionChannel(task *model.Task) *model.Channel {
	if task.SectionId == "" {
		return nil
	}
	section, err := a.Srv().Store().Task().GetSection(task.SectionId)
	if err != nil || section.ChannelId == "" {
		return nil
	}
	channel, err := a.Srv().Store().Channel().Get(section.ChannelId, true)
	if err != nil {
		return nil
	}
	return channel
}

func (a *App) postTaskAssignedMessage(rctx request.CTX, task *model.Task, actorID string) *model.AppError {
	assignee, appErr := a.GetUser(rctx, task.AssigneeId)
	if appErr != nil {
		return appErr
	}
	team, appErr := a.GetTeam(task.TeamId)
	if appErr != nil {
		return appErr
	}
	actorName := ""
	if actor, err := a.GetUser(rctx, actorID); err == nil {
		actorName = "@" + actor.Username
	}
	bot, appErr := a.GetSystemBot(rctx)
	if appErr != nil {
		return appErr
	}
	channel, appErr := a.GetOrCreateDirectChannel(rctx, assignee.Id, bot.UserId)
	if appErr != nil {
		return appErr
	}

	T := i18n.GetUserTranslations(assignee.Locale)
	link := fmt.Sprintf("%s/%s/tasks?task=%s", a.GetSiteURL(), team.Name, task.Id)
	if revisionChannel := a.taskRevisionChannel(task); revisionChannel != nil {
		link = a.revisionLink(team, revisionChannel, task)
	}
	post := &model.Post{
		UserId:    bot.UserId,
		ChannelId: channel.Id,
		Message:   T("app.task.assigned_notification", map[string]any{"Actor": actorName, "Title": task.Title, "Link": link}),
	}
	_, _, appErr = a.CreatePost(rctx, post, channel, model.CreatePostFlags{})
	return appErr
}

func (a *App) DeleteTask(rctx request.CTX, task *model.Task, connectionID string) *model.AppError {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return appErr
	}
	comments, err := a.Srv().Store().Task().GetCommentsForTask(task.Id)
	if err != nil {
		return taskStoreError("DeleteTask", task.Id, err)
	}
	if err := a.Srv().Store().Task().Delete(task.Id); err != nil {
		return taskStoreError("DeleteTask", task.Id, err)
	}
	for _, comment := range comments {
		a.removeTaskFiles(rctx, comment.FileIds)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskDeleted, task.TeamId, "task_id", task.Id, connectionID)
	return nil
}

func (a *App) GetTaskSection(sectionID string) (*model.TaskSection, *model.AppError) {
	section, err := a.Srv().Store().Task().GetSection(sectionID)
	if err != nil {
		return nil, taskStoreError("GetTaskSection", sectionID, err)
	}
	return section, nil
}

func (a *App) GetTaskSectionsForTeam(teamID string) ([]*model.TaskSection, *model.AppError) {
	if appErr := a.RequireTasksEnabled(teamID); appErr != nil {
		return nil, appErr
	}
	sections, err := a.Srv().Store().Task().GetSectionsForTeam(teamID)
	if err != nil {
		return nil, taskStoreError("GetTaskSectionsForTeam", teamID, err)
	}
	return sections, nil
}

func (a *App) CreateTaskSection(rctx request.CTX, section *model.TaskSection, connectionID string) (*model.TaskSection, *model.AppError) {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	if section.ChannelId != "" {
		if appErr := a.checkRevisionChannel(section); appErr != nil {
			return nil, appErr
		}
	}
	saved, err := a.Srv().Store().Task().SaveSection(section)
	if err != nil {
		return nil, taskStoreError("CreateTaskSection", section.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionUpserted, saved.TeamId, "section", saved, connectionID)
	return saved, nil
}

// checkRevisionChannel allows linking only an active channel of the section's team that no other section uses.
func (a *App) checkRevisionChannel(section *model.TaskSection) *model.AppError {
	if appErr := a.RequireRevisionsEnabled(section.TeamId); appErr != nil {
		return appErr
	}
	invalid := model.NewAppError("CreateTaskSection", "app.task.invalid_channel.app_error", nil, "channel_id="+section.ChannelId, http.StatusBadRequest)
	channel, err := a.Srv().Store().Channel().Get(section.ChannelId, true)
	if err != nil || channel.TeamId != section.TeamId || channel.DeleteAt != 0 {
		return invalid
	}
	sections, err := a.Srv().Store().Task().GetSectionsForTeam(section.TeamId)
	if err != nil {
		return taskStoreError("CreateTaskSection", section.TeamId, err)
	}
	for _, s := range sections {
		if s.ChannelId == section.ChannelId {
			return invalid
		}
	}
	return nil
}

func (a *App) PatchTaskSection(rctx request.CTX, section *model.TaskSection, patch *model.TaskSectionPatch, connectionID string) (*model.TaskSection, *model.AppError) {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	patched := *section
	patched.Patch(patch)
	updated, err := a.Srv().Store().Task().UpdateSection(&patched)
	if err != nil {
		return nil, taskStoreError("PatchTaskSection", section.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionUpserted, updated.TeamId, "section", updated, connectionID)
	return updated, nil
}

// DeleteTaskSection moves the section's tasks to "no section"; clients apply that themselves on task_section_deleted.
func (a *App) DeleteTaskSection(rctx request.CTX, section *model.TaskSection, connectionID string) *model.AppError {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return appErr
	}
	if err := a.Srv().Store().Task().DeleteSection(section.Id); err != nil {
		return taskStoreError("DeleteTaskSection", section.Id, err)
	}
	if section.VideoFileId != "" {
		a.removeTaskFiles(rctx, []string{section.VideoFileId})
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionDeleted, section.TeamId, "section_id", section.Id, connectionID)
	return nil
}

// SetTaskSectionVideo turns the section into a revision channel, replacing any earlier video.
func (a *App) SetTaskSectionVideo(rctx request.CTX, section *model.TaskSection, userID, name string, data []byte, connectionID string) (*model.TaskSection, *model.AppError) {
	if appErr := a.RequireRevisionsEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	if model.TaskVideoContentType(name) == "" {
		return nil, model.NewAppError("SetTaskSectionVideo", "app.task.not_video.app_error", nil, "name="+name, http.StatusBadRequest)
	}
	info, appErr := a.UploadFileForUserAndTeam(rctx, data, "", name, userID, section.TeamId)
	if appErr != nil {
		return nil, appErr
	}

	patched := *section
	patched.VideoFileId = info.Id
	updated, err := a.Srv().Store().Task().UpdateSection(&patched)
	if err != nil {
		a.removeTaskFiles(rctx, []string{info.Id})
		return nil, taskStoreError("SetTaskSectionVideo", section.Id, err)
	}
	if section.VideoFileId != "" {
		a.removeTaskFiles(rctx, []string{section.VideoFileId})
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionUpserted, updated.TeamId, "section", updated, connectionID)
	return updated, nil
}

func (a *App) GetTaskSectionVideo(rctx request.CTX, section *model.TaskSection) (*model.FileInfo, *model.AppError) {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	notFound := model.NewAppError("GetTaskSectionVideo", "app.task.not_found.app_error", nil, "section_id="+section.Id, http.StatusNotFound)
	if section.VideoFileId == "" {
		return nil, notFound
	}
	info, appErr := a.GetFileInfo(rctx, section.VideoFileId)
	if appErr != nil || info.DeleteAt != 0 {
		return nil, notFound
	}
	return info, nil
}

// publishTaskEvent broadcasts to the team; objects are sent as JSON strings like scheduled posts, ids as-is.
func (a *App) publishTaskEvent(rctx request.CTX, event model.WebsocketEventType, teamID, key string, value any, connectionID string) {
	message := model.NewWebSocketEvent(event, teamID, "", "", nil, connectionID)
	if id, ok := value.(string); ok {
		message.Add(key, id)
	} else {
		data, err := json.Marshal(value)
		if err != nil {
			rctx.Logger().Warn("publishTaskEvent: failed to marshal", mlog.String("event", string(event)), mlog.Err(err))
			return
		}
		message.Add(key, string(data))
	}
	message.Add("team_id", teamID)
	a.Publish(message)
}

// TaskCommentFile is one attachment as read from the request.
type TaskCommentFile struct {
	Name string
	Data []byte
}

func (a *App) GetTaskComment(commentID string) (*model.TaskComment, *model.AppError) {
	comment, err := a.Srv().Store().Task().GetComment(commentID)
	if err != nil {
		return nil, taskStoreError("GetTaskComment", commentID, err)
	}
	return comment, nil
}

func (a *App) GetTaskComments(task *model.Task) ([]*model.TaskComment, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	comments, err := a.Srv().Store().Task().GetCommentsForTask(task.Id)
	if err != nil {
		return nil, taskStoreError("GetTaskComments", task.Id, err)
	}

	var fileIDs []string
	for _, comment := range comments {
		fileIDs = append(fileIDs, comment.FileIds...)
	}
	if len(fileIDs) == 0 {
		return comments, nil
	}
	infos, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, false, false, false)
	if err != nil {
		return nil, taskStoreError("GetTaskComments", task.Id, err)
	}
	byID := make(map[string]*model.FileInfo, len(infos))
	for _, info := range infos {
		byID[info.Id] = info
	}
	for _, comment := range comments {
		comment.Files = []*model.FileInfo{}
		for _, id := range comment.FileIds {
			if info, ok := byID[id]; ok {
				comment.Files = append(comment.Files, info)
			}
		}
	}
	return comments, nil
}

// CreateTaskComment stores the files under the task's team (no channel) and then the comment; on failure the uploaded files are removed again.
func (a *App) CreateTaskComment(rctx request.CTX, task *model.Task, userID, message string, files []TaskCommentFile) (*model.TaskComment, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	if appErr := model.ValidateTaskCommentContent(message, len(files)); appErr != nil {
		return nil, appErr
	}

	infos := make([]*model.FileInfo, 0, len(files))
	fileIDs := model.StringArray{}
	for _, file := range files {
		info, appErr := a.UploadFileForUserAndTeam(rctx, file.Data, "", file.Name, userID, task.TeamId)
		if appErr != nil {
			a.removeTaskFiles(rctx, fileIDs)
			return nil, appErr
		}
		infos = append(infos, info)
		fileIDs = append(fileIDs, info.Id)
	}

	saved, err := a.Srv().Store().Task().SaveComment(&model.TaskComment{TaskId: task.Id, UserId: userID, Message: message, FileIds: fileIDs})
	if err != nil {
		a.removeTaskFiles(rctx, fileIDs)
		return nil, taskStoreError("CreateTaskComment", task.Id, err)
	}
	saved.Files = infos

	text := message
	for _, info := range infos {
		text += "\n:paperclip: " + info.Name
	}
	a.postRevisionActivity(rctx, task, func(link string) *model.Post {
		return &model.Post{
			UserId:  userID,
			Message: i18n.T("app.task.revision_comment", map[string]any{"Title": task.Title, "Link": link, "Message": strings.TrimSpace(text)}),
		}
	})
	return saved, nil
}

// GetTaskCommentFile only serves files that belong to the comment, so a task comment link cannot read other uploads.
func (a *App) GetTaskCommentFile(rctx request.CTX, task *model.Task, comment *model.TaskComment, fileID string) (*model.FileInfo, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	notFound := model.NewAppError("GetTaskCommentFile", "app.task.not_found.app_error", nil, "file_id="+fileID, http.StatusNotFound)
	if !slices.Contains(comment.FileIds, fileID) {
		return nil, notFound
	}
	info, appErr := a.GetFileInfo(rctx, fileID)
	if appErr != nil || info.DeleteAt != 0 {
		return nil, notFound
	}
	return info, nil
}

func (a *App) DeleteTaskComment(rctx request.CTX, task *model.Task, comment *model.TaskComment) *model.AppError {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return appErr
	}
	if err := a.Srv().Store().Task().DeleteComment(comment.Id); err != nil {
		return taskStoreError("DeleteTaskComment", comment.Id, err)
	}
	a.removeTaskFiles(rctx, comment.FileIds)
	return nil
}

// removeTaskFiles deletes stored files and their infos; failures are logged because their owner is already gone.
func (a *App) removeTaskFiles(rctx request.CTX, fileIDs []string) {
	if len(fileIDs) == 0 {
		return
	}
	infos, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, true, false, true)
	if err != nil {
		rctx.Logger().Warn("removeTaskFiles: failed to load file infos", mlog.Err(err))
		return
	}
	for _, appErr := range a.RemoveFilesFromFileStore(rctx, infos) {
		rctx.Logger().Warn("removeTaskFiles: failed to remove file", mlog.Err(appErr))
	}
	for _, info := range infos {
		if err := a.Srv().Store().FileInfo().PermanentDelete(rctx, info.Id); err != nil {
			rctx.Logger().Warn("removeTaskFiles: failed to delete file info", mlog.String("file_id", info.Id), mlog.Err(err))
		}
	}
}
