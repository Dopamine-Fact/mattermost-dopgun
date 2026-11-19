// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// teamDepartment returns a live department of teamID; another team's department is reported as missing.
func (a *App) teamDepartment(where, teamID, id string) (*model.Department, *model.AppError) {
	d, err := a.Srv().Store().Department().Get(id)
	if err != nil {
		return nil, customRoleStoreError(where, err)
	}
	if d.TeamId != teamID {
		return nil, model.NewAppError(where, "app.department.not_found.app_error", nil, "id="+id, http.StatusNotFound)
	}
	return d, nil
}

// ensureStudioDepartment returns the team's departments in order, creating Stüdyo geneli first if it is missing.
func (a *App) ensureStudioDepartment(teamID string) ([]*model.Department, *model.AppError) {
	deps, err := a.Srv().Store().Department().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("ensureStudioDepartment", err)
	}
	if slices.ContainsFunc(deps, func(d *model.Department) bool { return d.IsStudio }) {
		return deps, nil
	}
	studio := &model.Department{TeamId: teamID, Name: model.StudioDepartmentName, Color: model.DepartmentDefaultColor, IsStudio: true}
	// A concurrent call may have created it first; the unique index refuses the second, and we read theirs back.
	if _, err = a.Srv().Store().Department().Save(studio); err != nil && !isConflict(err) {
		return nil, customRoleStoreError("ensureStudioDepartment", err)
	} else if err == nil {
		ids := []string{studio.Id}
		for _, d := range deps {
			ids = append(ids, d.Id)
		}
		if err = a.Srv().Store().Department().SetPositions(teamID, ids, model.GetMillis()); err != nil {
			return nil, customRoleStoreError("ensureStudioDepartment", err)
		}
	}
	deps, err = a.Srv().Store().Department().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("ensureStudioDepartment", err)
	}
	return deps, nil
}

// UserDepartments returns the ids of the departments whose ranks the user holds in the team; a user who is not a
// live member of the team has none.
func (a *App) UserDepartments(rctx request.CTX, teamID, userID string) (map[string]bool, *model.AppError) {
	depts := map[string]bool{}
	member, appErr := a.GetTeamMember(rctx, teamID, userID)
	if appErr != nil {
		if appErr.StatusCode != http.StatusNotFound {
			return nil, appErr
		}
		return depts, nil
	}
	if member.DeleteAt != 0 {
		return depts, nil
	}
	ranks, err := a.Srv().Store().CustomRole().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("UserDepartments", err)
	}
	held := model.RankIdsFromRoles(member.ExplicitRoles)
	for _, r := range ranks {
		if slices.Contains(held, r.Id) {
			depts[r.DepartmentId] = true
		}
	}
	return depts, nil
}

func isConflict(err error) bool {
	_, ok := errors.AsType[*store.ErrConflict](err)
	return ok
}

// GetTeamDepartments returns the team's departments in order, each with its ranks in order, their permissions and
// the members holding them.
func (a *App) GetTeamDepartments(rctx request.CTX, teamID string) ([]*model.DepartmentWithRanks, *model.AppError) {
	deps, appErr := a.ensureStudioDepartment(teamID)
	if appErr != nil {
		return nil, appErr
	}
	ranks, appErr := a.teamRanksWithPermissions(teamID)
	if appErr != nil {
		return nil, appErr
	}
	names := make([]string, len(ranks))
	for i, r := range ranks {
		names[i] = r.RoleName
	}
	members, err := a.Srv().Store().Team().MembersWithRoles(teamID, names)
	if err != nil {
		return nil, customRoleStoreError("GetTeamDepartments", err)
	}

	out := make([]*model.DepartmentWithRanks, len(deps))
	index := make(map[string]*model.DepartmentWithRanks, len(deps))
	for i, d := range deps {
		out[i] = &model.DepartmentWithRanks{Department: d, Ranks: []*model.CustomRole{}}
		index[d.Id] = out[i]
	}
	for _, r := range ranks {
		r.MemberIds = members[r.RoleName]
		if r.MemberIds == nil {
			r.MemberIds = []string{}
		}
		r.MemberCount = int64(len(r.MemberIds))
		if d, ok := index[r.DepartmentId]; ok {
			d.Ranks = append(d.Ranks, r)
		}
	}
	return out, nil
}

// CreateDepartment adds a department at the bottom of the team's list.
func (a *App) CreateDepartment(rctx request.CTX, teamID, name, color string) (*model.Department, *model.AppError) {
	deps, appErr := a.ensureStudioDepartment(teamID)
	if appErr != nil {
		return nil, appErr
	}
	if color == "" {
		color = model.DepartmentDefaultColor
	}
	// shortcut: two concurrent creates can share a position; GetForTeam orders ties by CreateAt and a reorder fixes it.
	d := &model.Department{TeamId: teamID, Name: name, Color: color, Position: len(deps)}
	saved, err := a.Srv().Store().Department().Save(d)
	if err != nil {
		return nil, customRoleStoreError("CreateDepartment", err)
	}
	return saved, nil
}

func (a *App) PatchDepartment(rctx request.CTX, teamID, id string, p *model.DepartmentPatch) (*model.Department, *model.AppError) {
	d, appErr := a.teamDepartment("PatchDepartment", teamID, id)
	if appErr != nil {
		return nil, appErr
	}
	d.Patch(p)
	updated, err := a.Srv().Store().Department().Update(d)
	if err != nil {
		return nil, customRoleStoreError("PatchDepartment", err)
	}
	return updated, nil
}

// ReorderDepartments sets the team's department order; orderedIDs must name every department once, studio first.
func (a *App) ReorderDepartments(rctx request.CTX, teamID string, orderedIDs []string) ([]*model.DepartmentWithRanks, *model.AppError) {
	deps, appErr := a.ensureStudioDepartment(teamID)
	if appErr != nil {
		return nil, appErr
	}
	studio := deps[slices.IndexFunc(deps, func(d *model.Department) bool { return d.IsStudio })]
	if len(orderedIDs) == 0 || orderedIDs[0] != studio.Id {
		return nil, model.NewAppError("ReorderDepartments", "app.department.studio_first.app_error", nil, "", http.StatusBadRequest)
	}
	if err := a.Srv().Store().Department().SetPositions(teamID, orderedIDs, model.GetMillis()); err != nil {
		return nil, customRoleStoreError("ReorderDepartments", err)
	}
	return a.GetTeamDepartments(rctx, teamID)
}

// DeleteDepartment deletes a department with its ranks, stripping them from every member. Stüdyo geneli stays.
func (a *App) DeleteDepartment(rctx request.CTX, teamID, id string) *model.AppError {
	d, appErr := a.teamDepartment("DeleteDepartment", teamID, id)
	if appErr != nil {
		return appErr
	}
	if d.IsStudio {
		return model.NewAppError("DeleteDepartment", "app.department.studio_delete.app_error", nil, "", http.StatusBadRequest)
	}
	ranks, err := a.Srv().Store().CustomRole().GetForTeam(teamID)
	if err != nil {
		return customRoleStoreError("DeleteDepartment", err)
	}
	for _, r := range ranks {
		if r.DepartmentId == id {
			if appErr = a.deleteRank(rctx, r); appErr != nil {
				return appErr
			}
		}
	}
	if err = a.Srv().Store().Department().Delete(id, model.GetMillis()); err != nil {
		return customRoleStoreError("DeleteDepartment", err)
	}

	remaining, err := a.Srv().Store().Department().GetForTeam(teamID)
	if err != nil {
		return customRoleStoreError("DeleteDepartment", err)
	}
	ids := make([]string, len(remaining))
	for i, r := range remaining {
		ids[i] = r.Id
	}
	if err = a.Srv().Store().Department().SetPositions(teamID, ids, model.GetMillis()); err != nil {
		rctx.Logger().Warn("Failed to compact department positions", mlog.Err(err))
	}
	return nil
}
