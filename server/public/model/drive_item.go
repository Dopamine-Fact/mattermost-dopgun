// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	DriveItemTypeFolder = "folder"
	DriveItemTypeFile   = "file"

	DriveItemNameMaxRunes = 255
	DriveTrashRetention   = 30 * 24 * time.Hour
)

// DriveListing is a drive folder's children and its path from the channel root (root excluded).
type DriveListing struct {
	Items []*DriveItem `json:"items"`
	Path  []*DriveItem `json:"path"`

	Access        string `json:"access"`                   // DriveAccess*: how the viewer may change this folder
	SourceMissing bool   `json:"source_missing,omitempty"` // a mirror whose source is gone
}

const (
	DriveAccessDefault = "" // no write rule
	DriveAccessWrite   = "write"
	DriveAccessRead    = "read"
)

// DriveRules are a folder's access rules from an episode template; items inside follow their folder.
type DriveRules struct {
	ViewDepartments  StringArray `json:"view_departments,omitempty"`
	WriteDepartments StringArray `json:"write_departments,omitempty"`
	ReadOnly         bool        `json:"read_only,omitempty"`
	MirrorOf         string      `json:"mirror_of,omitempty"` // source folder id
}

func (r DriveRules) HasRules() bool {
	return len(r.ViewDepartments) > 0 || len(r.WriteDepartments) > 0 || r.ReadOnly || r.MirrorOf != ""
}

// DriveItem is a file or folder in a channel's file drive. ParentId "" is the channel root.
type DriveItem struct {
	Id        string `json:"id"`
	ChannelId string `json:"channel_id"`
	ParentId  string `json:"parent_id"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	FileId    string `json:"file_id"`
	CreatorId string `json:"creator_id"`
	CreateAt  int64  `json:"create_at"`
	UpdateAt  int64  `json:"update_at"`
	DeleteAt  int64  `json:"delete_at"`
	DeletedBy string `json:"deleted_by"`

	DriveRules

	FileInfo *FileInfo `json:"file_info,omitempty" db:"-"` // filled by the app on reads
}

func (o *DriveItem) Auditable() map[string]any {
	return map[string]any{
		"id":         o.Id,
		"channel_id": o.ChannelId,
		"parent_id":  o.ParentId,
		"type":       o.Type,
		"file_id":    o.FileId,
	}
}

func (o *DriveItem) IsFolder() bool { return o.Type == DriveItemTypeFolder }

func (o *DriveItem) PreSave() {
	if o.Id == "" {
		o.Id = NewId()
	}
	o.CreateAt = GetMillis()
	o.UpdateAt = o.CreateAt
}

func (o *DriveItem) PreUpdate() {
	o.UpdateAt = GetMillis()
}

// IsValidDriveItemName rejects names that are empty, too long, reserved, end in a space or dot,
// or contain characters that are invalid in Windows file names (so zips extract everywhere).
func IsValidDriveItemName(name string) bool {
	if name == "" || name == "." || name == ".." || utf8.RuneCountInString(name) > DriveItemNameMaxRunes || !utf8.ValidString(name) {
		return false
	}
	if strings.HasSuffix(name, " ") || strings.HasSuffix(name, ".") || strings.HasPrefix(name, " ") {
		return false
	}
	for _, r := range name {
		if r < 0x20 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return false
		}
	}
	return true
}

func (o *DriveItem) IsValid() *AppError {
	if !IsValidId(o.Id) {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(o.ChannelId) {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.channel_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if o.ParentId != "" && !IsValidId(o.ParentId) {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.parent_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if !IsValidId(o.CreatorId) {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.creator_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if !IsValidDriveItemName(o.Name) {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.name.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	switch o.Type {
	case DriveItemTypeFolder:
		if o.FileId != "" {
			return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.file_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
		}
	case DriveItemTypeFile:
		if !IsValidId(o.FileId) {
			return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.file_id.app_error", nil, "id="+o.Id, http.StatusBadRequest)
		}
	default:
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.type.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if o.HasRules() && !o.rulesValid() {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.rules.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	if o.CreateAt == 0 || o.UpdateAt == 0 {
		return NewAppError("DriveItem.IsValid", "model.drive_item.is_valid.create_at.app_error", nil, "id="+o.Id, http.StatusBadRequest)
	}
	return nil
}

// rulesValid: only folders carry rules, and every department and the mirror source must be a valid id.
func (o *DriveItem) rulesValid() bool {
	if !o.IsFolder() || (o.MirrorOf != "" && !IsValidId(o.MirrorOf)) {
		return false
	}
	for _, id := range append(append([]string{}, o.ViewDepartments...), o.WriteDepartments...) {
		if !IsValidId(id) {
			return false
		}
	}
	return true
}
