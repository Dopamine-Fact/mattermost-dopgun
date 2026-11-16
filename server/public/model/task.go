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
	Id          string  `json:"id"`
	TeamId      string  `json:"team_id"`
	SectionId   string  `json:"section_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	AssigneeId  string  `json:"assignee_id"`
	StartAt     int64   `json:"start_at"`
	DueAt       int64   `json:"due_at"`
	Status      string  `json:"status"`
	SortOrder   float64 `json:"sort_order"`
	VideoTime   int64   `json:"video_time"` // ms into the section's video, for revisions
	CreatorId   string  `json:"creator_id"`
	CreateAt    int64   `json:"create_at"`
	UpdateAt    int64   `json:"update_at"`
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

type TaskSectionPatch struct {
	Name      *string `json:"name"`
	SortOrder *int64  `json:"sort_order"`
}

func (t *Task) Auditable() map[string]any {
	return map[string]any{
		"id":          t.Id,
		"team_id":     t.TeamId,
		"section_id":  t.SectionId,
		"assignee_id": t.AssigneeId,
		"status":      t.Status,
	}
}

func (t *Task) PreSave() {
	if t.Id == "" {
		t.Id = NewId()
	}
	t.Title = strings.TrimSpace(t.Title)
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
