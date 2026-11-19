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
	t.Run("SectionVideos", func(t *testing.T) { testTaskStoreSectionVideos(t, ss) })
	t.Run("DeleteSectionClearsVersions", func(t *testing.T) { testTaskStoreDeleteSectionClearsVersions(t, ss) })
	t.Run("SaveKeepsVideoFileId", func(t *testing.T) { testTaskStoreSaveKeepsVideoFileId(t, ss) })
	t.Run("GetSectionByChannel", func(t *testing.T) { testTaskStoreGetSectionByChannel(t, ss) })
	t.Run("RuleFields", func(t *testing.T) { testTaskRuleFields(t, ss) })
	t.Run("GetPostIdsForTask", func(t *testing.T) { testTaskStoreGetPostIdsForTask(t, rctx, ss) })
}

func testTaskStoreGetSectionByChannel(t *testing.T, ss store.Store) {
	channelId := model.NewId()
	section, err := ss.Task().SaveSection(&model.TaskSection{TeamId: model.NewId(), Name: "Episode", ChannelId: channelId})
	require.NoError(t, err)

	got, err := ss.Task().GetSectionByChannel(channelId)
	require.NoError(t, err)
	require.Equal(t, section.Id, got.Id)

	_, err = ss.Task().GetSectionByChannel(model.NewId())
	var nfErr *store.ErrNotFound
	require.True(t, errors.As(err, &nfErr))
}

func testTaskStoreGetPostIdsForTask(t *testing.T, rctx request.CTX, ss store.Store) {
	taskA, taskB := model.NewId(), model.NewId()
	// Channel C is real: a reply's thread bookkeeping reads its channel row.
	channel, err := ss.Channel().Save(rctx, &model.Channel{TeamId: model.NewId(), Name: "c-" + model.NewId(), DisplayName: "C", Type: model.ChannelTypeOpen}, 1000)
	require.NoError(t, err)
	channelC, channelD := channel.Id, model.NewId()
	userId := model.NewId()
	save := func(channelId, taskId, rootId string, createAt, deleteAt int64) *model.Post {
		post, err := ss.Post().Save(rctx, &model.Post{ChannelId: channelId, UserId: userId, RootId: rootId, Message: "m", CreateAt: createAt, DeleteAt: deleteAt, Props: model.StringInterface{"task_id": taskId}})
		require.NoError(t, err)
		return post
	}
	c1 := save(channelC, taskA, "", 1000, 0)
	c2 := save(channelC, taskA, "", 2000, 0)
	c3 := save(channelC, taskA, "", 3000, 0)
	save(channelC, taskA, c1.Id, 3500, 0)
	d1 := save(channelD, taskA, "", 4000, 0)
	save(channelC, taskA, "", 5000, 6000)
	save(channelC, taskB, "", 7000, 0)

	ids, err := ss.Task().GetPostIdsForTask(taskA, "", 0, 10)
	require.NoError(t, err)
	require.Equal(t, []string{d1.Id, c3.Id, c2.Id, c1.Id}, ids)

	ids, err = ss.Task().GetPostIdsForTask(taskA, channelC, 0, 10)
	require.NoError(t, err)
	require.Equal(t, []string{c3.Id, c2.Id, c1.Id}, ids)

	ids, err = ss.Task().GetPostIdsForTask(taskA, "", 0, 2)
	require.NoError(t, err)
	require.Equal(t, []string{d1.Id, c3.Id}, ids)

	ids, err = ss.Task().GetPostIdsForTask(taskA, "", c3.CreateAt, 10)
	require.NoError(t, err)
	require.Equal(t, []string{c2.Id, c1.Id}, ids)
}

func testTaskStoreSectionVideos(t *testing.T, ss store.Store) {
	sectionId := model.NewId()
	var fileIds []string
	for i := 1; i <= 3; i++ {
		fileId := model.NewId()
		fileIds = append(fileIds, fileId)
		saved, err := ss.Task().SaveSectionVideo(&model.TaskSectionVideo{SectionId: sectionId, FileId: fileId, CreatorId: model.NewId()})
		require.NoError(t, err)
		require.Equal(t, i, saved.Version)
		require.NotEmpty(t, saved.Id)
	}

	videos, err := ss.Task().GetSectionVideos(sectionId)
	require.NoError(t, err)
	require.Len(t, videos, 3)
	for i, v := range videos {
		require.Equal(t, i+1, v.Version)
		require.Equal(t, fileIds[i], v.FileId)
		require.Nil(t, v.File)
	}

	other, err := ss.Task().SaveSectionVideo(&model.TaskSectionVideo{SectionId: model.NewId(), FileId: model.NewId(), CreatorId: model.NewId()})
	require.NoError(t, err)
	require.Equal(t, 1, other.Version)
}

func testTaskStoreDeleteSectionClearsVersions(t *testing.T, ss store.Store) {
	teamId := model.NewId()
	fileId := model.NewId()
	section, err := ss.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Episode", ChannelId: model.NewId(), VideoFileId: fileId})
	require.NoError(t, err)
	_, err = ss.Task().SaveSectionVideo(&model.TaskSectionVideo{SectionId: section.Id, FileId: fileId, CreatorId: model.NewId()})
	require.NoError(t, err)
	task, err := ss.Task().Save(&model.Task{TeamId: teamId, SectionId: section.Id, CreatorId: model.NewId(), Title: "revision", VideoFileId: fileId})
	require.NoError(t, err)

	require.NoError(t, ss.Task().DeleteSection(section.Id))

	videos, err := ss.Task().GetSectionVideos(section.Id)
	require.NoError(t, err)
	require.Empty(t, videos)
	got, err := ss.Task().Get(task.Id)
	require.NoError(t, err)
	require.Empty(t, got.VideoFileId)
	require.Empty(t, got.SectionId)
}

func testTaskStoreSaveKeepsVideoFileId(t *testing.T, ss store.Store) {
	fileId := model.NewId()
	task, err := ss.Task().Save(&model.Task{TeamId: model.NewId(), CreatorId: model.NewId(), Title: "revision", VideoFileId: fileId})
	require.NoError(t, err)

	got, err := ss.Task().Get(task.Id)
	require.NoError(t, err)
	require.Equal(t, fileId, got.VideoFileId)

	got.VideoFileId = model.NewId()
	_, err = ss.Task().Update(got)
	require.NoError(t, err)
	got, err = ss.Task().Get(task.Id)
	require.NoError(t, err)
	require.Equal(t, fileId, got.VideoFileId, "Update must not change VideoFileId")
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

func testTaskRuleFields(t *testing.T, ss store.Store) {
	deptId, folderId := model.NewId(), model.NewId()
	waits := model.StringArray{model.NewId(), model.NewId()}
	saved, err := ss.Task().Save(&model.Task{TeamId: model.NewId(), CreatorId: model.NewId(), Title: "ruled", DepartmentId: deptId, WaitsFor: waits, FolderId: folderId})
	require.NoError(t, err)

	got, err := ss.Task().Get(saved.Id)
	require.NoError(t, err)
	require.Equal(t, deptId, got.DepartmentId)
	require.Equal(t, waits, got.WaitsFor)
	require.Equal(t, folderId, got.FolderId)

	got.WaitsFor = model.StringArray{}
	_, err = ss.Task().Update(got)
	require.NoError(t, err)
	got, err = ss.Task().Get(saved.Id)
	require.NoError(t, err)
	require.Equal(t, model.StringArray{}, got.WaitsFor)
	require.Equal(t, folderId, got.FolderId, "Update must not change FolderId")

	plain, err := ss.Task().Save(&model.Task{TeamId: model.NewId(), CreatorId: model.NewId(), Title: "plain"})
	require.NoError(t, err)
	got, err = ss.Task().Get(plain.Id)
	require.NoError(t, err)
	require.Empty(t, got.DepartmentId)
	require.Equal(t, model.StringArray{}, got.WaitsFor)
	require.Empty(t, got.FolderId)
}
