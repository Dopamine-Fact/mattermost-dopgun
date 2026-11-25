// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func teamFilesTestTemplate() []*model.TeamFilesFolder {
	return []*model.TeamFilesFolder{
		{Name: "00_MANAGEMENT", Access: model.TeamFilesAccessAdmin, Children: []*model.TeamFilesFolder{{Name: "CONTRACTS"}}},
		{Name: "01_DOCTRINE", Access: model.TeamFilesAccessRead, Children: []*model.TeamFilesFolder{{Name: "00_CONSTITUTION"}}},
		{Name: "02_PRODUCTION", Kind: model.TeamFilesKindProduction},
		{Name: "03_LIBRARY", Kind: model.TeamFilesKindLibrary, Children: []*model.TeamFilesFolder{{Name: "CHARACTERS"}}},
		{Name: "05_PROJECTS", Kind: model.TeamFilesKindProjects},
	}
}

func TestTeamFiles(t *testing.T) {
	th := setupDrive(t)
	team := th.BasicTeam
	admin := th.SystemAdminUser
	th.LinkUserToTeam(t, admin, team)
	member := th.CreateUser(t)
	th.LinkUserToTeam(t, member, team)

	folders, appErr := th.App.ApplyTeamFilesTemplate(th.Context, admin.Id, team.Id, teamFilesTestTemplate())
	require.Nil(t, appErr)
	byName := map[string]string{}
	model.WalkTeamFilesTemplate(folders, func(f, _ *model.TeamFilesFolder) { byName[f.Name] = f.Id })
	assert.Empty(t, byName["02_PRODUCTION"], "virtual folders get no drive folder")
	require.NotEmpty(t, byName["CHARACTERS"])

	team, appErr = th.App.GetTeam(team.Id)
	require.Nil(t, appErr)
	require.NotEmpty(t, team.FilesChannelId)
	th.BasicTeam = team // fixtures update the team from th.BasicTeam
	channel, appErr := th.App.GetChannel(th.Context, team.FilesChannelId)
	require.Nil(t, appErr)
	assert.Equal(t, model.ChannelTypePrivate, channel.Type)

	t.Run("applying again keeps the folders", func(t *testing.T) {
		again, appErr := th.App.ApplyTeamFilesTemplate(th.Context, admin.Id, team.Id, teamFilesTestTemplate())
		require.Nil(t, appErr)
		model.WalkTeamFilesTemplate(again, func(f, _ *model.TeamFilesFolder) { assert.Equal(t, byName[f.Name], f.Id, f.Name) })
	})

	t.Run("layout hides the admin folder and joins the member", func(t *testing.T) {
		layout, appErr := th.App.GetTeamFilesLayout(th.Context, driveSession(member), team.Id)
		require.Nil(t, appErr)
		assert.False(t, layout.IsAdmin)
		assert.Equal(t, channel.Id, layout.ChannelId)
		names := []string{}
		for _, f := range layout.Folders {
			names = append(names, f.Name)
		}
		assert.Equal(t, []string{"01_DOCTRINE", "02_PRODUCTION", "03_LIBRARY", "05_PROJECTS"}, names)
		_, appErr = th.App.GetChannelMember(th.Context, channel.Id, member.Id)
		require.Nil(t, appErr)

		layout, appErr = th.App.GetTeamFilesLayout(th.Context, driveSession(admin), team.Id)
		require.Nil(t, appErr)
		assert.True(t, layout.IsAdmin)
		assert.Len(t, layout.Folders, 5)
	})

	s := driveSession(member)
	t.Run("the server enforces the folder access", func(t *testing.T) {
		root, appErr := th.App.ListDriveFolder(th.Context, s, channel, "")
		require.Nil(t, appErr)
		assert.False(t, slices.ContainsFunc(root.Items, func(it *model.DriveItem) bool { return it.Id == byName["00_MANAGEMENT"] }))
		_, appErr = th.App.ListDriveFolder(th.Context, s, channel, byName["CONTRACTS"])
		require.NotNil(t, appErr)
		assert.Equal(t, http.StatusNotFound, appErr.StatusCode)

		assert.False(t, th.App.DriveCanCreateIn(th.Context, s, channel, ""), "only admins add top folders")
		assert.False(t, th.App.DriveCanCreateIn(th.Context, s, channel, byName["00_CONSTITUTION"]), "doctrine is read-only")
		assert.False(t, th.App.DriveCanCreateIn(th.Context, s, channel, byName["CHARACTERS"]), "library needs a writing department")
		assert.True(t, th.App.DriveCanCreateIn(th.Context, s, channel, byName["05_PROJECTS"]))
		assert.True(t, th.App.DriveCanCreateIn(th.Context, driveSession(admin), channel, byName["00_CONSTITUTION"]))

		doctrine, appErr := th.App.ListDriveFolder(th.Context, s, channel, byName["01_DOCTRINE"])
		require.Nil(t, appErr)
		assert.Equal(t, model.DriveAccessRead, doctrine.Access)

		item, err := th.App.Srv().Store().DriveItem().Get(byName["05_PROJECTS"])
		require.NoError(t, err)
		v, appErr := th.App.driveViewerFor(th.Context, s, channel)
		require.Nil(t, appErr)
		assert.False(t, th.App.driveCanModify(th.Context, s, channel, v, item), "template folders are the admins'")
	})

	t.Run("library writers come from their department", func(t *testing.T) {
		dept := newDepartment(t, th, team.Id, "Vis-Dev")
		giveRanks(t, th, team.Id, member, newRank(t, th, team.Id, dept.Id, "Supervisor"))
		yes := true
		_, appErr := th.App.PatchDepartment(th.Context, team.Id, dept.Id, &model.DepartmentPatch{LibraryWrite: &yes})
		require.Nil(t, appErr)
		assert.True(t, th.App.DriveCanCreateIn(th.Context, s, channel, byName["CHARACTERS"]))
		assert.False(t, th.App.DriveCanCreateIn(th.Context, s, channel, byName["00_CONSTITUTION"]))
	})

	t.Run("projects folders are shared read-only with other teams", func(t *testing.T) {
		project, appErr := th.App.CreateDriveFolder(th.Context, member.Id, channel, byName["05_PROJECTS"], "Ortak Film", model.DriveRules{})
		require.Nil(t, appErr)
		other := th.CreateTeam(t)
		outsider := th.CreateUser(t)
		th.LinkUserToTeam(t, outsider, other)

		_, appErr = th.App.SetDriveFolderShares(th.Context, s, channel, project.Id, []string{other.Id})
		require.NotNil(t, appErr, "members do not share")
		_, appErr = th.App.SetDriveFolderShares(th.Context, driveSession(admin), channel, byName["01_DOCTRINE"], []string{other.Id})
		require.NotNil(t, appErr, "only folders inside the projects folder are shared")
		ids, appErr := th.App.SetDriveFolderShares(th.Context, driveSession(admin), channel, project.Id, []string{other.Id, team.Id})
		require.Nil(t, appErr)
		assert.Equal(t, []string{other.Id}, ids, "a team does not share with itself")

		info := driveUpload(t, th, member, channel, "board.png", []byte("storyboard"))
		_, appErr = th.App.AddDriveFile(th.Context, member.Id, channel, project.Id, info.Id)
		require.Nil(t, appErr)

		roots, appErr := th.App.ListSharedDriveFolder(other.Id, "")
		require.Nil(t, appErr)
		require.Len(t, roots.Items, 1)
		assert.Equal(t, project.Id, roots.Items[0].Id)
		inside, appErr := th.App.ListSharedDriveFolder(other.Id, project.Id)
		require.Nil(t, appErr)
		require.Len(t, inside.Items, 1)
		assert.Equal(t, model.DriveAccessRead, inside.Access)

		_, appErr = th.App.ListSharedDriveFolder(other.Id, byName["01_DOCTRINE"])
		require.NotNil(t, appErr)
		empty, appErr := th.App.ListSharedDriveFolder(team.Id, "")
		require.Nil(t, appErr)
		assert.Empty(t, empty.Items)

		assert.True(t, th.App.CanReadSharedDriveFile(th.Context, outsider.Id, info))
		stranger := th.CreateUser(t)
		assert.False(t, th.App.CanReadSharedDriveFile(th.Context, stranger.Id, info))

		_, appErr = th.App.SetDriveFolderShares(th.Context, driveSession(admin), channel, project.Id, nil)
		require.Nil(t, appErr)
		assert.False(t, th.App.CanReadSharedDriveFile(th.Context, outsider.Id, info))
	})

	t.Run("tasks reflect their files into a library folder", func(t *testing.T) {
		task := &model.Task{Id: model.NewId(), TeamId: team.Id, CreatorId: admin.Id, LibraryFolderId: byName["00_CONSTITUTION"]}
		require.NotNil(t, th.App.validateTaskFolders(task, false, true))
		task.LibraryFolderId = byName["CHARACTERS"]
		require.Nil(t, th.App.validateTaskFolders(task, false, true))

		seeded := driveTestTask(t, th, "")
		seeded.LibraryFolderId = byName["CHARACTERS"]
		_, err := th.App.Srv().Store().Task().Update(seeded)
		require.NoError(t, err)
		info := taskFilePost(t, th, th.BasicChannel, seeded.Id, "model_sheet.png")
		listing, appErr := th.App.ListDriveFolder(th.Context, s, channel, byName["CHARACTERS"])
		require.Nil(t, appErr)
		require.Len(t, listing.TaskFiles, 1)
		assert.Equal(t, info.Id, listing.TaskFiles[0].Id)
		assert.Equal(t, seeded.Id, listing.TaskFiles[0].TaskId)
	})
}

func TestTeamFilesParseTemplate(t *testing.T) {
	folders, appErr := model.ParseTeamFilesTemplate(`[{"name":"03_LIBRARY","kind":"library","description":"Varlıklar","children":[{"name":"RIGS"}]}]`)
	require.Nil(t, appErr)
	require.Len(t, folders, 1)
	assert.Equal(t, "RIGS", folders[0].Children[0].Name)

	for name, text := range map[string]string{
		"duplicate name":     `[{"name":"A"},{"name":"a"}]`,
		"bad name":           `[{"name":"a/b"}]`,
		"nested kind":        `[{"name":"A","children":[{"name":"B","kind":"library"}]}]`,
		"unknown access":     `[{"name":"A","access":"secret"}]`,
		"virtual with child": `[{"name":"A","kind":"channels","children":[{"name":"B"}]}]`,
	} {
		_, appErr := model.ParseTeamFilesTemplate(text)
		assert.NotNil(t, appErr, name)
	}
	none, appErr := model.ParseTeamFilesTemplate("  ")
	assert.Nil(t, appErr)
	assert.Nil(t, none)
}
