// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

const (
	TaskStageNameMaxRunes = 64

	TaskStageNotStarted = "not_started"
	TaskStageInProgress = "in_progress"
	TaskStageDone       = "done"
)

// TaskStage is a named step of a section's (episode's) production. Stages run in SortOrder; each lists the section's
// tasks that make it up. Status and Current are derived from those tasks when read, never stored.
type TaskStage struct {
	Id        string      `json:"id"`
	TeamId    string      `json:"team_id"`
	SectionId string      `json:"section_id"` // set on create only
	Name      string      `json:"name"`
	SortOrder int64       `json:"sort_order"`
	TaskIds   StringArray `json:"task_ids"`
	CreateAt  int64       `json:"create_at"`
	UpdateAt  int64       `json:"update_at"`

	Status  string `json:"status" db:"-"`  // TaskStage*: not_started, in_progress or done
	Current bool   `json:"current" db:"-"` // the first stage of its section that is not done
}

type TaskStagePatch struct {
	Name      *string      `json:"name"`
	SortOrder *int64       `json:"sort_order"`
	TaskIds   *StringArray `json:"task_ids"`
}

func (s *TaskStage) Auditable() map[string]any {
	return map[string]any{
		"id":         s.Id,
		"team_id":    s.TeamId,
		"section_id": s.SectionId,
	}
}

func (s *TaskStage) PreSave() {
	if s.Id == "" {
		s.Id = NewId()
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.TaskIds == nil {
		s.TaskIds = StringArray{}
	}
	s.CreateAt = GetMillis()
	s.UpdateAt = s.CreateAt
	if s.SortOrder == 0 {
		// New stages go to the end of their section.
		s.SortOrder = s.CreateAt
	}
}

func (s *TaskStage) PreUpdate() {
	s.Name = strings.TrimSpace(s.Name)
	if s.TaskIds == nil {
		s.TaskIds = StringArray{}
	}
	s.UpdateAt = GetMillis()
}

func (s *TaskStage) Patch(p *TaskStagePatch) {
	if p.Name != nil {
		s.Name = *p.Name
	}
	if p.SortOrder != nil {
		s.SortOrder = *p.SortOrder
	}
	if p.TaskIds != nil {
		s.TaskIds = *p.TaskIds
	}
}

func (s *TaskStage) IsValid() *AppError {
	if !IsValidId(s.Id) {
		return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(s.TeamId) {
		return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.team_id.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	if !IsValidId(s.SectionId) {
		return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.section_id.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	if s.Name == "" || utf8.RuneCountInString(s.Name) > TaskStageNameMaxRunes {
		return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.name.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	for _, id := range s.TaskIds {
		if !IsValidId(id) {
			return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.task_ids.app_error", nil, "id="+s.Id, http.StatusBadRequest)
		}
	}
	if s.CreateAt == 0 || s.UpdateAt == 0 {
		return NewAppError("TaskStage.IsValid", "model.task_stage.is_valid.create_at.app_error", nil, "id="+s.Id, http.StatusBadRequest)
	}
	return nil
}

// TaskStageStatus derives a stage's status from its tasks: done once every task is complete, not started while none
// has left to-do, in progress otherwise. A stage without tasks has not started. Ids missing from byID are skipped.
func TaskStageStatus(stage *TaskStage, byID map[string]*Task) string {
	total, complete, started := 0, 0, 0
	for _, id := range stage.TaskIds {
		task := byID[id]
		if task == nil {
			continue
		}
		total++
		if task.IsComplete() {
			complete++
		}
		if task.Status != TaskStatusTodo {
			started++
		}
	}
	switch {
	case total > 0 && complete == total:
		return TaskStageDone
	case started == 0:
		return TaskStageNotStarted
	default:
		return TaskStageInProgress
	}
}

// DeriveTaskStages fills Status and Current on stages, which must be one section's stages in order.
func DeriveTaskStages(stages []*TaskStage, byID map[string]*Task) {
	current := false
	for _, stage := range stages {
		stage.Status = TaskStageStatus(stage, byID)
		stage.Current = !current && stage.Status != TaskStageDone
		current = current || stage.Current
	}
}

// TaskSchedule is the timing of a section's ordinary tasks, kept for later planning. Weight is a task's span,
// DueAt - StartAt, in milliseconds; a task without both dates has no weight and is listed in MissingDates.
// FirstTaskId has the earliest StartAt and LastTaskId the latest DueAt; "" when no task has that date.
type TaskSchedule struct {
	SectionId    string           `json:"section_id"`
	Weights      map[string]int64 `json:"weights"`
	MissingDates []string         `json:"missing_dates"`
	FirstTaskId  string           `json:"first_task_id"`
	LastTaskId   string           `json:"last_task_id"`
}

// NewTaskSchedule computes the schedule of the section's ordinary tasks among tasks; revisions are left out.
func NewTaskSchedule(sectionID string, tasks []*Task) *TaskSchedule {
	schedule := &TaskSchedule{SectionId: sectionID, Weights: map[string]int64{}, MissingDates: []string{}}
	var first, last *Task
	for _, task := range tasks {
		if task.SectionId != sectionID || task.VideoFileId != "" {
			continue
		}
		if task.StartAt > 0 && task.DueAt > 0 {
			schedule.Weights[task.Id] = task.DueAt - task.StartAt
		} else {
			schedule.MissingDates = append(schedule.MissingDates, task.Id)
		}
		if task.StartAt > 0 && (first == nil || task.StartAt < first.StartAt) {
			first = task
		}
		if task.DueAt > 0 && (last == nil || task.DueAt > last.DueAt) {
			last = task
		}
	}
	if first != nil {
		schedule.FirstTaskId = first.Id
	}
	if last != nil {
		schedule.LastTaskId = last.Id
	}
	return schedule
}
