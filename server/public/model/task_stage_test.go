// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDeriveTaskStages(t *testing.T) {
	todo := &Task{Id: NewId(), Status: TaskStatusTodo}
	doing := &Task{Id: NewId(), Status: TaskStatusInProgress}
	pending := &Task{Id: NewId(), Status: TaskStatusDone, ApprovalStatus: TaskApprovalPendingDirector}
	done := &Task{Id: NewId(), Status: TaskStatusDone, ApprovalStatus: TaskApprovalApproved}
	byID := map[string]*Task{todo.Id: todo, doing.Id: doing, pending.Id: pending, done.Id: done}

	for name, tc := range map[string]struct {
		ids  []string
		want string
	}{
		"empty":                      {nil, TaskStageNotStarted},
		"all to do":                  {[]string{todo.Id}, TaskStageNotStarted},
		"unknown ids skipped":        {[]string{NewId()}, TaskStageNotStarted},
		"one started":                {[]string{todo.Id, doing.Id}, TaskStageInProgress},
		"done awaiting approval":     {[]string{pending.Id}, TaskStageInProgress},
		"some complete":              {[]string{todo.Id, done.Id}, TaskStageInProgress},
		"all complete":               {[]string{done.Id}, TaskStageDone},
		"complete plus unknown task": {[]string{done.Id, NewId()}, TaskStageDone},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tc.want, TaskStageStatus(&TaskStage{TaskIds: tc.ids}, byID))
		})
	}

	stages := []*TaskStage{{TaskIds: StringArray{done.Id}}, {TaskIds: StringArray{doing.Id}}, {TaskIds: StringArray{todo.Id}}}
	DeriveTaskStages(stages, byID)
	require.Equal(t, []bool{false, true, false}, []bool{stages[0].Current, stages[1].Current, stages[2].Current})

	finished := []*TaskStage{{TaskIds: StringArray{done.Id}}}
	DeriveTaskStages(finished, byID)
	require.False(t, finished[0].Current, "no stage is current once all are done")
}

func TestNewTaskSchedule(t *testing.T) {
	section := NewId()
	early := &Task{Id: NewId(), SectionId: section, StartAt: 100, DueAt: 500}
	late := &Task{Id: NewId(), SectionId: section, StartAt: 200, DueAt: 900}
	noStart := &Task{Id: NewId(), SectionId: section, DueAt: 1000}
	noDates := &Task{Id: NewId(), SectionId: section}
	revision := &Task{Id: NewId(), SectionId: section, VideoFileId: NewId(), StartAt: 1, DueAt: 5000}
	elsewhere := &Task{Id: NewId(), SectionId: NewId(), StartAt: 1, DueAt: 5000}

	schedule := NewTaskSchedule(section, []*Task{early, late, noStart, noDates, revision, elsewhere})
	require.Equal(t, map[string]int64{early.Id: 400, late.Id: 700}, schedule.Weights)
	require.ElementsMatch(t, []string{noStart.Id, noDates.Id}, schedule.MissingDates)
	require.Equal(t, early.Id, schedule.FirstTaskId)
	require.Equal(t, noStart.Id, schedule.LastTaskId, "the latest due date counts even without a start date")

	empty := NewTaskSchedule(section, nil)
	require.Empty(t, empty.FirstTaskId)
	require.Empty(t, empty.LastTaskId)
	require.NotNil(t, empty.MissingDates)
}
