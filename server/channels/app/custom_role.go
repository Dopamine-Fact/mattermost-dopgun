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

// checkCustomRoleNameFree rejects a display name another live role already uses, ignoring case and surrounding spaces.
func checkCustomRoleNameFree(where string, roles []*model.CustomRole, name, exceptID string) *model.AppError {
	name = strings.TrimSpace(name)
	for _, r := range roles {
		if r.Id != exceptID && strings.EqualFold(r.DisplayName, name) {
			return model.NewAppError(where, "app.custom_role.name_taken.app_error", nil, "", http.StatusBadRequest)
		}
	}
	return nil
}

// GetCustomRoles returns the live custom roles in list order, with permissions taken from their native roles.
func (a *App) GetCustomRoles() ([]*model.CustomRole, *model.AppError) {
	roles, err := a.Srv().Store().CustomRole().GetAll()
	if err != nil {
		return nil, customRoleStoreError("GetCustomRoles", err)
	}
	if len(roles) == 0 {
		return roles, nil
	}
	names := make([]string, len(roles))
	for i, r := range roles {
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
	for _, r := range roles {
		r.Permissions = perms[r.RoleName]
		if r.Permissions == nil {
			r.Permissions = []string{}
		}
	}
	return roles, nil
}

// CreateCustomRole adds a role at the bottom of the list, backed by a native system-scope role named cr_<id>.
func (a *App) CreateCustomRole(rctx request.CTX, r *model.CustomRole) (*model.CustomRole, *model.AppError) {
	if appErr := checkCustomRolePermissions("CreateCustomRole", r.Permissions); appErr != nil {
		return nil, appErr
	}
	existing, appErr := a.GetCustomRoles()
	if appErr != nil {
		return nil, appErr
	}
	if appErr = checkCustomRoleNameFree("CreateCustomRole", existing, r.DisplayName, ""); appErr != nil {
		return nil, appErr
	}

	r.Id = ""
	// shortcut: two concurrent creates can share a position; GetAll orders ties by CreateAt and a reorder fixes it.
	r.Position = len(existing)
	r.PreSave()
	if appErr = r.IsValid(); appErr != nil {
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
			rctx.Logger().Warn("Failed to roll back native role of a custom role", mlog.String("role", native.Name), mlog.Err(delErr))
		}
		return nil, customRoleStoreError("CreateCustomRole", err)
	}
	saved.Permissions = native.Permissions
	return saved, nil
}

// PatchCustomRole changes a role's metadata and, through the native role, its permissions.
func (a *App) PatchCustomRole(rctx request.CTX, id string, p *model.CustomRolePatch) (*model.CustomRole, *model.AppError) {
	if p.Permissions != nil {
		if appErr := checkCustomRolePermissions("PatchCustomRole", *p.Permissions); appErr != nil {
			return nil, appErr
		}
	}
	roles, appErr := a.GetCustomRoles()
	if appErr != nil {
		return nil, appErr
	}
	idx := slices.IndexFunc(roles, func(r *model.CustomRole) bool { return r.Id == id })
	if idx < 0 {
		return nil, model.NewAppError("PatchCustomRole", "app.custom_role.not_found.app_error", nil, "id="+id, http.StatusNotFound)
	}
	role := roles[idx]
	if p.DisplayName != nil {
		if appErr = checkCustomRoleNameFree("PatchCustomRole", roles, *p.DisplayName, id); appErr != nil {
			return nil, appErr
		}
	}

	role.Patch(p)
	role.PreUpdate()
	if appErr = role.IsValid(); appErr != nil {
		return nil, appErr
	}

	if p.Permissions != nil {
		native, appErr := a.GetRoleByName(rctx, role.RoleName)
		if appErr != nil {
			return nil, appErr
		}
		native, appErr = a.PatchRole(native, &model.RolePatch{Permissions: p.Permissions})
		if appErr != nil {
			return nil, appErr
		}
		role.Permissions = native.Permissions
	}

	updated, err := a.Srv().Store().CustomRole().Update(role)
	if err != nil {
		return nil, customRoleStoreError("PatchCustomRole", err)
	}
	updated.Permissions = role.Permissions
	return updated, nil
}

// ReorderCustomRoles sets the list order; orderedIDs must name every live role exactly once.
func (a *App) ReorderCustomRoles(rctx request.CTX, orderedIDs []string) ([]*model.CustomRole, *model.AppError) {
	if err := a.Srv().Store().CustomRole().SetPositions(orderedIDs, model.GetMillis()); err != nil {
		return nil, customRoleStoreError("ReorderCustomRoles", err)
	}
	return a.GetCustomRoles()
}

// DeleteCustomRole removes a role, strips it from every user and closes the gap in the list.
func (a *App) DeleteCustomRole(rctx request.CTX, id string) *model.AppError {
	role, err := a.Srv().Store().CustomRole().Get(id)
	if err != nil {
		return customRoleStoreError("DeleteCustomRole", err)
	}
	now := model.GetMillis()
	// Metadata goes first so the role can no longer be assigned while users are stripped.
	if err = a.Srv().Store().CustomRole().Delete(id, now); err != nil {
		return customRoleStoreError("DeleteCustomRole", err)
	}

	userIDs, err := a.Srv().Store().User().RemoveRoleFromAll(role.RoleName)
	if err != nil {
		return customRoleStoreError("DeleteCustomRole", err)
	}
	for _, userID := range userIDs {
		a.refreshUserRoles(rctx, userID)
	}

	if native, appErr := a.GetRoleByName(rctx, role.RoleName); appErr == nil {
		if _, appErr = a.DeleteRole(native.Id); appErr != nil {
			return appErr
		}
	}

	remaining, err := a.Srv().Store().CustomRole().GetAll()
	if err != nil {
		return customRoleStoreError("DeleteCustomRole", err)
	}
	ids := make([]string, len(remaining))
	for i, r := range remaining {
		ids[i] = r.Id
	}
	if err = a.Srv().Store().CustomRole().SetPositions(ids, now); err != nil {
		rctx.Logger().Warn("Failed to compact custom role positions", mlog.Err(err))
	}
	return nil
}

// refreshUserRoles pushes a user's stored roles to their sessions, caches and clients after a bulk change.
func (a *App) refreshUserRoles(rctx request.CTX, userID string) {
	// The bulk update bypassed the user cache, so drop it before reading the new roles back.
	a.InvalidateCacheForUser(userID)
	user, err := a.Srv().Store().User().Get(rctx, userID)
	if err != nil {
		rctx.Logger().Warn("Failed to reload user after custom role removal", mlog.String("user_id", userID), mlog.Err(err))
		return
	}
	if _, err = a.Srv().Store().Session().UpdateRoles(userID, user.Roles); err != nil {
		rctx.Logger().Warn("Failed to update session roles", mlog.String("user_id", userID), mlog.Err(err))
	}
	a.ClearSessionCacheForUser(userID)
	message := model.NewWebSocketEvent(model.WebsocketEventUserRoleUpdated, "", "", userID, nil, "")
	message.Add("user_id", userID)
	message.Add("roles", user.Roles)
	a.Publish(message)
}

// SetUserCustomRoles replaces the custom roles a user holds. Every role added or removed must be one actorID may
// assign, on a user actorID may act on.
func (a *App) SetUserCustomRoles(rctx request.CTX, actorID, userID string, roleIDs []string) (*model.User, *model.AppError) {
	user, appErr := a.GetUser(rctx, userID)
	if appErr != nil {
		return nil, appErr
	}
	if user.IsGuest() || user.IsBot {
		return nil, model.NewAppError("SetUserCustomRoles", "app.custom_role.invalid_target.app_error", nil, "", http.StatusBadRequest)
	}
	byID, err := a.customRolesByID()
	if err != nil {
		return nil, customRoleStoreError("SetUserCustomRoles", err)
	}
	want := map[string]bool{}
	for _, id := range roleIDs {
		if _, ok := byID[id]; !ok {
			return nil, model.NewAppError("SetUserCustomRoles", "app.custom_role.not_found.app_error", nil, "id="+id, http.StatusBadRequest)
		}
		want[id] = true
	}
	have := map[string]bool{}
	for _, r := range customRolesOf(user, byID) {
		have[r.Id] = true
	}

	var changed []string
	for id := range byID {
		if want[id] != have[id] {
			changed = append(changed, id)
		}
	}
	if len(changed) > 0 && !a.CanActOnUser(rctx, actorID, userID, "") {
		return nil, model.NewAppError("SetUserCustomRoles", "app.custom_role.not_outranked.app_error", nil, "", http.StatusForbidden)
	}
	for _, id := range changed {
		if !a.CanAssignRole(rctx, actorID, id) {
			return nil, model.NewAppError("SetUserCustomRoles", "app.custom_role.not_outranked.app_error", nil, "role_id="+id, http.StatusForbidden)
		}
	}

	var names []string
	for name := range strings.FieldsSeq(user.Roles) {
		if !model.IsCustomRoleName(name) {
			names = append(names, name)
		}
	}
	ordered := make([]*model.CustomRole, 0, len(want))
	for id := range want {
		ordered = append(ordered, byID[id])
	}
	slices.SortFunc(ordered, func(x, y *model.CustomRole) int { return x.Position - y.Position })
	for _, r := range ordered {
		names = append(names, r.RoleName)
	}
	return a.updateUserRolesWithUser(rctx, user, strings.Join(names, " "), true)
}
