// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// SetChannelParent makes the channel a sub-channel of parentID, or detaches it when parentID
// is empty. Permission checks on both channels are the caller's job.
func (a *App) SetChannelParent(rctx request.CTX, channelID, parentID string) (*model.Channel, *model.AppError) {
	channel, appErr := a.GetChannel(rctx, channelID)
	if appErr != nil {
		return nil, appErr
	}
	if channel.ParentId == parentID {
		return channel, nil
	}

	if parentID != "" {
		parent, appErr := a.GetChannel(rctx, parentID)
		if appErr != nil {
			return nil, appErr
		}
		hasChildren, err := a.Srv().Store().Channel().HasChildChannels(channel.Id)
		if err != nil {
			return nil, model.NewAppError("SetChannelParent", "app.channel.update_channel.internal_error", nil, "", http.StatusInternalServerError).Wrap(err)
		}
		if appErr := channel.ValidateParent(parent, hasChildren); appErr != nil {
			return nil, appErr
		}
	}

	updated := channel.DeepCopy()
	updated.ParentId = parentID
	return a.UpdateChannel(rctx, updated)
}
