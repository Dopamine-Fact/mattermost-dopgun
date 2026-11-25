// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// RequireNotesEnabled returns the team, or 403 unless it is active and has personal notes turned on.
func (a *App) RequireNotesEnabled(teamID string) (*model.Team, *model.AppError) {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	if !team.NotesEnabled || team.DeleteAt != 0 {
		return nil, model.NewAppError("RequireNotesEnabled", "app.note.disabled.app_error", nil, "team_id="+teamID, http.StatusForbidden)
	}
	return team, nil
}

// personalNoteLocation is the owner's timezone, which reminder times are computed in; UTC when unknown.
func (a *App) personalNoteLocation(rctx request.CTX, userID string) *time.Location {
	user, appErr := a.GetUser(rctx, userID)
	if appErr != nil {
		return time.UTC
	}
	loc, err := time.LoadLocation(user.GetPreferredTimezone())
	if err != nil {
		return time.UTC
	}
	return loc
}

func personalNoteStoreError(where, id string, err error) *model.AppError {
	var appErr *model.AppError
	var nfErr *store.ErrNotFound
	switch {
	case errors.As(err, &appErr):
		return appErr
	case errors.As(err, &nfErr):
		return model.NewAppError(where, "app.note.not_found.app_error", nil, "id="+id, http.StatusNotFound)
	default:
		return model.NewAppError(where, "app.note.store.app_error", nil, "id="+id, http.StatusInternalServerError).Wrap(err)
	}
}

func (a *App) CreatePersonalNote(rctx request.CTX, note *model.PersonalNote) (*model.PersonalNote, *model.AppError) {
	note.Id = ""
	note.PreSave()
	if appErr := note.IsValid(); appErr != nil {
		return nil, appErr
	}
	note.ComputeRemindAt(a.personalNoteLocation(rctx, note.UserId), model.GetMillis())
	saved, err := a.Srv().Store().PersonalNote().Save(note)
	if err != nil {
		return nil, personalNoteStoreError("CreatePersonalNote", note.Id, err)
	}
	return saved, nil
}

// getPersonalNoteFor loads a note userID may see in teamID. Someone else's private note, or a note of another team,
// is reported as missing; forWrite also rejects someone else's shared note with 403.
func (a *App) getPersonalNoteFor(teamID, noteID, userID string, forWrite bool) (*model.PersonalNote, *model.AppError) {
	note, err := a.Srv().Store().PersonalNote().Get(noteID)
	if err != nil {
		return nil, personalNoteStoreError("getPersonalNoteFor", noteID, err)
	}
	if note.TeamId != teamID || (note.UserId != userID && note.Visibility != model.PersonalNoteVisibilityTeam) {
		return nil, model.NewAppError("getPersonalNoteFor", "app.note.not_found.app_error", nil, "id="+noteID, http.StatusNotFound)
	}
	if forWrite && note.UserId != userID {
		return nil, model.NewAppError("getPersonalNoteFor", "app.note.not_owner.app_error", nil, "id="+noteID, http.StatusForbidden)
	}
	return note, nil
}

func (a *App) GetPersonalNote(rctx request.CTX, teamID, noteID, userID string) (*model.PersonalNote, *model.AppError) {
	return a.getPersonalNoteFor(teamID, noteID, userID, false)
}

func (a *App) GetPersonalNotes(rctx request.CTX, teamID, userID string, opts store.PersonalNoteListOptions) ([]*model.PersonalNote, *model.AppError) {
	notes, err := a.Srv().Store().PersonalNote().GetForTeam(teamID, userID, opts)
	if err != nil {
		return nil, personalNoteStoreError("GetPersonalNotes", teamID, err)
	}
	return notes, nil
}

func (a *App) PatchPersonalNote(rctx request.CTX, teamID, noteID, userID string, patch *model.PersonalNotePatch) (*model.PersonalNote, *model.AppError) {
	note, appErr := a.getPersonalNoteFor(teamID, noteID, userID, true)
	if appErr != nil {
		return nil, appErr
	}
	note.Patch(patch)
	note.PreUpdate()
	if appErr := note.IsValid(); appErr != nil {
		return nil, appErr
	}
	note.ComputeRemindAt(a.personalNoteLocation(rctx, note.UserId), model.GetMillis())
	updated, err := a.Srv().Store().PersonalNote().Update(note)
	if err != nil {
		return nil, personalNoteStoreError("PatchPersonalNote", noteID, err)
	}
	return updated, nil
}

func (a *App) DeletePersonalNote(rctx request.CTX, teamID, noteID, userID string) *model.AppError {
	if _, appErr := a.getPersonalNoteFor(teamID, noteID, userID, true); appErr != nil {
		return appErr
	}
	if err := a.Srv().Store().PersonalNote().Delete(noteID); err != nil {
		return personalNoteStoreError("DeletePersonalNote", noteID, err)
	}
	return nil
}
