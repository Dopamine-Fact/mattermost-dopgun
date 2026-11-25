// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

const (
	personalNoteMaxRangeDays    = 62
	personalNoteRangeLimit      = 1000
	personalNoteUndatedLimit    = 500
	personalNoteMaxRequestBytes = 1 << 16
)

func (api *API) InitPersonalNotes() {
	api.BaseRoutes.Team.Handle("/notes", api.APISessionRequired(getPersonalNotes)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/notes", api.APISessionRequired(createPersonalNote)).Methods(http.MethodPost)
	note := "/notes/{note_id:[A-Za-z0-9]+}"
	api.BaseRoutes.Team.Handle(note, api.APISessionRequired(getPersonalNote)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle(note+"/patch", api.APISessionRequired(patchPersonalNote)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle(note, api.APISessionRequired(deletePersonalNote)).Methods(http.MethodDelete)
}

// requirePersonalNotesTeam checks the caller is an active member of the team (team permissions alone would let
// non-member system admins in) and that the team has personal notes on.
func requirePersonalNotesTeam(c *Context) bool {
	if c.RequireTeamId(); c.Err != nil {
		return false
	}
	member, appErr := c.App.GetTeamMember(c.AppContext, c.Params.TeamId, c.AppContext.Session().UserId)
	if appErr != nil || member.DeleteAt != 0 {
		c.SetPermissionError(model.PermissionViewTeam)
		return false
	}
	if _, appErr := c.App.RequireNotesEnabled(c.Params.TeamId); appErr != nil {
		c.Err = appErr
		return false
	}
	return true
}

func personalNoteIDParam(c *Context, r *http.Request) string {
	id := mux.Vars(r)["note_id"]
	if !model.IsValidId(id) {
		c.SetInvalidURLParam("note_id")
		return ""
	}
	return id
}

func getPersonalNotes(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requirePersonalNotesTeam(c) {
		return
	}
	q := r.URL.Query()
	opts := store.PersonalNoteListOptions{OnlyMine: q.Get("only_mine") == "true", Undated: q.Get("undated") == "true"}
	if opts.Undated {
		opts.Limit = personalNoteUndatedLimit
	} else {
		from, err1 := time.Parse(time.DateOnly, q.Get("from"))
		to, err2 := time.Parse(time.DateOnly, q.Get("to"))
		if err1 != nil || err2 != nil || to.Before(from) || to.Sub(from) > (personalNoteMaxRangeDays-1)*24*time.Hour {
			c.Err = model.NewAppError("getPersonalNotes", "api.note.invalid_range.app_error", nil, "from="+q.Get("from")+" to="+q.Get("to"), http.StatusBadRequest)
			return
		}
		opts.FromDate, opts.ToDate, opts.Limit = q.Get("from"), q.Get("to"), personalNoteRangeLimit
	}
	notes, appErr := c.App.GetPersonalNotes(c.AppContext, c.Params.TeamId, c.AppContext.Session().UserId, opts)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, notes)
}

func getPersonalNote(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requirePersonalNotesTeam(c) {
		return
	}
	id := personalNoteIDParam(c, r)
	if c.Err != nil {
		return
	}
	note, appErr := c.App.GetPersonalNote(c.AppContext, c.Params.TeamId, id, c.AppContext.Session().UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, note)
}

func createPersonalNote(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requirePersonalNotesTeam(c) {
		return
	}
	var note model.PersonalNote
	if err := json.NewDecoder(io.LimitReader(r.Body, personalNoteMaxRequestBytes)).Decode(&note); err != nil {
		c.SetInvalidParamWithErr("note", err)
		return
	}
	// Owner and team come from the session and URL, never from the body.
	note.UserId, note.TeamId = c.AppContext.Session().UserId, c.Params.TeamId
	created, appErr := c.App.CreatePersonalNote(c.AppContext, &note)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusCreated, created)
}

func patchPersonalNote(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requirePersonalNotesTeam(c) {
		return
	}
	id := personalNoteIDParam(c, r)
	if c.Err != nil {
		return
	}
	var patch model.PersonalNotePatch
	if err := json.NewDecoder(io.LimitReader(r.Body, personalNoteMaxRequestBytes)).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("patch", err)
		return
	}
	note, appErr := c.App.PatchPersonalNote(c.AppContext, c.Params.TeamId, id, c.AppContext.Session().UserId, &patch)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, note)
}

func deletePersonalNote(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requirePersonalNotesTeam(c) {
		return
	}
	id := personalNoteIDParam(c, r)
	if c.Err != nil {
		return
	}
	if appErr := c.App.DeletePersonalNote(c.AppContext, c.Params.TeamId, id, c.AppContext.Session().UserId); appErr != nil {
		c.Err = appErr
		return
	}
	ReturnStatusOK(w)
}
