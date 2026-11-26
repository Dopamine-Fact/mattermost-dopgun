// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/app"
	"github.com/mattermost/mattermost/server/v8/platform/shared/web"
)

func (api *API) InitTasks() {
	api.BaseRoutes.Team.Handle("/tasks", api.APISessionRequired(getTeamTasks)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/tasks", api.APISessionRequired(createTask)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}", api.APISessionRequired(patchTask)).Methods(http.MethodPatch)
	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteTask)).Methods(http.MethodDelete)
	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}/approval", api.APISessionRequired(taskApproval)).Methods(http.MethodPost)

	api.BaseRoutes.Team.Handle("/task_sections", api.APISessionRequired(getTeamTaskSections)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/task_sections", api.APISessionRequired(createTaskSection)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}", api.APISessionRequired(patchTaskSection)).Methods(http.MethodPatch)
	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteTaskSection)).Methods(http.MethodDelete)
	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}/video", api.APISessionRequired(setTaskSectionVideo, handlerParamFileAPI)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}/video", api.APISessionRequiredTrustRequester(getTaskSectionVideo)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}/videos", api.APISessionRequired(getTaskSectionVideos)).Methods(http.MethodGet)

	api.BaseRoutes.APIRoot.Handle("/task_sections/{section_id:[A-Za-z0-9]+}/schedule", api.APISessionRequired(getTaskSchedule)).Methods(http.MethodGet)

	api.BaseRoutes.Team.Handle("/task_stages", api.APISessionRequired(getTeamTaskStages)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/task_stages", api.APISessionRequired(createTaskStage)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/task_stages/{stage_id:[A-Za-z0-9]+}", api.APISessionRequired(patchTaskStage)).Methods(http.MethodPatch)
	api.BaseRoutes.APIRoot.Handle("/task_stages/{stage_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteTaskStage)).Methods(http.MethodDelete)

	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}/comments", api.APISessionRequired(getTaskComments)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}/posts", api.APISessionRequired(getTaskPosts)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/tasks/{task_id:[A-Za-z0-9]+}/comments", api.APISessionRequired(createTaskComment, handlerParamFileAPI)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/task_comments/{comment_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteTaskComment)).Methods(http.MethodDelete)
	api.BaseRoutes.APIRoot.Handle("/task_comments/{comment_id:[A-Za-z0-9]+}/files/{file_id:[A-Za-z0-9]+}", api.APISessionRequiredTrustRequester(getTaskCommentFile)).Methods(http.MethodGet)
}

// requireTaskTeamMember: any team member may read and edit the team's tasks.
func requireTaskTeamMember(c *Context, teamID string) {
	if !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), teamID, model.PermissionViewTeam) {
		c.SetPermissionError(model.PermissionViewTeam)
	}
}

func requireTeamPermission(c *Context, teamID string, permission *model.Permission) {
	if !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), teamID, permission) {
		c.SetPermissionError(permission)
	}
}

// sectionPermission: revision sections need manage_revisions, the others manage_tasks.
func sectionPermission(section *model.TaskSection) *model.Permission {
	if section.IsRevision() {
		return model.PermissionManageRevisions
	}
	return model.PermissionManageTasks
}

// taskPermission: revisions (tasks pinned to a video version) need manage_revisions, every other task manage_tasks,
// whatever section it is in.
func taskPermission(task *model.Task) *model.Permission {
	if task.VideoFileId != "" {
		return model.PermissionManageRevisions
	}
	return model.PermissionManageTasks
}

// requireTaskPermission: creating, assigning and deleting a task needs its permission, which it returns.
func requireTaskPermission(c *Context, task *model.Task) *model.Permission {
	permission := taskPermission(task)
	requireTeamPermission(c, task.TeamId, permission)
	return permission
}

// requireCanAssign: giving a task to someone else needs a rank that carries permission and outranks them (admins
// bypass).
func requireCanAssign(c *Context, teamID, assigneeID string, permission *model.Permission) {
	if assigneeID != "" && !c.App.CanActOnUser(c.AppContext, c.AppContext.Session().UserId, assigneeID, teamID, permission) {
		c.Err = model.NewAppError("requireCanAssign", "api.task.assignee_not_outranked.app_error", nil, "", http.StatusForbidden)
	}
}

// isTaskClaim: a department member taking an unassigned task of their department for themselves.
func isTaskClaim(c *Context, task *model.Task, assigneeID string) (bool, *model.AppError) {
	if assigneeID != c.AppContext.Session().UserId || task.AssigneeId != "" || task.DepartmentId == "" || task.VideoFileId != "" {
		return false, nil
	}
	depts, appErr := c.App.UserDepartments(c.AppContext, task.TeamId, assigneeID)
	if appErr != nil {
		return false, appErr
	}
	return depts[task.DepartmentId], nil
}

func writeTaskJSON(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		mlog.Error("failed to encode task API response", mlog.Err(err))
	}
}

// loadTask resolves {task_id} and checks the caller belongs to the task's team.
func loadTask(c *Context, r *http.Request) *model.Task {
	task, appErr := c.App.GetTask(mux.Vars(r)["task_id"])
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if requireTaskTeamMember(c, task.TeamId); c.Err != nil {
		return nil
	}
	return task
}

func loadTaskSection(c *Context, r *http.Request) *model.TaskSection {
	section, appErr := c.App.GetTaskSection(mux.Vars(r)["section_id"])
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if requireTaskTeamMember(c, section.TeamId); c.Err != nil {
		return nil
	}
	return section
}

func getTeamTasks(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	tasks, appErr := c.App.GetTasksForTeam(c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, tasks)
}

func createTask(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}

	var task model.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		c.SetInvalidParamWithErr("task", err)
		return
	}
	task.TeamId = c.Params.TeamId
	permission := requireTaskPermission(c, &task)
	if c.Err != nil {
		return
	}
	if requireCanAssign(c, c.Params.TeamId, task.AssigneeId, permission); c.Err != nil {
		return
	}
	task.Id, task.FolderId = "", "" // the folder exists only on seeded tasks
	task.WaitsFor = model.StringArray{} // links are set by patch, which checks them
	if task.VideoFileId != "" && task.DepartmentId != "" {
		c.SetInvalidParam("department_id")
		return
	}
	task.CreatorId = c.AppContext.Session().UserId

	auditRec := c.MakeAuditRecord(model.AuditEventCreateTask, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterAuditableToAuditRec(auditRec, "task", &task)

	created, appErr := c.App.CreateTask(c.AppContext, &task, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("task")
	writeTaskJSON(w, http.StatusCreated, created)
}

func patchTask(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}

	var patch model.TaskPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("task", err)
		return
	}
	changesRules := (patch.DepartmentId != nil && *patch.DepartmentId != task.DepartmentId) ||
		(patch.WaitsFor != nil && !slices.Equal(*patch.WaitsFor, task.WaitsFor)) ||
		(patch.ParentId != nil && *patch.ParentId != task.ParentId)
	if changesRules {
		if requireTaskPermission(c, task); c.Err != nil {
			return
		}
	}
	if patch.SectionId != nil && *patch.SectionId != task.SectionId {
		// Moving a task drops its links both ways, so for a linked task it is a rules change.
		linked, appErr := c.App.TaskHasLinks(task)
		if appErr != nil {
			c.Err = appErr
			return
		}
		if linked {
			if requireTaskPermission(c, task); c.Err != nil {
				return
			}
		}
	}
	if patch.AssigneeId != nil && *patch.AssigneeId != task.AssigneeId {
		claim, appErr := isTaskClaim(c, task, *patch.AssigneeId)
		if appErr != nil {
			c.Err = appErr
			return
		}
		// A claim skips the permission checks; PatchTask still refuses it while the task is locked.
		if !claim {
			permission := requireTaskPermission(c, task)
			if c.Err != nil {
				return
			}
			if requireCanAssign(c, task.TeamId, *patch.AssigneeId, permission); c.Err != nil {
				return
			}
		}
	}

	auditRec := c.MakeAuditRecord(model.AuditEventPatchTask, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(task)

	updated, appErr := c.App.PatchTask(c.AppContext, task, &patch, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("task")
	writeTaskJSON(w, http.StatusOK, updated)
}

// taskApprovalPermission: the director stage and reverting an approval need approve_task_director, the supervisor
// stage approve_task_supervisor.
func taskApprovalPermission(task *model.Task, action string) *model.Permission {
	if action == model.TaskApprovalActionRevert || task.ApprovalStatus == model.TaskApprovalPendingDirector {
		return model.PermissionApproveTaskDirector
	}
	return model.PermissionApproveTaskSupervisor
}

func taskApproval(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}
	var body model.TaskApprovalRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("approval", err)
		return
	}
	if requireTeamPermission(c, task.TeamId, taskApprovalPermission(task, body.Action)); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventPatchTask, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(task)
	model.AddEventParameterToAuditRec(auditRec, "action", body.Action)

	updated, appErr := c.App.ApplyTaskApproval(c.AppContext, task, body.Action, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("task")
	writeTaskJSON(w, http.StatusOK, updated)
}

func deleteTask(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}
	if requireTaskPermission(c, task); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventDeleteTask, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(task)

	if appErr := c.App.DeleteTask(c.AppContext, task, r.Header.Get(model.ConnectionId)); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}

func getTeamTaskSections(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	sections, appErr := c.App.GetTaskSectionsForTeam(c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, sections)
}

func createTaskSection(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}

	var section model.TaskSection
	if err := json.NewDecoder(r.Body).Decode(&section); err != nil {
		c.SetInvalidParamWithErr("task_section", err)
		return
	}
	section.Id = ""
	section.TeamId = c.Params.TeamId
	section.VideoFileId = "" // set only by uploading through /video
	if requireTeamPermission(c, c.Params.TeamId, sectionPermission(&section)); c.Err != nil {
		return
	}
	if section.ChannelId != "" {
		if ok, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), section.ChannelId, model.PermissionReadChannel); !ok {
			c.SetPermissionError(model.PermissionReadChannel)
			return
		}
	}

	auditRec := c.MakeAuditRecord(model.AuditEventCreateTaskSection, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterAuditableToAuditRec(auditRec, "task_section", &section)

	created, appErr := c.App.CreateTaskSection(c.AppContext, &section, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("task_section")
	writeTaskJSON(w, http.StatusCreated, created)
}

func patchTaskSection(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	if requireTeamPermission(c, section.TeamId, sectionPermission(section)); c.Err != nil {
		return
	}

	var patch model.TaskSectionPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("task_section", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventPatchTaskSection, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(section)

	updated, appErr := c.App.PatchTaskSection(c.AppContext, section, &patch, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("task_section")
	writeTaskJSON(w, http.StatusOK, updated)
}

func deleteTaskSection(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	if requireTeamPermission(c, section.TeamId, sectionPermission(section)); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventDeleteTaskSection, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(section)

	if appErr := c.App.DeleteTaskSection(c.AppContext, section, r.Header.Get(model.ConnectionId)); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}

// readUploadedFile reads one multipart file field, enforcing attachments being on and MaxFileSize.
func readUploadedFile(c *Context, r *http.Request, field string) (string, []byte) {
	if !*c.App.Config().FileSettings.EnableFileAttachments {
		c.Err = model.NewAppError("readUploadedFile", "api.file.attachments.disabled.app_error", nil, "", http.StatusForbidden)
		return "", nil
	}
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		c.Err = model.NewAppError("readUploadedFile", "api.file.upload_file.read_request.app_error", nil, "", http.StatusBadRequest).Wrap(err)
		return "", nil
	}
	defer func() {
		if err := r.MultipartForm.RemoveAll(); err != nil {
			c.Logger.Warn("readUploadedFile: failed to remove temporary files", mlog.Err(err))
		}
	}()
	f, header, err := r.FormFile(field)
	if err != nil {
		c.SetInvalidParamWithErr(field, err)
		return "", nil
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		c.Err = model.NewAppError("readUploadedFile", "api.file.upload_file.read_request.app_error", nil, "", http.StatusBadRequest).Wrap(err)
		return "", nil
	}
	return header.Filename, data
}

// setTaskSectionVideo uploads the video that makes a section a revision channel.
func setTaskSectionVideo(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	if requireTeamPermission(c, section.TeamId, model.PermissionManageRevisions); c.Err != nil {
		return
	}
	name, data := readUploadedFile(c, r, "video")
	if c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventSetTaskSectionVideo, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(section)

	updated, appErr := c.App.SetTaskSectionVideo(c.AppContext, section, c.AppContext.Session().UserId, name, data, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("task_section")
	writeTaskJSON(w, http.StatusOK, updated)
}

// getTaskSectionVideos lists the section's video versions, oldest first, each with its file info.
func getTaskSectionVideos(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	videos, appErr := c.App.GetTaskSectionVideos(c.AppContext, section)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, videos)
}

// getTaskSectionVideo streams one version of the video (?file_id=, the latest without it) with range support so the
// player can seek.
func getTaskSectionVideo(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	info, appErr := c.App.GetTaskSectionVideo(c.AppContext, section, r.URL.Query().Get("file_id"))
	if appErr != nil {
		c.Err = appErr
		return
	}
	fileReader, appErr := c.App.FileReader(info.Path)
	if appErr != nil {
		c.Err = appErr
		return
	}
	defer fileReader.Close()
	web.WriteFileResponse(info.Name, model.TaskVideoContentType(info.Name), info.Size, time.UnixMilli(info.UpdateAt), *c.App.Config().ServiceSettings.WebserverMode, fileReader, false, w, r)
}

// loadTaskComment resolves {comment_id} with its task and checks the caller belongs to the task's team.
func loadTaskComment(c *Context, r *http.Request) (*model.Task, *model.TaskComment) {
	comment, appErr := c.App.GetTaskComment(mux.Vars(r)["comment_id"])
	if appErr != nil {
		c.Err = appErr
		return nil, nil
	}
	task, appErr := c.App.GetTask(comment.TaskId)
	if appErr != nil {
		c.Err = appErr
		return nil, nil
	}
	if requireTaskTeamMember(c, task.TeamId); c.Err != nil {
		return nil, nil
	}
	return task, comment
}

func getTaskComments(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}
	comments, appErr := c.App.GetTaskComments(task)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, comments)
}

// getTaskPosts serves the task's messages, newest first: ?channel_id= narrows them to one channel, ?before= (a
// CreateAt) pages back, ?per_page= sizes the page (default 60, at most 200).
func getTaskPosts(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}
	query := r.URL.Query()
	var before int64
	if raw := query.Get("before"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			c.SetInvalidURLParam("before")
			return
		}
		before = parsed
	}
	perPage := 60
	if raw := query.Get("per_page"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			c.SetInvalidURLParam("per_page")
			return
		}
		perPage = min(parsed, 200)
	}
	list, appErr := c.App.GetTaskPosts(c.AppContext, task, c.AppContext.Session().UserId, query.Get("channel_id"), before, perPage)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, list)
}

// canManageTaskPost: whoever may manage a task may delete the messages about it. The post must sit in the channel
// the task's section is linked to, so a task_id tag in some other channel grants nothing.
func canManageTaskPost(c *Context, post *model.Post) bool {
	taskID, _ := post.GetProp("task_id").(string)
	if taskID == "" {
		return false
	}
	task, appErr := c.App.GetTask(taskID)
	if appErr != nil || task.SectionId == "" {
		return false
	}
	section, appErr := c.App.GetTaskSection(task.SectionId)
	if appErr != nil || section.ChannelId != post.ChannelId {
		return false
	}
	if canRead, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), post.ChannelId, model.PermissionReadChannelContent); !canRead {
		return false
	}
	return c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), task.TeamId, taskPermission(task))
}

// createTaskComment takes multipart form data: a "message" field and any number of "files" parts.
func createTaskComment(c *Context, w http.ResponseWriter, r *http.Request) {
	task := loadTask(c, r)
	if c.Err != nil {
		return
	}

	// shortcut: handlerParamFileAPI caps the whole request at MaxFileSize, so all files of one comment share that limit; stream parts instead if that is too tight.
	maxFileSize := *c.App.Config().FileSettings.MaxFileSize
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		c.Err = model.NewAppError("createTaskComment", "api.file.upload_file.read_request.app_error", nil, "", http.StatusBadRequest).Wrap(err)
		return
	}
	defer func() {
		if err := r.MultipartForm.RemoveAll(); err != nil {
			c.Logger.Warn("createTaskComment: failed to remove temporary files", mlog.Err(err))
		}
	}()

	headers := r.MultipartForm.File["files"]
	if len(headers) > 0 && !*c.App.Config().FileSettings.EnableFileAttachments {
		c.Err = model.NewAppError("createTaskComment", "api.file.attachments.disabled.app_error", nil, "", http.StatusForbidden)
		return
	}
	message := r.FormValue("message")
	if appErr := model.ValidateTaskCommentContent(message, len(headers)); appErr != nil {
		c.Err = appErr
		return
	}

	files := make([]app.TaskCommentFile, 0, len(headers))
	for _, header := range headers {
		if header.Size > maxFileSize {
			c.Err = model.NewAppError("createTaskComment", "api.file.upload_file.too_large_detailed.app_error",
				map[string]any{"Filename": header.Filename, "Length": header.Size, "Limit": maxFileSize}, "", http.StatusRequestEntityTooLarge)
			return
		}
		f, err := header.Open()
		if err != nil {
			c.Err = model.NewAppError("createTaskComment", "api.file.upload_file.read_request.app_error", nil, "", http.StatusBadRequest).Wrap(err)
			return
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			c.Err = model.NewAppError("createTaskComment", "api.file.upload_file.read_request.app_error", nil, "", http.StatusBadRequest).Wrap(err)
			return
		}
		files = append(files, app.TaskCommentFile{Name: header.Filename, Data: data})
	}

	auditRec := c.MakeAuditRecord(model.AuditEventCreateTaskComment, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "task_id", task.Id)

	comment, appErr := c.App.CreateTaskComment(c.AppContext, task, c.AppContext.Session().UserId, message, files)
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(comment)
	auditRec.AddEventObjectType("task_comment")
	writeTaskJSON(w, http.StatusCreated, comment)
}

// deleteTaskComment: authors delete their own comments; task managers delete any.
func deleteTaskComment(c *Context, w http.ResponseWriter, r *http.Request) {
	task, comment := loadTaskComment(c, r)
	if c.Err != nil {
		return
	}
	if comment.UserId != c.AppContext.Session().UserId {
		if requireTaskPermission(c, task); c.Err != nil {
			return
		}
	}

	auditRec := c.MakeAuditRecord(model.AuditEventDeleteTaskComment, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(comment)

	if appErr := c.App.DeleteTaskComment(c.AppContext, task, comment); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}

// getTaskCommentFile streams an attachment; the files have no channel, so /files/{id} cannot serve them.
func getTaskCommentFile(c *Context, w http.ResponseWriter, r *http.Request) {
	task, comment := loadTaskComment(c, r)
	if c.Err != nil {
		return
	}
	info, appErr := c.App.GetTaskCommentFile(c.AppContext, task, comment, mux.Vars(r)["file_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	fileReader, appErr := c.App.FileReader(info.Path)
	if appErr != nil {
		c.Err = appErr
		return
	}
	defer fileReader.Close()

	forceDownload := r.URL.Query().Get("download") == "1"
	web.WriteFileResponse(info.Name, info.MimeType, info.Size, time.UnixMilli(info.UpdateAt), *c.App.Config().ServiceSettings.WebserverMode, fileReader, forceDownload, w, r)
}

// getTaskSchedule returns the section's task weights and first and last tasks; any team member may read it.
func getTaskSchedule(c *Context, w http.ResponseWriter, r *http.Request) {
	section := loadTaskSection(c, r)
	if c.Err != nil {
		return
	}
	schedule, appErr := c.App.GetTaskSchedule(section)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, schedule)
}

// loadTaskStage resolves {stage_id} and checks the caller belongs to the stage's team.
func loadTaskStage(c *Context, r *http.Request) *model.TaskStage {
	stage, appErr := c.App.GetTaskStage(mux.Vars(r)["stage_id"])
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if requireTaskTeamMember(c, stage.TeamId); c.Err != nil {
		return nil
	}
	return stage
}

func getTeamTaskStages(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	canSee, appErr := c.App.SessionCanSeeTaskStages(c.AppContext, *c.AppContext.Session(), c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	if !canSee {
		c.Err = model.NewAppError("getTeamTaskStages", "api.task_stage.hidden.app_error", nil, "", http.StatusForbidden)
		return
	}
	stages, appErr := c.App.GetTaskStagesForTeam(c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, stages)
}

// Stages are part of planning the tasks, so creating, changing and deleting them needs manage_tasks.
func createTaskStage(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTeamPermission(c, c.Params.TeamId, model.PermissionManageTasks); c.Err != nil {
		return
	}

	var stage model.TaskStage
	if err := json.NewDecoder(r.Body).Decode(&stage); err != nil {
		c.SetInvalidParamWithErr("task_stage", err)
		return
	}
	stage.Id = ""
	stage.TeamId = c.Params.TeamId

	auditRec := c.MakeAuditRecord(model.AuditEventCreateTaskStage, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterAuditableToAuditRec(auditRec, "task_stage", &stage)

	created, appErr := c.App.CreateTaskStage(c.AppContext, &stage, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("task_stage")
	writeTaskJSON(w, http.StatusCreated, created)
}

func patchTaskStage(c *Context, w http.ResponseWriter, r *http.Request) {
	stage := loadTaskStage(c, r)
	if c.Err != nil {
		return
	}
	if requireTeamPermission(c, stage.TeamId, model.PermissionManageTasks); c.Err != nil {
		return
	}

	var patch model.TaskStagePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("task_stage", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventPatchTaskStage, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(stage)

	updated, appErr := c.App.PatchTaskStage(c.AppContext, stage, &patch, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("task_stage")
	writeTaskJSON(w, http.StatusOK, updated)
}

func deleteTaskStage(c *Context, w http.ResponseWriter, r *http.Request) {
	stage := loadTaskStage(c, r)
	if c.Err != nil {
		return
	}
	if requireTeamPermission(c, stage.TeamId, model.PermissionManageTasks); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventDeleteTaskStage, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(stage)

	if appErr := c.App.DeleteTaskStage(c.AppContext, stage, r.Header.Get(model.ConnectionId)); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}
