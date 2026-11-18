// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"crypto/md5"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// TestTaskConversationsMigration re-runs 000256 over comments that predate it: comments of channel-linked tasks become
// posts in the channel, their echo copies are deleted, and a channel-less task keeps its comment.
func TestTaskConversationsMigration(t *testing.T) {
	logger := mlog.CreateTestLogger(t)

	settings, err := makeSqlSettings(model.DatabaseDriverPostgres)
	if err != nil {
		t.Skip(err)
	}

	store, err := New(*settings, logger, nil)
	require.NoError(t, err)
	defer store.Close()
	rctx := request.TestContext(t)

	teamId := model.NewId()
	userId := model.NewId()
	channel, err := store.Channel().Save(rctx, &model.Channel{TeamId: teamId, Name: "ep-" + model.NewId(), DisplayName: "Ep", Type: model.ChannelTypeOpen}, 1000)
	require.NoError(t, err)
	_, err = store.Channel().SaveMember(rctx, &model.ChannelMember{ChannelId: channel.Id, UserId: userId, NotifyProps: model.GetDefaultChannelNotifyProps()})
	require.NoError(t, err)

	linked, err := store.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Ep", ChannelId: channel.Id, VideoFileId: model.NewId()})
	require.NoError(t, err)
	board, err := store.Task().SaveSection(&model.TaskSection{TeamId: teamId, Name: "Board"})
	require.NoError(t, err)
	revision, err := store.Task().Save(&model.Task{TeamId: teamId, SectionId: linked.Id, CreatorId: userId, Title: "R", VideoFileId: linked.VideoFileId})
	require.NoError(t, err)
	ordinary, err := store.Task().Save(&model.Task{TeamId: teamId, SectionId: linked.Id, CreatorId: userId, Title: "T"})
	require.NoError(t, err)
	boardTask, err := store.Task().Save(&model.Task{TeamId: teamId, SectionId: board.Id, CreatorId: userId, Title: "N"})
	require.NoError(t, err)

	file, err := store.FileInfo().Save(rctx, &model.FileInfo{Id: model.NewId(), CreatorId: userId, Path: "tasks/a.png", Name: "a.png", CreateAt: 1000, UpdateAt: 1000})
	require.NoError(t, err)
	comment := func(taskId, message string, createAt int64, fileIds model.StringArray) *model.TaskComment {
		c, err := store.Task().SaveComment(&model.TaskComment{TaskId: taskId, UserId: userId, Message: message, FileIds: fileIds})
		require.NoError(t, err)
		_, err = store.GetMaster().Exec("UPDATE TaskComments SET CreateAt = $1 WHERE Id = $2", createAt, c.Id)
		require.NoError(t, err)
		c.CreateAt = createAt
		return c
	}
	c1 := comment(revision.Id, "first", 1000, model.StringArray{file.Id})
	c2 := comment(revision.Id, "second", 3000, nil)
	c3 := comment(ordinary.Id, "third", 4000, nil)
	c4 := comment(boardTask.Id, "board", 5000, nil)

	link := "http://localhost/team/channels/ep?revision=" + revision.Id
	post := func(message string, createAt int64) *model.Post {
		p, err := store.Post().Save(rctx, &model.Post{ChannelId: channel.Id, UserId: userId, Message: message, CreateAt: createAt})
		require.NoError(t, err)
		return p
	}
	echo1 := post(":speech_balloon: Comment on [R]("+link+"):\nfirst", 1100)
	echo2 := post(":speech_balloon: Comment on [R]("+link+"):\nsecond", 3050)
	pasted := post("see "+link, 20000)

	before, err := store.Channel().Get(channel.Id, false)
	require.NoError(t, err)
	memberBefore, err := store.Channel().GetMember(rctx, channel.Id, userId)
	require.NoError(t, err)

	up := readMigrationSQL(t, "000256_task_conversations.up.sql")
	for range 2 {
		_, err = store.GetMaster().ExecNoTimeout(up)
		require.NoError(t, err)
	}

	for _, c := range []*model.TaskComment{c1, c2, c3} {
		sum := md5.Sum([]byte(c.Id + ":post"))
		got, err := store.Post().GetSingle(rctx, hex.EncodeToString(sum[:])[:26], false)
		require.NoError(t, err, c.Message)
		require.Equal(t, channel.Id, got.ChannelId)
		require.Equal(t, userId, got.UserId)
		require.Equal(t, c.CreateAt, got.CreateAt)
		require.Equal(t, c.Message, got.Message)
		require.Equal(t, c.TaskId, got.GetProp("task_id"))
		require.Empty(t, got.RootId)
		require.Equal(t, []string(c.FileIds), []string(got.FileIds))
	}

	var postCount int
	require.NoError(t, store.GetMaster().Get(&postCount, "SELECT count(*) FROM Posts WHERE ChannelId = $1 AND Props->>'task_id' IS NOT NULL", channel.Id))
	require.Equal(t, 3, postCount)

	movedFile, err := store.FileInfo().Get(file.Id)
	require.NoError(t, err)
	sum := md5.Sum([]byte(c1.Id + ":post"))
	require.Equal(t, hex.EncodeToString(sum[:])[:26], movedFile.PostId)
	require.Equal(t, channel.Id, movedFile.ChannelId)

	deleteAt := func(id string) int64 {
		var v int64
		require.NoError(t, store.GetMaster().Get(&v, "SELECT DeleteAt FROM Posts WHERE Id = $1", id))
		return v
	}
	require.NotZero(t, deleteAt(echo1.Id))
	require.NotZero(t, deleteAt(echo2.Id))
	require.Zero(t, deleteAt(pasted.Id))

	left, err := store.Task().GetCommentsForTask(boardTask.Id)
	require.NoError(t, err)
	require.Len(t, left, 1)
	require.Equal(t, c4.Id, left[0].Id)
	for _, taskId := range []string{revision.Id, ordinary.Id} {
		gone, err := store.Task().GetCommentsForTask(taskId)
		require.NoError(t, err)
		require.Empty(t, gone)
	}

	after, err := store.Channel().Get(channel.Id, false)
	require.NoError(t, err)
	require.Equal(t, before.TotalMsgCount+3, after.TotalMsgCount)
	require.Equal(t, before.TotalMsgCountRoot+3, after.TotalMsgCountRoot)
	memberAfter, err := store.Channel().GetMember(rctx, channel.Id, userId)
	require.NoError(t, err)
	require.Equal(t, memberBefore.MsgCount+3, memberAfter.MsgCount)
	require.Equal(t, memberBefore.MsgCountRoot+3, memberAfter.MsgCountRoot)
}
