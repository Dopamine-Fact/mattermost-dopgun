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
	// Assigning to or reviewing BasicUser2 needs a rank that outranks them and carries the permission.
	rank := giveRankingRole(t, th, th.BasicUser)
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
		th.AddPermissionToRole(t, model.PermissionManageTasks.Id, rank.RoleName)
		defer th.RemovePermissionFromRole(t, model.PermissionManageTasks.Id, rank.RoleName)

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
		require.NoError(t, err, "earlier versions are kept")

		data, resp, err := th.Client.GetTaskSectionVideo(ctx, section.Id, "")
		require.NoError(t, err)
		require.Equal(t, "second", string(data))
		require.Equal(t, "video/webm", resp.Header.Get("Content-Type"))

		revision, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: section.Id, Title: "Logo too small", VideoTime: 83500, VideoFileId: section.VideoFileId})
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
		for _, fileID := range []string{firstVideo, section.VideoFileId} {
			_, err = th.App.Srv().Store().FileInfo().Get(fileID)
			require.Error(t, err, "every version is removed with its section")
		}
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
		linked = uploadSectionVideo(t, th.SystemAdminClient, linked.Id)
		revision, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: linked.Id, Title: "Cut earlier", AssigneeId: th.BasicUser2.Id, VideoFileId: linked.VideoFileId})
		require.NoError(t, err)
		bot, appErr := th.App.GetSystemBot(th.Context)
		require.Nil(t, appErr)
		dm, appErr := th.App.GetOrCreateDirectChannel(th.Context, th.BasicUser2.Id, bot.UserId)
		require.Nil(t, appErr)
		posts, appErr := th.App.GetPosts(th.Context, dm.Id, 0, 1)
		require.Nil(t, appErr)
		require.Contains(t, posts.Posts[posts.Order[0]].Message, "/channels/"+th.BasicChannel.Name+"?revision="+revision.Id)

		// A new revision shows in the channel as a revision card; its comments are the channel's messages, not task comments.
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
		_, resp, err = th.Client.CreateTaskComment(ctx, revision.Id, "Make it 2 frames shorter", nil)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		require.Equal(t, card.Id, channelPosts()[0].Id)

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
	// Assigning to or reviewing BasicUser2 needs a rank that outranks them and carries the permission.
	rank := giveRankingRole(t, th, th.BasicUser)
	ctx := context.Background()
	teamId := th.BasicTeam.Id
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamId, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)

	t.Run("manage_tasks alone: plain tasks only", func(t *testing.T) {
		th.AddPermissionToRole(t, model.PermissionManageTasks.Id, rank.RoleName)
		defer th.RemovePermissionFromRole(t, model.PermissionManageTasks.Id, rank.RoleName)

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
		th.AddPermissionToRole(t, model.PermissionManageRevisions.Id, rank.RoleName)
		defer th.RemovePermissionFromRole(t, model.PermissionManageRevisions.Id, rank.RoleName)

		section, resp, err := th.Client.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamId, Name: "rev", ChannelId: th.BasicChannel.Id})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		section = uploadSectionVideo(t, th.Client, section.Id)

		revision, resp, err := th.Client.CreateTask(ctx, &model.Task{TeamId: teamId, SectionId: section.Id, Title: "fix frame 12", VideoFileId: section.VideoFileId})
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

// uploadSectionVideo adds a version of a linked section's video as the client and returns the section.
func uploadSectionVideo(t *testing.T, client *model.Client4, sectionID string) *model.TaskSection {
	t.Helper()
	section, _, err := client.SetTaskSectionVideo(context.Background(), sectionID, "clip.mp4", []byte("video "+model.NewId()))
	require.NoError(t, err)
	return section
}

// videoSection turns tasks and revisions on and gives the basic channel a linked section with one video.
func videoSection(t *testing.T, th *TestHelper) *model.TaskSection {
	t.Helper()
	ctx := context.Background()
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, th.BasicTeam.Id, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)
	section, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Episode 1", ChannelId: th.BasicChannel.Id})
	require.NoError(t, err)
	return uploadSectionVideo(t, th.SystemAdminClient, section.Id)
}

func TestTaskPermissionFollowsTask(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id
	section := videoSection(t, th)
	department := newTestDepartment(t, th, teamID, "Episodes")
	tasksClient, _ := rankedClient(t, th, th.BasicTeam, newTestRank(t, th, teamID, department.Id, "Tasks", model.PermissionManageTasks.Id))
	revisionsClient, _ := rankedClient(t, th, th.BasicTeam, newTestRank(t, th, teamID, department.Id, "Revisions", model.PermissionManageRevisions.Id))

	ordinary := &model.Task{TeamId: teamID, SectionId: section.Id, Title: "Storyboard"}
	revision := &model.Task{TeamId: teamID, SectionId: section.Id, Title: "Cut earlier", VideoFileId: section.VideoFileId}
	for name, tc := range map[string]struct {
		client      *model.Client4
		own, others *model.Task
	}{
		"manage_tasks":     {tasksClient, ordinary, revision},
		"manage_revisions": {revisionsClient, revision, ordinary},
	} {
		t.Run(name, func(t *testing.T) {
			_, resp, err := tc.client.CreateTask(ctx, tc.others)
			require.Error(t, err)
			CheckForbiddenStatus(t, resp)
			other, _, err := th.SystemAdminClient.CreateTask(ctx, tc.others)
			require.NoError(t, err)
			_, resp, err = tc.client.PatchTask(ctx, other.Id, &model.TaskPatch{AssigneeId: &th.BasicUser2.Id})
			require.Error(t, err)
			CheckForbiddenStatus(t, resp)
			resp, err = tc.client.DeleteTask(ctx, other.Id)
			require.Error(t, err)
			CheckForbiddenStatus(t, resp)

			own, resp, err := tc.client.CreateTask(ctx, tc.own)
			require.NoError(t, err)
			CheckCreatedStatus(t, resp)
			_, _, err = tc.client.PatchTask(ctx, own.Id, &model.TaskPatch{AssigneeId: &th.BasicUser2.Id})
			require.NoError(t, err)
			_, err = tc.client.DeleteTask(ctx, own.Id)
			require.NoError(t, err)
		})
	}
}

func TestGetTaskSectionVideos(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	section := videoSection(t, th)
	section = uploadSectionVideo(t, th.SystemAdminClient, section.Id)

	videos, _, err := th.Client.GetTaskSectionVideos(ctx, section.Id)
	require.NoError(t, err)
	require.Len(t, videos, 2)
	require.Equal(t, 1, videos[0].Version)
	require.Equal(t, 2, videos[1].Version)
	require.Equal(t, section.VideoFileId, videos[1].FileId)
	require.NotNil(t, videos[0].File)
	require.Equal(t, "clip.mp4", videos[0].File.Name)

	outsider := th.CreateUser(t)
	client := th.CreateClient()
	_, _, err = client.Login(ctx, outsider.Email, outsider.Password)
	require.NoError(t, err)
	_, resp, err := client.GetTaskSectionVideos(ctx, section.Id)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
}

func TestGetTaskSectionVideoForeignFile(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	section, _, err := th.SystemAdminClient.SetTaskSectionVideo(ctx, videoSection(t, th).Id, "clip.mp4", []byte("v2"))
	require.NoError(t, err)
	videos, _, err := th.Client.GetTaskSectionVideos(ctx, section.Id)
	require.NoError(t, err)
	require.Len(t, videos, 2)

	other, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Other", ChannelId: th.CreatePublicChannel(t).Id})
	require.NoError(t, err)
	other = uploadSectionVideo(t, th.SystemAdminClient, other.Id)
	upload, _, err := th.Client.UploadFile(ctx, []byte("plain"), th.BasicChannel.Id, "plain.mp4")
	require.NoError(t, err)

	for _, fileID := range []string{other.VideoFileId, upload.FileInfos[0].Id} {
		_, resp, err := th.Client.GetTaskSectionVideo(ctx, section.Id, fileID)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
	}
	first, _, err := th.Client.GetTaskSectionVideo(ctx, section.Id, videos[0].FileId)
	require.NoError(t, err)
	require.Contains(t, string(first), "video ")
	latest, _, err := th.Client.GetTaskSectionVideo(ctx, section.Id, "")
	require.NoError(t, err)
	require.Equal(t, "v2", string(latest))
}

// taskPostsSetup turns tasks and revisions on, links a section to the basic channel and puts task T in it.
func taskPostsSetup(t *testing.T, th *TestHelper) *model.Task {
	t.Helper()
	ctx := context.Background()
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, th.BasicTeam.Id, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)
	section, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Ep", ChannelId: th.BasicChannel.Id})
	require.NoError(t, err)
	task, _, err := th.SystemAdminClient.CreateTask(ctx, &model.Task{TeamId: th.BasicTeam.Id, SectionId: section.Id, Title: "T"})
	require.NoError(t, err)
	return task
}

func taskChannelPost(t *testing.T, client *model.Client4, channelID, taskID, rootID string) *model.Post {
	t.Helper()
	post := &model.Post{ChannelId: channelID, RootId: rootID, Message: "about T"}
	if taskID != "" {
		post.AddProp("task_id", taskID)
	}
	saved, _, err := client.CreatePost(context.Background(), post)
	require.NoError(t, err)
	return saved
}

func TestGetTaskPosts(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	task := taskPostsSetup(t, th)

	first := taskChannelPost(t, th.Client, th.BasicChannel.Id, task.Id, "")
	second := taskChannelPost(t, th.Client, th.BasicChannel.Id, task.Id, "")
	taskChannelPost(t, th.Client, th.BasicChannel.Id, "", first.Id)

	list, resp, err := th.Client.GetTaskPosts(ctx, task.Id, "", 0, 0)
	require.NoError(t, err)
	CheckOKStatus(t, resp)
	require.Equal(t, []string{second.Id, first.Id}, list.Order)

	list, _, err = th.Client.GetTaskPosts(ctx, task.Id, th.BasicChannel.Id, 0, 1)
	require.NoError(t, err)
	require.Equal(t, []string{second.Id}, list.Order)

	list, _, err = th.Client.GetTaskPosts(ctx, task.Id, "", second.CreateAt, 0)
	require.NoError(t, err)
	require.Equal(t, []string{first.Id}, list.Order)

	// Someone who can't read the channel gets none of its posts.
	_, _, err = th.SystemAdminClient.UpdateChannelPrivacy(ctx, th.BasicChannel.Id, model.ChannelTypePrivate)
	require.NoError(t, err)
	_, err = th.SystemAdminClient.RemoveUserFromChannel(ctx, th.BasicChannel.Id, th.BasicUser2.Id)
	require.NoError(t, err)
	th.LoginBasic2(t)
	list, resp, err = th.Client.GetTaskPosts(ctx, task.Id, "", 0, 0)
	require.NoError(t, err)
	CheckOKStatus(t, resp)
	require.Empty(t, list.Order)
}

func TestDeleteTaskPostAsManager(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	task := taskPostsSetup(t, th)

	// BasicUser2 writes; BasicUser deletes, first without and then with manage_tasks (never delete_others_posts).
	th.LoginBasic2(t)
	tagged := taskChannelPost(t, th.Client, th.BasicChannel.Id, task.Id, "")
	other := taskChannelPost(t, th.Client, th.BasicChannel2.Id, "", "")
	th.LoginBasic(t)

	resp, err := th.Client.DeletePost(ctx, tagged.Id)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)

	giveRankingRole(t, th, th.BasicUser, model.PermissionManageTasks.Id)
	resp, err = th.Client.DeletePost(ctx, other.Id)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
	resp, err = th.Client.DeletePost(ctx, tagged.Id)
	require.NoError(t, err)
	CheckOKStatus(t, resp)
}
