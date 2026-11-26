// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

func (a *App) GetTaskStage(stageID string) (*model.TaskStage, *model.AppError) {
	stage, err := a.Srv().Store().Task().GetStage(stageID)
	if err != nil {
		return nil, taskStoreError("GetTaskStage", stageID, err)
	}
	return stage, nil
}

// GetTaskStagesForTeam returns the team's stages, each section's in order, with Status and Current derived from the
// tasks they list.
func (a *App) GetTaskStagesForTeam(teamID string) ([]*model.TaskStage, *model.AppError) {
	if appErr := a.RequireTasksEnabled(teamID); appErr != nil {
		return nil, appErr
	}
	stages, err := a.Srv().Store().Task().GetStagesForTeam(teamID)
	if err != nil {
		return nil, taskStoreError("GetTaskStagesForTeam", teamID, err)
	}
	tasks, appErr := a.GetTasksForTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	deriveTeamTaskStages(stages, tasksByID(tasks))
	return stages, nil
}

// deriveTeamTaskStages derives each section's run of stages; the store orders them by section, then SortOrder.
func deriveTeamTaskStages(stages []*model.TaskStage, byID map[string]*model.Task) {
	for start := 0; start < len(stages); {
		end := start + 1
		for end < len(stages) && stages[end].SectionId == stages[start].SectionId {
			end++
		}
		model.DeriveTaskStages(stages[start:end], byID)
		start = end
	}
}

// derivedTaskStage returns the stage as the team listing shows it, so Current reflects its section's other stages.
func (a *App) derivedTaskStage(stage *model.TaskStage) *model.TaskStage {
	stages, appErr := a.GetTaskStagesForTeam(stage.TeamId)
	if appErr == nil {
		for _, s := range stages {
			if s.Id == stage.Id {
				return s
			}
		}
	}
	return stage
}

func invalidTaskStageTasksError(stageID string) *model.AppError {
	return model.NewAppError("validateTaskStageTasks", "app.task_stage.invalid_tasks.app_error", nil, "id="+stageID, http.StatusBadRequest)
}

// validateTaskStageTasks keeps a stage's tasks to ordinary tasks of its own section, once each, and in no other stage
// of that section.
func (a *App) validateTaskStageTasks(stage *model.TaskStage) *model.AppError {
	if len(stage.TaskIds) == 0 {
		return nil
	}
	tasks, appErr := a.GetTasksForTeam(stage.TeamId)
	if appErr != nil {
		return appErr
	}
	stages, err := a.Srv().Store().Task().GetStagesForTeam(stage.TeamId)
	if err != nil {
		return taskStoreError("validateTaskStageTasks", stage.TeamId, err)
	}
	taken := map[string]bool{}
	for _, other := range stages {
		if other.Id != stage.Id && other.SectionId == stage.SectionId {
			for _, id := range other.TaskIds {
				taken[id] = true
			}
		}
	}
	byID := tasksByID(tasks)
	seen := map[string]bool{}
	for _, id := range stage.TaskIds {
		task := byID[id]
		if task == nil || task.SectionId != stage.SectionId || task.VideoFileId != "" || seen[id] || taken[id] {
			return invalidTaskStageTasksError(stage.Id)
		}
		seen[id] = true
	}
	return nil
}

func (a *App) CreateTaskStage(rctx request.CTX, stage *model.TaskStage, connectionID string) (*model.TaskStage, *model.AppError) {
	if appErr := a.RequireTasksEnabled(stage.TeamId); appErr != nil {
		return nil, appErr
	}
	section, err := a.Srv().Store().Task().GetSection(stage.SectionId)
	if err != nil || section.TeamId != stage.TeamId {
		return nil, model.NewAppError("CreateTaskStage", "app.task_stage.invalid_section.app_error", nil, "section_id="+stage.SectionId, http.StatusBadRequest)
	}
	if appErr := a.validateTaskStageTasks(stage); appErr != nil {
		return nil, appErr
	}
	saved, err := a.Srv().Store().Task().SaveStage(stage)
	if err != nil {
		return nil, taskStoreError("CreateTaskStage", stage.Id, err)
	}
	saved = a.derivedTaskStage(saved)
	a.publishTaskEvent(rctx, model.WebsocketTaskStageUpserted, saved.TeamId, "stage", saved, connectionID)
	return saved, nil
}

func (a *App) PatchTaskStage(rctx request.CTX, stage *model.TaskStage, patch *model.TaskStagePatch, connectionID string) (*model.TaskStage, *model.AppError) {
	if appErr := a.RequireTasksEnabled(stage.TeamId); appErr != nil {
		return nil, appErr
	}
	patched := *stage
	patched.Patch(patch)
	if patch.TaskIds != nil {
		if appErr := a.validateTaskStageTasks(&patched); appErr != nil {
			return nil, appErr
		}
	}
	updated, err := a.Srv().Store().Task().UpdateStage(&patched)
	if err != nil {
		return nil, taskStoreError("PatchTaskStage", stage.Id, err)
	}
	updated = a.derivedTaskStage(updated)
	a.publishTaskEvent(rctx, model.WebsocketTaskStageUpserted, updated.TeamId, "stage", updated, connectionID)
	return updated, nil
}

func (a *App) DeleteTaskStage(rctx request.CTX, stage *model.TaskStage, connectionID string) *model.AppError {
	if appErr := a.RequireTasksEnabled(stage.TeamId); appErr != nil {
		return appErr
	}
	if err := a.Srv().Store().Task().DeleteStage(stage.Id); err != nil {
		return taskStoreError("DeleteTaskStage", stage.Id, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketTaskStageDeleted, stage.TeamId, "stage_id", stage.Id, connectionID)
	return nil
}

// unlinkTaskFromStages drops a task that left sectionID (moved or deleted) from that section's stages.
func (a *App) unlinkTaskFromStages(rctx request.CTX, teamID, sectionID, taskID, connectionID string) *model.AppError {
	if sectionID == "" {
		return nil
	}
	stages, err := a.Srv().Store().Task().GetStagesForTeam(teamID)
	if err != nil {
		return taskStoreError("unlinkTaskFromStages", teamID, err)
	}
	for _, stage := range stages {
		if stage.SectionId != sectionID || !slices.Contains(stage.TaskIds, taskID) {
			continue
		}
		stage.TaskIds = slices.DeleteFunc(slices.Clone(stage.TaskIds), func(id string) bool { return id == taskID })
		saved, err := a.Srv().Store().Task().UpdateStage(stage)
		if err != nil {
			return taskStoreError("unlinkTaskFromStages", stage.Id, err)
		}
		a.publishTaskEvent(rctx, model.WebsocketTaskStageUpserted, saved.TeamId, "stage", a.derivedTaskStage(saved), connectionID)
	}
	return nil
}

// GetTaskSchedule returns the weights and first and last tasks of the section's ordinary tasks, computed from their
// current dates.
func (a *App) GetTaskSchedule(section *model.TaskSection) (*model.TaskSchedule, *model.AppError) {
	tasks, appErr := a.GetTasksForTeam(section.TeamId)
	if appErr != nil {
		return nil, appErr
	}
	return model.NewTaskSchedule(section.Id, tasks), nil
}
