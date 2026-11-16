// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/app/imaging"
)

func channelIconPath(channelID string) string {
	return "channels/" + channelID + "/channelIcon.png"
}

func (a *App) GetChannelIcon(channel *model.Channel) ([]byte, *model.AppError) {
	if *a.Config().FileSettings.DriverName == "" {
		return nil, model.NewAppError("GetChannelIcon", "api.channel.channel_icon.storage.app_error", nil, "", http.StatusNotImplemented)
	}

	data, err := a.ReadFile(channelIconPath(channel.Id))
	if err != nil {
		return nil, model.NewAppError("GetChannelIcon", "api.channel.channel_icon.read_file.app_error", nil, "", http.StatusNotFound).Wrap(err)
	}

	return data, nil
}

// SetChannelIcon mirrors SetTeamIcon: scale to a 128px square PNG, store it and bump LastIconUpdate.
func (a *App) SetChannelIcon(rctx request.CTX, channel *model.Channel, imageData *multipart.FileHeader) *model.AppError {
	if *a.Config().FileSettings.DriverName == "" {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.storage.app_error", nil, "", http.StatusNotImplemented)
	}

	file, err := imageData.Open()
	if err != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.invalid_image.app_error", nil, "", http.StatusBadRequest).Wrap(err)
	}
	defer file.Close()

	if limitErr := checkImageLimits(file, *a.Config().FileSettings.MaxImageResolution); limitErr != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.invalid_image.app_error", nil, "", http.StatusBadRequest).Wrap(limitErr)
	}

	img, format, err := a.ch.imgDecoder.Decode(file)
	if err != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.invalid_image.app_error", nil, "", http.StatusBadRequest).Wrap(err)
	}

	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.write_file.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	orientation, err := imaging.GetImageOrientation(file, format)
	if err != nil {
		rctx.Logger().Warn("Failed to get image orientation", mlog.Err(err))
	}

	img = imaging.FillCenter(imaging.MakeImageUpright(img, orientation), 128, 128)

	buf := new(bytes.Buffer)
	if err = a.ch.imgEncoder.EncodePNG(buf, img); err != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.write_file.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if _, err := a.WriteFile(buf, channelIconPath(channel.Id)); err != nil {
		return model.NewAppError("SetChannelIcon", "api.channel.channel_icon.write_file.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	return a.setChannelLastIconUpdate(rctx, channel, model.GetMillis())
}

func (a *App) RemoveChannelIcon(rctx request.CTX, channel *model.Channel) *model.AppError {
	return a.setChannelLastIconUpdate(rctx, channel, 0)
}

// setChannelLastIconUpdate goes through UpdateChannel so caches are invalidated and channel_updated is broadcast.
func (a *App) setChannelLastIconUpdate(rctx request.CTX, channel *model.Channel, value int64) *model.AppError {
	updated := channel.DeepCopy()
	updated.LastIconUpdate = value
	_, appErr := a.UpdateChannel(rctx, updated)
	return appErr
}
