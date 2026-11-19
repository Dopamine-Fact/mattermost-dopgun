// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/app"
	"github.com/mattermost/mattermost/server/v8/platform/shared/web"
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

	api.BaseRoutes.Team.Handle("/daily_reports/mine/files", api.APISessionRequired(addMyDailyReportFile, handlerParamFileAPI)).Methods(http.MethodPost)
	api.BaseRoutes.Team.Handle("/daily_reports/excuse", api.APISessionRequired(excuseDailyReport)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/daily_reports/{report_id:[A-Za-z0-9]+}/files", api.APISessionRequired(addDailyReportFile, handlerParamFileAPI)).Methods(http.MethodPost)
	file := "/daily_reports/{report_id:[A-Za-z0-9]+}/files/{file_id:[A-Za-z0-9]+}"
	api.BaseRoutes.APIRoot.Handle(file, api.APISessionRequired(removeDailyReportFile)).Methods(http.MethodDelete)
	// Served like post files: gzip rather than brotli, and HEAD for media players.
	api.BaseRoutes.APIRoot.Handle(file, api.APISessionRequiredTrustRequesterGzip(serveDailyReportFile(""))).Methods(http.MethodGet, http.MethodHead)
	api.BaseRoutes.APIRoot.Handle(file+"/thumbnail", api.APISessionRequiredTrustRequesterGzip(serveDailyReportFile("thumbnail"))).Methods(http.MethodGet, http.MethodHead)
	api.BaseRoutes.APIRoot.Handle(file+"/preview", api.APISessionRequiredTrustRequesterGzip(serveDailyReportFile("preview"))).Methods(http.MethodGet, http.MethodHead)
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
	if userID != "" && !c.App.CanActOnUser(c.AppContext, sessionUserID, userID, team.Id, model.PermissionManageDailyReports) {
		c.SetPermissionError(model.PermissionManageDailyReports)
		return
	}
	return from, to, userID, true
}

// getVisibleDailyReports lists reports for the filter; an unfiltered list keeps only the caller's own reports and
// those of people the caller outranks. Other people's drafts are dropped, and their excused days lose the files
// nobody but the author was meant to see.
func getVisibleDailyReports(c *Context, teamID, from, to, userID string) []*model.DailyReport {
	reports, appErr := c.App.GetDailyReports(teamID, from, to, userID)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	sessionUserID := c.AppContext.Session().UserId
	reports = slices.DeleteFunc(reports, func(r *model.DailyReport) bool {
		return r.UserId != sessionUserID && r.Status == model.DailyReportStatusDraft
	})
	for _, r := range reports {
		if r.UserId != sessionUserID && r.Status == model.DailyReportStatusExcused {
			r.Files = []*model.FileInfo{}
		}
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
	allowed := c.App.ActionableUserIDs(c.AppContext, sessionUserID, teamID, authors, model.PermissionManageDailyReports)
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
	// A blank message is the app's call: a report with files may have none.
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == nil {
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
	if requireDailyReportReviewer(c, report.TeamId, report.UserId); c.Err != nil {
		return nil, body
	}
	return report, body
}

// requireDailyReportReviewer checks the caller may review userID's reports in the team.
func requireDailyReportReviewer(c *Context, teamID, userID string) {
	if requireDailyReportTeam(c, teamID); c.Err != nil {
		return
	}
	if requireTeamPermission(c, teamID, model.PermissionManageDailyReports); c.Err != nil {
		return
	}
	// Reviewing your own report needs an admin; CanActOnUser lets everyone act on themself.
	if userID == c.AppContext.Session().UserId && !c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), teamID, model.PermissionManageTeam) {
		c.SetPermissionError(model.PermissionManageTeam)
		return
	}
	if !c.App.CanActOnUser(c.AppContext, c.AppContext.Session().UserId, userID, teamID, model.PermissionManageDailyReports) {
		c.SetPermissionError(model.PermissionManageDailyReports)
	}
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
	// A blank message is the app's call: a report with files may have none.
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == nil {
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

// canViewDailyReport: the author always; a reviewer who may act on the author once the report is sent.
func canViewDailyReport(c *Context, report *model.DailyReport) bool {
	sessionUserID := c.AppContext.Session().UserId
	if report.UserId == sessionUserID {
		return true
	}
	return report.IsSent() &&
		c.App.SessionHasPermissionToTeam(*c.AppContext.Session(), report.TeamId, model.PermissionManageDailyReports) &&
		c.App.CanActOnUser(c.AppContext, sessionUserID, report.UserId, report.TeamId, model.PermissionManageDailyReports)
}

// serveDailyReportFile streams a report attachment, or its stored thumbnail or preview when variant names one.
func serveDailyReportFile(variant string) func(*Context, http.ResponseWriter, *http.Request) {
	return func(c *Context, w http.ResponseWriter, r *http.Request) {
		report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
		if appErr != nil {
			c.Err = appErr
			return
		}
		if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
			return
		}
		notFound := model.NewAppError("serveDailyReportFile", "app.daily_report.not_found.app_error", nil, "id="+report.Id, http.StatusNotFound)
		if !canViewDailyReport(c, report) {
			if !report.IsSent() {
				c.Err = notFound // someone else's draft does not exist as far as the caller can tell
				return
			}
			c.SetPermissionError(model.PermissionManageDailyReports)
			return
		}
		info, appErr := c.App.GetDailyReportFile(c.AppContext, report.Id, mux.Vars(r)["file_id"])
		if appErr != nil {
			c.Err = appErr
			return
		}
		path, contentType, size := info.Path, model.DailyReportFileContentType(info.Name), info.Size
		switch variant {
		case "thumbnail":
			path, contentType, size = info.ThumbnailPath, ThumbnailImageType, 0
		case "preview":
			path, contentType, size = info.PreviewPath, PreviewImageType, 0
		}
		if path == "" {
			c.Err = notFound
			return
		}
		fileReader, appErr := c.App.FileReader(path)
		if appErr != nil {
			c.Err = appErr
			return
		}
		defer fileReader.Close()
		forceDownload, _ := strconv.ParseBool(r.URL.Query().Get("download"))
		web.WriteFileResponse(info.Name, contentType, size, time.UnixMilli(info.UpdateAt), *c.App.Config().ServiceSettings.WebserverMode, fileReader, forceDownload, w, r)
	}
}

func addMyDailyReportFile(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	if requireDailyReportTeam(c, c.Params.TeamId); c.Err != nil {
		return
	}
	name, data := readUploadedFile(c, r, "file")
	if c.Err != nil {
		return
	}
	info, appErr := c.App.AddMyDailyReportFile(c.AppContext, c.Params.TeamId, c.AppContext.Session().UserId, name, data)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, info)
}

func addDailyReportFile(c *Context, w http.ResponseWriter, r *http.Request) {
	report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
		return
	}
	name, data := readUploadedFile(c, r, "file")
	if c.Err != nil {
		return
	}
	info, appErr := c.App.AddDailyReportFile(c.AppContext, report.Id, c.AppContext.Session().UserId, name, data)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, info)
}

func removeDailyReportFile(c *Context, w http.ResponseWriter, r *http.Request) {
	report, appErr := c.App.GetDailyReport(mux.Vars(r)["report_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	if requireDailyReportTeam(c, report.TeamId); c.Err != nil {
		return
	}
	if appErr := c.App.RemoveDailyReportFile(c.AppContext, report.Id, mux.Vars(r)["file_id"], c.AppContext.Session().UserId); appErr != nil {
		c.Err = appErr
		return
	}
	ReturnStatusOK(w)
}

func excuseDailyReport(c *Context, w http.ResponseWriter, r *http.Request) {
	if c.RequireTeamId(); c.Err != nil {
		return
	}
	var body struct {
		UserID string `json:"user_id"`
		Date   string `json:"date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !model.IsValidId(body.UserID) {
		c.SetInvalidParam("user_id")
		return
	}
	if requireDailyReportReviewer(c, c.Params.TeamId, body.UserID); c.Err != nil {
		return
	}
	if member, appErr := c.App.GetTeamMember(c.AppContext, c.Params.TeamId, body.UserID); appErr != nil || member.DeleteAt != 0 {
		c.SetInvalidParam("user_id") // only someone on the team has days to excuse
		return
	}

	auditRec := c.MakeAuditRecord(model.AuditEventExcuseDailyReport, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "team_id", c.Params.TeamId)
	model.AddEventParameterToAuditRec(auditRec, "user_id", body.UserID)
	model.AddEventParameterToAuditRec(auditRec, "date", body.Date)

	report, appErr := c.App.ExcuseDailyReport(c.AppContext, c.Params.TeamId, body.UserID, body.Date, c.AppContext.Session().UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(report)
	auditRec.AddEventObjectType("daily_report")
	writeTaskJSON(w, http.StatusOK, report)
}
