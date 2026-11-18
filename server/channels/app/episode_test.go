// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func setupEpisode(t *testing.T, folders, tasks string) *TestHelper {
	t.Helper()
	th := setupDrive(t)
	th.BasicTeam.TasksEnabled = true
	th.BasicTeam.RevisionsEnabled = true
	th.BasicTeam.EpisodeFolders = folders
	th.BasicTeam.EpisodeTasks = tasks
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team
	return th
}

func episodeChild(t *testing.T, th *TestHelper, channelID, parentID, name string) *model.DriveItem {
	t.Helper()
	items, err := th.App.Srv().Store().DriveItem().GetChildren(channelID, parentID, 100)
	require.NoError(t, err)
	for _, it := range items {
		if it.Name == name {
			return it
		}
	}
	require.FailNow(t, "no drive item "+name)
	return nil
}

func TestCreateEpisode(t *testing.T) {
	bg, anim := model.NewId(), model.NewId()
	th := setupEpisode(t, fmt.Sprintf(`[{"path":"BG/Layout","view_departments":["%s"]},{"path":"Anim/Layout","mirror_of":"BG/Layout","view_departments":["%s"]},{"path":"Notes"}]`, bg, anim), "Storyboard\nAnimatic")
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-one", DisplayName: "Episode One"})
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)

	ch, appErr := th.App.GetChannelByName(th.Context, "ep-one", th.BasicTeam.Id, false)
	require.Nil(t, appErr)
	require.Equal(t, ch.Id, got.Channel.Id)
	require.Equal(t, ch.Id, got.Section.ChannelId)

	root, err := th.App.Srv().Store().DriveItem().GetChildren(ch.Id, "", 100)
	require.NoError(t, err)
	names := []string{}
	for _, it := range root {
		names = append(names, it.Name)
	}
	require.ElementsMatch(t, []string{"Anim", "BG", "Notes"}, names)

	bgFolder := episodeChild(t, th, ch.Id, "", "BG")
	require.False(t, bgFolder.DriveRules.HasRules())
	layout := episodeChild(t, th, ch.Id, bgFolder.Id, "Layout")
	require.Equal(t, model.StringArray{bg}, layout.ViewDepartments)
	require.Equal(t, model.StringArray{bg}, layout.WriteDepartments)
	mirror := episodeChild(t, th, ch.Id, episodeChild(t, th, ch.Id, "", "Anim").Id, "Layout")
	require.Equal(t, layout.Id, mirror.MirrorOf)

	tasks, appErr := th.App.GetTasksForTeam(th.BasicTeam.Id)
	require.Nil(t, appErr)
	var titles []string
	for _, task := range tasks {
		if task.SectionId == got.Section.Id {
			require.Equal(t, model.TaskStatusTodo, task.Status)
			require.Equal(t, th.BasicUser.Id, task.CreatorId)
			titles = append(titles, task.Title)
		}
	}
	require.ElementsMatch(t, []string{"Storyboard", "Animatic"}, titles)
}

func TestCreateEpisodeRulesOnPathCreatedAsIntermediate(t *testing.T) {
	dept := model.NewId()
	th := setupEpisode(t, fmt.Sprintf(`[{"path":"A/B"},{"path":"A","view_departments":["%s"]}]`, dept), "")
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-inter", DisplayName: "Inter"})
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)
	a := episodeChild(t, th, got.Channel.Id, "", "A")
	require.Equal(t, model.StringArray{dept}, a.ViewDepartments)
	episodeChild(t, th, got.Channel.Id, a.Id, "B")
}

func TestCreateEpisodeLegacyTemplate(t *testing.T) {
	th := setupEpisode(t, "A\nA/B", "")
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-legacy", DisplayName: "Legacy"})
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)
	a := episodeChild(t, th, got.Channel.Id, "", "A")
	b := episodeChild(t, th, got.Channel.Id, a.Id, "B")
	require.False(t, a.DriveRules.HasRules())
	require.False(t, b.DriveRules.HasRules())
}

func TestCreateEpisodeSectionFailureRemovesChannel(t *testing.T) {
	th := setupEpisode(t, "", "")
	th.BasicTeam.TasksEnabled = false
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team

	_, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-gone", DisplayName: "Gone"})
	require.NotNil(t, appErr)
	_, err = th.App.Srv().Store().Channel().GetByName(th.BasicTeam.Id, "ep-gone", true)
	var nf *store.ErrNotFound
	require.ErrorAs(t, err, &nf)
}

func TestCreateEpisodeDriveDisabled(t *testing.T) {
	th := setupEpisode(t, `[{"path":"A/B"},{"path":"C"}]`, "T")
	th.BasicTeam.FilesEnabled = false
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team

	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-nodrive", DisplayName: "No drive"})
	require.Nil(t, appErr)
	require.Equal(t, []string{"A/B", "C"}, got.Failed)
}

// The template validator rejects bad names, so seed a hand-made template whose mirror source cannot be created.
func TestCreateEpisodeFailedMirrorSourceSkipsMirror(t *testing.T) {
	th := setupEpisode(t, "", "")
	team := *th.BasicTeam
	team.EpisodeFolders = `[{"path":"Src/bad:name"},{"path":"M","mirror_of":"Src/bad:name"}]`
	ch := th.CreateChannel(t, th.BasicTeam)
	failed := th.App.seedEpisodeFolders(th.Context, th.BasicUser.Id, &team, ch)
	require.Equal(t, []string{"Src/bad:name", "M"}, failed)
	items, err := th.App.Srv().Store().DriveItem().GetChildren(ch.Id, "", 100)
	require.NoError(t, err)
	require.Len(t, items, 1) // Src only
}
