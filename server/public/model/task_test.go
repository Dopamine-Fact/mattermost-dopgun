// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTaskIsValid(t *testing.T) {
	valid := func() *Task {
		task := &Task{TeamId: NewId(), CreatorId: NewId(), Title: "  write docs  "}
		task.PreSave()
		return task
	}

	require.Nil(t, valid().IsValid())
	require.Equal(t, "write docs", valid().Title)
	require.Equal(t, TaskStatusTodo, valid().Status)
	require.Equal(t, float64(valid().CreateAt), valid().SortOrder, "new tasks go to the bottom")

	for name, mutate := range map[string]func(*Task){
		"empty title":      func(t *Task) { t.Title = "" },
		"long title":       func(t *Task) { t.Title = strings.Repeat("a", TaskTitleMaxRunes+1) },
		"long description": func(t *Task) { t.Description = strings.Repeat("a", TaskDescriptionMaxRunes+1) },
		"bad team":         func(t *Task) { t.TeamId = "x" },
		"bad creator":      func(t *Task) { t.CreatorId = "" },
		"bad section":      func(t *Task) { t.SectionId = "x" },
		"bad assignee":     func(t *Task) { t.AssigneeId = "x" },
		"negative due":     func(t *Task) { t.DueAt = -1 },
		"unknown status":   func(t *Task) { t.Status = "blocked" },
		"start after due":  func(t *Task) { t.StartAt, t.DueAt = 2, 1 },
	} {
		t.Run(name, func(t *testing.T) {
			task := valid()
			mutate(task)
			require.NotNil(t, task.IsValid())
		})
	}

	task := valid()
	status, sortOrder, assignee := TaskStatusInProgress, 1.5, NewId()
	task.Patch(&TaskPatch{Status: &status, SortOrder: &sortOrder, AssigneeId: &assignee})
	require.Equal(t, TaskStatusInProgress, task.Status)
	require.Equal(t, 1.5, task.SortOrder)
	require.Equal(t, assignee, task.AssigneeId)
	require.Nil(t, task.IsValid())
}

func TestTaskSectionIsValid(t *testing.T) {
	s := &TaskSection{TeamId: NewId(), Name: "Yapılacak"}
	s.PreSave()
	require.Nil(t, s.IsValid())

	s.Name = strings.Repeat("ş", TaskSectionNameMaxRunes+1)
	require.NotNil(t, s.IsValid())
	s.Name = ""
	require.NotNil(t, s.IsValid())
}
