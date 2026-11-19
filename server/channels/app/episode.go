// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// CreateEpisode creates an open channel with its task section, then seeds the team's template folders (with their
// rules) and tasks. Only a failed section undoes the channel; folders and tasks that fail are reported in Failed.
func (a *App) CreateEpisode(rctx request.CTX, userID, teamID string, in *model.EpisodeCreate) (*model.EpisodeCreated, *model.AppError) {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	channel, appErr := a.CreateChannelWithUser(rctx, &model.Channel{TeamId: teamID, Name: in.Name, DisplayName: in.DisplayName, Type: model.ChannelTypeOpen}, userID)
	if appErr != nil {
		return nil, appErr
	}
	section, appErr := a.CreateTaskSection(rctx, &model.TaskSection{TeamId: teamID, Name: in.DisplayName, ChannelId: channel.Id}, "")
	if appErr != nil {
		if delErr := a.PermanentDeleteChannel(rctx, channel); delErr != nil {
			rctx.Logger().Error("Failed to remove the channel of a failed episode", mlog.String("channel_id", channel.Id), mlog.Err(delErr))
		}
		return nil, appErr
	}

	created := &model.EpisodeCreated{Channel: channel, Section: section, Failed: []string{}, TaskIds: []string{}}
	failedFolders, folderIDs := a.seedEpisodeFolders(rctx, userID, team, channel)
	created.Failed = append(created.Failed, failedFolders...)
	a.seedEpisodeTasks(rctx, userID, team, section, folderIDs, created)
	return created, nil
}

// seedEpisodeTasks creates the template's tasks in order, then fills each task's WaitsFor from the entries that seeded.
// It writes through CreateTask and the store, so the lock and claim rules (which guard edits) do not apply.
func (a *App) seedEpisodeTasks(rctx request.CTX, userID string, team *model.Team, section *model.TaskSection, folderIDs map[string]string, created *model.EpisodeCreated) {
	loc := time.UTC
	if user, appErr := a.GetUser(rctx, userID); appErr == nil {
		if l, err := time.LoadLocation(user.GetPreferredTimezone()); err == nil {
			loc = l
		}
	}
	now := time.Now().In(loc)

	entries := model.ParseEpisodeTasks(team.EpisodeTasks)
	saved := map[string]*model.Task{} // template key -> seeded task
	for _, entry := range entries {
		task := &model.Task{TeamId: team.Id, SectionId: section.Id, Title: entry.Title, Status: model.TaskStatusTodo, CreatorId: userID,
			DepartmentId: entry.DepartmentId, AssigneeId: entry.AssigneeId, WaitsFor: model.StringArray{}}
		if task.AssigneeId != "" {
			// A template assignee who left the team seeds the task unassigned, a pool task if it has a department.
			if member, appErr := a.GetTeamMember(rctx, team.Id, task.AssigneeId); appErr != nil || member.DeleteAt != 0 {
				task.AssigneeId = ""
			}
		}
		if entry.Folder != "" {
			task.FolderId = folderIDs[folderKey(entry.Folder)]
		}
		if entry.DueDays != nil {
			task.DueAt = time.Date(now.Year(), now.Month(), now.Day()+*entry.DueDays, 0, 0, 0, 0, loc).UnixMilli()
		}
		seeded, appErr := a.CreateTask(rctx, task, "")
		if appErr != nil {
			rctx.Logger().Warn("Failed to create an episode task", mlog.String("title", entry.Title), mlog.Err(appErr))
			created.Failed = append(created.Failed, entry.Title)
			continue
		}
		saved[entry.Key] = seeded
		created.TaskIds = append(created.TaskIds, seeded.Id)
	}

	for _, entry := range entries {
		task := saved[entry.Key]
		if task == nil || len(entry.WaitsFor) == 0 {
			continue
		}
		for _, key := range entry.WaitsFor {
			if pre := saved[key]; pre != nil && !slices.Contains(task.WaitsFor, pre.Id) {
				task.WaitsFor = append(task.WaitsFor, pre.Id)
			}
		}
		if len(task.WaitsFor) == 0 {
			continue
		}
		updated, err := a.Srv().Store().Task().Update(task)
		if err != nil {
			rctx.Logger().Warn("Failed to set the waits-for of an episode task", mlog.String("task_id", task.Id), mlog.Err(err))
			continue
		}
		a.publishTaskEvent(rctx, model.WebsocketTaskUpserted, updated.TeamId, "task", updated, "")
	}
}

// folderKey is the key of a folder path in the ids map: "/" plus the lowercased, trimmed segments.
func folderKey(path string) string {
	key := ""
	for _, name := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' }) {
		key += "/" + strings.ToLower(strings.TrimSpace(name))
	}
	return key
}

// seedEpisodeFolders returns the template paths that could not be created, and the created folder ids by folderKey.
func (a *App) seedEpisodeFolders(rctx request.CTX, userID string, team *model.Team, channel *model.Channel) ([]string, map[string]string) {
	folders, err := model.ParseEpisodeFolders(team.EpisodeFolders)
	if err != nil || len(folders) == 0 {
		return nil, nil
	}
	var failed []string
	if _, appErr := a.RequireDriveChannel(rctx, channel.Id); appErr != nil {
		for _, f := range folders {
			failed = append(failed, f.Path)
		}
		return failed, nil
	}

	ids := map[string]string{}  // lowercased path -> folder id
	broken := map[string]bool{} // lowercased paths that failed; their subtrees fail too
	// ensure creates the folder at path and any missing ancestors (without rules); rules apply to the last one only.
	ensure := func(path string, rules model.DriveRules) (string, bool) {
		parentID, key := "", ""
		names := strings.FieldsFunc(path, func(r rune) bool { return r == '/' })
		for i, name := range names {
			name = strings.TrimSpace(name)
			key += "/" + strings.ToLower(name)
			if broken[key] {
				return "", false
			}
			id, ok := ids[key]
			if ok && i == len(names)-1 && rules.HasRules() {
				// Never leave a restricted folder rule-less: report it instead of reusing the existing one.
				rctx.Logger().Error("Episode folder already exists, its rules were not applied", mlog.String("path", path))
				return "", false
			}
			if !ok {
				r := model.DriveRules{}
				if i == len(names)-1 {
					r = rules
				}
				item, appErr := a.CreateDriveFolder(rctx, userID, channel, parentID, name, r)
				if appErr != nil {
					rctx.Logger().Warn("Failed to create an episode folder", mlog.String("path", path), mlog.Err(appErr))
					broken[key] = true
					return "", false
				}
				id = item.Id
				ids[key] = id
			}
			parentID = id
		}
		return parentID, parentID != ""
	}

	// Parents first, so an explicit entry is never preceded by its auto-created, rule-less intermediate.
	slices.SortStableFunc(folders, func(x, y *model.EpisodeFolder) int {
		return strings.Count(x.Path, "/") - strings.Count(y.Path, "/")
	})
	var mirrors []*model.EpisodeFolder
	for _, f := range folders {
		if f.MirrorOf != "" {
			mirrors = append(mirrors, f)
		} else if _, ok := ensure(f.Path, f.Rules()); !ok {
			failed = append(failed, f.Path)
		}
	}
	for _, f := range mirrors {
		rules := f.Rules()
		rules.MirrorOf = ids[folderKey(f.MirrorOf)]
		if rules.MirrorOf == "" {
			failed = append(failed, f.Path)
		} else if _, ok := ensure(f.Path, rules); !ok {
			failed = append(failed, f.Path)
		}
	}
	return failed, ids
}

// validateEpisodeTaskDepartments refuses a template that names a department of another team. The model cannot
// check this because it does not know the team's departments.
func (a *App) validateEpisodeTaskDepartments(teamID, tasks string) *model.AppError {
	var wanted []string
	for _, entry := range model.ParseEpisodeTasks(tasks) {
		if entry != nil && entry.DepartmentId != "" {
			wanted = append(wanted, entry.DepartmentId)
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	deps, err := a.Srv().Store().Department().GetForTeam(teamID)
	if err != nil {
		return customRoleStoreError("validateEpisodeTaskDepartments", err)
	}
	for _, id := range wanted {
		if !slices.ContainsFunc(deps, func(d *model.Department) bool { return d.Id == id }) {
			return model.NewAppError("validateEpisodeTaskDepartments", "model.team.is_valid.episode_tasks.app_error", nil, "department_id="+id, http.StatusBadRequest)
		}
	}
	return nil
}
