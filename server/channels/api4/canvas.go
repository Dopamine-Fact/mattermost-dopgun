// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (api *API) InitCanvas() {
	api.BaseRoutes.Team.Handle("/canvases", api.APISessionRequired(createCanvas)).Methods(http.MethodPost)
	api.BaseRoutes.Channel.Handle("/canvas", api.APISessionRequired(getCanvas)).Methods(http.MethodGet)
	api.BaseRoutes.Channel.Handle("/canvas/state", api.APISessionRequired(getCanvasState)).Methods(http.MethodGet)
	// fileAPI lifts the 300 KB MaximumPayloadSizeBytes cap; decodeCanvasBody enforces the canvas limits.
	api.BaseRoutes.Channel.Handle("/canvas/updates", api.APISessionRequired(postCanvasUpdate, handlerParamFileAPI)).Methods(http.MethodPost)
	api.BaseRoutes.Channel.Handle("/canvas/snapshot", api.APISessionRequired(putCanvasSnapshot, handlerParamFileAPI)).Methods(http.MethodPut)
}

func writeCanvasJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		mlog.Error("failed to encode canvas API response", mlog.Err(err))
	}
}

// decodeCanvasBody reads a body of at most maxBytes decoded bytes (plus base64 and JSON overhead); false means c.Err is set.
func decodeCanvasBody(c *Context, w http.ResponseWriter, r *http.Request, maxBytes int, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxBytes)*4/3+1024)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.Err = model.NewAppError("decodeCanvasBody", "app.canvas.too_large.app_error", nil, "", http.StatusRequestEntityTooLarge).Wrap(err)
		} else {
			c.SetInvalidParamWithErr("body", err)
		}
		return false
	}
	return true
}

func requireCanvasChannelPermission(c *Context, permission *model.Permission) bool {
	if c.RequireChannelId(); c.Err != nil {
		return false
	}
	if ok, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), c.Params.ChannelId, permission); !ok {
		c.SetPermissionError(permission)
		return false
	}
	return true
}

func createCanvas(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	var body struct {
		ChannelId string `json:"channel_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !model.IsValidId(body.ChannelId) {
		c.SetInvalidParam("channel_id")
		return
	}
	channel, appErr := c.App.GetChannel(c.AppContext, body.ChannelId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	permission := model.PermissionManagePublicChannelProperties
	if channel.Type == model.ChannelTypePrivate {
		permission = model.PermissionManagePrivateChannelProperties
	}
	if ok, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), channel.Id, permission); !ok {
		c.SetPermissionError(permission)
		return
	}
	canvas, appErr := c.App.CreateCanvas(c.AppContext, c.Params.TeamId, channel.Id, c.AppContext.Session().UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCanvasJSON(w, http.StatusCreated, canvas)
}

func getCanvas(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requireCanvasChannelPermission(c, model.PermissionReadChannel) {
		return
	}
	canvas, appErr := c.App.GetCanvas(c.AppContext, c.Params.ChannelId)
	if appErr != nil {
		// A channel without a canvas is a normal answer for this probe; 204 keeps it out of the browser console.
		if appErr.Id == "app.canvas.not_found.app_error" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		c.Err = appErr
		return
	}
	writeCanvasJSON(w, http.StatusOK, canvas)
}

func getCanvasState(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requireCanvasChannelPermission(c, model.PermissionReadChannel) {
		return
	}
	var after int64
	if s := r.URL.Query().Get("after"); s != "" {
		var err error
		if after, err = strconv.ParseInt(s, 10, 64); err != nil {
			c.SetInvalidURLParam("after")
			return
		}
	}
	state, appErr := c.App.GetCanvasState(c.AppContext, c.Params.ChannelId, after)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCanvasJSON(w, http.StatusOK, state)
}

func postCanvasUpdate(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requireCanvasChannelPermission(c, model.PermissionCreatePost) {
		return
	}
	var body struct {
		Data []byte `json:"data"`
	}
	if !decodeCanvasBody(c, w, r, model.CanvasUpdateMaxBytes, &body) {
		return
	}
	seq, appErr := c.App.AppendCanvasUpdate(c.AppContext, c.Params.ChannelId, c.AppContext.Session().UserId, body.Data, r.Header.Get(model.ConnectionId))
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCanvasJSON(w, http.StatusOK, map[string]int64{"seq": seq})
}

func putCanvasSnapshot(c *Context, w http.ResponseWriter, r *http.Request) {
	if !requireCanvasChannelPermission(c, model.PermissionCreatePost) {
		return
	}
	var snap model.CanvasSnapshot
	if !decodeCanvasBody(c, w, r, model.CanvasSnapshotMaxBytes, &snap) {
		return
	}
	applied, appErr := c.App.SaveCanvasSnapshot(c.AppContext, c.Params.ChannelId, &snap)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCanvasJSON(w, http.StatusOK, map[string]bool{"applied": applied})
}
