// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
)

func (api *API) InitTeamFiles() {
	api.BaseRoutes.Team.Handle("/files/layout", api.APISessionRequired(getTeamFilesLayout)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/files/template", api.APISessionRequired(getTeamFilesTemplate)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/files/template", api.APISessionRequired(putTeamFilesTemplate)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle("/files/shared", api.APISessionRequired(listSharedDriveFolder)).Methods(http.MethodGet)
	api.BaseRoutes.Channel.Handle("/drive/folders", api.APISessionRequired(listDriveFolders)).Methods(http.MethodGet)
	api.BaseRoutes.Channel.Handle("/drive/shares", api.APISessionRequired(getDriveFolderShares)).Methods(http.MethodGet)
	api.BaseRoutes.Channel.Handle("/drive/shares", api.APISessionRequired(putDriveFolderShares)).Methods(http.MethodPut)
}

// requireFilesTeam checks the URL team has the file drive on and the caller may view it.
func requireFilesTeam(c *Context) *model.Team {
	if c.RequireTeamId(); c.Err != nil {
		return nil
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return nil
	}
	team, appErr := c.App.GetTeam(c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if !team.FilesEnabled {
		c.Err = model.NewAppError("requireFilesTeam", "app.drive.disabled.app_error", nil, "team_id="+team.Id, http.StatusForbidden)
		return nil
	}
	return team
}

func getTeamFilesLayout(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireFilesTeam(c); c.Err != nil {
		return
	}
	layout, appErr := c.App.GetTeamFilesLayout(c.AppContext, *c.AppContext.Session(), c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, layout)
}

func getTeamFilesTemplate(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTeamPermission(c, c.Params.TeamId, model.PermissionManageTeam); c.Err != nil {
		return
	}
	folders, appErr := c.App.GetTeamFilesTemplate(c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, folders)
}

func putTeamFilesTemplate(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTeamPermission(c, c.Params.TeamId, model.PermissionManageTeam); c.Err != nil {
		return
	}
	var folders []*model.TeamFilesFolder
	if err := json.NewDecoder(r.Body).Decode(&folders); err != nil {
		c.SetInvalidParamWithErr("template", err)
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventPatchTeam, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "team_id", c.Params.TeamId)
	model.AddEventParameterToAuditRec(auditRec, "files_template_folders", len(folders))

	saved, appErr := c.App.ApplyTeamFilesTemplate(c.AppContext, c.AppContext.Session().UserId, c.Params.TeamId, folders)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	writeTaskJSON(w, http.StatusOK, saved)
}

func listSharedDriveFolder(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireFilesTeam(c); c.Err != nil {
		return
	}
	parentID := r.URL.Query().Get("parent_id")
	if parentID != "" && !model.IsValidId(parentID) {
		c.SetInvalidParam("parent_id")
		return
	}
	listing, appErr := c.App.ListSharedDriveFolder(c.Params.TeamId, parentID)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, listing)
}

func listDriveFolders(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	folders, appErr := c.App.ListDriveFolders(c.AppContext, *c.AppContext.Session(), channel)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, folders)
}

type driveSharesBody struct {
	ItemId  string   `json:"item_id"`
	TeamIds []string `json:"team_ids"`
}

func getDriveFolderShares(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	itemID := r.URL.Query().Get("item_id")
	if !model.IsValidId(itemID) {
		c.SetInvalidParam("item_id")
		return
	}
	teamIDs, appErr := c.App.GetDriveFolderShares(c.AppContext, *c.AppContext.Session(), channel, itemID)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, driveSharesBody{ItemId: itemID, TeamIds: teamIDs})
}

func putDriveFolderShares(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	var body driveSharesBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("body", err)
		return
	}
	if !model.IsValidId(body.ItemId) {
		c.SetInvalidParam("item_id")
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventPatchTeam, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "drive_item_id", body.ItemId)
	model.AddEventParameterToAuditRec(auditRec, "team_ids", body.TeamIds)

	teamIDs, appErr := c.App.SetDriveFolderShares(c.AppContext, *c.AppContext.Session(), channel, body.ItemId, body.TeamIds)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	writeTaskJSON(w, http.StatusOK, driveSharesBody{ItemId: body.ItemId, TeamIds: teamIDs})
}
