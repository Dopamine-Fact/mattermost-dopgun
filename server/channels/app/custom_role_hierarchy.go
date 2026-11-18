// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// outranks reports whether role a sits above role b in the list and the two do not belong to different departments.
func outranks(a, b *model.CustomRole) bool {
	return a.Position < b.Position && (a.Department == "" || b.Department == "" || a.Department == b.Department)
}

// canActOn reports whether one of the actor's roles outranks every role of the target. A target without custom roles
// can be acted on by anyone holding at least one.
func canActOn(actor, target []*model.CustomRole) bool {
	if len(target) == 0 {
		return len(actor) > 0
	}
	return slices.ContainsFunc(actor, func(a *model.CustomRole) bool {
		return !slices.ContainsFunc(target, func(t *model.CustomRole) bool { return !outranks(a, t) })
	})
}

// customRolesOf returns the live custom roles a user holds; roles missing from byID are ignored.
func customRolesOf(user *model.User, byID map[string]*model.CustomRole) []*model.CustomRole {
	var roles []*model.CustomRole
	for _, id := range model.CustomRoleIdsFromRoles(user.Roles) {
		if r, ok := byID[id]; ok {
			roles = append(roles, r)
		}
	}
	return roles
}

// customRolesByID loads the live custom roles without their permissions.
func (a *App) customRolesByID() (map[string]*model.CustomRole, error) {
	roles, err := a.Srv().Store().CustomRole().GetAll()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*model.CustomRole, len(roles))
	for _, r := range roles {
		byID[r.Id] = r
	}
	return byID, nil
}

// bypassesHierarchy reports whether the actor is a system admin, or a team admin of teamID when it is set.
func (a *App) bypassesHierarchy(rctx request.CTX, actor *model.User, teamID string) bool {
	if actor.IsSystemAdmin() {
		return true
	}
	if teamID == "" {
		return false
	}
	member, appErr := a.GetTeamMember(rctx, teamID, actor.Id)
	return appErr == nil && member.DeleteAt == 0 && member.SchemeAdmin
}

// CanActOnUser applies the custom role hierarchy: may actorID act on targetID within teamID ("" for no team)?
func (a *App) CanActOnUser(rctx request.CTX, actorID, targetID, teamID string) bool {
	if actorID == targetID {
		return true
	}
	actor, appErr := a.GetUser(rctx, actorID)
	if appErr != nil {
		return false
	}
	if a.bypassesHierarchy(rctx, actor, teamID) {
		return true
	}
	target, appErr := a.GetUser(rctx, targetID)
	if appErr != nil {
		return false
	}
	byID, err := a.customRolesByID()
	if err != nil {
		rctx.Logger().Warn("Failed to load custom roles", mlog.Err(err))
		return false
	}
	return canActOn(customRolesOf(actor, byID), customRolesOf(target, byID))
}

// CanAssignRole reports whether actorID may give or remove the custom role roleID: one of the actor's roles must
// outrank it.
func (a *App) CanAssignRole(rctx request.CTX, actorID, roleID string) bool {
	actor, appErr := a.GetUser(rctx, actorID)
	if appErr != nil {
		return false
	}
	byID, err := a.customRolesByID()
	if err != nil {
		rctx.Logger().Warn("Failed to load custom roles", mlog.Err(err))
		return false
	}
	role, ok := byID[roleID]
	if !ok {
		return false
	}
	if actor.IsSystemAdmin() {
		return true
	}
	return slices.ContainsFunc(customRolesOf(actor, byID), func(r *model.CustomRole) bool { return outranks(r, role) })
}

// ActionableUserIDs returns, in their original order, the candidates actorID may act on within teamID.
func (a *App) ActionableUserIDs(rctx request.CTX, actorID, teamID string, candidates []string) []string {
	actor, appErr := a.GetUser(rctx, actorID)
	if appErr != nil {
		return nil
	}
	if a.bypassesHierarchy(rctx, actor, teamID) {
		return candidates
	}
	byID, err := a.customRolesByID()
	if err != nil {
		rctx.Logger().Warn("Failed to load custom roles", mlog.Err(err))
		return nil
	}
	users, appErr := a.GetUsers(rctx, slices.Clone(candidates)) // GetMany may reorder its input
	if appErr != nil {
		rctx.Logger().Warn("Failed to load users", mlog.Err(appErr))
		return nil
	}
	mine := customRolesOf(actor, byID)
	allowed := make(map[string]bool, len(users))
	for _, u := range users {
		allowed[u.Id] = u.Id == actorID || canActOn(mine, customRolesOf(u, byID))
	}
	return slices.DeleteFunc(slices.Clone(candidates), func(id string) bool { return !allowed[id] })
}
