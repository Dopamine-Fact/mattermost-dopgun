// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"archive/zip"
	"bytes"
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/einterfaces/mocks"
)

func setDriveTeam(t *testing.T, th *TestHelper, enabled bool) {
	t.Helper()
	th.BasicTeam.FilesEnabled = enabled
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team
}

func setupDriveAPI(t *testing.T, th *TestHelper) *TestHelper {
	t.Helper()
	if *th.App.Config().FileSettings.DriverName == "" {
		t.Skip("skipping because no file driver is enabled")
	}
	setDriveTeam(t, th, true)
	return th
}

func driveAPIUpload(t *testing.T, client *model.Client4, channelID, name string, data []byte) string {
	t.Helper()
	resp, _, err := client.UploadFile(context.Background(), data, channelID, name)
	require.NoError(t, err)
	require.Len(t, resp.FileInfos, 1)
	return resp.FileInfos[0].Id
}

func driveAPIAdd(t *testing.T, client *model.Client4, channelID, parentID, name string, data []byte) *model.DriveItem {
	t.Helper()
	item, _, err := client.AddDriveFile(context.Background(), channelID, parentID, driveAPIUpload(t, client, channelID, name, data))
	require.NoError(t, err)
	return item
}

func TestDriveAPI(t *testing.T) {
	ctx := context.Background()
	th := setupDriveAPI(t, Setup(t).InitBasic(t))
	client2 := th.CreateClient()
	th.LoginBasic2WithClient(t, client2)

	t.Run("NonMember403", func(t *testing.T) {
		private := th.CreatePrivateChannel(t)
		_, resp, err := client2.GetDriveFolder(ctx, private.Id, "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = client2.CreateDriveFolder(ctx, private.Id, "", "x")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("ToggleOff403", func(t *testing.T) {
		setDriveTeam(t, th, false)
		defer setDriveTeam(t, th, true)
		_, resp, err := th.Client.GetDriveFolder(ctx, th.BasicChannel.Id, "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		CheckErrorID(t, err, "app.drive.disabled.app_error")
	})

	t.Run("UploadAndList", func(t *testing.T) {
		folder, resp, err := th.Client.CreateDriveFolder(ctx, th.BasicChannel.Id, "", "Listing")
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		file := driveAPIAdd(t, th.Client, th.BasicChannel.Id, folder.Id, "a.png", []byte("png"))
		require.Equal(t, "a.png", file.Name)

		root, _, err := th.Client.GetDriveFolder(ctx, th.BasicChannel.Id, "")
		require.NoError(t, err)
		require.True(t, slices.ContainsFunc(root.Items, func(it *model.DriveItem) bool { return it.Id == folder.Id }))
		require.Empty(t, root.Path)

		inner, _, err := th.Client.GetDriveFolder(ctx, th.BasicChannel.Id, folder.Id)
		require.NoError(t, err)
		require.Len(t, inner.Items, 1)
		require.Equal(t, file.Id, inner.Items[0].Id)
		require.NotNil(t, inner.Items[0].FileInfo)
		require.Len(t, inner.Path, 1)
		require.Equal(t, folder.Id, inner.Path[0].Id)
	})

	t.Run("ClaimOthersFileRejected", func(t *testing.T) {
		fileID := driveAPIUpload(t, th.Client, th.BasicChannel.Id, "mine.png", []byte("x"))
		_, resp, err := client2.AddDriveFile(ctx, th.BasicChannel.Id, "", fileID)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		CheckErrorID(t, err, "app.drive.invalid_file.app_error")
	})

	t.Run("ItemFromOtherChannel404", func(t *testing.T) {
		folder, _, err := th.Client.CreateDriveFolder(ctx, th.BasicChannel.Id, "", "Elsewhere")
		require.NoError(t, err)
		_, resp, err := th.Client.RenameDriveItem(ctx, th.BasicChannel2.Id, folder.Id, "y")
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
		resp, err = th.Client.DeleteDriveItems(ctx, th.BasicChannel2.Id, []string{folder.Id}, false)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
		_, resp, err = th.Client.DownloadDriveZip(ctx, th.BasicChannel2.Id, []string{folder.Id})
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
	})

	t.Run("RenameOthersItemForbidden", func(t *testing.T) {
		folder, _, err := th.Client.CreateDriveFolder(ctx, th.BasicChannel.Id, "", "Owned")
		require.NoError(t, err)
		_, resp, err := client2.RenameDriveItem(ctx, th.BasicChannel.Id, folder.Id, "Stolen")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		renamed, _, err := th.Client.RenameDriveItem(ctx, th.BasicChannel.Id, folder.Id, "Owned2")
		require.NoError(t, err)
		require.Equal(t, "Owned2", renamed.Name)
	})

	t.Run("CreatePostWithDriveFileFails", func(t *testing.T) {
		item := driveAPIAdd(t, th.Client, th.BasicChannel.Id, "", "keep.png", []byte("x"))
		post, _, err := th.Client.CreatePost(ctx, &model.Post{ChannelId: th.BasicChannel.Id, Message: "steal", FileIds: model.StringArray{item.FileId}})
		if err == nil {
			require.Empty(t, post.FileIds)
		}
		info, appErr := th.App.GetFileInfo(th.Context, item.FileId)
		require.Nil(t, appErr)
		require.Empty(t, info.PostId)
		require.Equal(t, th.BasicChannel.Id, info.ChannelId)
	})

	t.Run("MoveRevokesOldChannelImmediately", func(t *testing.T) {
		item := driveAPIAdd(t, th.Client, th.BasicChannel.Id, "", "moving.png", []byte("x"))
		_, resp, err := client2.GetFile(ctx, item.FileId)
		require.NoError(t, err)
		CheckOKStatus(t, resp)
		// GetFileInfo reads through the FileInfo cache, which the move must invalidate.
		_, resp, err = client2.GetFileInfo(ctx, item.FileId)
		require.NoError(t, err)
		CheckOKStatus(t, resp)

		dst := th.CreatePrivateChannel(t)
		_, err = th.Client.MoveDriveItems(ctx, th.BasicChannel.Id, []string{item.Id}, dst.Id, "")
		require.NoError(t, err)

		_, resp, err = client2.GetFile(ctx, item.FileId)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = client2.GetFileInfo(ctx, item.FileId)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("MoveNeedsTargetMembership", func(t *testing.T) {
		item := driveAPIAdd(t, client2, th.BasicChannel.Id, "", "m.png", []byte("x"))
		dst := th.CreatePrivateChannel(t)
		resp, err := client2.MoveDriveItems(ctx, th.BasicChannel.Id, []string{item.Id}, dst.Id, "")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("ChatFilesFiltersAndSorts", func(t *testing.T) {
		channel := th.CreatePublicChannel(t)
		b := driveAPIUpload(t, th.Client, channel.Id, "b.txt", []byte("bb"))
		a := driveAPIUpload(t, th.Client, channel.Id, "a.txt", []byte("aaaa"))
		_, _, err := th.Client.CreatePost(ctx, &model.Post{ChannelId: channel.Id, Message: "files", FileIds: model.StringArray{a, b}})
		require.NoError(t, err)
		driveAPIAdd(t, th.Client, channel.Id, "", "drive.txt", []byte("d"))

		files, _, err := th.Client.GetDriveChatFiles(ctx, channel.Id, 0, 10, "name", false)
		require.NoError(t, err)
		require.Len(t, files, 2)
		require.Equal(t, []string{"a.txt", "b.txt"}, []string{files[0].Name, files[1].Name})

		files, _, err = th.Client.GetDriveChatFiles(ctx, channel.Id, 0, 10, "size", true)
		require.NoError(t, err)
		require.Equal(t, a, files[0].Id)

		_, resp, err := th.Client.GetDriveChatFiles(ctx, channel.Id, 0, 10, "bogus", false)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("DownloadZip", func(t *testing.T) {
		folder, _, err := th.Client.CreateDriveFolder(ctx, th.BasicChannel.Id, "", "Folder")
		require.NoError(t, err)
		driveAPIAdd(t, th.Client, th.BasicChannel.Id, folder.Id, "a.png", []byte("zipped"))

		data, resp, err := th.Client.DownloadDriveZip(ctx, th.BasicChannel.Id, []string{folder.Id})
		require.NoError(t, err)
		require.Equal(t, "application/zip", resp.Header.Get("Content-Type"))
		require.Contains(t, resp.Header.Get("Content-Disposition"), th.BasicChannel.Name+".zip")
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		require.NoError(t, err)
		names := []string{}
		for _, f := range zr.File {
			names = append(names, f.Name)
		}
		require.Contains(t, names, "Folder/a.png")
	})

	t.Run("TrashRestoreEmpty", func(t *testing.T) {
		item := driveAPIAdd(t, th.Client, th.BasicChannel.Id, "", "bin.png", []byte("x"))
		_, err := th.Client.DeleteDriveItems(ctx, th.BasicChannel.Id, []string{item.Id}, false)
		require.NoError(t, err)
		trash, _, err := th.Client.GetDriveTrash(ctx, th.BasicChannel.Id)
		require.NoError(t, err)
		require.True(t, slices.ContainsFunc(trash, func(it *model.DriveItem) bool { return it.Id == item.Id }))
		_, err = th.Client.RestoreDriveItems(ctx, th.BasicChannel.Id, []string{item.Id})
		require.NoError(t, err)
		_, err = th.Client.DeleteDriveItems(ctx, th.BasicChannel.Id, []string{item.Id}, false)
		require.NoError(t, err)
		_, err = th.Client.EmptyDriveTrash(ctx, th.BasicChannel.Id)
		require.NoError(t, err)
		trash, _, err = th.Client.GetDriveTrash(ctx, th.BasicChannel.Id)
		require.NoError(t, err)
		require.False(t, slices.ContainsFunc(trash, func(it *model.DriveItem) bool { return it.Id == item.Id }))
	})
}

func TestDriveAPIABACDenied(t *testing.T) {
	th := setupDriveAPI(t, SetupConfig(t, func(cfg *model.Config) {
		cfg.FeatureFlags.PermissionPolicies = true
		cfg.AccessControlSettings.EnableAttributeBasedAccessControl = model.NewPointer(true)
	}).InitBasic(t))

	mockACS := &mocks.AccessControlServiceInterface{}
	original := th.App.Srv().Channels().AccessControl
	th.App.Srv().Channels().AccessControl = mockACS
	t.Cleanup(func() { th.App.Srv().Channels().AccessControl = original })
	mockACS.On("AccessEvaluation", mock.Anything, mock.MatchedBy(func(req model.AccessRequest) bool {
		return req.Action == model.AccessControlPolicyActionDownloadFileAttachment && req.Resource.ID == th.BasicChannel.Id
	})).Return(model.AccessDecision{Decision: false}, (*model.AppError)(nil))
	mockACS.On("AccessEvaluation", mock.Anything, mock.Anything).Return(model.AccessDecision{Decision: true}, (*model.AppError)(nil)).Maybe()
	mockACS.On("GetPolicy", mock.Anything, mock.AnythingOfType("string")).Return(nil, (*model.AppError)(nil)).Maybe()
	mockACS.On("DeletePolicy", mock.Anything, mock.AnythingOfType("string")).Return((*model.AppError)(nil)).Maybe()

	_, resp, err := th.Client.GetDriveFolder(context.Background(), th.BasicChannel.Id, "")
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
	_, _, err = th.Client.GetDriveFolder(context.Background(), th.BasicChannel2.Id, "")
	require.NoError(t, err)
}

func TestDriveAPIRules(t *testing.T) {
	ctx := context.Background()
	th := setupDriveAPI(t, Setup(t).InitBasic(t))
	client2 := th.CreateClient()
	th.LoginBasic2WithClient(t, client2)

	folder, err := th.App.Srv().Store().DriveItem().Save(&model.DriveItem{
		ChannelId: th.BasicChannel.Id, Type: model.DriveItemTypeFolder, Name: "Restricted", CreatorId: th.BasicUser.Id,
		DriveRules: model.DriveRules{ViewDepartments: []string{model.NewId()}},
	})
	require.NoError(t, err)

	_, resp, err := client2.GetDriveFolder(ctx, th.BasicChannel.Id, folder.Id)
	require.Error(t, err)
	CheckNotFoundStatus(t, resp)
	listing, _, err := th.SystemAdminClient.GetDriveFolder(ctx, th.BasicChannel.Id, folder.Id)
	require.NoError(t, err)
	require.NotNil(t, listing)
	root, _, err := client2.GetDriveFolder(ctx, th.BasicChannel.Id, "")
	require.NoError(t, err)
	require.Empty(t, root.Items)
}

func TestDriveCreateRulesAPI(t *testing.T) {
	ctx := context.Background()
	th := setupDriveAPI(t, Setup(t).InitBasic(t))
	client2 := th.CreateClient()
	th.LoginBasic2WithClient(t, client2)

	locked, err := th.App.Srv().Store().DriveItem().Save(&model.DriveItem{ChannelId: th.BasicChannel.Id, Type: model.DriveItemTypeFolder, Name: "Locked", CreatorId: th.BasicUser.Id, DriveRules: model.DriveRules{ReadOnly: true}})
	require.NoError(t, err)

	_, resp, err := client2.CreateDriveFolder(ctx, th.BasicChannel.Id, locked.Id, "x")
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
	_, resp, err = client2.CreateDriveFolder(ctx, th.BasicChannel.Id, model.NewId(), "x")
	require.Error(t, err)
	CheckBadRequestStatus(t, resp)
}

func TestDriveTaskFiles(t *testing.T) {
	ctx := context.Background()
	th := setupDriveAPI(t, Setup(t).InitBasic(t))
	channelID, teamID := th.BasicChannel.Id, th.BasicTeam.Id

	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamID, &model.TeamPatch{TasksEnabled: model.NewPointer(true), RevisionsEnabled: model.NewPointer(true)})
	require.NoError(t, err)
	section, _, err := th.SystemAdminClient.CreateTaskSection(ctx, &model.TaskSection{TeamId: teamID, Name: "Episode 1", ChannelId: channelID})
	require.NoError(t, err)

	dept, appErr := th.App.CreateDepartment(th.Context, teamID, "BG", "#3366ff")
	require.Nil(t, appErr)
	rank, appErr := th.App.CreateRank(th.Context, teamID, dept.Id, &model.CustomRole{DisplayName: "Artist", Color: "#ff00aa"})
	require.Nil(t, appErr)

	member := func(ranked bool) *model.Client4 {
		user := th.CreateUser(t)
		th.LinkUserToTeam(t, user, th.BasicTeam)
		th.AddUserToChannel(t, user, th.BasicChannel)
		if ranked {
			_, appErr := th.App.SetMemberRanks(th.Context, th.SystemAdminUser.Id, teamID, user.Id, []string{rank.Id})
			require.Nil(t, appErr)
		}
		client := th.CreateClient()
		_, _, err := client.Login(ctx, user.Email, user.Password)
		require.NoError(t, err)
		return client
	}
	deptClient := member(true)
	ownerClient := member(false)
	otherClient := member(false)

	// folder makes a root folder with rules and a task seeded into it.
	folder := func(name string, rules model.DriveRules) *model.Task {
		item, err := th.App.Srv().Store().DriveItem().Save(&model.DriveItem{ChannelId: channelID, Type: model.DriveItemTypeFolder, Name: name, CreatorId: th.BasicUser.Id, DriveRules: rules})
		require.NoError(t, err)
		task, err := th.App.Srv().Store().Task().Save(&model.Task{TeamId: teamID, SectionId: section.Id, CreatorId: th.BasicUser.Id, Title: name, FolderId: item.Id})
		require.NoError(t, err)
		return task
	}
	// post sends a message with one new file about the task and returns the post and the file.
	post := func(client *model.Client4, task *model.Task, message, name string) (*model.Post, string) {
		fileID := driveAPIUpload(t, client, channelID, name, []byte("content of "+name))
		p, _, err := client.CreatePost(ctx, &model.Post{ChannelId: channelID, Message: message, FileIds: []string{fileID}, Props: model.StringInterface{"task_id": task.Id}})
		require.NoError(t, err)
		return p, fileID
	}
	fileName := func(fileID string) string {
		info, _, err := th.SystemAdminClient.GetFileInfo(ctx, fileID)
		require.NoError(t, err)
		return info.Name
	}

	writeTask := folder("Write", model.DriveRules{WriteDepartments: []string{dept.Id}})
	openTask := folder("Open", model.DriveRules{})
	hiddenTask := folder("Hidden", model.DriveRules{ViewDepartments: []string{dept.Id}, WriteDepartments: []string{dept.Id}})

	t.Run("RenameOwnFileWithoutWriteRule", func(t *testing.T) {
		p, fileID := post(ownerClient, openTask, "m", "own.png")
		info, _, err := ownerClient.RenameDriveTaskFile(ctx, channelID, fileID, "mine.png")
		require.NoError(t, err)
		require.Equal(t, "mine.png", info.Name)
		require.Equal(t, "mine.png", fileName(fileID))
		got, _, err := th.SystemAdminClient.GetPost(ctx, p.Id, "")
		require.NoError(t, err)
		require.Len(t, got.Metadata.Files, 1)
		require.Equal(t, "mine.png", got.Metadata.Files[0].Name)

		_, fileID = post(ownerClient, openTask, "m", "own.png")
		_, resp, err := otherClient.RenameDriveTaskFile(ctx, channelID, fileID, "nope.png")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("RenameByWriteDepartment", func(t *testing.T) {
		_, fileID := post(ownerClient, writeTask, "m", "a.png")
		_, resp, err := otherClient.RenameDriveTaskFile(ctx, channelID, fileID, "x.png")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = ownerClient.RenameDriveTaskFile(ctx, channelID, fileID, "x.png")
		require.Error(t, err, "outside the department, even for their own file")
		CheckForbiddenStatus(t, resp)

		_, _, err = deptClient.RenameDriveTaskFile(ctx, channelID, fileID, "b.png")
		require.NoError(t, err)
		require.Equal(t, "b.png", fileName(fileID))
		_, _, err = th.SystemAdminClient.RenameDriveTaskFile(ctx, channelID, fileID, "c.png")
		require.NoError(t, err, "a channel manager")
		require.Equal(t, "c.png", fileName(fileID))

		_, resp, err = th.SystemAdminClient.RenameDriveTaskFile(ctx, channelID, fileID, "a/b.png")
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("RenameOneOfTwoSameNames", func(t *testing.T) {
		_, first := post(deptClient, writeTask, "m", "a.png")
		_, second := post(deptClient, writeTask, "m", "a.png")
		_, _, err := deptClient.RenameDriveTaskFile(ctx, channelID, first, "renamed.png")
		require.NoError(t, err)
		require.Equal(t, "renamed.png", fileName(first))
		require.Equal(t, "a.png", fileName(second))
	})

	t.Run("ViewRestrictedFolder", func(t *testing.T) {
		_, fileID := post(deptClient, hiddenTask, "m", "secret.png")
		_, resp, err := otherClient.RenameDriveTaskFile(ctx, channelID, fileID, "x.png")
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = otherClient.DeleteDriveTaskFile(ctx, channelID, fileID)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		require.Equal(t, "secret.png", fileName(fileID))
	})

	t.Run("DeleteKeepsMessageAndHistory", func(t *testing.T) {
		fileID := driveAPIUpload(t, deptClient, channelID, "keep.png", []byte("k"))
		other := driveAPIUpload(t, deptClient, channelID, "stay.png", []byte("s"))
		p, _, err := deptClient.CreatePost(ctx, &model.Post{ChannelId: channelID, Message: "hello", FileIds: []string{fileID, other}, Props: model.StringInterface{"task_id": writeTask.Id}})
		require.NoError(t, err)

		_, err = deptClient.DeleteDriveTaskFile(ctx, channelID, fileID)
		require.NoError(t, err)
		got, _, err := th.SystemAdminClient.GetPost(ctx, p.Id, "")
		require.NoError(t, err)
		require.Equal(t, "hello", got.Message)
		require.Equal(t, model.StringArray{other}, got.FileIds)

		history, err := th.App.Srv().Store().Post().GetEditHistoryForPost(p.Id)
		require.NoError(t, err)
		require.Len(t, history, 1)
		require.Contains(t, history[0].FileIds, fileID, "the earlier version keeps the file")
	})

	t.Run("DeleteFileOnlyPost", func(t *testing.T) {
		p, fileID := post(deptClient, writeTask, "", "only.png")
		_, err := deptClient.DeleteDriveTaskFile(ctx, channelID, fileID)
		require.NoError(t, err)
		got, _, err := th.SystemAdminClient.GetPost(ctx, p.Id, "")
		if err == nil {
			require.NotZero(t, got.DeleteAt)
		}
	})

	t.Run("NotATaskFile", func(t *testing.T) {
		loose := driveAPIUpload(t, th.SystemAdminClient, channelID, "loose.png", []byte("l"))
		_, resp, err := th.SystemAdminClient.RenameDriveTaskFile(ctx, channelID, loose, "x.png")
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
		resp, err = th.SystemAdminClient.DeleteDriveTaskFile(ctx, channelID, loose)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)

		elsewhere := driveAPIUpload(t, th.SystemAdminClient, th.BasicChannel2.Id, "else.png", []byte("e"))
		_, _, err = th.SystemAdminClient.CreatePost(ctx, &model.Post{ChannelId: th.BasicChannel2.Id, Message: "m", FileIds: []string{elsewhere}})
		require.NoError(t, err)
		_, resp, err = th.SystemAdminClient.RenameDriveTaskFile(ctx, channelID, elsewhere, "x.png")
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)
	})
}
