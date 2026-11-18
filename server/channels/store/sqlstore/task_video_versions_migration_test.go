// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// TestTaskVideoVersionsBackfill re-runs 000255 over a revision section that predates it: the section's
// video becomes version 1, and only the task with a revision card in the channel becomes a revision.
func TestTaskVideoVersionsBackfill(t *testing.T) {
	logger := mlog.CreateTestLogger(t)

	settings, err := makeSqlSettings(model.DatabaseDriverPostgres)
	if err != nil {
		t.Skip(err)
	}

	store, err := New(*settings, logger, nil)
	require.NoError(t, err)
	defer store.Close()
	rctx := request.TestContext(t)

	creatorId := model.NewId()
	file, err := store.FileInfo().Save(rctx, &model.FileInfo{Id: model.NewId(), CreatorId: creatorId, Path: "videos/ep1.mp4", Name: "ep1.mp4", CreateAt: 1000, UpdateAt: 1000})
	require.NoError(t, err)

	teamId := model.NewId()
	channelId := model.NewId()
	section, err := store.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Ep 1", ChannelId: channelId, VideoFileId: file.Id})
	require.NoError(t, err)
	taskA, err := store.Task().Save(&model.Task{TeamId: teamId, SectionId: section.Id, CreatorId: creatorId, Title: "A"})
	require.NoError(t, err)
	taskB, err := store.Task().Save(&model.Task{TeamId: teamId, SectionId: section.Id, CreatorId: creatorId, Title: "B"})
	require.NoError(t, err)
	_, err = store.Post().Save(rctx, &model.Post{ChannelId: channelId, UserId: creatorId, Type: model.PostTypeRevision, Props: model.StringInterface{"task_id": taskA.Id}})
	require.NoError(t, err)

	up := readMigrationSQL(t, "000255_task_video_versions.up.sql")
	for range 2 {
		_, err = store.GetMaster().ExecNoTimeout(up)
		require.NoError(t, err)
	}

	videos, err := store.Task().GetSectionVideos(section.Id)
	require.NoError(t, err)
	require.Len(t, videos, 1)
	require.Equal(t, 1, videos[0].Version)
	require.Equal(t, file.Id, videos[0].FileId)
	require.Equal(t, creatorId, videos[0].CreatorId)
	require.Equal(t, int64(1000), videos[0].CreateAt)

	got, err := store.Task().Get(taskA.Id)
	require.NoError(t, err)
	require.Equal(t, file.Id, got.VideoFileId)
	got, err = store.Task().Get(taskB.Id)
	require.NoError(t, err)
	require.Empty(t, got.VideoFileId)
}
