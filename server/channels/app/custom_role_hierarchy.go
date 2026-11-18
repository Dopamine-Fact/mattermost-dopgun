// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"slices"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// rankOutranks reports whether rank a sits above rank b: a is studio-wide and b is not, or both are in one department
// and a comes first. studio holds the ids of Stüdyo geneli departments.
func rankOutranks(a, b *model.CustomRole, studio map[string]bool) bool {
	if studio[a.DepartmentId] && !studio[b.DepartmentId] {
		return true
	}
	return a.DepartmentId == b.DepartmentId && a.Position < b.Position
}

// rankOutranksTarget reports whether rank r outranks a person holding target: they hold no rank; or they hold a
// studio rank and r outranks it; or they hold none and r outranks their rank in at least one department.
func rankOutranksTarget(r *model.CustomRole, target []*model.CustomRole, studio map[string]bool) bool {
	if i := slices.IndexFunc(target, func(t *model.CustomRole) bool { return studio[t.DepartmentId] }); i >= 0 {
		return rankOutranks(r, target[i], studio)
	}
	return len(target) == 0 || slices.ContainsFunc(target, func(t *model.CustomRole) bool { return rankOutranks(r, t, studio) })
}

// canActWithRanks reports whether one of actor's ranks both carries permission and outranks target.
func canActWithRanks(actor, target []*model.CustomRole, permission *model.Permission, studio map[string]bool) bool {
	return slices.ContainsFunc(actor, func(r *model.CustomRole) bool {
		return slices.Contains(r.Permissions, permission.Id) && rankOutranksTarget(r, target, studio)
	})
}

// teamRanks is a team's live ranks with their permissions, and where its departments sit.
type teamRanks struct {
	byID    map[string]*model.CustomRole
	studio  map[string]bool
	deptPos map[string]int
}

func (a *App) loadTeamRanks(teamID string) (*teamRanks, *model.AppError) {
	ranks, appErr := a.teamRanksWithPermissions(teamID)
	if appErr != nil {
		return nil, appErr
	}
	deps, err := a.Srv().Store().Department().GetForTeam(teamID)
	if err != nil {
		return nil, customRoleStoreError("loadTeamRanks", err)
	}
	tr := &teamRanks{byID: make(map[string]*model.CustomRole, len(ranks)), studio: map[string]bool{}, deptPos: make(map[string]int, len(deps))}
	for _, r := range ranks {
		tr.byID[r.Id] = r
	}
	for _, d := range deps {
		tr.studio[d.Id] = d.IsStudio
		tr.deptPos[d.Id] = d.Position
	}
	return tr, nil
}

// of returns the live ranks a team member holds; nil for a missing or departed member.
func (tr *teamRanks) of(member *model.TeamMember) []*model.CustomRole {
	if member == nil || member.DeleteAt != 0 {
		return nil
	}
	var ranks []*model.CustomRole
	for _, id := range model.RankIdsFromRoles(member.ExplicitRoles) {
		if r, ok := tr.byID[id]; ok {
			ranks = append(ranks, r)
		}
	}
	return ranks
}

// memberRanks returns the ranks userID holds in the team; none when they are not a member.
func (a *App) memberRanks(rctx request.CTX, tr *teamRanks, teamID, userID string) []*model.CustomRole {
	member, appErr := a.GetTeamMember(rctx, teamID, userID)
	if appErr != nil {
		return nil
	}
	return tr.of(member)
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

// CanActOnUser applies the rank hierarchy: may actorID act on targetID within teamID with permission? The permission
// must come from a rank that outranks the target. Admins rank above every rank, so only other admins act on them.
func (a *App) CanActOnUser(rctx request.CTX, actorID, targetID, teamID string, permission *model.Permission) bool {
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
	if appErr != nil || teamID == "" || a.bypassesHierarchy(rctx, target, teamID) {
		return false
	}
	tr, appErr := a.loadTeamRanks(teamID)
	if appErr != nil {
		rctx.Logger().Warn("Failed to load ranks", mlog.Err(appErr))
		return false
	}
	return canActWithRanks(a.memberRanks(rctx, tr, teamID, actorID), a.memberRanks(rctx, tr, teamID, targetID), permission, tr.studio)
}

// ActionableUserIDs returns, in their original order, the candidates actorID may act on within teamID with
// permission.
func (a *App) ActionableUserIDs(rctx request.CTX, actorID, teamID string, candidates []string, permission *model.Permission) []string {
	actor, appErr := a.GetUser(rctx, actorID)
	if appErr != nil {
		return nil
	}
	if a.bypassesHierarchy(rctx, actor, teamID) {
		return candidates
	}
	self := slices.DeleteFunc(slices.Clone(candidates), func(id string) bool { return id != actorID })
	if teamID == "" {
		return self
	}
	tr, appErr := a.loadTeamRanks(teamID)
	if appErr != nil {
		rctx.Logger().Warn("Failed to load ranks", mlog.Err(appErr))
		return self
	}
	mine := a.memberRanks(rctx, tr, teamID, actorID)
	if len(mine) == 0 {
		return self
	}
	users, appErr := a.GetUsers(rctx, slices.Clone(candidates)) // GetMany may reorder its input
	if appErr != nil {
		rctx.Logger().Warn("Failed to load users", mlog.Err(appErr))
		return self
	}
	members, appErr := a.GetTeamMembersByIds(teamID, slices.Clone(candidates), nil)
	if appErr != nil {
		rctx.Logger().Warn("Failed to load team members", mlog.Err(appErr))
		return self
	}
	byUser := make(map[string]*model.TeamMember, len(members))
	for _, m := range members {
		byUser[m.UserId] = m
	}
	allowed := make(map[string]bool, len(users))
	for _, u := range users {
		m := byUser[u.Id]
		admin := u.IsSystemAdmin() || (m != nil && m.DeleteAt == 0 && m.SchemeAdmin)
		allowed[u.Id] = u.Id == actorID || (!admin && canActWithRanks(mine, tr.of(m), permission, tr.studio))
	}
	return slices.DeleteFunc(slices.Clone(candidates), func(id string) bool { return !allowed[id] })
}

// CanAssignRank reports whether actorID may give rankID to targetID or take it away. Unless an admin, the actor
// needs one rank carrying assign_custom_roles that outranks the rank itself, the target's current rank in its
// department, and the target's studio rank if they hold one.
func (a *App) CanAssignRank(rctx request.CTX, actorID, targetID, rankID string) bool {
	k, err := a.Srv().Store().CustomRole().Get(rankID)
	if err != nil {
		return false
	}
	actor, appErr := a.GetUser(rctx, actorID)
	if appErr != nil {
		return false
	}
	if a.bypassesHierarchy(rctx, actor, k.TeamId) {
		return true
	}
	target, appErr := a.GetUser(rctx, targetID)
	if appErr != nil || a.bypassesHierarchy(rctx, target, k.TeamId) {
		return false
	}
	tr, appErr := a.loadTeamRanks(k.TeamId)
	if appErr != nil {
		rctx.Logger().Warn("Failed to load ranks", mlog.Err(appErr))
		return false
	}
	held := a.memberRanks(rctx, tr, k.TeamId, targetID)
	return slices.ContainsFunc(a.memberRanks(rctx, tr, k.TeamId, actorID), func(r *model.CustomRole) bool {
		if !slices.Contains(r.Permissions, model.PermissionAssignCustomRoles.Id) || !rankOutranks(r, k, tr.studio) {
			return false
		}
		return !slices.ContainsFunc(held, func(t *model.CustomRole) bool {
			return (t.DepartmentId == k.DepartmentId || tr.studio[t.DepartmentId]) && !rankOutranks(r, t, tr.studio)
		})
	})
}
