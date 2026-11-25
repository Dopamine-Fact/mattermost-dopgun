// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	// RankRoleNamePrefix starts the native Roles.Name of every rank: "rk_" + CustomRole.Id.
	RankRoleNamePrefix            = "rk_"
	CustomRoleDisplayNameMaxRunes = 64
)

var rankColorRegex = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// CustomRolePermissionWhitelist is every permission a custom role may carry.
var CustomRolePermissionWhitelist = []string{
	"manage_tasks",
	"manage_daily_reports",
	"manage_revisions",
	"approve_task_supervisor",
	"approve_task_director",
	"assign_custom_roles",
}

// CustomRole is a rank inside a team's department: metadata here, permissions on the team-scope native role named
// RoleName, held through TeamMembers.ExplicitRoles. Position orders the ranks of one department, lower = higher.
type CustomRole struct {
	Id           string   `json:"id"`
	RoleName     string   `json:"role_name"`
	TeamId       string   `json:"team_id"`
	DepartmentId string   `json:"department_id"`
	DisplayName  string   `json:"display_name"`
	Color        string   `json:"color"`
	Position     int      `json:"position"`
	Permissions  []string `json:"permissions" db:"-"`
	MemberCount  int64    `json:"member_count" db:"-"`
	MemberIds    []string `json:"member_ids" db:"-"`
	CreateAt     int64    `json:"create_at"`
	UpdateAt     int64    `json:"update_at"`
	DeleteAt     int64    `json:"delete_at"`
}

type CustomRolePatch struct {
	DisplayName *string   `json:"display_name"`
	Color       *string   `json:"color"`
	Permissions *[]string `json:"permissions"`
}

func RankRoleNameFromId(id string) string {
	return RankRoleNamePrefix + id
}

func IsRankRoleName(name string) bool {
	return len(name) > len(RankRoleNamePrefix) && strings.HasPrefix(name, RankRoleNamePrefix)
}

// RankIdsFromRoles returns the rank ids in a space-separated roles string.
func RankIdsFromRoles(roles string) []string {
	var ids []string
	for name := range strings.FieldsSeq(roles) {
		if IsRankRoleName(name) {
			ids = append(ids, strings.TrimPrefix(name, RankRoleNamePrefix))
		}
	}
	return ids
}

// RemoveRankRoles drops every rank role from a space-separated roles string.
func RemoveRankRoles(roles string) string {
	var kept []string
	for name := range strings.FieldsSeq(roles) {
		if !IsRankRoleName(name) {
			kept = append(kept, name)
		}
	}
	return strings.Join(kept, " ")
}

func (r *CustomRole) Auditable() map[string]any {
	return map[string]any{
		"id":            r.Id,
		"team_id":       r.TeamId,
		"department_id": r.DepartmentId,
		"display_name":  r.DisplayName,
		"color":         r.Color,
		"position":      r.Position,
		"permissions":   r.Permissions,
	}
}

func (r *CustomRole) Patch(p *CustomRolePatch) {
	if p.DisplayName != nil {
		r.DisplayName = *p.DisplayName
	}
	if p.Color != nil {
		r.Color = *p.Color
	}
	if p.Permissions != nil {
		r.Permissions = *p.Permissions
	}
}

func (r *CustomRole) normalize() {
	r.DisplayName = strings.TrimSpace(r.DisplayName)
}

func (r *CustomRole) PreSave() {
	if r.Id == "" {
		r.Id = NewId()
	}
	r.RoleName = RankRoleNameFromId(r.Id)
	r.CreateAt = GetMillis()
	r.UpdateAt = r.CreateAt
	r.normalize()
}

func (r *CustomRole) PreUpdate() {
	r.UpdateAt = GetMillis()
	r.normalize()
}

func (r *CustomRole) IsValid() *AppError {
	if !IsValidId(r.Id) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(r.TeamId) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.team_id.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if !IsValidId(r.DepartmentId) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.department_id.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.RoleName != RankRoleNameFromId(r.Id) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.role_name.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if n := utf8.RuneCountInString(r.DisplayName); n == 0 || n > CustomRoleDisplayNameMaxRunes || strings.TrimSpace(r.DisplayName) == "" {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.display_name.app_error", map[string]any{"Max": CustomRoleDisplayNameMaxRunes}, "id="+r.Id, http.StatusBadRequest)
	}
	if !rankColorRegex.MatchString(r.Color) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.color.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.Position < 0 {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.position.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.CreateAt == 0 || r.UpdateAt == 0 {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.create_at.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	return nil
}
