// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

// taskPostSetup links a section to the basic channel with task T in it, and puts task X in another section.
func taskPostSetup(t *testing.T) (*TestHelper, *model.TaskSection, *model.Task, *model.Task) {
	t.Helper()
	th := Setup(t).InitBasic(t)
	section := newRevisionSection(t, th)
	other, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Board"}, "")
	require.Nil(t, appErr)
	task, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, SectionId: section.Id, CreatorId: th.BasicUser.Id, Title: "T"}, "")
	require.Nil(t, appErr)
	elsewhere, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, SectionId: other.Id, CreatorId: th.BasicUser.Id, Title: "X"}, "")
	require.Nil(t, appErr)
	return th, section, task, elsewhere
}

func taskPost(th *TestHelper, channelID, taskID, rootID string) *model.Post {
	post := &model.Post{UserId: th.BasicUser.Id, ChannelId: channelID, RootId: rootID, Message: "about it"}
	if taskID != "" {
		post.AddProp("task_id", taskID)
	}
	return post
}

func TestTaskPostRule(t *testing.T) {
	mainHelper.Parallel(t)
	th, _, task, elsewhere := taskPostSetup(t)

	_, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), "", false)
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_required.app_error", appErr.Id)
	require.Equal(t, 400, appErr.StatusCode)

	_, _, appErr = th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, elsewhere.Id, ""), "", false)
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_invalid.app_error", appErr.Id)

	saved, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, task.Id, ""), "", false)
	require.Nil(t, appErr)
	require.Equal(t, task.Id, saved.GetProp("task_id"))

	plain := th.CreateChannel(t, th.BasicTeam)
	_, _, appErr = th.App.CreatePostAsUser(th.Context, taskPost(th, plain.Id, "", ""), "", false)
	require.Nil(t, appErr)

	// A task named outside a task-list channel is dropped, so the post never joins that task's conversation.
	stray, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, plain.Id, task.Id, ""), "", false)
	require.Nil(t, appErr)
	require.Nil(t, stray.GetProp("task_id"))

	// A typed user post such as /me is held to the rule like any other message.
	me := taskPost(th, th.BasicChannel.Id, "", "")
	me.Type = model.PostTypeMe
	_, _, appErr = th.App.CreatePostAsUser(th.Context, me, "", false)
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_required.app_error", appErr.Id)
}

func TestTaskPostRuleReplies(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)

	// A root from before the channel had a task list.
	oldRoot, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), "", false)
	require.Nil(t, appErr)

	section := newRevisionSection(t, th)
	other, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Board"}, "")
	require.Nil(t, appErr)
	task, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, SectionId: section.Id, CreatorId: th.BasicUser.Id, Title: "T"}, "")
	require.Nil(t, appErr)
	elsewhere, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, SectionId: other.Id, CreatorId: th.BasicUser.Id, Title: "X"}, "")
	require.Nil(t, appErr)

	root, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, task.Id, ""), "", false)
	require.Nil(t, appErr)
	reply, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, elsewhere.Id, root.Id), "", false)
	require.Nil(t, appErr)
	require.Equal(t, task.Id, reply.GetProp("task_id"))

	oldReply, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, "", oldRoot.Id), "", false)
	require.Nil(t, appErr)
	require.Nil(t, oldReply.GetProp("task_id"))
}

func TestTaskPostRuleExempt(t *testing.T) {
	mainHelper.Parallel(t)
	th, _, _, _ := taskPostSetup(t)

	bot := th.CreateBot(t)
	th.LinkUserToTeam(t, &model.User{Id: bot.UserId}, th.BasicTeam)
	_, appErr := th.App.AddUserToChannel(th.Context, &model.User{Id: bot.UserId}, th.BasicChannel, false)
	require.Nil(t, appErr)
	_, _, appErr = th.App.CreatePost(th.Context, &model.Post{UserId: bot.UserId, ChannelId: th.BasicChannel.Id, Message: "bot"}, th.BasicChannel, model.CreatePostFlags{})
	require.Nil(t, appErr)

	_, _, appErr = th.App.CreatePost(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), th.BasicChannel, model.CreatePostFlags{FromIncomingWebhook: true})
	require.Nil(t, appErr)
	_, _, appErr = th.App.CreatePost(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), th.BasicChannel, model.CreatePostFlags{FromPlugin: true})
	require.Nil(t, appErr)

	join := taskPost(th, th.BasicChannel.Id, "", "")
	join.Type = model.PostTypeJoinChannel
	_, _, appErr = th.App.CreatePost(th.Context, join, th.BasicChannel, model.CreatePostFlags{})
	require.Nil(t, appErr)
}

func TestTaskPostRuleOff(t *testing.T) {
	mainHelper.Parallel(t)

	t.Run("revisions turned off", func(t *testing.T) {
		th, _, _, _ := taskPostSetup(t)
		team := *th.BasicTeam
		team.TasksEnabled = true
		team.RevisionsEnabled = false
		_, err := th.App.Srv().Store().Team().Update(&team)
		require.NoError(t, err)

		_, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), "", false)
		require.Nil(t, appErr)
	})

	t.Run("section deleted", func(t *testing.T) {
		th, section, _, _ := taskPostSetup(t)
		require.Nil(t, th.App.DeleteTaskSection(th.Context, section, ""))

		_, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, "", ""), "", false)
		require.Nil(t, appErr)
	})
}

func TestTaskPostRuleEdit(t *testing.T) {
	mainHelper.Parallel(t)
	th, _, task, elsewhere := taskPostSetup(t)

	post, _, appErr := th.App.CreatePostAsUser(th.Context, taskPost(th, th.BasicChannel.Id, task.Id, ""), "", false)
	require.Nil(t, appErr)

	patched, _, appErr := th.App.PatchPost(th.Context, post.Id, &model.PostPatch{Message: model.NewPointer("edited")}, nil)
	require.Nil(t, appErr)
	require.Equal(t, "edited", patched.Message)
	require.Equal(t, task.Id, patched.GetProp("task_id"))

	dropped := patched.Clone()
	dropped.SetProps(model.StringInterface{})
	_, _, appErr = th.App.UpdatePost(th.Context, dropped, &model.UpdatePostOptions{SafeUpdate: false})
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_change.app_error", appErr.Id)

	moved := patched.Clone()
	moved.AddProp("task_id", elsewhere.Id)
	_, _, appErr = th.App.UpdatePost(th.Context, moved, &model.UpdatePostOptions{SafeUpdate: false})
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_change.app_error", appErr.Id)
}

// The app package has no built-in slash commands registered, so this drives the command response path directly.
func TestTaskPostRuleCommand(t *testing.T) {
	mainHelper.Parallel(t)
	th, _, task, _ := taskPostSetup(t)

	args := &model.CommandArgs{TeamId: th.BasicTeam.Id, ChannelId: th.BasicChannel.Id, UserId: th.BasicUser.Id, TaskId: task.Id}
	response := &model.CommandResponse{ResponseType: model.CommandResponseTypeInChannel, Text: "*waves*"}
	post, appErr := th.App.HandleCommandResponsePost(th.Context, &model.Command{}, args, response, true)
	require.Nil(t, appErr)
	saved, appErr := th.App.GetSinglePost(th.Context, post.Id, false)
	require.Nil(t, appErr)
	require.Equal(t, task.Id, saved.GetProp("task_id"))

	// A response sent to another channel does not carry the task picked in this one.
	plain := th.CreateChannel(t, th.BasicTeam)
	elsewhere := &model.CommandResponse{ResponseType: model.CommandResponseTypeInChannel, Text: "over there", ChannelId: plain.Id}
	post, appErr = th.App.HandleCommandResponsePost(th.Context, &model.Command{}, args, elsewhere, true)
	require.Nil(t, appErr)
	require.Nil(t, post.GetProp("task_id"))

	args.TaskId = ""
	_, appErr = th.App.HandleCommandResponsePost(th.Context, &model.Command{}, args, response, true)
	require.NotNil(t, appErr)
	require.Equal(t, "app.post.task_required.app_error", appErr.Id)
}

func TestCreateTaskCommentChannelLinked(t *testing.T) {
	mainHelper.Parallel(t)
	th, _, task, elsewhere := taskPostSetup(t)

	_, appErr := th.App.CreateTaskComment(th.Context, task, th.BasicUser.Id, "on it", nil)
	require.NotNil(t, appErr)
	require.Equal(t, "app.task.comment.use_channel.app_error", appErr.Id)
	require.Equal(t, 400, appErr.StatusCode)

	before := len(channelPostTypes(t, th, th.BasicChannel.Id))
	comment, appErr := th.App.CreateTaskComment(th.Context, elsewhere, th.BasicUser.Id, "board talk", nil)
	require.Nil(t, appErr)
	require.Equal(t, elsewhere.Id, comment.TaskId)
	require.Len(t, channelPostTypes(t, th, th.BasicChannel.Id), before, "a channel-less task's comment posts nothing")
}
