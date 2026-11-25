// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"errors"
	"net/http"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/i18n"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

const noteReminderBatch = 200

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

// CheckNoteReminders DMs every due reminder to its owner from the system bot. Reminders of a team with notes turned
// off, or of an owner who left the team or was deactivated, are cleared without being sent. A reminder is cleared
// only after its DM is posted, so a failure retries on the next tick (and a crash in between can send it twice).
func (a *App) CheckNoteReminders(rctx request.CTX) {
	rctx = rctx.WithLogFields(mlog.String("component", "note_reminders"))
	systemBot, appErr := a.GetSystemBot(rctx)
	if appErr != nil {
		if appErr.Id == "app.bot.get_system_bot.empty_admin_list.app_error" {
			rctx.Logger().Debug("Skipping note reminders because there is no system admin to own the system bot")
			return
		}
		rctx.Logger().Error("Failed to get system bot", mlog.Err(appErr))
		return
	}
	notes, err := a.Srv().Store().PersonalNote().GetDueReminders(model.GetMillis(), noteReminderBatch)
	if err != nil {
		rctx.Logger().Error("Failed to get due note reminders", mlog.Err(err))
		return
	}

	teams := map[string]*model.Team{}
	for _, note := range notes {
		team, seen := teams[note.TeamId]
		if !seen {
			var appErr *model.AppError
			if team, appErr = a.GetTeam(note.TeamId); appErr != nil && appErr.StatusCode != http.StatusNotFound {
				rctx.Logger().Error("Failed to get team for note reminder", mlog.Err(appErr), mlog.String("note_id", note.Id))
				continue
			}
			teams[note.TeamId] = team
		}
		user, userErr := a.GetUser(rctx, note.UserId)
		member, memberErr := a.GetTeamMember(rctx, note.TeamId, note.UserId)
		if (userErr != nil && userErr.StatusCode != http.StatusNotFound) || (memberErr != nil && memberErr.StatusCode != http.StatusNotFound) {
			rctx.Logger().Error("Failed to get owner of note reminder", mlog.String("note_id", note.Id))
			continue
		}
		deliverable := team != nil && team.NotesEnabled && team.DeleteAt == 0 &&
			userErr == nil && user.DeleteAt == 0 && memberErr == nil && member.DeleteAt == 0
		if deliverable && !a.sendNoteReminder(rctx, systemBot.UserId, team, user, note) {
			continue
		}
		if err := a.Srv().Store().PersonalNote().ClearReminder(note.Id); err != nil {
			rctx.Logger().Error("Failed to clear note reminder", mlog.Err(err), mlog.String("note_id", note.Id))
		}
	}
}

func (a *App) sendNoteReminder(rctx request.CTX, botID string, team *model.Team, user *model.User, note *model.PersonalNote) bool {
	ch, appErr := a.GetOrCreateDirectChannel(rctx, user.Id, botID)
	if appErr != nil {
		rctx.Logger().Error("Failed to get direct channel for note reminder", mlog.Err(appErr), mlog.String("note_id", note.Id))
		return false
	}
	when := note.Date
	if note.Time != "" {
		when += " " + note.Time
	}
	T := i18n.GetUserTranslations(user.Locale)
	dm := &model.Post{
		ChannelId: ch.Id,
		UserId:    botID,
		Message: T("app.note_reminder_dm", model.StringInterface{
			"Title":    note.Title,
			"When":     when,
			"SiteURL":  *a.Config().ServiceSettings.SiteURL,
			"TeamName": team.Name,
			"NoteId":   note.Id,
		}),
	}
	if _, _, appErr := a.CreatePost(rctx, dm, ch, model.CreatePostFlags{SetOnline: true}); appErr != nil {
		rctx.Logger().Error("Failed to post note reminder", mlog.Err(appErr), mlog.String("note_id", note.Id))
		return false
	}
	return true
}
