// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"

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

// validateTaskVideo makes a revision's video one of its own section's versions; ordinary tasks pass.
func (a *App) validateTaskVideo(task *model.Task) *model.AppError {
	if task.VideoFileId == "" {
		return nil
	}
	if task.SectionId == "" {
		return invalidTaskVideoError(task)
	}
	section, err := a.Srv().Store().Task().GetSection(task.SectionId)
	if err != nil || !section.IsRevision() {
		return invalidTaskVideoError(task)
	}
	videos, err := a.Srv().Store().Task().GetSectionVideos(section.Id)
	if err != nil {
		return taskStoreError("validateTaskVideo", section.Id, err)
	}
	for _, video := range videos {
		if video.FileId == task.VideoFileId {
			return nil
		}
	}
	return invalidTaskVideoError(task)
}

func invalidTaskVideoError(task *model.Task) *model.AppError {
	return model.NewAppError("validateTaskVideo", "app.task.invalid_video.app_error", nil, "video_file_id="+task.VideoFileId, http.StatusBadRequest)
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
	if appErr := a.validateTaskVideo(task); appErr != nil {
		return nil, appErr
	}
	task.ApprovalStatus = ""
	if appErr := a.syncTaskApproval("", task); appErr != nil {
		return nil, appErr
	}
	if task.ParentId != "" {
		teamTasks, appErr := a.GetTasksForTeam(task.TeamId)
		if appErr != nil {
			return nil, appErr
		}
		if appErr := validateTaskParent(task, tasksByID(teamTasks)); appErr != nil {
			return nil, appErr
		}
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
	if task.VideoFileId != "" && patched.SectionId != task.SectionId {
		return nil, invalidTaskVideoError(task)
	}
	if task.VideoFileId == "" && task.ApprovalStatus == model.TaskApprovalApproved && (patched.Status != task.Status ||
		patched.SectionId != task.SectionId || patched.AssigneeId != task.AssigneeId || patched.ParentId != task.ParentId) {
		// Only an approval someone gave locks the task; without the chain, done is approved on arrival and stays open.
		approvalOn, appErr := a.taskApprovalEnabled(task.TeamId)
		if appErr != nil {
			return nil, appErr
		}
		if approvalOn {
			return nil, model.NewAppError("PatchTask", "app.task.approved_locked.app_error", nil, "id="+task.Id, http.StatusBadRequest)
		}
	}
	if appErr := a.validateTaskRefs(rctx, &patched); appErr != nil {
		return nil, appErr
	}
	if task.VideoFileId != "" && (patch.DepartmentId != nil || patch.WaitsFor != nil || (patch.ParentId != nil && *patch.ParentId != "")) {
		return nil, model.NewAppError("PatchTask", "app.task.revision_rules.app_error", nil, "id="+task.Id, http.StatusBadRequest)
	}
	if appErr := a.syncTaskApproval(task.Status, &patched); appErr != nil {
		return nil, appErr
	}
	var teamTasks []*model.Task
	if task.VideoFileId == "" {
		var appErr *model.AppError
		if teamTasks, appErr = a.GetTasksForTeam(task.TeamId); appErr != nil {
			return nil, appErr
		}
		byID := tasksByID(teamTasks)
		if patched.ParentId != task.ParentId {
			if appErr := validateTaskParent(&patched, byID); appErr != nil {
				return nil, appErr
			}
		}
		if appErr := checkTaskHierarchy(task.Status, &patched, byID); appErr != nil {
			return nil, appErr
		}
		if patched.SectionId != task.SectionId || patched.WaitsFor == nil {
			patched.WaitsFor = model.StringArray{} // links never cross sections; nil would store JSON null
		}
		if patched.SectionId != task.SectionId {
			patched.FolderId = "" // the folder is the episode channel's; the task has left it
		}
		if patch.WaitsFor != nil {
			if appErr := validateTaskWaitsFor(&patched, byID); appErr != nil {
				return nil, appErr
			}
		}
		if appErr := a.checkTaskLock(rctx, task, &patched, byID); appErr != nil {
			return nil, appErr
		}
	}
	updated, err := a.Srv().Store().Task().Update(&patched)
	if err != nil {
		return nil, taskStoreError("PatchTask", task.Id, err)
	}
	if patched.SectionId != task.SectionId {
		if appErr := a.unlinkTask(rctx, task.Id, teamTasks, false, connectionID); appErr != nil {
			return nil, appErr
		}
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, updated.TeamId, "task", updated, connectionID)
	actorID := ""
	if session := rctx.Session(); session != nil {
		actorID = session.UserId
	}
	a.notifyTaskAssignee(rctx, updated, task.AssigneeId, actorID)
	return updated, nil
}

// ApplyTaskApproval moves a done task along the approval chain (approve, reject) or reopens an approved one (revert).
// The API has already checked the permission for the task's current stage.
func (a *App) ApplyTaskApproval(rctx request.CTX, task *model.Task, action, connectionID string) (*model.Task, *model.AppError) {
	if appErr := a.RequireTasksEnabled(task.TeamId); appErr != nil {
		return nil, appErr
	}
	invalid := model.NewAppError("ApplyTaskApproval", "app.task.approval_invalid.app_error", nil, "id="+task.Id+" action="+action, http.StatusBadRequest)
	if task.VideoFileId != "" {
		return nil, invalid
	}
	teamTasks, appErr := a.GetTasksForTeam(task.TeamId)
	if appErr != nil {
		return nil, appErr
	}
	byID := tasksByID(teamTasks)
	pending := task.Status == model.TaskStatusDone &&
		(task.ApprovalStatus == model.TaskApprovalPendingSupervisor || task.ApprovalStatus == model.TaskApprovalPendingDirector)

	updated := *task
	switch action {
	case model.TaskApprovalActionApprove:
		if !pending {
			return nil, invalid
		}
		if len(a.taskLocked(task, byID)) > 0 {
			return nil, model.NewAppError("ApplyTaskApproval", "app.task.locked.app_error", nil, "id="+task.Id, http.StatusBadRequest)
		}
		if hasOpenSubtasks(task.Id, byID) {
			return nil, model.NewAppError("ApplyTaskApproval", "app.task.subtasks_open.app_error", nil, "id="+task.Id, http.StatusBadRequest)
		}
		updated.ApprovalStatus = model.TaskApprovalApproved
		if task.ApprovalStatus == model.TaskApprovalPendingSupervisor {
			updated.ApprovalStatus = model.TaskApprovalPendingDirector
		}
	case model.TaskApprovalActionReject:
		if !pending {
			return nil, invalid
		}
		updated.ApprovalStatus = model.TaskApprovalRejected
		updated.Status = model.TaskStatusInProgress
	case model.TaskApprovalActionRevert:
		if !task.IsComplete() {
			return nil, invalid
		}
		if parent := byID[task.ParentId]; parent != nil && parent.Status == model.TaskStatusDone {
			return nil, taskParentDoneError(task.Id)
		}
		updated.ApprovalStatus = ""
		updated.Status = model.TaskStatusInProgress
	default:
		return nil, invalid
	}

	saved, err := a.Srv().Store().Task().Update(&updated)
	if err != nil {
		return nil, taskStoreError("ApplyTaskApproval", task.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, saved.TeamId, "task", saved, connectionID)
	return saved, nil
}

func taskWaitsForError(id string) *model.AppError {
	return model.NewAppError("PatchTask", "app.task.waits_for.app_error", nil, "id="+id, http.StatusBadRequest)
}

// validateTaskWaitsFor keeps a task's waits-for to other tasks of its own section, once each, without a cycle.
func validateTaskWaitsFor(task *model.Task, byID map[string]*model.Task) *model.AppError {
	byID = maps.Clone(byID)
	byID[task.Id] = task
	seen := map[string]bool{}
	for _, id := range task.WaitsFor {
		other := byID[id]
		if id == task.Id || other == nil || other.SectionId != task.SectionId || other.VideoFileId != "" || seen[id] {
			return taskWaitsForError(task.Id)
		}
		seen[id] = true
	}
	visited := map[string]bool{}
	var reaches func(id string) bool // whether the waits-for chain from id comes back to task
	reaches = func(id string) bool {
		if id == task.Id {
			return true
		}
		if visited[id] || byID[id] == nil {
			return false
		}
		visited[id] = true
		return slices.ContainsFunc(byID[id].WaitsFor, reaches)
	}
	if slices.ContainsFunc(task.WaitsFor, reaches) {
		return taskWaitsForError(task.Id)
	}
	return nil
}

// taskLocked lists the tasks task waits for that are not complete yet.
func (a *App) taskLocked(task *model.Task, byID map[string]*model.Task) []*model.Task {
	var open []*model.Task
	for _, id := range task.WaitsFor {
		if other := byID[id]; other != nil && !other.IsComplete() {
			open = append(open, other)
		}
	}
	return open
}

func tasksByID(tasks []*model.Task) map[string]*model.Task {
	byID := make(map[string]*model.Task, len(tasks))
	for _, t := range tasks {
		byID[t.Id] = t
	}
	return byID
}

func taskParentError(id, reason string) *model.AppError {
	return model.NewAppError("validateTaskParent", "app.task.invalid_parent.app_error", nil, "id="+id+" reason="+reason, http.StatusBadRequest)
}

func taskParentDoneError(id string) *model.AppError {
	return model.NewAppError("checkTaskHierarchy", "app.task.parent_done.app_error", nil, "id="+id, http.StatusBadRequest)
}

// validateTaskParent keeps subtasks one level deep inside the team and off revisions, and keeps open work out of a
// parent that is already in done. byID holds the team's tasks.
func validateTaskParent(task *model.Task, byID map[string]*model.Task) *model.AppError {
	if task.ParentId == "" {
		return nil
	}
	parent := byID[task.ParentId]
	switch {
	case parent == nil || parent.Id == task.Id:
		return taskParentError(task.Id, "not found")
	case parent.ParentId != "":
		return taskParentError(task.Id, "parent is a subtask")
	case parent.VideoFileId != "" || task.VideoFileId != "":
		return taskParentError(task.Id, "revision")
	case task.Id != "" && hasSubtasks(task.Id, byID):
		return taskParentError(task.Id, "has subtasks")
	case parent.Status == model.TaskStatusDone && !task.IsComplete():
		return taskParentDoneError(task.Id)
	}
	return nil
}

func hasSubtasks(id string, byID map[string]*model.Task) bool {
	for _, other := range byID {
		if other.ParentId == id {
			return true
		}
	}
	return false
}

func hasOpenSubtasks(id string, byID map[string]*model.Task) bool {
	for _, other := range byID {
		if other.ParentId == id && !other.IsComplete() {
			return true
		}
	}
	return false
}

// checkTaskHierarchy: a parent enters done only once its subtasks are complete, and a subtask cannot leave done while
// its parent is there.
func checkTaskHierarchy(oldStatus string, task *model.Task, byID map[string]*model.Task) *model.AppError {
	if task.Status == model.TaskStatusDone && oldStatus != model.TaskStatusDone && hasOpenSubtasks(task.Id, byID) {
		return model.NewAppError("checkTaskHierarchy", "app.task.subtasks_open.app_error", nil, "id="+task.Id, http.StatusBadRequest)
	}
	if task.ParentId != "" && oldStatus == model.TaskStatusDone && task.Status != model.TaskStatusDone {
		if parent := byID[task.ParentId]; parent != nil && parent.Status == model.TaskStatusDone {
			return taskParentDoneError(task.Id)
		}
	}
	return nil
}

// syncTaskApproval keeps a task's approval stage in step with its status: entering done starts the chain (or approves
// at once when the team has no approval or the task is a revision), and outside done only a rejection being reworked
// (in progress) keeps its stage.
func (a *App) syncTaskApproval(oldStatus string, task *model.Task) *model.AppError {
	if task.Status != model.TaskStatusDone {
		if task.ApprovalStatus != model.TaskApprovalRejected || task.Status != model.TaskStatusInProgress {
			task.ApprovalStatus = ""
		}
		return nil
	}
	if oldStatus == model.TaskStatusDone && task.ApprovalStatus != "" {
		return nil
	}
	approvalOn, appErr := a.taskApprovalEnabled(task.TeamId)
	if appErr != nil {
		return appErr
	}
	task.ApprovalStatus = model.TaskApprovalApproved
	if approvalOn && task.VideoFileId == "" {
		task.ApprovalStatus = model.TaskApprovalPendingSupervisor
	}
	return nil
}

func (a *App) taskApprovalEnabled(teamID string) (bool, *model.AppError) {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return false, appErr
	}
	return team.TaskApprovalEnabled, nil
}

// checkTaskLock refuses to start or claim a to-do task that is still locked, unless the session manages tasks.
func (a *App) checkTaskLock(rctx request.CTX, task, patched *model.Task, byID map[string]*model.Task) *model.AppError {
	if task.Status != model.TaskStatusTodo || (patched.Status == task.Status && patched.AssigneeId == task.AssigneeId) {
		return nil
	}
	if len(a.taskLocked(task, byID)) == 0 {
		return nil
	}
	if session := rctx.Session(); session == nil || a.SessionHasPermissionToTeam(*session, task.TeamId, model.PermissionManageTasks) {
		return nil
	}
	return model.NewAppError("PatchTask", "app.task.locked.app_error", nil, "id="+task.Id, http.StatusBadRequest)
}

// unlinkTask drops id from the waits-for of every task in tasks that has it and, with detachSubtasks, makes id's
// subtasks top-level; each changed task is saved and published once.
func (a *App) unlinkTask(rctx request.CTX, id string, tasks []*model.Task, detachSubtasks bool, connectionID string) *model.AppError {
	for _, other := range tasks {
		waits := slices.Contains(other.WaitsFor, id)
		child := detachSubtasks && other.ParentId == id
		if other.Id == id || (!waits && !child) {
			continue
		}
		c := *other
		c.WaitsFor = slices.DeleteFunc(slices.Clone(other.WaitsFor), func(w string) bool { return w == id })
		if child {
			c.ParentId = ""
		}
		saved, err := a.Srv().Store().Task().Update(&c)
		if err != nil {
			return taskStoreError("unlinkTask", other.Id, err)
		}
		a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, saved.TeamId, "task", saved, connectionID)
	}
	return nil
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
	if task.SectionId == "" || task.VideoFileId == "" {
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
	teamTasks, appErr := a.GetTasksForTeam(task.TeamId)
	if appErr != nil {
		return appErr
	}
	return a.unlinkTask(rctx, task.Id, teamTasks, true, connectionID)
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
	// Read the versions first: the store delete removes their rows.
	videos, err := a.Srv().Store().Task().GetSectionVideos(section.Id)
	if err != nil {
		return taskStoreError("DeleteTaskSection", section.Id, err)
	}
	fileIDs := []string{}
	if section.VideoFileId != "" {
		fileIDs = append(fileIDs, section.VideoFileId)
	}
	for _, video := range videos {
		if video.FileId != section.VideoFileId {
			fileIDs = append(fileIDs, video.FileId)
		}
	}
	if err := a.Srv().Store().Task().DeleteSection(section.Id); err != nil {
		return taskStoreError("DeleteTaskSection", section.Id, err)
	}
	a.removeTaskFiles(rctx, fileIDs)
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionDeleted, section.TeamId, "section_id", section.Id, connectionID)
	return nil
}

// SetTaskSectionVideo adds a new version of the section's video and makes it the latest; earlier versions stay.
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

	if _, err := a.Srv().Store().Task().SaveSectionVideo(&model.TaskSectionVideo{SectionId: section.Id, FileId: info.Id, CreatorId: userID}); err != nil {
		a.removeTaskFiles(rctx, []string{info.Id})
		return nil, taskStoreError("SetTaskSectionVideo", section.Id, err)
	}
	patched := *section
	patched.VideoFileId = info.Id
	updated, err := a.Srv().Store().Task().UpdateSection(&patched)
	if err != nil {
		// The version row stays and points at a removed file; GetTaskSectionVideos drops such rows.
		a.removeTaskFiles(rctx, []string{info.Id})
		return nil, taskStoreError("SetTaskSectionVideo", section.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskSectionUpserted, updated.TeamId, "section", updated, connectionID)
	return updated, nil
}

// GetTaskSectionVideos lists the section's video versions, oldest first, each with its file; versions whose file is gone are left out.
func (a *App) GetTaskSectionVideos(rctx request.CTX, section *model.TaskSection) ([]*model.TaskSectionVideo, *model.AppError) {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	videos, err := a.Srv().Store().Task().GetSectionVideos(section.Id)
	if err != nil {
		return nil, taskStoreError("GetTaskSectionVideos", section.Id, err)
	}
	if len(videos) == 0 {
		return videos, nil
	}
	fileIDs := make([]string, 0, len(videos))
	for _, video := range videos {
		fileIDs = append(fileIDs, video.FileId)
	}
	infos, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, false, false, true)
	if err != nil {
		return nil, taskStoreError("GetTaskSectionVideos", section.Id, err)
	}
	byID := make(map[string]*model.FileInfo, len(infos))
	for _, info := range infos {
		byID[info.Id] = info
	}
	kept := make([]*model.TaskSectionVideo, 0, len(videos))
	for _, video := range videos {
		if info := byID[video.FileId]; info != nil {
			video.File = info
			kept = append(kept, video)
		}
	}
	return kept, nil
}

// GetTaskSectionVideo returns one version's file: the latest for an empty fileID, otherwise only a version of this section.
func (a *App) GetTaskSectionVideo(rctx request.CTX, section *model.TaskSection, fileID string) (*model.FileInfo, *model.AppError) {
	if appErr := a.RequireTasksEnabled(section.TeamId); appErr != nil {
		return nil, appErr
	}
	notFound := model.NewAppError("GetTaskSectionVideo", "app.task.not_found.app_error", nil, "section_id="+section.Id, http.StatusNotFound)
	if fileID == "" {
		fileID = section.VideoFileId
	}
	if fileID == "" {
		return nil, notFound
	}
	if fileID != section.VideoFileId {
		videos, err := a.Srv().Store().Task().GetSectionVideos(section.Id)
		if err != nil {
			return nil, taskStoreError("GetTaskSectionVideo", section.Id, err)
		}
		found := false
		for _, video := range videos {
			found = found || video.FileId == fileID
		}
		if !found {
			return nil, notFound
		}
	}
	info, appErr := a.GetFileInfo(rctx, fileID)
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
	// A task in a channel's task list is discussed in that channel: its comments are the channel's messages about it.
	if task.SectionId != "" {
		section, err := a.Srv().Store().Task().GetSection(task.SectionId)
		if err != nil {
			return nil, taskStoreError("CreateTaskComment", task.SectionId, err)
		}
		if section.ChannelId != "" {
			return nil, model.NewAppError("CreateTaskComment", "app.task.comment.use_channel.app_error", nil, "task_id="+task.Id, http.StatusBadRequest)
		}
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
	return saved, nil
}

// GetTaskPosts returns the task's messages (root posts tagged with it), newest first, from the channels userID can read.
func (a *App) GetTaskPosts(rctx request.CTX, task *model.Task, userID, channelID string, before int64, perPage int) (*model.PostList, *model.AppError) {
	ids, err := a.Srv().Store().Task().GetPostIdsForTask(task.Id, channelID, before, perPage)
	if err != nil {
		return nil, model.NewAppError("GetTaskPosts", "app.post.get.app_error", nil, "task_id="+task.Id, http.StatusInternalServerError).Wrap(err)
	}
	list := model.NewPostList()
	// A full page of ids means more may follow, though the reader may see fewer posts than that.
	list.HasNext = model.NewPointer(len(ids) == perPage)
	if len(ids) == 0 {
		return list, nil
	}
	// The per-reader read path, so burn-on-read and plan-limited posts are handled as everywhere else.
	posts, _, appErr := a.GetPostsByIdsForUser(rctx, userID, ids)
	if appErr != nil {
		if appErr.StatusCode == http.StatusNotFound {
			return list, nil
		}
		return nil, appErr
	}
	byID := make(map[string]*model.Post, len(posts))
	for _, post := range posts {
		byID[post.Id] = post
	}
	readable := map[string]bool{}
	for _, id := range ids {
		post, ok := byID[id]
		if !ok {
			continue
		}
		canRead, seen := readable[post.ChannelId]
		if !seen {
			canRead, _ = a.HasPermissionToChannel(rctx, userID, post.ChannelId, model.PermissionReadChannelContent)
			readable[post.ChannelId] = canRead
		}
		if canRead {
			list.AddPost(post)
			list.AddOrder(post.Id)
		}
	}
	return a.PreparePostListForClient(rctx, list, nil), nil
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

// TaskHasLinks reports whether task waits for another task or another task waits for it.
func (a *App) TaskHasLinks(task *model.Task) (bool, *model.AppError) {
	if len(task.WaitsFor) > 0 {
		return true, nil
	}
	tasks, appErr := a.GetTasksForTeam(task.TeamId)
	if appErr != nil {
		return false, appErr
	}
	return slices.ContainsFunc(tasks, func(t *model.Task) bool { return slices.Contains(t.WaitsFor, task.Id) }), nil
}
