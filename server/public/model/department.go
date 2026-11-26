// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

const (
	DepartmentNameMaxRunes = 64
	// StudioDepartmentName names the per-team studio-wide group whose ranks outrank every other department.
	StudioDepartmentName   = "Stüdyo geneli"
	DepartmentDefaultColor = "#5d89ea"
)

// Department groups a team's ranks. Position orders departments; the studio department (IsStudio) always sorts first.
type Department struct {
	Id       string `json:"id"`
	TeamId   string `json:"team_id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Position int    `json:"position"`
	IsStudio bool   `json:"is_studio"`
	// LibraryWrite lets the department's ranks write into the team files library.
	LibraryWrite bool `json:"library_write"`
	// StagesView lets the department's members see the task stages (the stages panels and the task page's Stages tab).
	StagesView bool  `json:"stages_view"`
	CreateAt   int64 `json:"create_at"`
	UpdateAt   int64 `json:"update_at"`
	DeleteAt   int64 `json:"delete_at"`
}

// DepartmentWithRanks is a department and its ranks in order, as the Departmanlar tab shows them.
type DepartmentWithRanks struct {
	*Department
	Ranks []*CustomRole `json:"ranks"`
}

type DepartmentPatch struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`

	LibraryWrite *bool `json:"library_write"`
	StagesView   *bool `json:"stages_view"`
}

func (d *Department) Auditable() map[string]any {
	return map[string]any{
		"id":        d.Id,
		"team_id":   d.TeamId,
		"name":      d.Name,
		"color":     d.Color,
		"position":  d.Position,
		"is_studio": d.IsStudio,
	}
}

func (d *Department) Patch(p *DepartmentPatch) {
	if p.Name != nil {
		d.Name = *p.Name
	}
	if p.Color != nil {
		d.Color = *p.Color
	}
	if p.LibraryWrite != nil {
		d.LibraryWrite = *p.LibraryWrite
	}
	if p.StagesView != nil {
		d.StagesView = *p.StagesView
	}
}

func (d *Department) PreSave() {
	if d.Id == "" {
		d.Id = NewId()
	}
	d.CreateAt = GetMillis()
	d.UpdateAt = d.CreateAt
	d.Name = strings.TrimSpace(d.Name)
}

func (d *Department) PreUpdate() {
	d.UpdateAt = GetMillis()
	d.Name = strings.TrimSpace(d.Name)
}

func (d *Department) IsValid() *AppError {
	if !IsValidId(d.Id) {
		return NewAppError("Department.IsValid", "model.department.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(d.TeamId) {
		return NewAppError("Department.IsValid", "model.department.is_valid.team_id.app_error", nil, "id="+d.Id, http.StatusBadRequest)
	}
	if n := utf8.RuneCountInString(d.Name); n > DepartmentNameMaxRunes || strings.TrimSpace(d.Name) == "" {
		return NewAppError("Department.IsValid", "model.department.is_valid.name.app_error", map[string]any{"Max": DepartmentNameMaxRunes}, "id="+d.Id, http.StatusBadRequest)
	}
	if !rankColorRegex.MatchString(d.Color) {
		return NewAppError("Department.IsValid", "model.department.is_valid.color.app_error", nil, "id="+d.Id, http.StatusBadRequest)
	}
	if d.Position < 0 {
		return NewAppError("Department.IsValid", "model.department.is_valid.position.app_error", nil, "id="+d.Id, http.StatusBadRequest)
	}
	if d.CreateAt == 0 || d.UpdateAt == 0 {
		return NewAppError("Department.IsValid", "model.department.is_valid.create_at.app_error", nil, "id="+d.Id, http.StatusBadRequest)
	}
	return nil
}
