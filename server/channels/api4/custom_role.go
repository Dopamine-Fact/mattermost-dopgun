// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (api *API) InitCustomRoles() {
	api.BaseRoutes.APIRoot.Handle("/custom_roles", api.APISessionRequired(getCustomRoles)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/custom_roles", api.APISessionRequired(createCustomRole)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/custom_roles/order", api.APISessionRequired(reorderCustomRoles)).Methods(http.MethodPut)
	api.BaseRoutes.APIRoot.Handle("/custom_roles/{custom_role_id:[A-Za-z0-9]+}", api.APISessionRequired(patchCustomRole)).Methods(http.MethodPatch)
	api.BaseRoutes.APIRoot.Handle("/custom_roles/{custom_role_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteCustomRole)).Methods(http.MethodDelete)
	api.BaseRoutes.User.Handle("/custom_roles", api.APISessionRequired(setUserCustomRoles)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle("/custom_roles/actionable_users", api.APISessionRequired(getActionableUsers)).Methods(http.MethodGet)
}

func writeCustomRoleJSON(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		mlog.Warn("Error while writing response", mlog.Err(err))
	}
}

// publishCustomRolesChanged tells every client to reload the role list.
func publishCustomRolesChanged(c *Context) {
	c.App.Publish(model.NewWebSocketEvent(model.WebsocketEventCustomRolesChanged, "", "", "", nil, ""))
}

func requireManageSystem(c *Context) {
	if !c.App.SessionHasPermissionTo(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
	}
}

func getCustomRoles(c *Context, w http.ResponseWriter, r *http.Request) {
	roles, appErr := c.App.GetCustomRoles()
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCustomRoleJSON(w, http.StatusOK, roles)
}

func createCustomRole(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireManageSystem(c); c.Err != nil {
		return
	}
	var role model.CustomRole
	if err := json.NewDecoder(r.Body).Decode(&role); err != nil {
		c.SetInvalidParamWithErr("custom_role", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventCreateCustomRole, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterAuditableToAuditRec(auditRec, "custom_role", &role)

	created, appErr := c.App.CreateCustomRole(c.AppContext, &role)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("custom_role")
	publishCustomRolesChanged(c)
	writeCustomRoleJSON(w, http.StatusCreated, created)
}

func patchCustomRole(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireManageSystem(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["custom_role_id"]
	var patch model.CustomRolePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("custom_role", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventPatchCustomRole, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "custom_role_id", id)

	updated, appErr := c.App.PatchCustomRole(c.AppContext, id, &patch)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("custom_role")
	publishCustomRolesChanged(c)
	writeCustomRoleJSON(w, http.StatusOK, updated)
}

func deleteCustomRole(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireManageSystem(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["custom_role_id"]

	auditRec := c.MakeAuditRecord(model.AuditEventDeleteCustomRole, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "custom_role_id", id)

	if appErr := c.App.DeleteCustomRole(c.AppContext, id); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishCustomRolesChanged(c)
	ReturnStatusOK(w)
}

func reorderCustomRoles(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireManageSystem(c); c.Err != nil {
		return
	}
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("ids", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventReorderCustomRoles, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "ids", body.IDs)

	roles, appErr := c.App.ReorderCustomRoles(c.AppContext, body.IDs)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishCustomRolesChanged(c)
	writeCustomRoleJSON(w, http.StatusOK, roles)
}

func setUserCustomRoles(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireUserId(); c.Err != nil {
		return
	}
	if !c.App.SessionHasPermissionTo(*c.AppContext.Session(), model.PermissionAssignCustomRoles) {
		c.SetPermissionError(model.PermissionAssignCustomRoles)
		return
	}
	var body struct {
		RoleIDs []string `json:"role_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("role_ids", err)
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventSetUserCustomRoles, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "user_id", c.Params.UserId)
	model.AddEventParameterToAuditRec(auditRec, "role_ids", body.RoleIDs)

	user, appErr := c.App.SetUserCustomRoles(c.AppContext, c.AppContext.Session().UserId, c.Params.UserId, body.RoleIDs)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	c.App.SanitizeProfile(user, c.IsSystemAdmin())
	writeCustomRoleJSON(w, http.StatusOK, user)
}

// getActionableUsers lists the team members the caller may assign tasks to and review, for the assignee picker.
func getActionableUsers(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	const page = 200
	var ids []string
	for offset := 0; ; offset += page {
		members, appErr := c.App.GetTeamMembers(c.Params.TeamId, offset, page, nil)
		if appErr != nil {
			c.Err = appErr
			return
		}
		for _, m := range members {
			if m.DeleteAt == 0 {
				ids = append(ids, m.UserId)
			}
		}
		if len(members) < page {
			break
		}
	}
	ids = c.App.ActionableUserIDs(c.AppContext, c.AppContext.Session().UserId, c.Params.TeamId, ids)
	if ids == nil {
		ids = []string{}
	}
	writeCustomRoleJSON(w, http.StatusOK, ids)
}
