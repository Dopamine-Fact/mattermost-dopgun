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
	// CustomRoleNamePrefix starts the native Roles.Name of every custom role: "cr_" + CustomRole.Id.
	CustomRoleNamePrefix          = "cr_"
	CustomRoleDisplayNameMaxRunes = 64
	CustomRoleDepartmentMaxRunes  = 64
)

var customRoleColorRegex = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// CustomRolePermissionWhitelist is every permission a custom role may carry.
var CustomRolePermissionWhitelist = []string{
	"manage_tasks",
	"manage_daily_reports",
	"manage_revisions",
	"assign_custom_roles",
}

// CustomRole is a studio-defined role: metadata here, permissions on the native role named RoleName.
// Position orders all roles, lower = higher rank. Department "" means none.
type CustomRole struct {
	Id          string   `json:"id"`
	RoleName    string   `json:"role_name"`
	DisplayName string   `json:"display_name"`
	Color       string   `json:"color"`
	Position    int      `json:"position"`
	Department  string   `json:"department"`
	Permissions []string `json:"permissions" db:"-"`
	CreateAt    int64    `json:"create_at"`
	UpdateAt    int64    `json:"update_at"`
	DeleteAt    int64    `json:"delete_at"`
}

type CustomRolePatch struct {
	DisplayName *string   `json:"display_name"`
	Color       *string   `json:"color"`
	Department  *string   `json:"department"`
	Permissions *[]string `json:"permissions"`
}

func CustomRoleNameFromId(id string) string {
	return CustomRoleNamePrefix + id
}

func IsCustomRoleName(name string) bool {
	return len(name) > len(CustomRoleNamePrefix) && strings.HasPrefix(name, CustomRoleNamePrefix)
}

// CustomRoleIdsFromRoles returns the custom role ids in a space-separated roles string.
func CustomRoleIdsFromRoles(roles string) []string {
	var ids []string
	for name := range strings.FieldsSeq(roles) {
		if IsCustomRoleName(name) {
			ids = append(ids, strings.TrimPrefix(name, CustomRoleNamePrefix))
		}
	}
	return ids
}

func (r *CustomRole) Auditable() map[string]any {
	return map[string]any{
		"id":           r.Id,
		"display_name": r.DisplayName,
		"color":        r.Color,
		"position":     r.Position,
		"department":   r.Department,
		"permissions":  r.Permissions,
	}
}

func (r *CustomRole) Patch(p *CustomRolePatch) {
	if p.DisplayName != nil {
		r.DisplayName = *p.DisplayName
	}
	if p.Color != nil {
		r.Color = *p.Color
	}
	if p.Department != nil {
		r.Department = *p.Department
	}
	if p.Permissions != nil {
		r.Permissions = *p.Permissions
	}
}

func (r *CustomRole) normalize() {
	r.DisplayName = strings.TrimSpace(r.DisplayName)
	r.Department = strings.TrimSpace(r.Department)
}

func (r *CustomRole) PreSave() {
	if r.Id == "" {
		r.Id = NewId()
	}
	r.RoleName = CustomRoleNameFromId(r.Id)
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
	if r.RoleName != CustomRoleNameFromId(r.Id) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.role_name.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if n := utf8.RuneCountInString(r.DisplayName); n == 0 || n > CustomRoleDisplayNameMaxRunes || strings.TrimSpace(r.DisplayName) == "" {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.display_name.app_error", map[string]any{"Max": CustomRoleDisplayNameMaxRunes}, "id="+r.Id, http.StatusBadRequest)
	}
	if !customRoleColorRegex.MatchString(r.Color) {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.color.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.Position < 0 {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.position.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if utf8.RuneCountInString(r.Department) > CustomRoleDepartmentMaxRunes {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.department.app_error", map[string]any{"Max": CustomRoleDepartmentMaxRunes}, "id="+r.Id, http.StatusBadRequest)
	}
	if r.CreateAt == 0 || r.UpdateAt == 0 {
		return NewAppError("CustomRole.IsValid", "model.custom_role.is_valid.create_at.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	return nil
}
