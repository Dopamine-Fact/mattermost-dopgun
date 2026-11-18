// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func customRoleStoreError(where string, err error) *model.AppError {
	if _, ok := errors.AsType[*store.ErrNotFound](err); ok {
		return model.NewAppError(where, "app.custom_role.not_found.app_error", nil, "", http.StatusNotFound).Wrap(err)
	}
	if _, ok := errors.AsType[*store.ErrInvalidInput](err); ok {
		return model.NewAppError(where, "app.custom_role.invalid_order.app_error", nil, "", http.StatusBadRequest).Wrap(err)
	}
	if _, ok := errors.AsType[*store.ErrConflict](err); ok {
		return model.NewAppError(where, "app.custom_role.name_taken.app_error", nil, "", http.StatusBadRequest).Wrap(err)
	}
	if appErr, ok := errors.AsType[*model.AppError](err); ok {
		return appErr
	}
	return model.NewAppError(where, "app.custom_role.store.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
}

func checkCustomRolePermissions(where string, perms []string) *model.AppError {
	for _, p := range perms {
		if !slices.Contains(model.CustomRolePermissionWhitelist, p) {
			return model.NewAppError(where, "app.custom_role.permission_not_allowed.app_error", map[string]any{"Permission": p}, "", http.StatusBadRequest)
		}
	}
	return nil
}

// teamRank returns a live rank of teamID; another team's rank is reported as missing.
func (a *App) teamRank(where, teamID, id string) (*model.CustomRole, *model.AppError) {
	r, err := a.Srv().Store().CustomRole().Get(id)
	if err != nil {
		return nil, customRoleStoreError(where, err)
	}
	if r.TeamId != teamID {
		return nil, model.NewAppError(where, "app.custom_role.not_found.app_error", nil, "id="+id, http.StatusNotFound)
	}
	return r, nil
}

// teamRanksWithPermissions returns the team's live ranks, ordered by department then position, with the permissions
// of their native roles.
func (a *App) teamRanksWithPermissions(teamID string) ([]*model.CustomRole, *model.AppError) {
	ranks, err := a.Srv().Store().CustomRole().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("teamRanksWithPermissions", err)
	}
	if len(ranks) == 0 {
		return ranks, nil
	}
	names := make([]string, len(ranks))
	for i, r := range ranks {
		names[i] = r.RoleName
	}
	natives, appErr := a.GetRolesByNames(names)
	if appErr != nil {
		return nil, appErr
	}
	perms := make(map[string][]string, len(natives))
	for _, n := range natives {
		perms[n.Name] = n.Permissions
	}
	for _, r := range ranks {
		r.Permissions = perms[r.RoleName]
		if r.Permissions == nil {
			r.Permissions = []string{}
		}
	}
	return ranks, nil
}

// CreateRank adds a rank at the bottom of its department, backed by a native role named rk_<id> that members hold
// through their team roles.
func (a *App) CreateRank(rctx request.CTX, teamID, departmentID string, r *model.CustomRole) (*model.CustomRole, *model.AppError) {
	if appErr := checkCustomRolePermissions("CreateRank", r.Permissions); appErr != nil {
		return nil, appErr
	}
	if _, appErr := a.teamDepartment("CreateRank", teamID, departmentID); appErr != nil {
		return nil, appErr
	}
	ranks, err := a.Srv().Store().CustomRole().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("CreateRank", err)
	}

	r.Id = ""
	r.TeamId = teamID
	r.DepartmentId = departmentID
	// shortcut: two concurrent creates can share a position; GetForTeam orders ties by CreateAt and a reorder fixes it.
	r.Position = 0
	for _, other := range ranks {
		if other.DepartmentId == departmentID {
			r.Position++
		}
	}
	r.PreSave()
	if appErr := r.IsValid(); appErr != nil {
		return nil, appErr
	}
	perms := r.Permissions
	if perms == nil {
		perms = []string{}
	}

	native, appErr := a.CreateRole(&model.Role{Name: r.RoleName, DisplayName: r.DisplayName, Permissions: perms})
	if appErr != nil {
		return nil, appErr
	}
	saved, err := a.Srv().Store().CustomRole().Save(r)
	if err != nil {
		if _, delErr := a.DeleteRole(native.Id); delErr != nil {
			rctx.Logger().Warn("Failed to roll back native role of a rank", mlog.String("role", native.Name), mlog.Err(delErr))
		}
		return nil, customRoleStoreError("CreateRank", err)
	}
	saved.Permissions = native.Permissions
	return saved, nil
}

// PatchRank changes a rank's name, color and, through its native role, permissions.
func (a *App) PatchRank(rctx request.CTX, teamID, id string, p *model.CustomRolePatch) (*model.CustomRole, *model.AppError) {
	if p.Permissions != nil {
		if appErr := checkCustomRolePermissions("PatchRank", *p.Permissions); appErr != nil {
			return nil, appErr
		}
	}
	rank, appErr := a.teamRank("PatchRank", teamID, id)
	if appErr != nil {
		return nil, appErr
	}
	rank.Patch(p)
	rank.PreUpdate()
	if appErr = rank.IsValid(); appErr != nil {
		return nil, appErr
	}
	// The row goes first: a taken name stops the patch before the native role changes.
	updated, err := a.Srv().Store().CustomRole().Update(rank)
	if err != nil {
		return nil, customRoleStoreError("PatchRank", err)
	}

	native, appErr := a.GetRoleByName(rctx, rank.RoleName)
	if appErr != nil {
		return nil, appErr
	}
	native.DisplayName = rank.DisplayName
	if p.Permissions != nil {
		native.Permissions = *p.Permissions
	}
	if native, appErr = a.UpdateRole(native); appErr != nil {
		return nil, appErr
	}
	if appErr = a.sendUpdatedRoleEvent(native); appErr != nil {
		return nil, appErr
	}
	updated.Permissions = native.Permissions
	return updated, nil
}

// ReorderRanks sets a department's rank order; orderedIDs must name every rank of it once.
func (a *App) ReorderRanks(rctx request.CTX, teamID, departmentID string, orderedIDs []string) ([]*model.DepartmentWithRanks, *model.AppError) {
	if _, appErr := a.teamDepartment("ReorderRanks", teamID, departmentID); appErr != nil {
		return nil, appErr
	}
	if err := a.Srv().Store().CustomRole().SetPositions(departmentID, orderedIDs, model.GetMillis()); err != nil {
		return nil, customRoleStoreError("ReorderRanks", err)
	}
	return a.GetTeamDepartments(rctx, teamID)
}

// DeleteRank removes a rank, strips it from every member and closes the gap in its department.
func (a *App) DeleteRank(rctx request.CTX, teamID, id string) *model.AppError {
	rank, appErr := a.teamRank("DeleteRank", teamID, id)
	if appErr != nil {
		return appErr
	}
	if appErr = a.deleteRank(rctx, rank); appErr != nil {
		return appErr
	}

	ranks, err := a.Srv().Store().CustomRole().GetForTeam(teamID)
	if err != nil {
		return customRoleStoreError("DeleteRank", err)
	}
	var ids []string
	for _, r := range ranks {
		if r.DepartmentId == rank.DepartmentId {
			ids = append(ids, r.Id)
		}
	}
	if err = a.Srv().Store().CustomRole().SetPositions(rank.DepartmentId, ids, model.GetMillis()); err != nil {
		rctx.Logger().Warn("Failed to compact rank positions", mlog.Err(err))
	}
	return nil
}

// deleteRank deletes the rank and strips it from the team's members, leaving positions alone.
func (a *App) deleteRank(rctx request.CTX, rank *model.CustomRole) *model.AppError {
	// The native role goes first so its permissions drop at once, even if a later step fails; a retry still finds
	// the metadata row and finishes the job.
	if native, appErr := a.GetRoleByName(rctx, rank.RoleName); appErr == nil && native.DeleteAt == 0 {
		if _, appErr = a.DeleteRole(native.Id); appErr != nil {
			return appErr
		}
	}
	// Metadata goes next so the rank can no longer be assigned while members are stripped.
	if err := a.Srv().Store().CustomRole().Delete(rank.Id, model.GetMillis()); err != nil {
		return customRoleStoreError("DeleteRank", err)
	}
	userIDs, err := a.Srv().Store().Team().RemoveRoleFromAllMembers(rank.TeamId, rank.RoleName)
	if err != nil {
		return customRoleStoreError("DeleteRank", err)
	}
	for _, userID := range userIDs {
		a.ClearSessionCacheForUser(userID)
		a.invalidateCacheForUserTeams(userID)
		member, appErr := a.GetTeamMember(rctx, rank.TeamId, userID)
		if appErr != nil {
			rctx.Logger().Warn("Failed to reload team member after rank removal", mlog.String("user_id", userID), mlog.Err(appErr))
			continue
		}
		if appErr = a.sendUpdatedTeamMemberEvent(member); appErr != nil {
			rctx.Logger().Warn("Failed to send team member update", mlog.String("user_id", userID), mlog.Err(appErr))
		}
	}
	return nil
}

// SetMemberRanks replaces the ranks a member holds in teamID. Every rank added or removed must be one actorID may
// assign to that member.
func (a *App) SetMemberRanks(rctx request.CTX, actorID, teamID, userID string, rankIDs []string) (*model.TeamMember, *model.AppError) {
	user, appErr := a.GetUser(rctx, userID)
	if appErr != nil {
		return nil, appErr
	}
	invalidTarget := model.NewAppError("SetMemberRanks", "app.custom_role.invalid_target.app_error", nil, "", http.StatusBadRequest)
	if user.IsGuest() || user.IsBot {
		return nil, invalidTarget
	}
	member, appErr := a.GetTeamMember(rctx, teamID, userID)
	if appErr != nil || member.DeleteAt != 0 {
		return nil, invalidTarget
	}
	tr, appErr := a.loadTeamRanks(teamID)
	if appErr != nil {
		return nil, appErr
	}

	want := map[string]bool{}
	byDept := map[string]string{}
	for _, id := range rankIDs {
		r, ok := tr.byID[id]
		if !ok {
			return nil, model.NewAppError("SetMemberRanks", "app.custom_role.not_found.app_error", nil, "id="+id, http.StatusBadRequest)
		}
		if other, taken := byDept[r.DepartmentId]; taken && other != id {
			return nil, model.NewAppError("SetMemberRanks", "app.custom_role.one_per_department.app_error", nil, "", http.StatusBadRequest)
		}
		byDept[r.DepartmentId] = id
		want[id] = true
	}
	have := map[string]bool{}
	for _, r := range tr.of(member) {
		have[r.Id] = true
	}
	var changed []string
	for id := range tr.byID {
		if want[id] != have[id] {
			changed = append(changed, id)
		}
	}
	if len(changed) == 0 {
		return member, nil
	}
	// Nobody but a system admin changes their own ranks: a lead could otherwise take a lower rank's permissions.
	if actorID == userID && !user.IsSystemAdmin() {
		return nil, model.NewAppError("SetMemberRanks", "app.custom_role.not_outranked.app_error", nil, "self", http.StatusForbidden)
	}
	for _, id := range changed {
		if !a.CanAssignRank(rctx, actorID, userID, id) {
			return nil, model.NewAppError("SetMemberRanks", "app.custom_role.not_outranked.app_error", nil, "rank_id="+id, http.StatusForbidden)
		}
	}

	ordered := make([]*model.CustomRole, 0, len(want))
	for id := range want {
		ordered = append(ordered, tr.byID[id])
	}
	slices.SortFunc(ordered, func(x, y *model.CustomRole) int {
		if d := tr.deptPos[x.DepartmentId] - tr.deptPos[y.DepartmentId]; d != 0 {
			return d
		}
		return x.Position - y.Position
	})
	names := strings.Fields(model.RemoveRankRoles(member.Roles))
	for _, r := range ordered {
		names = append(names, r.RoleName)
	}
	return a.updateTeamMemberRolesInternal(rctx, teamID, userID, strings.Join(names, " "), false)
}
