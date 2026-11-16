// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func canvasStoreError(where, channelID string, err error) *model.AppError {
	var nfErr *store.ErrNotFound
	var conflictErr *store.ErrConflict
	switch {
	case errors.As(err, &nfErr):
		return model.NewAppError(where, "app.canvas.not_found.app_error", nil, "channel_id="+channelID, http.StatusNotFound).Wrap(err)
	case errors.As(err, &conflictErr):
		return model.NewAppError(where, "app.canvas.invalid_channel.app_error", nil, "canvas already exists, channel_id="+channelID, http.StatusBadRequest).Wrap(err)
	default:
		return model.NewAppError(where, "app.canvas.store.app_error", nil, "channel_id="+channelID, http.StatusInternalServerError).Wrap(err)
	}
}

func (a *App) requireCanvasTeam(where, teamID string) *model.AppError {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return appErr
	}
	if !team.CanvasEnabled || team.DeleteAt != 0 {
		return model.NewAppError(where, "app.canvas.disabled.app_error", nil, "team_id="+teamID, http.StatusForbidden)
	}
	return nil
}

func canvasPayloadError(where string, size, limit int) *model.AppError {
	if size == 0 {
		return model.NewAppError(where, "api.context.invalid_body_param.app_error", map[string]any{"Name": "data"}, "", http.StatusBadRequest)
	}
	if size > limit {
		return model.NewAppError(where, "app.canvas.too_large.app_error", nil, "", http.StatusRequestEntityTooLarge)
	}
	return nil
}

// requireCanvasWritable: the canvas exists, its team still has canvases on and its channel is not archived.
func (a *App) requireCanvasWritable(rctx request.CTX, where, channelID string) *model.AppError {
	canvas, err := a.Srv().Store().Canvas().Get(channelID)
	if err != nil {
		return canvasStoreError(where, channelID, err)
	}
	if appErr := a.requireCanvasTeam(where, canvas.TeamId); appErr != nil {
		return appErr
	}
	channel, appErr := a.GetChannel(rctx, channelID)
	if appErr != nil {
		return appErr
	}
	if channel.DeleteAt != 0 {
		return model.NewAppError(where, "app.canvas.archived.app_error", nil, "channel_id="+channelID, http.StatusBadRequest)
	}
	return nil
}

func (a *App) CreateCanvas(rctx request.CTX, teamID, channelID, userID string) (*model.Canvas, *model.AppError) {
	if appErr := a.requireCanvasTeam("CreateCanvas", teamID); appErr != nil {
		return nil, appErr
	}
	channel, appErr := a.GetChannel(rctx, channelID)
	if appErr != nil {
		return nil, appErr
	}
	if channel.TeamId != teamID {
		return nil, model.NewAppError("CreateCanvas", "app.canvas.invalid_channel.app_error", nil, "channel_id="+channelID, http.StatusBadRequest)
	}
	if channel.DeleteAt != 0 {
		return nil, model.NewAppError("CreateCanvas", "app.canvas.archived.app_error", nil, "channel_id="+channelID, http.StatusBadRequest)
	}
	canvas, err := a.Srv().Store().Canvas().Save(&model.Canvas{ChannelId: channelID, TeamId: teamID, CreatorId: userID})
	if err != nil {
		return nil, canvasStoreError("CreateCanvas", channelID, err)
	}
	return canvas, nil
}

func (a *App) GetCanvas(rctx request.CTX, channelID string) (*model.Canvas, *model.AppError) {
	canvas, err := a.Srv().Store().Canvas().Get(channelID)
	if err != nil {
		return nil, canvasStoreError("GetCanvas", channelID, err)
	}
	return canvas, nil
}

func (a *App) GetCanvasState(rctx request.CTX, channelID string, afterSeq int64) (*model.CanvasState, *model.AppError) {
	if _, appErr := a.GetCanvas(rctx, channelID); appErr != nil {
		return nil, appErr
	}
	state, err := a.Srv().Store().Canvas().GetState(channelID, max(afterSeq, 0))
	if err != nil {
		return nil, canvasStoreError("GetCanvasState", channelID, err)
	}
	return state, nil
}

// AppendCanvasUpdate stores one update and tells every other connection of the channel's members.
func (a *App) AppendCanvasUpdate(rctx request.CTX, channelID, userID string, data []byte, connectionID string) (int64, *model.AppError) {
	if appErr := canvasPayloadError("AppendCanvasUpdate", len(data), model.CanvasUpdateMaxBytes); appErr != nil {
		return 0, appErr
	}
	if appErr := a.requireCanvasWritable(rctx, "AppendCanvasUpdate", channelID); appErr != nil {
		return 0, appErr
	}
	seq, err := a.Srv().Store().Canvas().AppendUpdate(channelID, userID, data)
	if err != nil {
		return 0, canvasStoreError("AppendCanvasUpdate", channelID, err)
	}

	event := model.NewWebSocketEvent(model.WebsocketEventCanvasUpdated, "", channelID, "", nil, connectionID)
	event.Add("channel_id", channelID)
	event.Add("seq", seq)
	event.Add("data", base64.StdEncoding.EncodeToString(data))
	a.Publish(event)
	return seq, nil
}

// SaveCanvasSnapshot replaces the updates up to snap.UptoSeq; the store ignores a snapshot that is stale or ahead of the log.
func (a *App) SaveCanvasSnapshot(rctx request.CTX, channelID string, snap *model.CanvasSnapshot) (bool, *model.AppError) {
	if appErr := canvasPayloadError("SaveCanvasSnapshot", len(snap.Data), model.CanvasSnapshotMaxBytes); appErr != nil {
		return false, appErr
	}
	if snap.UptoSeq < 1 {
		return false, model.NewAppError("SaveCanvasSnapshot", "api.context.invalid_body_param.app_error", map[string]any{"Name": "upto_seq"}, "", http.StatusBadRequest)
	}
	if appErr := a.requireCanvasWritable(rctx, "SaveCanvasSnapshot", channelID); appErr != nil {
		return false, appErr
	}
	applied, err := a.Srv().Store().Canvas().SaveSnapshot(channelID, snap.Data, snap.UptoSeq)
	if err != nil {
		return false, canvasStoreError("SaveCanvasSnapshot", channelID, err)
	}
	return applied, nil
}

// PublishCanvasAwareness relays cursors and selections to the channel's other users; nothing is stored.
func (a *App) PublishCanvasAwareness(channelID, userID string, data []byte) {
	event := model.NewWebSocketEvent(model.WebsocketEventCanvasAwareness, "", channelID, "", map[string]bool{userID: true}, "")
	event.Add("channel_id", channelID)
	event.Add("user_id", userID)
	event.Add("data", base64.StdEncoding.EncodeToString(data))
	a.Publish(event)
}
