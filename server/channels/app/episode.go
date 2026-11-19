// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"slices"
	"strings"

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
	created.Failed = append(created.Failed, a.seedEpisodeFolders(rctx, userID, team, channel)...)
	for _, title := range model.EpisodeTemplateLines(team.EpisodeTasks) {
		task := &model.Task{TeamId: teamID, SectionId: section.Id, Title: title, Status: model.TaskStatusTodo, CreatorId: userID}
		saved, appErr := a.CreateTask(rctx, task, "")
		if appErr != nil {
			rctx.Logger().Warn("Failed to create an episode task", mlog.String("title", title), mlog.Err(appErr))
			created.Failed = append(created.Failed, title)
			continue
		}
		created.TaskIds = append(created.TaskIds, saved.Id)
	}
	return created, nil
}

// seedEpisodeFolders returns the template paths that could not be created.
func (a *App) seedEpisodeFolders(rctx request.CTX, userID string, team *model.Team, channel *model.Channel) []string {
	folders, err := model.ParseEpisodeFolders(team.EpisodeFolders)
	if err != nil || len(folders) == 0 {
		return nil
	}
	var failed []string
	if _, appErr := a.RequireDriveChannel(rctx, channel.Id); appErr != nil {
		for _, f := range folders {
			failed = append(failed, f.Path)
		}
		return failed
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
		rules.MirrorOf = ids["/"+strings.ToLower(strings.TrimSpace(f.MirrorOf))]
		if rules.MirrorOf == "" {
			failed = append(failed, f.Path)
		} else if _, ok := ensure(f.Path, rules); !ok {
			failed = append(failed, f.Path)
		}
	}
	return failed
}
