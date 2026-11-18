// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

// newRevisionSection turns on tasks and revisions for the basic team and links a section to the basic channel.
func newRevisionSection(t *testing.T, th *TestHelper) *model.TaskSection {
	t.Helper()
	clone := *th.BasicTeam
	clone.TasksEnabled = true
	clone.RevisionsEnabled = true
	_, err := th.App.Srv().Store().Team().Update(&clone)
	require.NoError(t, err)
	section, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Episode 1", ChannelId: th.BasicChannel.Id}, "")
	require.Nil(t, appErr)
	return section
}

func uploadVersion(t *testing.T, th *TestHelper, section *model.TaskSection, data string) *model.TaskSection {
	t.Helper()
	updated, appErr := th.App.SetTaskSectionVideo(th.Context, section, th.BasicUser.Id, "clip.mp4", []byte(data), "")
	require.Nil(t, appErr)
	return updated
}

func channelPostTypes(t *testing.T, th *TestHelper, channelID string) []string {
	t.Helper()
	list, appErr := th.App.GetPosts(th.Context, channelID, 0, 100)
	require.Nil(t, appErr)
	types := []string{}
	for _, id := range list.Order {
		types = append(types, list.Posts[id].Type)
	}
	return types
}

func TestSetTaskSectionVideoKeepsVersions(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := newRevisionSection(t, th)

	section = uploadVersion(t, th, section, "first")
	first := section.VideoFileId
	section = uploadVersion(t, th, section, "second")
	require.NotEqual(t, first, section.VideoFileId)

	videos, appErr := th.App.GetTaskSectionVideos(th.Context, section)
	require.Nil(t, appErr)
	require.Len(t, videos, 2)
	require.Equal(t, 1, videos[0].Version)
	require.Equal(t, first, videos[0].FileId)
	require.Equal(t, 2, videos[1].Version)
	require.Equal(t, section.VideoFileId, videos[1].FileId)
	require.NotNil(t, videos[0].File)
	require.Equal(t, "clip.mp4", videos[0].File.Name)

	for fileID, want := range map[string]string{first: "first", section.VideoFileId: "second"} {
		info, appErr := th.App.GetTaskSectionVideo(th.Context, section, fileID)
		require.Nil(t, appErr)
		data, appErr := th.App.ReadFile(info.Path)
		require.Nil(t, appErr)
		require.Equal(t, want, string(data))
	}
	latest, appErr := th.App.GetTaskSectionVideo(th.Context, section, "")
	require.Nil(t, appErr)
	require.Equal(t, section.VideoFileId, latest.Id)
}

func TestGetTaskSectionVideoForeignFileApp(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := uploadVersion(t, th, newRevisionSection(t, th), "first")
	other, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Other", ChannelId: th.CreateChannel(t, th.BasicTeam).Id}, "")
	require.Nil(t, appErr)
	other = uploadVersion(t, th, other, "other")

	_, appErr = th.App.GetTaskSectionVideo(th.Context, section, other.VideoFileId)
	require.NotNil(t, appErr)
	require.Equal(t, http.StatusNotFound, appErr.StatusCode)
}

func TestDeleteTaskSectionRemovesAllVersions(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := newRevisionSection(t, th)
	section = uploadVersion(t, th, section, "first")
	first := section.VideoFileId
	section = uploadVersion(t, th, section, "second")
	revision, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: section.TeamId, SectionId: section.Id, Title: "Cut", CreatorId: th.BasicUser.Id, VideoFileId: first}, "")
	require.Nil(t, appErr)

	require.Nil(t, th.App.DeleteTaskSection(th.Context, section, ""))

	for _, fileID := range []string{first, section.VideoFileId} {
		_, err := th.App.Srv().Store().FileInfo().Get(fileID)
		require.Error(t, err, "version file %s is removed", fileID)
	}
	got, appErr := th.App.GetTask(revision.Id)
	require.Nil(t, appErr)
	require.Empty(t, got.VideoFileId)
	require.Empty(t, got.SectionId)
}

func TestCreateRevisionOnOlderVersion(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := newRevisionSection(t, th)
	section = uploadVersion(t, th, section, "first")
	first := section.VideoFileId
	section = uploadVersion(t, th, section, "second")

	revision, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: section.TeamId, SectionId: section.Id, Title: "Older cut", CreatorId: th.BasicUser.Id, VideoFileId: first, VideoTime: 1000}, "")
	require.Nil(t, appErr)
	require.Equal(t, first, revision.VideoFileId)
	require.Contains(t, channelPostTypes(t, th, th.BasicChannel.Id), model.PostTypeRevision)
}

func TestCreateTaskInvalidVideo(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := uploadVersion(t, th, newRevisionSection(t, th), "first")
	other, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Other", ChannelId: th.CreateChannel(t, th.BasicTeam).Id}, "")
	require.Nil(t, appErr)
	other = uploadVersion(t, th, other, "other")
	plain, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Plain"}, "")
	require.Nil(t, appErr)

	for name, task := range map[string]*model.Task{
		"file of another section": {SectionId: section.Id, VideoFileId: other.VideoFileId},
		"video on ordinary section": {SectionId: plain.Id, VideoFileId: section.VideoFileId},
		"video without a section":   {VideoFileId: section.VideoFileId},
	} {
		task.TeamId = th.BasicTeam.Id
		task.Title = name
		task.CreatorId = th.BasicUser.Id
		_, appErr := th.App.CreateTask(th.Context, task, "")
		require.NotNil(t, appErr, name)
		require.Equal(t, "app.task.invalid_video.app_error", appErr.Id, name)
		require.Equal(t, http.StatusBadRequest, appErr.StatusCode, name)
	}
}

func TestOrdinaryTaskInLinkedSectionPostsNothing(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := uploadVersion(t, th, newRevisionSection(t, th), "first")
	before := len(channelPostTypes(t, th, th.BasicChannel.Id))

	task, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: section.TeamId, SectionId: section.Id, Title: "Storyboard", CreatorId: th.BasicUser.Id, AssigneeId: th.BasicUser2.Id}, "")
	require.Nil(t, appErr)
	require.Len(t, channelPostTypes(t, th, th.BasicChannel.Id), before, "ordinary tasks post nothing to the channel")

	dms := systemBotDMTexts(t, th, th.BasicUser2)
	require.NotEmpty(t, dms)
	require.Contains(t, dms[0], "/tasks?task="+task.Id)
}

func TestPatchTaskSectionRules(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	section := uploadVersion(t, th, newRevisionSection(t, th), "first")
	plain, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: "Plain"}, "")
	require.Nil(t, appErr)

	revision, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: section.TeamId, SectionId: section.Id, Title: "Cut", CreatorId: th.BasicUser.Id, VideoFileId: section.VideoFileId}, "")
	require.Nil(t, appErr)
	for _, target := range []string{plain.Id, ""} {
		_, appErr = th.App.PatchTask(th.Context, revision, &model.TaskPatch{SectionId: model.NewPointer(target)}, "")
		require.NotNil(t, appErr)
		require.Equal(t, "app.task.invalid_video.app_error", appErr.Id)
	}
	_, appErr = th.App.PatchTask(th.Context, revision, &model.TaskPatch{Title: model.NewPointer("Cut shorter")}, "")
	require.Nil(t, appErr, "other fields of a revision still change")

	ordinary, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: section.TeamId, SectionId: section.Id, Title: "Storyboard", CreatorId: th.BasicUser.Id}, "")
	require.Nil(t, appErr)
	moved, appErr := th.App.PatchTask(th.Context, ordinary, &model.TaskPatch{SectionId: model.NewPointer(plain.Id)}, "")
	require.Nil(t, appErr)
	require.Equal(t, plain.Id, moved.SectionId)
}
