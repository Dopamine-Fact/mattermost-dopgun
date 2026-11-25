// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// The team files template keeps its real folders in the drive of a private channel per team (Team.FilesChannelId):
// uploads, trash and moves are the drive's own. Members join that channel when they open the Files page; the
// template's top folders add their access on top of the drive rules (driveViewer.files).

// teamFilesRules are the template rules of one viewer in a team files channel.
type teamFilesRules struct {
	top           map[string]*model.TeamFilesFolder // top folder id -> its template entry
	protected     map[string]bool                   // ids of every template folder: only admins rename, move or delete them
	libraryWriter bool                              // one of the viewer's departments may write into the library
}

// access narrows the drive rules of a path (root first) for someone who is not an admin.
func (t *teamFilesRules) access(path []*model.DriveItem, visible bool, write driveWrite) (bool, driveWrite) {
	if len(path) == 0 {
		return visible, driveWriteDenied // only admins add top folders
	}
	top := t.top[path[0].Id]
	if top == nil {
		return visible, write
	}
	switch top.Access {
	case model.TeamFilesAccessAdmin:
		visible = false
	case model.TeamFilesAccessRead:
		write = driveWriteDenied
	}
	if top.Kind == model.TeamFilesKindLibrary && write != driveWriteDenied {
		if t.libraryWriter {
			write = driveWriteAllowed
		} else {
			write = driveWriteDenied
		}
	}
	return visible, write
}

// teamFilesTeam returns the team whose files channel this is, or nil.
func (a *App) teamFilesTeam(channel *model.Channel) *model.Team {
	if channel.TeamId == "" {
		return nil
	}
	team, appErr := a.GetTeam(channel.TeamId)
	if appErr != nil || team.FilesChannelId != channel.Id {
		return nil
	}
	return team
}

// teamFilesFolders parses a team's stored template; a broken one counts as none (it was validated when saved).
func teamFilesFolders(team *model.Team) []*model.TeamFilesFolder {
	folders, appErr := model.ParseTeamFilesTemplate(team.FilesTemplate)
	if appErr != nil {
		return nil
	}
	return folders
}

func (a *App) teamFilesRulesFor(team *model.Team, depts map[string]bool) (*teamFilesRules, *model.AppError) {
	t := &teamFilesRules{top: map[string]*model.TeamFilesFolder{}, protected: map[string]bool{}}
	folders := teamFilesFolders(team)
	for _, f := range folders {
		if f.Id != "" {
			t.top[f.Id] = f
		}
	}
	model.WalkTeamFilesTemplate(folders, func(f, _ *model.TeamFilesFolder) {
		if f.Id != "" {
			t.protected[f.Id] = true
		}
	})
	if len(depts) > 0 {
		list, err := a.Srv().Store().Department().GetForTeam(team.Id)
		if err != nil {
			return nil, customRoleStoreError("teamFilesRulesFor", err)
		}
		t.libraryWriter = slices.ContainsFunc(list, func(d *model.Department) bool { return d.LibraryWrite && depts[d.Id] })
	}
	return t, nil
}

// teamFilesHiddenTops are the admin-only top folders of channel's template; nil when channel is no files channel.
func (a *App) teamFilesHiddenTops(channelID string) map[string]bool {
	channel, appErr := a.GetChannel(request.EmptyContext(a.Log()), channelID)
	if appErr != nil {
		return nil
	}
	team := a.teamFilesTeam(channel)
	if team == nil {
		return nil
	}
	hidden := map[string]bool{}
	for _, f := range teamFilesFolders(team) {
		if f.Access == model.TeamFilesAccessAdmin && f.Id != "" {
			hidden[f.Id] = true
		}
	}
	return hidden
}

// GetTeamFilesTemplate returns the team's template with the ids of the folders it created.
func (a *App) GetTeamFilesTemplate(teamID string) ([]*model.TeamFilesFolder, *model.AppError) {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	folders := teamFilesFolders(team)
	if folders == nil {
		folders = []*model.TeamFilesFolder{}
	}
	return folders, nil
}

// ApplyTeamFilesTemplate saves the team's template and creates its missing folders (and the files channel) as userID.
// Folders are matched by id, then by name; folders the template no longer lists stay in the drive, unlisted.
func (a *App) ApplyTeamFilesTemplate(rctx request.CTX, userID, teamID string, folders []*model.TeamFilesFolder) ([]*model.TeamFilesFolder, *model.AppError) {
	text, _ := json.Marshal(folders)
	if _, appErr := model.ParseTeamFilesTemplate(string(text)); appErr != nil {
		return nil, appErr
	}
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	if len(folders) == 0 {
		team.FilesTemplate = ""
		return []*model.TeamFilesFolder{}, a.saveTeamFiles(team)
	}
	channel, appErr := a.ensureTeamFilesChannel(rctx, userID, team)
	if appErr != nil {
		return nil, appErr
	}
	var place func(list []*model.TeamFilesFolder, parentID string) *model.AppError
	place = func(list []*model.TeamFilesFolder, parentID string) *model.AppError {
		children, err := a.Srv().Store().DriveItem().GetChildren(channel.Id, parentID, driveListLimit)
		if err != nil {
			return driveStoreError("ApplyTeamFilesTemplate", err)
		}
		for _, f := range list {
			if f.IsVirtual() {
				f.Id = ""
				continue
			}
			i := slices.IndexFunc(children, func(c *model.DriveItem) bool { return c.IsFolder() && c.Id == f.Id })
			if i < 0 {
				i = slices.IndexFunc(children, func(c *model.DriveItem) bool { return c.IsFolder() && strings.EqualFold(c.Name, f.Name) })
			}
			if i >= 0 {
				f.Id = children[i].Id
				if children[i].Name != f.Name {
					item := *children[i]
					item.Name = f.Name
					if _, err := a.Srv().Store().DriveItem().Update(&item); err != nil {
						return driveStoreError("ApplyTeamFilesTemplate", err)
					}
				}
			} else {
				item, appErr := a.CreateDriveFolder(rctx, userID, channel, parentID, f.Name, model.DriveRules{})
				if appErr != nil {
					return appErr
				}
				f.Id = item.Id
			}
			if appErr := place(f.Children, f.Id); appErr != nil {
				return appErr
			}
		}
		return nil
	}
	if appErr := place(folders, ""); appErr != nil {
		return nil, appErr
	}
	text, _ = json.Marshal(folders)
	team.FilesTemplate = string(text)
	if appErr := a.saveTeamFiles(team); appErr != nil {
		return nil, appErr
	}
	a.publishDriveChanged(channel.Id, "")
	return folders, nil
}

func (a *App) saveTeamFiles(team *model.Team) *model.AppError {
	updated, err := a.Srv().Store().Team().Update(team)
	if err != nil {
		return model.NewAppError("saveTeamFiles", "app.team.update.updating.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return a.sendTeamEvent(updated, model.WebsocketEventUpdateTeam)
}

// ensureTeamFilesChannel returns the team's live files channel, creating it (with userID as its admin) when missing.
func (a *App) ensureTeamFilesChannel(rctx request.CTX, userID string, team *model.Team) (*model.Channel, *model.AppError) {
	if team.FilesChannelId != "" {
		if channel, appErr := a.GetChannel(rctx, team.FilesChannelId); appErr == nil && channel.DeleteAt == 0 {
			return channel, nil
		}
	}
	channel, appErr := a.CreateChannel(rctx, &model.Channel{
		TeamId:      team.Id,
		Name:        "dosyalar-" + model.NewId()[:10],
		DisplayName: "Dosyalar",
		Purpose:     "Takımın Dosyalar sayfasındaki klasörleri burada saklanır.",
		Type:        model.ChannelTypePrivate,
		CreatorId:   userID,
	}, false)
	if appErr != nil {
		return nil, appErr
	}
	team.FilesChannelId = channel.Id
	if appErr := a.saveTeamFiles(team); appErr != nil {
		return nil, appErr
	}
	if _, appErr := a.GetTeamMember(rctx, team.Id, userID); appErr == nil {
		if _, appErr := a.AddChannelMember(rctx, userID, channel, ChannelMemberOpts{}); appErr != nil {
			rctx.Logger().Warn("Failed to add the template author to the files channel", mlog.Err(appErr))
		}
	}
	return channel, nil
}

// GetTeamFilesLayout returns the Files page root for the session's user and makes them a member of the files channel,
// which is what lets the drive serve them. Admin-only folders are left out for everyone else.
func (a *App) GetTeamFilesLayout(rctx request.CTX, session model.Session, teamID string) (*model.TeamFilesLayout, *model.AppError) {
	layout := &model.TeamFilesLayout{Folders: []*model.TeamFilesFolder{}, ProductionChannelIds: []string{}}
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	folders := teamFilesFolders(team)
	if len(folders) == 0 || team.FilesChannelId == "" {
		return layout, nil
	}
	channel, appErr := a.GetChannel(rctx, team.FilesChannelId)
	if appErr != nil || channel.DeleteAt > 0 {
		return layout, nil
	}
	if _, appErr := a.GetChannelMember(rctx, channel.Id, session.UserId); appErr != nil {
		user, appErr := a.GetUser(rctx, session.UserId)
		if appErr != nil {
			return nil, appErr
		}
		if _, appErr := a.AddUserToChannel(rctx, user, channel, false); appErr != nil {
			return nil, appErr
		}
	}
	layout.ChannelId = channel.Id
	layout.IsAdmin, _ = a.SessionHasPermissionToChannel(rctx, session, channel.Id, model.PermissionManageChannelRoles)
	for _, f := range folders {
		if layout.IsAdmin || f.Access != model.TeamFilesAccessAdmin {
			layout.Folders = append(layout.Folders, f)
		}
	}
	sections, err := a.Srv().Store().Task().GetSectionsForTeam(teamID)
	if err != nil {
		return nil, taskStoreError("GetTeamFilesLayout", teamID, err)
	}
	for _, s := range sections {
		if s.ChannelId != "" && s.ChannelId != channel.Id && !slices.Contains(layout.ProductionChannelIds, s.ChannelId) {
			layout.ProductionChannelIds = append(layout.ProductionChannelIds, s.ChannelId)
		}
	}
	return layout, nil
}

// teamFilesTop returns the template top folder that path (root first) starts in, if channel is a files channel.
func (a *App) teamFilesTop(channel *model.Channel, path []*model.DriveItem) *model.TeamFilesFolder {
	if len(path) == 0 {
		return nil
	}
	if channel.TeamId == "" {
		full, appErr := a.GetChannel(request.EmptyContext(a.Log()), channel.Id)
		if appErr != nil {
			return nil
		}
		channel = full
	}
	team := a.teamFilesTeam(channel)
	if team == nil {
		return nil
	}
	for _, f := range teamFilesFolders(team) {
		if f.Id == path[0].Id {
			return f
		}
	}
	return nil
}

// GetDriveFolderShares lists the teams a projects folder is shared with; admins of the files channel only.
func (a *App) GetDriveFolderShares(rctx request.CTX, session model.Session, channel *model.Channel, itemID string) ([]string, *model.AppError) {
	if appErr := a.driveShareable(rctx, session, channel, itemID); appErr != nil {
		return nil, appErr
	}
	shares, err := a.Srv().Store().DriveItem().GetShares([]string{itemID})
	if err != nil {
		return nil, driveStoreError("GetDriveFolderShares", err)
	}
	ids := make([]string, 0, len(shares))
	for _, s := range shares {
		ids = append(ids, s.TeamId)
	}
	return ids, nil
}

// SetDriveFolderShares replaces the other teams a projects folder shows in, read-only.
func (a *App) SetDriveFolderShares(rctx request.CTX, session model.Session, channel *model.Channel, itemID string, teamIDs []string) ([]string, *model.AppError) {
	if appErr := a.driveShareable(rctx, session, channel, itemID); appErr != nil {
		return nil, appErr
	}
	ids := []string{}
	for _, id := range teamIDs {
		if id == channel.TeamId || slices.Contains(ids, id) {
			continue
		}
		if !model.IsValidId(id) {
			return nil, driveError("SetDriveFolderShares", "invalid_team", http.StatusBadRequest)
		}
		team, appErr := a.GetTeam(id)
		if appErr != nil || team.DeleteAt > 0 {
			return nil, driveError("SetDriveFolderShares", "invalid_team", http.StatusBadRequest)
		}
		ids = append(ids, id)
	}
	if err := a.Srv().Store().DriveItem().SetShares(itemID, ids, session.UserId); err != nil {
		return nil, driveStoreError("SetDriveFolderShares", err)
	}
	return ids, nil
}

// driveShareable checks that itemID is a live folder below the projects folder of channel's template and that the
// session is an admin of the channel.
func (a *App) driveShareable(rctx request.CTX, session model.Session, channel *model.Channel, itemID string) *model.AppError {
	if ok, _ := a.SessionHasPermissionToChannel(rctx, session, channel.Id, model.PermissionManageChannelRoles); !ok {
		return driveError("driveShareable", "forbidden", http.StatusForbidden)
	}
	path, appErr := a.driveFolderPath(channel, itemID)
	if appErr != nil {
		return appErr
	}
	if top := a.teamFilesTop(channel, path); top == nil || top.Kind != model.TeamFilesKindProjects || len(path) < 2 {
		return driveError("driveShareable", "not_shareable", http.StatusBadRequest)
	}
	return nil
}

// driveSharedRoot returns where path (root first, in a files channel) enters a folder shared with one of teamIDs,
// or -1. A share counts only while its folder still sits below its team's projects folder.
func (a *App) driveSharedRoot(path []*model.DriveItem, teamIDs []string) (int, *model.AppError) {
	if len(path) < 2 {
		return -1, nil
	}
	ids := make([]string, len(path))
	for i, f := range path {
		ids[i] = f.Id
	}
	shares, err := a.Srv().Store().DriveItem().GetShares(ids)
	if err != nil {
		return -1, driveStoreError("driveSharedRoot", err)
	}
	shares = slices.DeleteFunc(shares, func(s *model.DriveShare) bool { return !slices.Contains(teamIDs, s.TeamId) })
	if len(shares) == 0 {
		return -1, nil
	}
	if top := a.teamFilesTop(&model.Channel{Id: path[0].ChannelId}, path); top == nil || top.Kind != model.TeamFilesKindProjects {
		return -1, nil
	}
	for i, f := range path[1:] {
		if slices.ContainsFunc(shares, func(s *model.DriveShare) bool { return s.ItemId == f.Id }) {
			return i + 1, nil
		}
	}
	return -1, nil
}

// ListSharedDriveFolder lists, read-only, the folders other teams share into teamID (parentID "") or a folder inside
// one of them. The caller must be a member of teamID.
func (a *App) ListSharedDriveFolder(teamID, parentID string) (*DriveListing, *model.AppError) {
	listing := &DriveListing{Items: []*model.DriveItem{}, Path: []*model.DriveItem{}, TaskFiles: []*model.DriveTaskFile{}, Access: model.DriveAccessRead}
	notFound := driveError("ListSharedDriveFolder", "not_found", http.StatusNotFound)
	if parentID == "" {
		shares, err := a.Srv().Store().DriveItem().GetSharedWithTeam(teamID)
		if err != nil {
			return nil, driveStoreError("ListSharedDriveFolder", err)
		}
		for _, s := range shares {
			item, err := a.Srv().Store().DriveItem().Get(s.ItemId)
			if err != nil || item.DeleteAt > 0 {
				continue
			}
			path, appErr := a.driveFolderPath(&model.Channel{Id: item.ChannelId}, item.Id)
			if appErr != nil {
				continue
			}
			i, appErr := a.driveSharedRoot(path, []string{teamID})
			if appErr != nil {
				return nil, appErr
			}
			if i == len(path)-1 { // shared itself, not only through a shared folder above it
				listing.Items = append(listing.Items, item)
			}
		}
		return listing, nil
	}
	item, err := a.Srv().Store().DriveItem().Get(parentID)
	if err != nil {
		return nil, notFound
	}
	path, appErr := a.driveFolderPath(&model.Channel{Id: item.ChannelId}, parentID)
	if appErr != nil {
		return nil, notFound
	}
	i, appErr := a.driveSharedRoot(path, []string{teamID})
	if appErr != nil {
		return nil, appErr
	}
	if i < 0 {
		return nil, notFound
	}
	listing.Path = path[i:]
	children, err := a.Srv().Store().DriveItem().GetChildren(item.ChannelId, parentID, driveListLimit)
	if err != nil {
		return nil, driveStoreError("ListSharedDriveFolder", err)
	}
	if listing.Items, appErr = a.embedDriveFiles(children); appErr != nil {
		return nil, appErr
	}
	return listing, nil
}

// CanReadSharedDriveFile reports whether the file is a drive file inside a folder shared with a team userID is in.
func (a *App) CanReadSharedDriveFile(rctx request.CTX, userID string, info *model.FileInfo) bool {
	item, err := a.Srv().Store().DriveItem().GetByFileId(info.Id)
	if err != nil || item.DeleteAt > 0 || item.ChannelId != info.ChannelId || item.ParentId == "" {
		return false
	}
	path, appErr := a.driveFolderPath(&model.Channel{Id: item.ChannelId}, item.ParentId)
	if appErr != nil {
		return false
	}
	members, appErr := a.GetTeamMembersForUser(rctx, userID, "", false)
	if appErr != nil {
		return false
	}
	teamIDs := []string{}
	for _, m := range members {
		if m.DeleteAt == 0 {
			teamIDs = append(teamIDs, m.TeamId)
		}
	}
	i, appErr := a.driveSharedRoot(path, teamIDs)
	return appErr == nil && i >= 0
}

// ListDriveFolders lists every folder of channel's drive the session can see, for folder pickers.
func (a *App) ListDriveFolders(rctx request.CTX, session model.Session, channel *model.Channel) ([]*model.DriveItem, *model.AppError) {
	v, appErr := a.driveViewerFor(rctx, session, channel)
	if appErr != nil {
		return nil, appErr
	}
	tree, appErr := a.driveVisibleTree(v, &model.DriveItem{ChannelId: channel.Id})
	if appErr != nil {
		return nil, appErr
	}
	return slices.DeleteFunc(tree, func(it *model.DriveItem) bool { return !it.IsFolder() }), nil
}

// validateTaskFolders checks a task's drive folder (a live folder of its section's channel) and library folder (a live
// folder below the library folder of the team template).
func (a *App) validateTaskFolders(task *model.Task, folderChanged, libraryChanged bool) *model.AppError {
	invalid := model.NewAppError("validateTaskFolders", "app.task.invalid_folder.app_error", nil, "id="+task.Id, http.StatusBadRequest)
	if folderChanged && task.FolderId != "" {
		if task.SectionId == "" {
			return invalid
		}
		section, err := a.Srv().Store().Task().GetSection(task.SectionId)
		if err != nil || section.ChannelId == "" {
			return invalid
		}
		if _, appErr := a.driveFolderPath(&model.Channel{Id: section.ChannelId}, task.FolderId); appErr != nil {
			return invalid
		}
	}
	if libraryChanged && task.LibraryFolderId != "" {
		team, appErr := a.GetTeam(task.TeamId)
		if appErr != nil || team.FilesChannelId == "" {
			return invalid
		}
		channel := &model.Channel{Id: team.FilesChannelId, TeamId: team.Id}
		path, appErr := a.driveFolderPath(channel, task.LibraryFolderId)
		if appErr != nil {
			return invalid
		}
		if top := a.teamFilesTop(channel, path); top == nil || top.Kind != model.TeamFilesKindLibrary {
			return invalid
		}
	}
	return nil
}
