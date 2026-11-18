// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

type driveWrite int

const (
	driveWriteDefault driveWrite = iota // no write rule on the path: today's rules
	driveWriteAllowed
	driveWriteDenied
)

func driveInDepts(list []string, depts map[string]bool) bool {
	return slices.ContainsFunc(list, func(id string) bool { return depts[id] })
}

// driveRuleAccess judges a folder path (root first, the folder last) for someone in depts. Visible: every folder
// on it has no view list or lists one of depts. Write: denied when a mirror is on the path; else the nearest folder
// with ReadOnly or write departments decides; default when none has one.
func driveRuleAccess(path []*model.DriveItem, depts map[string]bool) (visible bool, write driveWrite) {
	visible = true
	for _, f := range path {
		if len(f.ViewDepartments) > 0 && !driveInDepts(f.ViewDepartments, depts) {
			visible = false
		}
		if f.MirrorOf != "" {
			write = driveWriteDenied
		}
	}
	if write == driveWriteDenied {
		return visible, write
	}
	for _, f := range slices.Backward(path) {
		switch {
		case f.ReadOnly:
			return visible, driveWriteDenied
		case len(f.WriteDepartments) > 0:
			if driveInDepts(f.WriteDepartments, depts) {
				return visible, driveWriteAllowed
			}
			return visible, driveWriteDenied
		}
	}
	return visible, driveWriteDefault
}

// driveViewer is one person in one channel's drive.
type driveViewer struct {
	manager bool            // manage_channel_roles: bypasses every folder rule
	depts   map[string]bool // department ids of the person's ranks in the channel's team
}

func (a *App) driveViewerFor(rctx request.CTX, session model.Session, channel *model.Channel) (*driveViewer, *model.AppError) {
	if ok, _ := a.SessionHasPermissionToChannel(rctx, session, channel.Id, model.PermissionManageChannelRoles); ok {
		return &driveViewer{manager: true}, nil
	}
	v := &driveViewer{depts: map[string]bool{}}
	member, appErr := a.GetTeamMember(rctx, channel.TeamId, session.UserId)
	if appErr != nil || member.DeleteAt != 0 {
		return v, nil // not in the team: no departments, so every restricted folder stays hidden
	}
	ranks, err := a.Srv().Store().CustomRole().GetForTeam(channel.TeamId)
	if err != nil {
		return nil, customRoleStoreError("driveViewerFor", err)
	}
	held := model.RankIdsFromRoles(member.ExplicitRoles)
	for _, r := range ranks {
		if slices.Contains(held, r.Id) {
			v.depts[r.DepartmentId] = true
		}
	}
	return v, nil
}

func (v *driveViewer) access(path []*model.DriveItem) (visible bool, write driveWrite) {
	if v.manager {
		return true, driveWriteAllowed
	}
	return driveRuleAccess(path, v.depts)
}

// driveReadPath is how v reaches folderID ("" = root): its own path when visible, else the path through the first
// live mirror (of the folder or a folder above it) that v can see: mirror's path + the source folders below the
// mirrored one. mirrored is true for the second. 404 driveError "not_found" when neither.
func (a *App) driveReadPath(v *driveViewer, channel *model.Channel, folderID string) (path []*model.DriveItem, mirrored bool, appErr *model.AppError) {
	notFound := driveError("driveReadPath", "not_found", http.StatusNotFound)
	own, appErr := a.driveFolderPath(channel, folderID)
	if appErr != nil {
		if appErr.StatusCode == http.StatusBadRequest {
			return nil, false, notFound
		}
		return nil, false, appErr
	}
	if visible, _ := v.access(own); visible {
		return own, false, nil
	}
	ids := make([]string, len(own))
	for i, f := range own {
		ids[i] = f.Id
	}
	mirrors, err := a.Srv().Store().DriveItem().GetMirrors(channel.Id, ids)
	if err != nil {
		return nil, false, driveStoreError("driveReadPath", err)
	}
	// Stable order: oldest mirror first.
	slices.SortFunc(mirrors, func(x, y *model.DriveItem) int {
		if x.CreateAt != y.CreateAt {
			return int(x.CreateAt - y.CreateAt)
		}
		return slices.Compare([]byte(x.Id), []byte(y.Id))
	})
	for _, m := range mirrors {
		mirrorPath, appErr := a.driveFolderPath(channel, m.Id)
		if appErr != nil {
			continue // a mirror in a trashed folder is not a route
		}
		if visible, _ := v.access(mirrorPath); !visible {
			continue
		}
		i := slices.IndexFunc(own, func(f *model.DriveItem) bool { return f.Id == m.MirrorOf })
		below := own[i+1:]
		ok := true
		for _, f := range below { // each source subfolder must itself admit v; its ancestors above the source do not matter
			if vis, _ := v.access([]*model.DriveItem{f}); !vis {
				ok = false
				break
			}
		}
		if ok {
			return append(mirrorPath, below...), true, nil
		}
	}
	return nil, false, notFound
}
