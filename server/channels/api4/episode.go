// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
)

func (api *API) InitEpisode() {
	api.BaseRoutes.Team.Handle("/episodes", api.APISessionRequired(createEpisode)).Methods(http.MethodPost)
}

func createEpisode(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	teamID := c.Params.TeamId
	if requireTaskTeamMember(c, teamID); c.Err != nil {
		return
	}
	if requireTeamPermission(c, teamID, model.PermissionCreatePublicChannel); c.Err != nil {
		return
	}
	if requireTeamPermission(c, teamID, model.PermissionManageTasks); c.Err != nil {
		return
	}

	var in model.EpisodeCreate
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		c.SetInvalidParamWithErr("episode", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventCreateEpisode, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "team_id", teamID)
	model.AddEventParameterToAuditRec(auditRec, "name", in.Name)

	created, appErr := c.App.CreateEpisode(c.AppContext, c.AppContext.Session().UserId, teamID, &in)
	if appErr != nil {
		c.Err = appErr
		return
	}

	auditRec.Success()
	auditRec.AddEventObjectType("episode")
	model.AddEventParameterToAuditRec(auditRec, "channel_id", created.Channel.Id)
	writeTaskJSON(w, http.StatusCreated, created)
}
