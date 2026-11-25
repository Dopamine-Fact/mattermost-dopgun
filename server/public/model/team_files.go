// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Kinds of a top folder of the team files template.
const (
	TeamFilesKindFolder     = ""           // a real folder in the team files channel
	TeamFilesKindLibrary    = "library"    // a real folder; its subfolders also list the files of tasks reflected into them
	TeamFilesKindProjects   = "projects"   // a real folder; its subfolders can be shared with other teams
	TeamFilesKindProduction = "production" // virtual: the team's episode channels
	TeamFilesKindChannels   = "channels"   // virtual: the viewer's channels in the team
)

// Access of a top folder for people who are not admins of the team files channel.
const (
	TeamFilesAccessDefault = ""      // the drive's usual rules
	TeamFilesAccessAdmin   = "admin" // hidden from everyone but admins
	TeamFilesAccessRead    = "read"  // everyone reads, admins write
)

const TeamFilesDescriptionMaxRunes = 1000

// TeamFilesFolder is one folder of a team's Files page layout. Id is the drive folder the server created for it
// (empty for virtual kinds and before the template is applied).
type TeamFilesFolder struct {
	Id          string             `json:"id,omitempty"`
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Kind        string             `json:"kind,omitempty"`   // top folders only
	Access      string             `json:"access,omitempty"` // top folders only
	Children    []*TeamFilesFolder `json:"children,omitempty"`
}

func (f *TeamFilesFolder) IsVirtual() bool {
	return f.Kind == TeamFilesKindProduction || f.Kind == TeamFilesKindChannels
}

// TeamFilesLayout is what the Files page shows at the team root for one viewer.
type TeamFilesLayout struct {
	ChannelId string             `json:"channel_id"` // the team files channel; empty without a template
	Folders   []*TeamFilesFolder `json:"folders"`
	// ProductionChannelIds are the team's episode channels (channels with a task section).
	ProductionChannelIds []string `json:"production_channel_ids"`
	IsAdmin              bool     `json:"is_admin"`
}

// DriveShare shows a team files folder (and everything below it) read-only in another team's projects folder.
type DriveShare struct {
	ItemId    string `json:"item_id"`
	TeamId    string `json:"team_id"`
	CreatorId string `json:"creator_id"`
	CreateAt  int64  `json:"create_at"`
}

// DriveSharedItem is a folder shared into a team, with the team that owns it.
type DriveSharedItem struct {
	*DriveItem
	SourceTeamId          string `json:"source_team_id"`
	SourceTeamDisplayName string `json:"source_team_display_name"`
}

// ParseTeamFilesTemplate reads and validates a template; "" is no template (nil).
func ParseTeamFilesTemplate(text string) ([]*TeamFilesFolder, *AppError) {
	if strings.TrimSpace(text) == "" {
		return nil, nil
	}
	invalid := func(detail string) *AppError {
		return NewAppError("ParseTeamFilesTemplate", "model.team_files.invalid.app_error", nil, detail, http.StatusBadRequest)
	}
	if utf8.RuneCountInString(text) > TeamEpisodeFoldersMaxRunes {
		return nil, invalid("too long")
	}
	var folders []*TeamFilesFolder
	if err := json.Unmarshal([]byte(text), &folders); err != nil {
		return nil, invalid(err.Error())
	}
	var check func(list []*TeamFilesFolder, top bool) *AppError
	check = func(list []*TeamFilesFolder, top bool) *AppError {
		names := map[string]bool{}
		for _, f := range list {
			if f == nil || !IsValidDriveItemName(f.Name) || names[strings.ToLower(f.Name)] {
				return invalid("name")
			}
			names[strings.ToLower(f.Name)] = true
			if f.Id != "" && !IsValidId(f.Id) {
				return invalid("id")
			}
			if utf8.RuneCountInString(f.Description) > TeamFilesDescriptionMaxRunes {
				return invalid("description")
			}
			if !top && (f.Kind != "" || f.Access != "") {
				return invalid("kind and access are for top folders only")
			}
			switch f.Kind {
			case TeamFilesKindFolder, TeamFilesKindLibrary, TeamFilesKindProjects, TeamFilesKindProduction, TeamFilesKindChannels:
			default:
				return invalid("kind")
			}
			switch f.Access {
			case TeamFilesAccessDefault, TeamFilesAccessAdmin, TeamFilesAccessRead:
			default:
				return invalid("access")
			}
			if f.IsVirtual() && (len(f.Children) > 0 || f.Access != "") {
				return invalid("virtual folders have no children or access")
			}
			if appErr := check(f.Children, false); appErr != nil {
				return appErr
			}
		}
		return nil
	}
	if appErr := check(folders, true); appErr != nil {
		return nil, appErr
	}
	return folders, nil
}

// WalkTeamFilesTemplate calls fn for every folder with its top folder, parents first.
func WalkTeamFilesTemplate(folders []*TeamFilesFolder, fn func(f, top *TeamFilesFolder)) {
	var walk func(list []*TeamFilesFolder, top *TeamFilesFolder)
	walk = func(list []*TeamFilesFolder, top *TeamFilesFolder) {
		for _, f := range list {
			t := top
			if t == nil {
				t = f
			}
			fn(f, t)
			walk(f.Children, t)
		}
	}
	walk(folders, nil)
}
