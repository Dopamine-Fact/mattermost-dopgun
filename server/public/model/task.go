// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const (
	TaskTitleMaxRunes       = 512
	TaskDescriptionMaxRunes = 16000
	TaskSectionNameMaxRunes = 64

	TaskStatusTodo       = "todo"
	TaskStatusInProgress = "in_progress"
	TaskStatusDone       = "done"

	// A done task moves through these approval stages; "" means it has not reached done (or left it).
	TaskApprovalPendingSupervisor = "pending_supervisor"
	TaskApprovalPendingDirector   = "pending_director"
	TaskApprovalApproved          = "approved"
	TaskApprovalRejected          = "rejected"

	TaskApprovalActionApprove = "approve"
	TaskApprovalActionReject  = "reject"
	TaskApprovalActionRevert  = "revert"
)

// TaskVideoContentTypes lists the videos a revision channel accepts, by extension; the server's mime table may not know them.
var TaskVideoContentTypes = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".webm": "video/webm",
	".ogv":  "video/ogg",
	".mov":  "video/quicktime",
}

// TaskVideoContentType returns the video type for a file name, or "" when it is not a supported video.
func TaskVideoContentType(name string) string {
	return TaskVideoContentTypes[strings.ToLower(filepath.Ext(name))]
}

// Task is an item on a team's task board. SectionId and AssigneeId are empty when unset; StartAt and DueAt are 0 when unset.
// SortOrder orders tasks within a status column; it is a float so a dragged task can land between two others.
type Task struct {
	Id           string      `json:"id"`
	TeamId       string      `json:"team_id"`
	SectionId    string      `json:"section_id"`
	Title        string      `json:"title"`
	Description  string      `json:"description"`
	AssigneeId   string      `json:"assignee_id"`
	StartAt      int64       `json:"start_at"`
	DueAt        int64       `json:"due_at"`
	Status       string      `json:"status"`
	SortOrder    float64     `json:"sort_order"`
	VideoTime    int64       `json:"video_time"`    // ms into the section's video, for revisions
	VideoFileId  string      `json:"video_file_id"` // the video version a revision was written on; empty for ordinary tasks. Set on create only.
	DepartmentId string      `json:"department_id"` // the department that does the task; empty = any
	WaitsFor     StringArray `json:"waits_for"`     // ids of the tasks that must be done first
	FolderId     string      `json:"folder_id"`     // the episode channel's drive folder that lists the task's files
	// LibraryFolderId is a folder of the team files library that also lists the task's files.
	LibraryFolderId string `json:"library_folder_id"`
	ParentId        string `json:"parent_id"` // the task this is a subtask of; empty for a top-level task

	// ApprovalStatus is where a done task is in the approval chain (TaskApproval*); the server sets it, never a patch.
	ApprovalStatus string `json:"approval_status"`
	CreatorId      string `json:"creator_id"`
	CreateAt       int64  `json:"create_at"`
	UpdateAt       int64  `json:"update_at"`
}

// IsComplete reports whether the task is finished: in done and through the approval chain.
func (t *Task) IsComplete() bool {
	return t.Status == TaskStatusDone && t.ApprovalStatus == TaskApprovalApproved
}

type TaskPatch struct {
	SectionId   *string  `json:"section_id"`
	Title       *string  `json:"title"`
	Description *string  `json:"description"`
	AssigneeId  *string  `json:"assignee_id"`
	StartAt     *int64   `json:"start_at"`
	DueAt       *int64   `json:"due_at"`
	Status      *string  `json:"status"`
	SortOrder   *float64 `json:"sort_order"`
	VideoTime   *int64   `json:"video_time"`

	DepartmentId *string      `json:"department_id"`
	WaitsFor     *StringArray `json:"waits_for"`
	ParentId     *string      `json:"parent_id"`

	FolderId        *string `json:"folder_id"`
	LibraryFolderId *string `json:"library_folder_id"`
}

// TaskApprovalRequest is the body of POST /tasks/{task_id}/approval.
type TaskApprovalRequest struct {
	Action string `json:"action"` // TaskApprovalAction*
}

// TaskSection groups tasks. A section linked to a channel (ChannelId) is that revision channel's list:
// VideoFileId is its video and its tasks are revisions at a VideoTime.
type TaskSection struct {
	Id          string `json:"id"`
	TeamId      string `json:"team_id"`
	Name        string `json:"name"`
	SortOrder   int64  `json:"sort_order"`
	ChannelId   string `json:"channel_id"` // set on create only
	VideoFileId string `json:"video_file_id"`
	CreateAt    int64  `json:"create_at"`
	UpdateAt    int64  `json:"update_at"`
}

// TaskSectionVideo is one uploaded version of a linked section's video. Version counts up from 1 per section.
type TaskSectionVideo struct {
	Id        string    `json:"id"`
	SectionId string    `json:"section_id"`
	FileId    string    `json:"file_id"`
	Version   int       `json:"version"`
	CreatorId string    `json:"creator_id"`
	CreateAt  int64     `json:"create_at"`
	File      *FileInfo `json:"file,omitempty" db:"-"`
}

func (v *TaskSectionVideo) PreSave() {
	if v.Id == "" {
		v.Id = NewId()
	}
	v.CreateAt = GetMillis()
}

type TaskSectionPatch struct {
	Name      *string `json:"name"`
	SortOrder *int64  `json:"sort_order"`
}

func (t *Task) Auditable() map[string]any {
	return map[string]any{
		"id":              t.Id,
		"team_id":         t.TeamId,
		"section_id":      t.SectionId,
		"assignee_id":     t.AssigneeId,
		"status":          t.Status,
		"parent_id":       t.ParentId,
		"approval_status": t.ApprovalStatus,
	}
}

func (t *Task) PreSave() {
	if t.Id == "" {
		t.Id = NewId()
	}
	t.Title = strings.TrimSpace(t.Title)
	if t.WaitsFor == nil {
		t.WaitsFor = StringArray{}
	}
	t.CreateAt = GetMillis()
	t.UpdateAt = t.CreateAt
	if t.Status == "" {
		t.Status = TaskStatusTodo
	}
	if t.SortOrder == 0 {
		// New tasks go to the bottom of their column.
		t.SortOrder = float64(t.CreateAt)
	}
}

func (t *Task) PreUpdate() {
	t.Title = strings.TrimSpace(t.Title)
	t.UpdateAt = GetMillis()
}

func (t *Task) Patch(p *TaskPatch) {
	if p.SectionId != nil {
		t.SectionId = *p.SectionId
	}
	if p.Title != nil {
		t.Title = *p.Title
	}
	if p.Description != nil {
		t.Description = *p.Description
	}
	if p.AssigneeId != nil {
		t.AssigneeId = *p.AssigneeId
	}
	if p.StartAt != nil {
		t.StartAt = *p.StartAt
	}
	if p.DueAt != nil {
		t.DueAt = *p.DueAt
	}
	if p.Status != nil {
		t.Status = *p.Status
	}
	if p.SortOrder != nil {
		t.SortOrder = *p.SortOrder
	}
	if p.VideoTime != nil {
		t.VideoTime = *p.VideoTime
	}
	if p.DepartmentId != nil {
		t.DepartmentId = *p.DepartmentId
	}
	if p.WaitsFor != nil {
		t.WaitsFor = *p.WaitsFor
	}
	if p.ParentId != nil {
		t.ParentId = *p.ParentId
	}
	if p.FolderId != nil {
		t.FolderId = *p.FolderId
	}
	if p.LibraryFolderId != nil {
		t.LibraryFolderId = *p.LibraryFolderId
	}
}

func (t *Task) IsValid() *AppError {
	if !IsValidId(t.Id) {
		return NewAppError("Task.IsValid", "model.task.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(t.TeamId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.team_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if !IsValidId(t.CreatorId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.creator_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.SectionId != "" && !IsValidId(t.SectionId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.section_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.AssigneeId != "" && !IsValidId(t.AssigneeId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.assignee_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.DepartmentId != "" && !IsValidId(t.DepartmentId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.department_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.FolderId != "" && !IsValidId(t.FolderId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.folder_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.LibraryFolderId != "" && !IsValidId(t.LibraryFolderId) {
		return NewAppError("Task.IsValid", "model.task.is_valid.folder_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.ParentId != "" && (!IsValidId(t.ParentId) || t.ParentId == t.Id) {
		return NewAppError("Task.IsValid", "model.task.is_valid.parent_id.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	switch t.ApprovalStatus {
	case "", TaskApprovalPendingSupervisor, TaskApprovalPendingDirector, TaskApprovalApproved, TaskApprovalRejected:
	default:
		return NewAppError("Task.IsValid", "model.task.is_valid.approval_status.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	for _, id := range t.WaitsFor {
		if !IsValidId(id) {
			return NewAppError("Task.IsValid", "model.task.is_valid.waits_for.app_error", nil, "id="+t.Id, http.StatusBadRequest)
		}
	}
	if t.Title == "" || utf8.RuneCountInString(t.Title) > TaskTitleMaxRunes {
		return NewAppError("Task.IsValid", "model.task.is_valid.title.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if utf8.RuneCountInString(t.Description) > TaskDescriptionMaxRunes {
		return NewAppError("Task.IsValid", "model.task.is_valid.description.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.Status != TaskStatusTodo && t.Status != TaskStatusInProgress && t.Status != TaskStatusDone {
		return NewAppError("Task.IsValid", "model.task.is_valid.status.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.VideoTime < 0 {
		return NewAppError("Task.IsValid", "model.task.is_valid.video_time.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.DueAt < 0 {
		return NewAppError("Task.IsValid", "model.task.is_valid.due_at.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.StartAt < 0 || (t.StartAt > 0 && t.DueAt > 0 && t.StartAt > t.DueAt) {
		return NewAppError("Task.IsValid", "model.task.is_valid.start_at.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	if t.CreateAt == 0 || t.UpdateAt == 0 {
		return NewAppError("Task.IsValid", "model.task.is_valid.create_at.app_error", nil, "id="+t.Id, http.StatusBadRequest)
	}
	return nil
}

func (s *TaskSection) Auditable() map[string]any {
	return map[string]any{
		"id":      s.Id,
		"team_id": s.TeamId,
	}
}

// IsRevision reports whether the section is a revision channel: tied to a channel or carrying a video.
func (s *TaskSection) IsRevision() bool {
	return s.ChannelId != "" || s.VideoFileId != ""
}

func (s *TaskSection) PreSave() {
	if s.Id == "" {
		s.Id = NewId()
	}
	s.Name = strings.TrimSpace(s.Name)
	s.CreateAt = GetMillis()
	s.UpdateAt = s.CreateAt
}

func (s *TaskSection) PreUpdate() {
	s.Name = strings.TrimSpace(s.Name)
	s.UpdateAt = GetMillis()
}

func (s *TaskSection) Patch(p *TaskSectionPatch) {
	if p.Name != nil {
		s.Name = *p.Name
	}
	if p.SortOrder != nil {
		s.SortOrder = *p.SortOrder
	}
}

func (s *TaskSection) IsValid() *AppError {
	if !IsValidId(s.Id) {
		return NewAppError("TaskSection.IsValid", "model.task_section.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(s.TeamId) {
		return NewAppError("TaskSection.IsValid", "model.task_section.is_valid.team_id.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	if s.Name == "" || utf8.RuneCountInString(s.Name) > TaskSectionNameMaxRunes {
		return NewAppError("TaskSection.IsValid", "model.task_section.is_valid.name.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	if s.CreateAt == 0 || s.UpdateAt == 0 {
		return NewAppError("TaskSection.IsValid", "model.task_section.is_valid.create_at.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	return nil
}
