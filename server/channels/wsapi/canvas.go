// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package wsapi

import (
	"encoding/base64"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

func (api *API) InitCanvas() {
	api.Router.Handle("canvas_awareness", api.APIWebSocketHandler(api.canvasAwareness))
}

func (api *API) canvasAwareness(req *model.WebSocketRequest) (map[string]any, *model.AppError) {
	if api.App.Srv().Platform().Busy.IsBusy() {
		// non-critical, like typing: dropped while the server is busy.
		return nil, NewServerBusyWebSocketError(req.Action)
	}

	channelID, ok := req.Data["channel_id"].(string)
	if !ok || !model.IsValidId(channelID) {
		return nil, NewInvalidWebSocketParamError(req.Action, "channel_id")
	}
	if hasPermission, _ := api.App.SessionHasPermissionToChannel(request.EmptyContext(api.App.Log()), req.Session, channelID, model.PermissionReadChannel); !hasPermission {
		return nil, NewInvalidWebSocketParamError(req.Action, "channel_id")
	}

	encoded, ok := req.Data["data"].(string)
	if !ok || base64.StdEncoding.DecodedLen(len(encoded)) > model.CanvasAwarenessMaxBytes+2 {
		return nil, NewInvalidWebSocketParamError(req.Action, "data")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data) > model.CanvasAwarenessMaxBytes {
		return nil, NewInvalidWebSocketParamError(req.Action, "data")
	}

	api.App.PublishCanvasAwareness(channelID, req.Session.UserId, data)
	return nil, nil
}
