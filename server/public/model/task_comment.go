// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

const (
	TaskCommentMessageMaxRunes = 16000
	TaskCommentMaxFiles        = 10
)

// TaskComment is a note on a task, optionally with attached files. Files is filled in on reads and is not stored.
type TaskComment struct {
	Id       string      `json:"id"`
	TaskId   string      `json:"task_id"`
	UserId   string      `json:"user_id"`
	Message  string      `json:"message"`
	FileIds  StringArray `json:"file_ids"`
	CreateAt int64       `json:"create_at"`
	Files    []*FileInfo `json:"files,omitempty" db:"-"`
}

func (c *TaskComment) Auditable() map[string]any {
	return map[string]any{
		"id":       c.Id,
		"task_id":  c.TaskId,
		"user_id":  c.UserId,
		"file_ids": c.FileIds,
	}
}

func (c *TaskComment) PreSave() {
	if c.Id == "" {
		c.Id = NewId()
	}
	if c.FileIds == nil {
		c.FileIds = StringArray{}
	}
	c.Message = strings.TrimSpace(c.Message)
	c.CreateAt = GetMillis()
}

// ValidateTaskCommentContent checks what the user wrote and attached. It runs before files are uploaded, so a rejected comment leaves no files behind.
func ValidateTaskCommentContent(message string, fileCount int) *AppError {
	if strings.TrimSpace(message) == "" && fileCount == 0 {
		return NewAppError("ValidateTaskCommentContent", "model.task_comment.is_valid.empty.app_error", nil, "", http.StatusBadRequest)
	}
	if utf8.RuneCountInString(message) > TaskCommentMessageMaxRunes {
		return NewAppError("ValidateTaskCommentContent", "model.task_comment.is_valid.message.app_error", nil, "", http.StatusBadRequest)
	}
	if fileCount > TaskCommentMaxFiles {
		return NewAppError("ValidateTaskCommentContent", "model.task_comment.is_valid.files.app_error", map[string]any{"Max": TaskCommentMaxFiles}, "", http.StatusBadRequest)
	}
	return nil
}

func (c *TaskComment) IsValid() *AppError {
	if !IsValidId(c.Id) || !IsValidId(c.TaskId) || !IsValidId(c.UserId) || c.CreateAt == 0 {
		return NewAppError("TaskComment.IsValid", "model.task_comment.is_valid.app_error", nil, "id="+c.Id, http.StatusBadRequest)
	}
	for _, id := range c.FileIds {
		if !IsValidId(id) {
			return NewAppError("TaskComment.IsValid", "model.task_comment.is_valid.app_error", nil, "id="+c.Id, http.StatusBadRequest)
		}
	}
	return ValidateTaskCommentContent(c.Message, len(c.FileIds))
}
