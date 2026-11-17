// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"
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
	api.BaseRoutes.APIRoot.Handle("/daily_reports/{report_id:[A-Za-z0-9]+}/approve", api.APISessionRequired(approveDailyReport)).Methods(http.MethodPost)
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

// dailyReportFilter resolves from/to (default today) and the user filter; users who cannot manage tasks only see their own.
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
	if !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), team.Id, model.PermissionManageTeamTasks) {
		userID = c.AppContext.Session().UserId
	}
	return from, to, userID, true
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
	reports, appErr := c.App.GetDailyReports(team.Id, from, to, userID)
	if appErr != nil {
		c.Err = appErr
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

func approveDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
		return
	}
	if requireManageTasks(c, report.TeamId); c.Err != nil {
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventApproveDailyReport, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	auditRec.AddEventPriorState(report)

	approved, appErr := c.App.ApproveDailyReport(c.AppContext, report.Id, c.AppContext.Session().UserId, 0)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(approved)
	auditRec.AddEventObjectType("daily_report")
	writeTaskJSON(w, http.StatusOK, approved)
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
	reports, appErr := c.App.GetDailyReports(team.Id, from, to, userID)
	if appErr != nil {
		c.Err = appErr
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="daily-reports-`+from+`_`+to+`.csv"`)
	w.WriteHeader(http.StatusOK)
	if appErr := c.App.ExportDailyReportsCSV(w, reports); appErr != nil {
		c.Logger.Error("failed to write daily reports CSV", mlog.Err(appErr))
	}
}
