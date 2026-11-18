// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

const dailyReportMaxRangeDays = 366

func (api *API) InitDailyReports() {
	api.BaseRoutes.Team.Handle("/daily_reports", api.APISessionRequired(getDailyReports)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/daily_reports/mine", api.APISessionRequired(submitDailyReport)).Methods(http.MethodPut)
	api.BaseRoutes.Team.Handle("/daily_reports/export", api.APISessionRequired(exportDailyReports)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/daily_reports/assignees", api.APISessionRequired(getDailyReportAssignees)).Methods(http.MethodGet)
	api.BaseRoutes.Team.Handle("/daily_reports/assignees", api.APISessionRequired(setDailyReportAssignees)).Methods(http.MethodPut)
	api.BaseRoutes.APIRoot.Handle("/daily_reports/{report_id:[A-Za-z0-9]+}", api.APISessionRequired(updateDailyReport)).Methods(http.MethodPut)
	api.BaseRoutes.APIRoot.Handle("/daily_reports/{report_id:[A-Za-z0-9]+}/approve", api.APISessionRequired(approveDailyReport)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/daily_reports/{report_id:[A-Za-z0-9]+}/reject", api.APISessionRequired(rejectDailyReport)).Methods(http.MethodPost)
}

// requireDailyReportTeam checks the caller is a team member and the team has daily reports on.
func requireDailyReportTeam(c *Context, teamID string) *model.Team {
	if requireTaskTeamMember(c, teamID); c.Err != nil {
		return nil
	}
	team, appErr := c.App.RequireDailyReportsEnabled(teamID)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	return team
}

// dailyReportFilter resolves from/to (default today) and the user filter; users who cannot manage daily reports only see their own.
func dailyReportFilter(c *Context, r *http.Request, team *model.Team) (from, to, userID string, ok bool) {
	q := r.URL.Query()
	from, to, userID = q.Get("from"), q.Get("to"), q.Get("user_id")
	if from == "" {
		from = to
	}
	if from == "" {
		today, err := app.DailyReportDate(team, time.Now())
		if err != nil {
			c.Err = model.NewAppError("dailyReportFilter", "model.team.is_valid.daily_report_timezone.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
			return
		}
		from = today
	}
	if to == "" {
		to = from
	}
	start, err1 := time.Parse(time.DateOnly, from)
	end, err2 := time.Parse(time.DateOnly, to)
	switch {
	case err1 != nil:
		c.SetInvalidParamWithErr("from", err1)
		return
	case err2 != nil:
		c.SetInvalidParamWithErr("to", err2)
		return
	case end.Before(start) || end.Sub(start) > dailyReportMaxRangeDays*24*time.Hour:
		c.SetInvalidParam("to")
		return
	}
	sessionUserID := c.AppContext.Session().UserId
	if !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), team.Id, model.PermissionManageDailyReports) {
		userID = sessionUserID
	}
	if userID != "" && !c.App.CanActOnUser(c.AppContext, sessionUserID, userID, team.Id) {
		c.SetPermissionError(model.PermissionManageDailyReports)
		return
	}
	return from, to, userID, true
}

// getVisibleDailyReports lists reports for the filter; an unfiltered list keeps only the caller's own reports and
// those of people the caller outranks.
func getVisibleDailyReports(c *Context, teamID, from, to, userID string) []*model.DailyReport {
	reports, appErr := c.App.GetDailyReports(teamID, from, to, userID)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if userID != "" {
		return reports
	}
	var authors []string
	for _, r := range reports {
		if !slices.Contains(authors, r.UserId) {
			authors = append(authors, r.UserId)
		}
	}
	allowed := c.App.ActionableUserIDs(c.AppContext, c.AppContext.Session().UserId, teamID, authors)
	return slices.DeleteFunc(reports, func(r *model.DailyReport) bool { return !slices.Contains(allowed, r.UserId) })
}

func getDailyReports(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	team := requireDailyReportTeam(c, c.Params.TeamId)
	if c.Err != nil {
		return
	}
	from, to, userID, ok := dailyReportFilter(c, r, team)
	if !ok {
		return
	}
	reports := getVisibleDailyReports(c, team.Id, from, to, userID)
	if c.Err != nil {
		return
	}
	writeTaskJSON(w, http.StatusOK, reports)
}

func submitDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireDailyReportTeam(c, c.Params.TeamId); c.Err != nil {
		return
	}
	var body struct {
		Message *string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == nil || strings.TrimSpace(*body.Message) == "" {
		c.SetInvalidParam("message")
		return
	}
	report, appErr := c.App.SubmitDailyReport(c.AppContext, c.Params.TeamId, c.AppContext.Session().UserId, *body.Message)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, report)
}

// reviewBody is the approve/reject body; update_at is the version the reviewer saw (0 = no check).
type reviewBody struct {
	Reason   string `json:"reason"`
	UpdateAt int64  `json:"update_at"`
}

// loadReviewableReport reads the report and the optional body, and checks the caller may review it.
func loadReviewableReport(c *Context, r *http.Request) (*model.DailyReport, reviewBody) {
	var body reviewBody
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
			c.SetInvalidParamWithErr("body", err)
			return nil, body
		}
	}
	report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
	if appErr != nil {
		c.Err = appErr
		return nil, body
	}
	if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
		return nil, body
	}
	if requireTeamPermission(c, report.TeamId, model.PermissionManageDailyReports); c.Err != nil {
		return nil, body
	}
	if !c.App.CanActOnUser(c.AppContext, c.AppContext.Session().UserId, report.UserId, report.TeamId) {
		c.SetPermissionError(model.PermissionManageDailyReports)
		return nil, body
	}
	return report, body
}

func approveDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	report, body := loadReviewableReport(c, r)
	if c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventApproveDailyReport, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(report)

	approved, appErr := c.App.ApproveDailyReport(c.AppContext, report.Id, c.AppContext.Session().UserId, body.UpdateAt)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(approved)
	auditRec.AddEventObjectType("daily_report")
	writeTaskJSON(w, http.StatusOK, approved)
}

func rejectDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	report, body := loadReviewableReport(c, r)
	if c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventRejectDailyReport, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(report)

	rejected, appErr := c.App.RejectDailyReport(c.AppContext, report.Id, c.AppContext.Session().UserId, body.Reason, body.UpdateAt)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(rejected)
	auditRec.AddEventObjectType("daily_report")
	writeTaskJSON(w, http.StatusOK, rejected)
}

func updateDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message *string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == nil || strings.TrimSpace(*body.Message) == "" {
		c.SetInvalidParam("message")
		return
	}
	report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventUpdateDailyReport, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(report)

	updated, appErr := c.App.UpdateDailyReport(c.AppContext, report.Id, c.AppContext.Session().UserId, *body.Message)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(updated)
	auditRec.AddEventObjectType("daily_report")
	writeTaskJSON(w, http.StatusOK, updated)
}

type dailyReportAssigneesBody struct {
	UserIDs []string `json:"user_ids"`
}

func getDailyReportAssignees(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireDailyReportTeam(c, c.Params.TeamId); c.Err != nil {
		return
	}
	ids, appErr := c.App.GetDailyReportAssignees(c.AppContext, c.Params.TeamId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	if ids == nil {
		ids = []string{} // JSON [] rather than null
	}
	writeTaskJSON(w, http.StatusOK, dailyReportAssigneesBody{UserIDs: ids})
}

func setDailyReportAssignees(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireDailyReportTeam(c, c.Params.TeamId); c.Err != nil {
		return
	}
	if requireTeamPermission(c, c.Params.TeamId, model.PermissionManageDailyReports); c.Err != nil {
		return
	}
	var body dailyReportAssigneesBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.UserIDs == nil {
		c.SetInvalidParam("user_ids")
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventSetDailyReportAssignees, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "team_id", c.Params.TeamId)

	ids, appErr := c.App.SetDailyReportAssignees(c.AppContext, c.Params.TeamId, body.UserIDs)
	if appErr != nil {
		c.Err = appErr
		return
	}
	// The ids actually stored, not the raw request: unknown and non-member ids are dropped.
	model.AddEventParameterToAuditRec(auditRec, "user_ids", ids)
	auditRec.Success()
	writeTaskJSON(w, http.StatusOK, dailyReportAssigneesBody{UserIDs: ids})
}

func exportDailyReports(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	team := requireDailyReportTeam(c, c.Params.TeamId)
	if c.Err != nil {
		return
	}
	from, to, userID, ok := dailyReportFilter(c, r, team)
	if !ok {
		return
	}
	reports := getVisibleDailyReports(c, team.Id, from, to, userID)
	if c.Err != nil {
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="daily-reports-`+from+`_`+to+`.csv"`)
	w.WriteHeader(http.StatusOK)
	if appErr := c.App.ExportDailyReportsCSV(w, reports); appErr != nil {
		c.Logger.Error("failed to write daily reports CSV", mlog.Err(appErr))
	}
}
