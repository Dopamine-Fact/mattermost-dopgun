// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestTaskStages(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamId := th.BasicTeam.Id
	admin := th.SystemAdminClient

	_, _, err := admin.PatchTeam(ctx, teamId, &model.TeamPatch{TasksEnabled: new(true)})
	require.NoError(t, err)

	section, _, err := admin.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Episode 1"})
	require.NoError(t, err)
	otherSection, _, err := admin.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Episode 2"})
	require.NoError(t, err)
	newTask := func(title, sectionID string) *model.Task {
		task, _, err := admin.CreateTask(ctx, &model.Task{TeamId: teamId, Title: title, SectionId: sectionID})
		require.NoError(t, err)
		return task
	}
	layout, animation, foreign := newTask("Layout", section.Id), newTask("Animation", section.Id), newTask("Other", otherSection.Id)

	stageByID := func(id string) *model.TaskStage {
		stages, _, err := th.Client.GetTeamTaskStages(ctx, teamId)
		require.NoError(t, err)
		for _, s := range stages {
			if s.Id == id {
				return s
			}
		}
		return nil
	}

	t.Run("members without manage_tasks only read", func(t *testing.T) {
		_, resp, err := th.Client.CreateTaskStage(ctx, &model.TaskStage{TeamId: teamId, SectionId: section.Id, Name: "x"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, _, err = th.Client.GetTeamTaskStages(ctx, teamId)
		require.NoError(t, err)
	})

	first, _, err := admin.CreateTaskStage(ctx, &model.TaskStage{TeamId: teamId, SectionId: section.Id, Name: "Layout", TaskIds: model.StringArray{layout.Id}})
	require.NoError(t, err)
	second, _, err := admin.CreateTaskStage(ctx, &model.TaskStage{TeamId: teamId, SectionId: section.Id, Name: "Animation", TaskIds: model.StringArray{animation.Id}})
	require.NoError(t, err)
	require.Less(t, first.SortOrder, second.SortOrder, "new stages go last")
	require.Equal(t, model.TaskStageNotStarted, first.Status)
	require.True(t, first.Current)

	t.Run("links stay inside the section and in one stage", func(t *testing.T) {
		for _, ids := range []model.StringArray{{foreign.Id}, {layout.Id}, {animation.Id, animation.Id}, {model.NewId()}} {
			_, resp, err := admin.PatchTaskStage(ctx, second.Id, &model.TaskStagePatch{TaskIds: &ids})
			require.Error(t, err)
			CheckBadRequestStatus(t, resp)
		}
		_, resp, err := admin.CreateTaskStage(ctx, &model.TaskStage{TeamId: teamId, SectionId: model.NewId(), Name: "x"})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("status follows the tasks and the next stage becomes current", func(t *testing.T) {
		_, _, err := th.Client.PatchTask(ctx, layout.Id, &model.TaskPatch{Status: new(model.TaskStatusInProgress)})
		require.NoError(t, err)
		require.Equal(t, model.TaskStageInProgress, stageByID(first.Id).Status)

		_, _, err = th.Client.PatchTask(ctx, layout.Id, &model.TaskPatch{Status: new(model.TaskStatusDone)})
		require.NoError(t, err)
		got := stageByID(first.Id)
		require.Equal(t, model.TaskStageDone, got.Status)
		require.False(t, got.Current)
		require.True(t, stageByID(second.Id).Current)
	})

	t.Run("rename, reorder and permissions on a stage", func(t *testing.T) {
		_, resp, err := th.Client.PatchTaskStage(ctx, second.Id, &model.TaskStagePatch{Name: new("x")})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteTaskStage(ctx, second.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		patched, _, err := admin.PatchTaskStage(ctx, second.Id, &model.TaskStagePatch{Name: new("Anim"), SortOrder: new(int64(1))})
		require.NoError(t, err)
		require.Equal(t, "Anim", patched.Name)
		require.True(t, patched.Current, "moved first and not done")
		require.False(t, stageByID(first.Id).Current)
	})

	t.Run("a task that leaves the section leaves its stage", func(t *testing.T) {
		_, _, err := admin.PatchTask(ctx, animation.Id, &model.TaskPatch{SectionId: &otherSection.Id})
		require.NoError(t, err)
		require.Empty(t, stageByID(second.Id).TaskIds)

		_, err = admin.DeleteTask(ctx, layout.Id)
		require.NoError(t, err)
		require.Empty(t, stageByID(first.Id).TaskIds)
	})

	t.Run("schedule", func(t *testing.T) {
		dated := newTask("Dated", section.Id)
		_, _, err := admin.PatchTask(ctx, dated.Id, &model.TaskPatch{StartAt: new(int64(1000)), DueAt: new(int64(5000))})
		require.NoError(t, err)
		undated := newTask("Undated", section.Id)

		schedule, _, err := th.Client.GetTaskSchedule(ctx, section.Id)
		require.NoError(t, err)
		require.Equal(t, map[string]int64{dated.Id: 4000}, schedule.Weights)
		require.Equal(t, []string{undated.Id}, schedule.MissingDates)
		require.Equal(t, dated.Id, schedule.FirstTaskId)
		require.Equal(t, dated.Id, schedule.LastTaskId)
	})

	t.Run("deleting a stage or its section removes it", func(t *testing.T) {
		_, err := admin.DeleteTaskStage(ctx, first.Id)
		require.NoError(t, err)
		require.Nil(t, stageByID(first.Id))

		_, err = admin.DeleteTaskSection(ctx, section.Id)
		require.NoError(t, err)
		require.Nil(t, stageByID(second.Id))
	})
}
