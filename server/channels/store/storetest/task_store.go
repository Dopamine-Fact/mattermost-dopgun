// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestTaskStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("TaskCRUD", func(t *testing.T) { testTaskCRUD(t, ss) })
	t.Run("DeleteSectionUnassignsTasks", func(t *testing.T) { testDeleteTaskSection(t, ss) })
}

func testTaskCRUD(t *testing.T, ss store.Store) {
	teamId := model.NewId()

	saved, err := ss.Task().Save(&model.Task{TeamId: teamId, CreatorId: model.NewId(), Title: "first"})
	require.NoError(t, err)
	_, err = ss.Task().Save(&model.Task{TeamId: model.NewId(), CreatorId: model.NewId(), Title: "other team"})
	require.NoError(t, err)

	_, err = ss.Task().Save(&model.Task{TeamId: teamId, CreatorId: model.NewId(), Title: ""})
	require.Error(t, err)

	got, err := ss.Task().Get(saved.Id)
	require.NoError(t, err)
	require.Equal(t, saved, got)

	got.Status = model.TaskStatusDone
	got.SortOrder = 0.5
	got.AssigneeId = model.NewId()
	got.StartAt = 1000
	got.DueAt = 1234
	_, err = ss.Task().Update(got)
	require.NoError(t, err)

	list, err := ss.Task().GetForTeam(teamId)
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, model.TaskStatusDone, list[0].Status)
	require.Equal(t, 0.5, list[0].SortOrder)
	require.Equal(t, int64(1000), list[0].StartAt)
	require.Equal(t, int64(1234), list[0].DueAt)

	require.NoError(t, ss.Task().Delete(saved.Id))
	_, err = ss.Task().Get(saved.Id)
	var nfErr *store.ErrNotFound
	require.True(t, errors.As(err, &nfErr))

	_, err = ss.Task().Update(got)
	require.True(t, errors.As(err, &nfErr))
}

func testDeleteTaskSection(t *testing.T, ss store.Store) {
	teamId := model.NewId()

	section, err := ss.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Todo"})
	require.NoError(t, err)
	_, err = ss.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Done", SortOrder: -1})
	require.NoError(t, err)

	sections, err := ss.Task().GetSectionsForTeam(teamId)
	require.NoError(t, err)
	require.Len(t, sections, 2)
	require.Equal(t, "Done", sections[0].Name, "ordered by SortOrder")

	section.Name = "Renamed"
	_, err = ss.Task().UpdateSection(section)
	require.NoError(t, err)

	task, err := ss.Task().Save(&model.Task{TeamId: teamId, SectionId: section.Id, CreatorId: model.NewId(), Title: "in section"})
	require.NoError(t, err)

	require.NoError(t, ss.Task().DeleteSection(section.Id))

	_, err = ss.Task().GetSection(section.Id)
	var nfErr *store.ErrNotFound
	require.True(t, errors.As(err, &nfErr))

	got, err := ss.Task().Get(task.Id)
	require.NoError(t, err)
	require.Empty(t, got.SectionId)
}
