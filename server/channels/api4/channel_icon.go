// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func getChannelIcon(c *Context, w http.ResponseWriter, r *http.Request) {
	c.RequireChannelId()
	if c.Err != nil {
		return
	}

	channel, appErr := c.App.GetChannel(c.AppContext, c.Params.ChannelId)
	if appErr != nil {
		c.Err = appErr
		return
	}

	// Same read rules as getChannel: public channels are readable by team members.
	if channel.Type != model.ChannelTypeOpen || !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), channel.TeamId, model.PermissionReadPublicChannel) {
		if ok, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), channel.Id, model.PermissionReadChannel); !ok {
			c.SetPermissionError(model.PermissionReadChannel)
			return
		}
	}

	if channel.LastIconUpdate == 0 {
		c.Err = model.NewAppError("getChannelIcon", "api.channel.channel_icon.read_file.app_error", nil, "", http.StatusNotFound)
		return
	}

	etag := strconv.FormatInt(channel.LastIconUpdate, 10)
	if c.HandleEtag(etag, "Get Channel Icon", w, r) {
		return
	}

	img, appErr := c.App.GetChannelIcon(channel)
	if appErr != nil {
		c.Err = appErr
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v, private", model.DayInSeconds))
	w.Header().Set(model.HeaderEtagServer, etag)
	if _, err := w.Write(img); err != nil {
		c.Logger.Warn("Error while writing response", mlog.Err(err))
	}
}

// requireManageChannelIcon loads the channel and checks the same permission that guards header/purpose edits.
func requireManageChannelIcon(c *Context) *model.Channel {
	channel, appErr := c.App.GetChannel(c.AppContext, c.Params.ChannelId)
	if appErr != nil {
		c.Err = appErr
		return nil
	}

	var permission *model.Permission
	switch channel.Type {
	case model.ChannelTypeOpen:
		permission = model.PermissionManagePublicChannelProperties
	case model.ChannelTypePrivate:
		permission = model.PermissionManagePrivateChannelProperties
	default:
		c.SetInvalidParam("channel_id")
		return nil
	}

	if channel.DeleteAt != 0 {
		c.Err = model.NewAppError("channelIcon", "api.channel.update_channel.deleted.app_error", nil, "", http.StatusBadRequest)
		return nil
	}

	if ok, _ := c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), channel.Id, permission); !ok {
		c.SetPermissionError(permission)
		return nil
	}

	return channel
}

func setChannelIcon(c *Context, w http.ResponseWriter, r *http.Request) {
	defer func() {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			c.Logger.Warn("Error while reading request body", mlog.Err(err))
		}
	}()

	c.RequireChannelId()
	if c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventSetChannelIcon, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", c.Params.ChannelId)

	channel := requireManageChannelIcon(c)
	if c.Err != nil {
		return
	}

	maxSize := *c.App.Config().FileSettings.MaxFileSize
	if r.ContentLength > maxSize {
		c.Err = model.NewAppError("setChannelIcon", "api.channel.channel_icon.too_large.app_error", nil, "", http.StatusBadRequest)
		return
	}

	if err := r.ParseMultipartForm(maxSize); err != nil {
		c.Err = model.NewAppError("setChannelIcon", "api.channel.channel_icon.invalid_image.app_error", nil, "", http.StatusBadRequest).Wrap(err)
		return
	}

	images := r.MultipartForm.File["image"]
	if len(images) == 0 {
		c.Err = model.NewAppError("setChannelIcon", "api.channel.channel_icon.no_file.app_error", nil, "", http.StatusBadRequest)
		return
	}

	if appErr := c.App.SetChannelIcon(c.AppContext, channel, images[0]); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}

func removeChannelIcon(c *Context, w http.ResponseWriter, r *http.Request) {
	c.RequireChannelId()
	if c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventRemoveChannelIcon, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", c.Params.ChannelId)

	channel := requireManageChannelIcon(c)
	if c.Err != nil {
		return
	}

	if appErr := c.App.RemoveChannelIcon(c.AppContext, channel); appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	ReturnStatusOK(w)
}
