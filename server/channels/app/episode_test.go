// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"fmt"
	"testing"
	"time"

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
	var titles, ids []string
	for _, task := range tasks {
		if task.SectionId == got.Section.Id {
			require.Equal(t, model.TaskStatusTodo, task.Status)
			require.Equal(t, th.BasicUser.Id, task.CreatorId)
			titles = append(titles, task.Title)
			ids = append(ids, task.Id)
		}
	}
	require.ElementsMatch(t, []string{"Storyboard", "Animatic"}, titles)
	require.ElementsMatch(t, ids, got.TaskIds, "the client deletes these if the episode is rolled back")
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
	failed, _ := th.App.seedEpisodeFolders(th.Context, th.BasicUser.Id, &team, ch)
	require.Equal(t, []string{"Src/bad:name", "M"}, failed)
	items, err := th.App.Srv().Store().DriveItem().GetChildren(ch.Id, "", 100)
	require.NoError(t, err)
	require.Len(t, items, 1) // Src only
}

// A second entry for an existing path must not pass as success while its rules are dropped.
func TestCreateEpisodeDuplicatePathWithRulesFails(t *testing.T) {
	th := setupEpisode(t, "", "")
	team := *th.BasicTeam
	team.EpisodeFolders = fmt.Sprintf(`[{"path":"A"},{"path":"A","view_departments":["%s"]}]`, model.NewId())
	ch := th.CreateChannel(t, th.BasicTeam)
	failed, _ := th.App.seedEpisodeFolders(th.Context, th.BasicUser.Id, &team, ch)
	require.Equal(t, []string{"A"}, failed)
	require.False(t, episodeChild(t, th, ch.Id, "", "A").DriveRules.HasRules())
}

func episodeTasksByTitle(t *testing.T, th *TestHelper, sectionID string) map[string]*model.Task {
	t.Helper()
	tasks, appErr := th.App.GetTasksForTeam(th.BasicTeam.Id)
	require.Nil(t, appErr)
	byTitle := map[string]*model.Task{}
	for _, task := range tasks {
		if task.SectionId == sectionID {
			byTitle[task.Title] = task
		}
	}
	return byTitle
}

func TestCreateEpisodeTaskRules(t *testing.T) {
	dept := model.NewId()
	th := setupEpisode(t, `[{"path":"BG/Layout"}]`, "")
	th.BasicTeam.EpisodeTasks = fmt.Sprintf(`[{"key":"a","title":"Storyboard","department_id":"%s","due_days":5},`+
		`{"key":"b","title":"Layout","assignee_id":"%s","waits_for":["a"],"folder":"BG/Layout"},`+
		`{"key":"c","title":"Mine","assignee_id":"%s"}]`, dept, th.BasicUser2.Id, th.BasicUser.Id)
	team, err := th.App.Srv().Store().Team().Update(th.BasicTeam)
	require.NoError(t, err)
	th.BasicTeam = team

	th.BasicUser.Timezone = model.StringMap{"useAutomaticTimezone": "false", "manualTimezone": "Europe/Istanbul", "automaticTimezone": ""}
	_, appErr := th.App.UpdateUser(th.Context, th.BasicUser, false)
	require.Nil(t, appErr)

	// The code reads the clock itself, so accept the due date of the day before or after the call: a run that
	// straddles midnight must not flake.
	loc, lerr := time.LoadLocation("Europe/Istanbul")
	require.NoError(t, lerr)
	before := time.Now().In(loc)
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-rules", DisplayName: "Rules"})
	after := time.Now().In(loc)
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)
	require.Len(t, got.TaskIds, 3)

	byTitle := episodeTasksByTitle(t, th, got.Section.Id)
	story, layout := byTitle["Storyboard"], byTitle["Layout"]
	due := func(now time.Time) int64 {
		day := now.AddDate(0, 0, 5)
		return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc).UnixMilli()
	}
	require.Contains(t, []int64{due(before), due(after)}, story.DueAt)
	require.Equal(t, dept, story.DepartmentId)
	require.Empty(t, story.AssigneeId)
	require.Equal(t, model.StringArray{}, story.WaitsFor)

	bg := episodeChild(t, th, got.Channel.Id, "", "BG")
	require.Equal(t, th.BasicUser2.Id, layout.AssigneeId)
	require.Equal(t, model.StringArray{story.Id}, layout.WaitsFor)
	require.Equal(t, episodeChild(t, th, got.Channel.Id, bg.Id, "Layout").Id, layout.FolderId)
	require.Zero(t, layout.DueAt)

	bot, appErr := th.App.GetSystemBot(th.Context)
	require.Nil(t, appErr)
	dm, appErr := th.App.GetOrCreateDirectChannel(th.Context, th.BasicUser2.Id, bot.UserId)
	require.Nil(t, appErr)
	posts, appErr := th.App.GetPosts(th.Context, dm.Id, 0, 10)
	require.Nil(t, appErr)
	require.Len(t, posts.Posts, 1)
	for _, p := range posts.Posts {
		require.Contains(t, p.Message, "Layout")
	}
	dm, appErr = th.App.GetOrCreateDirectChannel(th.Context, th.BasicUser.Id, bot.UserId)
	require.Nil(t, appErr)
	posts, appErr = th.App.GetPosts(th.Context, dm.Id, 0, 10)
	require.Nil(t, appErr)
	require.Empty(t, posts.Posts)
}

func TestCreateEpisodeTaskRulesLegacyTemplate(t *testing.T) {
	th := setupEpisode(t, "", "Storyboard\nAnimatic")
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-lines", DisplayName: "Lines"})
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)
	byTitle := episodeTasksByTitle(t, th, got.Section.Id)
	require.Len(t, byTitle, 2)
	for _, task := range byTitle {
		require.Empty(t, task.DepartmentId)
		require.Empty(t, task.FolderId)
		require.Equal(t, model.StringArray{}, task.WaitsFor)
		require.Zero(t, task.DueAt)
	}
}

// A template assignee who is no longer an active team member seeds the task unassigned, not failed; with a
// department it is a pool task.
func TestCreateEpisodeAssigneeLeftTeam(t *testing.T) {
	gone, dept := model.NewId(), model.NewId()
	th := setupEpisode(t, "", fmt.Sprintf(`[{"key":"a","title":"Pool","department_id":"%s","assignee_id":"%s"},{"key":"b","title":"Plain","assignee_id":"%s"}]`, dept, gone, gone))
	got, appErr := th.App.CreateEpisode(th.Context, th.BasicUser.Id, th.BasicTeam.Id, &model.EpisodeCreate{Name: "ep-gone", DisplayName: "Gone"})
	require.Nil(t, appErr)
	require.Empty(t, got.Failed)
	byTitle := episodeTasksByTitle(t, th, got.Section.Id)
	require.Len(t, byTitle, 2)
	require.Empty(t, byTitle["Pool"].AssigneeId)
	require.Equal(t, dept, byTitle["Pool"].DepartmentId)
	require.Empty(t, byTitle["Plain"].AssigneeId)
}
