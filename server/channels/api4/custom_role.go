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

func (api *API) InitDepartments() {
	api.BaseRoutes.Team.Handle("/departments", api.APISessionRequired(getTeamDepartments)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/departments", api.APISessionRequired(createDepartment)).Methods(http.MethodPost)
	api.BaseRoutes.Team.Handle("/departments/order", api.APISessionRequired(reorderDepartments)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle("/departments/{department_id:[A-Za-z0-9]+}", api.APISessionRequired(patchDepartment)).Methods(http.MethodPatch)
	api.BaseRoutes.Team.Handle("/departments/{department_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteDepartment)).Methods(http.MethodDelete)
	api.BaseRoutes.Team.Handle("/departments/{department_id:[A-Za-z0-9]+}/ranks", api.APISessionRequired(createRank)).Methods(http.MethodPost)
	api.BaseRoutes.Team.Handle("/departments/{department_id:[A-Za-z0-9]+}/ranks/order", api.APISessionRequired(reorderRanks)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle("/ranks/{rank_id:[A-Za-z0-9]+}", api.APISessionRequired(patchRank)).Methods(http.MethodPatch)
	api.BaseRoutes.Team.Handle("/ranks/{rank_id:[A-Za-z0-9]+}", api.APISessionRequired(deleteRank)).Methods(http.MethodDelete)
	api.BaseRoutes.TeamMember.Handle("/ranks", api.APISessionRequired(setMemberRanks)).Methods(http.MethodPut)
	api.BaseRoutes.TeamMember.Handle("/assignable_ranks", api.APISessionRequired(getAssignableRanks)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/actionable_user_ids", api.APISessionRequired(getActionableUserIds)).Methods(http.MethodGet)
}

func writeCustomRoleJSON(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		mlog.Warn("Error while writing response", mlog.Err(err))
	}
}

// publishDepartmentsChanged tells the team's clients to reload its departments and ranks.
func publishDepartmentsChanged(c *Context, teamID string) {
	event := model.NewWebSocketEvent(model.WebsocketEventDepartmentsChanged, teamID, "", "", nil, "")
	event.Add("team_id", teamID)
	c.App.Publish(event)
}

// requireTeamManager resolves {team_id} and checks the caller may manage the team's departments.
func requireTeamManager(c *Context) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	requireTeamPermission(c, c.Params.TeamId, model.PermissionManageTeam)
}

// departmentAudit starts a failed audit record for a department or rank change in {team_id}.
func departmentAudit(c *Context, event string) *model.AuditRecord {
	auditRec := c.MakeAuditRecord(event, model.AuditStatusFail)
	model.AddEventParameterToAuditRec(auditRec, "team_id", c.Params.TeamId)
	return auditRec
}

func getTeamDepartments(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	deps, appErr := c.App.GetTeamDepartments(c.AppContext, c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCustomRoleJSON(w, http.StatusOK, deps)
}

func createDepartment(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	var d model.Department
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		c.SetInvalidParamWithErr("department", err)
		return
	}
	auditRec := departmentAudit(c, model.AuditEventCreateDepartment)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "name", d.Name)

	created, appErr := c.App.CreateDepartment(c.AppContext, c.Params.TeamId, d.Name, d.Color)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("department")
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusCreated, created)
}

func patchDepartment(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["department_id"]
	var patch model.DepartmentPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("department", err)
		return
	}
	auditRec := departmentAudit(c, model.AuditEventPatchDepartment)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "department_id", id)

	updated, appErr := c.App.PatchDepartment(c.AppContext, c.Params.TeamId, id, &patch)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("department")
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusOK, updated)
}

func deleteDepartment(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["department_id"]
	auditRec := departmentAudit(c, model.AuditEventDeleteDepartment)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "department_id", id)

	if appErr := c.App.DeleteDepartment(c.AppContext, c.Params.TeamId, id); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishDepartmentsChanged(c, c.Params.TeamId)
	ReturnStatusOK(w)
}

// decodeIDs reads an {"ids": [...]} body.
func decodeIDs(c *Context, r *http.Request) []string {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("ids", err)
	}
	return body.IDs
}

func reorderDepartments(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	ids := decodeIDs(c, r)
	if c.Err != nil {
		return
	}
	auditRec := departmentAudit(c, model.AuditEventReorderDepartments)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "ids", ids)

	deps, appErr := c.App.ReorderDepartments(c.AppContext, c.Params.TeamId, ids)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusOK, deps)
}

func createRank(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	departmentID := mux.Vars(r)["department_id"]
	var rank model.CustomRole
	if err := json.NewDecoder(r.Body).Decode(&rank); err != nil {
		c.SetInvalidParamWithErr("rank", err)
		return
	}
	auditRec := departmentAudit(c, model.AuditEventCreateRank)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "department_id", departmentID)
	model.AddEventParameterAuditableToAuditRec(auditRec, "rank", &rank)

	created, appErr := c.App.CreateRank(c.AppContext, c.Params.TeamId, departmentID, &rank)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(created)
	auditRec.AddEventObjectType("rank")
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusCreated, created)
}

func patchRank(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["rank_id"]
	var patch model.CustomRolePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		c.SetInvalidParamWithErr("rank", err)
		return
	}
	auditRec := departmentAudit(c, model.AuditEventPatchRank)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "rank_id", id)

	updated, appErr := c.App.PatchRank(c.AppContext, c.Params.TeamId, id, &patch)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("rank")
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusOK, updated)
}

func deleteRank(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	id := mux.Vars(r)["rank_id"]
	auditRec := departmentAudit(c, model.AuditEventDeleteRank)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "rank_id", id)

	if appErr := c.App.DeleteRank(c.AppContext, c.Params.TeamId, id); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishDepartmentsChanged(c, c.Params.TeamId)
	ReturnStatusOK(w)
}

func reorderRanks(c *Context, w http.ResponseWriter, r *http.Request) {
	if requireTeamManager(c); c.Err != nil {
		return
	}
	departmentID := mux.Vars(r)["department_id"]
	ids := decodeIDs(c, r)
	if c.Err != nil {
		return
	}
	auditRec := departmentAudit(c, model.AuditEventReorderRanks)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "department_id", departmentID)
	model.AddEventParameterToAuditRec(auditRec, "ids", ids)

	deps, appErr := c.App.ReorderRanks(c.AppContext, c.Params.TeamId, departmentID, ids)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishDepartmentsChanged(c, c.Params.TeamId)
	writeCustomRoleJSON(w, http.StatusOK, deps)
}

func setMemberRanks(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId().RequireUserId(); c.Err != nil {
		return
	}
	if requireTeamPermission(c, c.Params.TeamId, model.PermissionAssignCustomRoles); c.Err != nil {
		return
	}
	var body struct {
		RankIDs []string `json:"rank_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("rank_ids", err)
		return
	}
	auditRec := departmentAudit(c, model.AuditEventSetMemberRanks)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "user_id", c.Params.UserId)
	model.AddEventParameterToAuditRec(auditRec, "rank_ids", body.RankIDs)

	member, appErr := c.App.SetMemberRanks(c.AppContext, c.AppContext.Session().UserId, c.Params.TeamId, c.Params.UserId, body.RankIDs)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	publishDepartmentsChanged(c, c.Params.TeamId) // member counts changed
	writeCustomRoleJSON(w, http.StatusOK, member)
}

func getAssignableRanks(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId().RequireUserId(); c.Err != nil {
		return
	}
	if requireTaskTeamMember(c, c.Params.TeamId); c.Err != nil {
		return
	}
	ids, appErr := c.App.AssignableRanks(c.AppContext, c.AppContext.Session().UserId, c.Params.TeamId, c.Params.UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeCustomRoleJSON(w, http.StatusOK, ids)
}

// actionablePermissions are the permissions a rank's reach is asked about.
var actionablePermissions = map[string]*model.Permission{
	model.PermissionManageTasks.Id:        model.PermissionManageTasks,
	model.PermissionManageRevisions.Id:    model.PermissionManageRevisions,
	model.PermissionManageDailyReports.Id: model.PermissionManageDailyReports,
}

// getActionableUserIds lists the team members the caller may act on with ?permission=, for assignee pickers.
func getActionableUserIds(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	permission, ok := actionablePermissions[r.URL.Query().Get("permission")]
	if !ok {
		c.SetInvalidURLParam("permission")
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
	ids = c.App.ActionableUserIDs(c.AppContext, c.AppContext.Session().UserId, c.Params.TeamId, ids, permission)
	if ids == nil {
		ids = []string{}
	}
	writeCustomRoleJSON(w, http.StatusOK, ids)
}
