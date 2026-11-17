// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestTasks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamId := th.BasicTeam.Id

	t.Run("disabled team returns 403", func(t *testing.T) {
		_, resp, err := th.Client.GetTeamTasks(ctx, teamId)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamId, &model.TeamPatch{TasksEnabled: new(true)})
	require.NoError(t, err)

	t.Run("non-member gets 403", func(t *testing.T) {
		other := th.CreateTeamWithClient(t, th.SystemAdminClient)
		_, _, err := th.SystemAdminClient.PatchTeam(ctx, other.Id, &model.TeamPatch{TasksEnabled: new(true)})
		require.NoError(t, err)

		_, resp, err := th.Client.GetTeamTasks(ctx, other.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.CreateTask(ctx, &model.Task{TeamId: other.Id, Title: "x"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("members without manage_tasks only edit existing tasks", func(t *testing.T) {
		task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Admin task"})
		require.NoError(t, err)
		section, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Admin section"})
		require.NoError(t, err)

		_, resp, err := th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "x"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{AssigneeId: &th.BasicUser.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteTask(ctx, task.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "x"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteTaskSection(ctx, section.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// Status, dates and text stay open, and re-sending the same assignee is not an assignment.
		patched, _, err := th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{Status: new(model.TaskStatusInProgress), AssigneeId: new(""), Title: new("Renamed")})
		require.NoError(t, err)
		require.Equal(t, model.TaskStatusInProgress, patched.Status)
		require.Equal(t, "Renamed", patched.Title)

		_, err = th.SystemAdminClient.DeleteTask(ctx, task.Id)
		require.NoError(t, err)
		_, err = th.SystemAdminClient.DeleteTaskSection(ctx, section.Id)
		require.NoError(t, err)
	})

	t.Run("crud and section delete", func(t *testing.T) {
		th.AddPermissionToRole(t, model.PermissionManageTasks.Id, model.TeamUserRoleId)
		defer th.RemovePermissionFromRole(t, model.PermissionManageTasks.Id, model.TeamUserRoleId)

		section, resp, err := th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Yapılacak"})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)

		task, resp, err := th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: section.Id, Title: "Spec yaz", CreatorId: th.BasicUser2.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		require.Equal(t, th.BasicUser.Id, task.CreatorId, "creator comes from the session")

		task, _, err = th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{Status: new(model.TaskStatusDone), AssigneeId: &th.BasicUser2.Id, DueAt: new(int64(1700000000000))})
		require.NoError(t, err)
		require.Equal(t, model.TaskStatusDone, task.Status)
		require.Equal(t, th.BasicUser2.Id, task.AssigneeId)

		outsider := th.CreateUser(t)
		_, resp, err = th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{AssigneeId: &outsider.Id})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		resp, err = th.Client.DeleteTaskSection(ctx, section.Id)
		require.NoError(t, err)
		CheckOKStatus(t, resp)

		tasks, _, err := th.Client.GetTeamTasks(ctx, teamId)
		require.NoError(t, err)
		require.Len(t, tasks, 1)
		require.Empty(t, tasks[0].SectionId)

		resp, err = th.Client.DeleteTask(ctx, task.Id)
		require.NoError(t, err)
		CheckOKStatus(t, resp)

		_, resp, err = th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{Status: new(model.TaskStatusTodo)})
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
	})

	t.Run("comments with files", func(t *testing.T) {
		task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Discuss"})
		require.NoError(t, err)

		comment, resp, err := th.Client.CreateTaskComment(ctx, task.Id, "  see attached  ", map[string][]byte{"notes.txt": []byte("hello")})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		require.Equal(t, "see attached", comment.Message)
		require.Equal(t, th.BasicUser.Id, comment.UserId, "author comes from the session")
		require.Len(t, comment.FileIds, 1)
		fileId := comment.FileIds[0]

		comments, _, err := th.Client.GetTaskComments(ctx, task.Id)
		require.NoError(t, err)
		require.Len(t, comments, 1)
		require.Len(t, comments[0].Files, 1)
		require.Equal(t, "notes.txt", comments[0].Files[0].Name)

		data, _, err := th.Client.GetTaskCommentFile(ctx, comment.Id, fileId)
		require.NoError(t, err)
		require.Equal(t, "hello", string(data))

		// The download route only serves the comment's own files.
		_, resp, err = th.Client.GetTaskCommentFile(ctx, comment.Id, model.NewId())
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)

		_, resp, err = th.Client.CreateTaskComment(ctx, task.Id, "   ", nil)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		// Another member without manage_tasks cannot delete someone else's comment.
		client2 := th.CreateClient()
		th.LoginBasic2WithClient(t, client2)
		resp, err = client2.DeleteTaskComment(ctx, comment.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// Users outside the team cannot read the comments or their files.
		outsider := th.CreateUser(t)
		outsiderClient := th.CreateClient()
		_, _, err = outsiderClient.Login(ctx, outsider.Email, outsider.Password)
		require.NoError(t, err)
		_, resp, err = outsiderClient.GetTaskComments(ctx, task.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = outsiderClient.GetTaskCommentFile(ctx, comment.Id, fileId)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		resp, err = th.Client.DeleteTaskComment(ctx, comment.Id)
		require.NoError(t, err)
		CheckOKStatus(t, resp)
		_, resp, err = th.Client.GetTaskCommentFile(ctx, comment.Id, fileId)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
		_, err = th.App.Srv().Store().FileInfo().Get(fileId)
		require.Error(t, err, "the attachment is removed with the comment")

		// Deleting the task removes its comments' files too.
		comment, _, err = th.Client.CreateTaskComment(ctx, task.Id, "", map[string][]byte{"a.txt": []byte("a")})
		require.NoError(t, err)
		_, err = th.SystemAdminClient.DeleteTask(ctx, task.Id)
		require.NoError(t, err)
		_, err = th.App.Srv().Store().FileInfo().Get(comment.FileIds[0])
		require.Error(t, err)
		_, err = th.App.Srv().Store().Task().GetComment(comment.Id)
		require.Error(t, err)
	})

	t.Run("comment files may exceed the JSON payload limit", func(t *testing.T) {
		task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Big file"})
		require.NoError(t, err)
		big := make([]byte, *th.App.Config().ServiceSettings.MaximumPayloadSizeBytes*2)
		comment, _, err := th.Client.CreateTaskComment(ctx, task.Id, "", map[string][]byte{"big.bin": big})
		require.NoError(t, err)
		data, _, err := th.Client.GetTaskCommentFile(ctx, comment.Id, comment.FileIds[0])
		require.NoError(t, err)
		require.Len(t, data, len(big))
	})

	t.Run("comment files need attachments enabled", func(t *testing.T) {
		task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "No files"})
		require.NoError(t, err)
		th.App.UpdateConfig(func(cfg *model.Config) { *cfg.FileSettings.EnableFileAttachments = false })
		defer th.App.UpdateConfig(func(cfg *model.Config) { *cfg.FileSettings.EnableFileAttachments = true })

		_, resp, err := th.Client.CreateTaskComment(ctx, task.Id, "x", map[string][]byte{"a.txt": []byte("a")})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, _, err = th.Client.CreateTaskComment(ctx, task.Id, "text only still works", nil)
		require.NoError(t, err)
	})

	t.Run("revision channel video and revision times", func(t *testing.T) {
		// A client-sent video id is ignored; only the upload route sets it.
		section, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Trailer v1", VideoFileId: model.NewId()})
		require.NoError(t, err)
		require.Empty(t, section.VideoFileId)

		// Uploads need revision channels turned on for the team.
		_, resp, err := th.SystemAdminClient.SetTaskSectionVideo(ctx, section.Id, "clip.mp4", []byte("video"))
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, _, err = th.SystemAdminClient.PatchTeam(ctx, teamId, &model.TeamPatch{RevisionsEnabled: new(true)})
		require.NoError(t, err)

		_, resp, err = th.Client.SetTaskSectionVideo(ctx, section.Id, "clip.mp4", []byte("video"))
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.SystemAdminClient.SetTaskSectionVideo(ctx, section.Id, "notes.txt", []byte("text"))
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		section, _, err = th.SystemAdminClient.SetTaskSectionVideo(ctx, section.Id, "clip.mp4", []byte("first"))
		require.NoError(t, err)
		firstVideo := section.VideoFileId
		require.NotEmpty(t, firstVideo)
		section, _, err = th.SystemAdminClient.SetTaskSectionVideo(ctx, section.Id, "clip.webm", []byte("second"))
		require.NoError(t, err)
		_, err = th.App.Srv().Store().FileInfo().Get(firstVideo)
		require.Error(t, err, "the replaced video is removed")

		data, resp, err := th.Client.GetTaskSectionVideo(ctx, section.Id)
		require.NoError(t, err)
		require.Equal(t, "second", string(data))
		require.Equal(t, "video/webm", resp.Header.Get("Content-Type"))

		revision, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: section.Id, Title: "Logo too small", VideoTime: 83500})
		require.NoError(t, err)
		require.Equal(t, int64(83500), revision.VideoTime)
		revision, _, err = th.Client.PatchTask(ctx, revision.Id, &model.TaskPatch{VideoTime: model.NewPointer(int64(90000))})
		require.NoError(t, err)
		require.Equal(t, int64(90000), revision.VideoTime)
		_, resp, err = th.Client.PatchTask(ctx, revision.Id, &model.TaskPatch{VideoTime: model.NewPointer(int64(-1))})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		_, err = th.SystemAdminClient.DeleteTaskSection(ctx, section.Id)
		require.NoError(t, err)
		_, err = th.App.Srv().Store().FileInfo().Get(section.VideoFileId)
		require.Error(t, err, "the video is removed with its section")
	})

	t.Run("assigning a task messages the assignee", func(t *testing.T) {
		bot, appErr := th.App.GetSystemBot(th.Context)
		require.Nil(t, appErr)
		messagesTo := func(userId string) []string {
			channel, appErr := th.App.GetOrCreateDirectChannel(th.Context, userId, bot.UserId)
			require.Nil(t, appErr)
			posts, appErr := th.App.GetPosts(th.Context, channel.Id, 0, 100)
			require.Nil(t, appErr)
			var messages []string
			for _, post := range posts.Posts {
				if post.UserId == bot.UserId {
					messages = append(messages, post.Message)
				}
			}
			return messages
		}
		before1, before2 := len(messagesTo(th.BasicUser.Id)), len(messagesTo(th.BasicUser2.Id))

		task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Fix the intro", AssigneeId: th.BasicUser.Id})
		require.NoError(t, err)
		messages := messagesTo(th.BasicUser.Id)
		require.Len(t, messages, before1+1)
		require.Contains(t, strings.Join(messages, " "), "Fix the intro")
		require.Contains(t, strings.Join(messages, " "), "/tasks?task="+task.Id)

		// Other edits do not notify again; reassigning notifies the new assignee.
		_, _, err = th.Client.PatchTask(ctx, task.Id, &model.TaskPatch{Status: model.NewPointer(model.TaskStatusDone)})
		require.NoError(t, err)
		require.Len(t, messagesTo(th.BasicUser.Id), before1+1)
		_, _, err = th.SystemAdminClient.PatchTask(ctx, task.Id, &model.TaskPatch{AssigneeId: &th.BasicUser2.Id})
		require.NoError(t, err)
		require.Len(t, messagesTo(th.BasicUser2.Id), before2+1)

		// Assigning yourself sends nothing.
		th.LinkUserToTeam(t, th.SystemAdminUser, th.BasicTeam)
		_, _, err = th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Mine", AssigneeId: th.SystemAdminUser.Id})
		require.NoError(t, err)
		require.Len(t, messagesTo(th.SystemAdminUser.Id), 0)
	})

	t.Run("revision channel links a channel", func(t *testing.T) {
		linked, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Trailer", ChannelId: th.BasicChannel.Id})
		require.NoError(t, err)
		require.Equal(t, th.BasicChannel.Id, linked.ChannelId)

		// A channel links to one section, of its own team, while it is active.
		_, resp, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Again", ChannelId: th.BasicChannel.Id})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		other := th.CreateTeamWithClient(t, th.SystemAdminClient)
		foreign := th.CreateChannelWithClientAndTeam(t, th.SystemAdminClient, model.ChannelTypeOpen, other.Id)
		_, resp, err = th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Foreign", ChannelId: foreign.Id})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		archived := th.CreatePublicChannel(t)
		_, err = th.SystemAdminClient.DeleteChannel(ctx, archived.Id)
		require.NoError(t, err)
		_, resp, err = th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Archived", ChannelId: archived.Id})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		// The assignment message of a revision opens its channel's Revisions tab.
		revision, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: linked.Id, Title: "Cut earlier", AssigneeId: th.BasicUser2.Id})
		require.NoError(t, err)
		bot, appErr := th.App.GetSystemBot(th.Context)
		require.Nil(t, appErr)
		dm, appErr := th.App.GetOrCreateDirectChannel(th.Context, th.BasicUser2.Id, bot.UserId)
		require.Nil(t, appErr)
		posts, appErr := th.App.GetPosts(th.Context, dm.Id, 0, 1)
		require.Nil(t, appErr)
		require.Contains(t, posts.Posts[posts.Order[0]].Message, "/channels/"+th.BasicChannel.Name+"?revision="+revision.Id)

		// A new revision shows in the channel as a revision card, and its comments as messages from the commenter.
		channelPosts := func() []*model.Post {
			list, appErr := th.App.GetPosts(th.Context, th.BasicChannel.Id, 0, 100)
			require.Nil(t, appErr)
			result := []*model.Post{}
			for _, id := range list.Order {
				result = append(result, list.Posts[id])
			}
			return result
		}
		card := channelPosts()[0]
		require.Equal(t, model.PostTypeRevision, card.Type)
		require.Equal(t, revision.Id, card.GetProp("task_id"))
		require.Equal(t, th.SystemAdminUser.Id, card.UserId)
		require.Contains(t, card.Message, "Cut earlier")
		_, _, err = th.Client.CreateTaskComment(ctx, revision.Id, "Make it 2 frames shorter", nil)
		require.NoError(t, err)
		comment := channelPosts()[0]
		require.Equal(t, th.BasicUser.Id, comment.UserId)
		require.Contains(t, comment.Message, "Make it 2 frames shorter")
		require.Contains(t, comment.Message, "?revision="+revision.Id)

		// Ordinary tasks and their comments stay out of channels.
		before := len(channelPosts())
		plain, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "Plain"})
		require.NoError(t, err)
		_, _, err = th.SystemAdminClient.CreateTaskComment(ctx, plain.Id, "hi", nil)
		require.NoError(t, err)
		require.Len(t, channelPosts(), before)

		// With revision channels off, no new channel can be linked.
		_, _, err = th.SystemAdminClient.PatchTeam(ctx, teamId, &model.TeamPatch{RevisionsEnabled: new(false)})
		require.NoError(t, err)
		_, resp, err = th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "Off", ChannelId: th.CreatePublicChannel(t).Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})
}

func TestTaskPermissionSplit(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamId := th.BasicTeam.Id
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamId, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)

	t.Run("manage_tasks alone: plain tasks only", func(t *testing.T) {
		th.AddPermissionToRole(t, model.PermissionManageTasks.Id, model.TeamUserRoleId)
		defer th.RemovePermissionFromRole(t, model.PermissionManageTasks.Id, model.TeamUserRoleId)

		task, resp, err := th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "plain"})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, err = th.Client.DeleteTask(ctx, task.Id)
		require.NoError(t, err)

		_, resp, err = th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "rev", ChannelId: th.BasicChannel.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("manage_revisions alone: revision sections and their tasks only", func(t *testing.T) {
		th.AddPermissionToRole(t, model.PermissionManageRevisions.Id, model.TeamUserRoleId)
		defer th.RemovePermissionFromRole(t, model.PermissionManageRevisions.Id, model.TeamUserRoleId)

		section, resp, err := th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "rev", ChannelId: th.BasicChannel.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)

		revision, resp, err := th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: section.Id, Title: "fix frame 12"})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		_, _, err = th.Client.PatchTask(ctx, revision.Id, &model.TaskPatch{AssigneeId: &th.BasicUser2.Id})
		require.NoError(t, err)

		_, resp, err = th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, Title: "plain"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "plain section"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		_, err = th.Client.DeleteTask(ctx, revision.Id)
		require.NoError(t, err)
		_, err = th.Client.DeleteTaskSection(ctx, section.Id)
		require.NoError(t, err)
	})
}
