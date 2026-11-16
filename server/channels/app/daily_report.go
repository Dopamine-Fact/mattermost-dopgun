// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/i18n"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

const dailyReportAutoApproveAfter = 30 * time.Minute

// RequireDailyReportsEnabled returns the team, or 403 unless it is active and has daily reports turned on.
func (a *App) RequireDailyReportsEnabled(teamID string) (*model.Team, *model.AppError) {
	team, appErr := a.GetTeam(teamID)
	if appErr != nil {
		return nil, appErr
	}
	if !team.DailyReportsEnabled || team.DeleteAt != 0 {
		return nil, model.NewAppError("RequireDailyReportsEnabled", "app.daily_report.disabled.app_error", nil, "team_id="+teamID, http.StatusForbidden)
	}
	return team, nil
}

func dailyReportStoreError(where, id string, err error) *model.AppError {
	var nfErr *store.ErrNotFound
	var conflictErr *store.ErrConflict
	var appErr *model.AppError
	switch {
	case errors.As(err, &appErr):
		return appErr
	case errors.As(err, &nfErr):
		return model.NewAppError(where, "app.daily_report.not_found.app_error", nil, "id="+id, http.StatusNotFound).Wrap(err)
	case errors.As(err, &conflictErr):
		return model.NewAppError(where, "app.daily_report.conflict.app_error", nil, "id="+id, http.StatusConflict).Wrap(err)
	default:
		return model.NewAppError(where, "app.daily_report.store.app_error", nil, "id="+id, http.StatusInternalServerError).Wrap(err)
	}
}

// DailyReportDate is the team-local calendar day of now as YYYY-MM-DD.
func DailyReportDate(team *model.Team, now time.Time) (string, error) {
	loc, err := time.LoadLocation(team.DailyReportTimezone)
	if err != nil {
		return "", err
	}
	return now.In(loc).Format(time.DateOnly), nil
}

// finishedTasksForDay snapshots the user's done tasks that were last updated during the given team-local day.
// shortcut: Task has no completed-at column, so UpdateAt stands in for it and a later edit of a done task moves it
// to the edit day; add a CompletedAt column if that matters.
func (a *App) finishedTasksForDay(teamID, userID string, loc *time.Location, date string) ([]model.DailyReportTask, *model.AppError) {
	start, err := time.ParseInLocation(time.DateOnly, date, loc)
	if err != nil {
		return nil, model.NewAppError("finishedTasksForDay", "app.daily_report.invalid_date.app_error", nil, "date="+date, http.StatusBadRequest).Wrap(err)
	}
	from, to := start.UnixMilli(), start.AddDate(0, 0, 1).UnixMilli()

	tasks, err := a.Srv().Store().Task().GetForTeam(teamID)
	if err != nil {
		return nil, dailyReportStoreError("finishedTasksForDay", teamID, err)
	}
	sections, err := a.Srv().Store().Task().GetSectionsForTeam(teamID)
	if err != nil {
		return nil, dailyReportStoreError("finishedTasksForDay", teamID, err)
	}
	sectionNames := make(map[string]string, len(sections))
	for _, s := range sections {
		sectionNames[s.Id] = s.Name
	}

	result := []model.DailyReportTask{}
	for _, t := range tasks {
		if t.AssigneeId == userID && t.Status == model.TaskStatusDone && t.UpdateAt >= from && t.UpdateAt < to {
			result = append(result, model.DailyReportTask{Id: t.Id, Title: t.Title, SectionName: sectionNames[t.SectionId]})
		}
	}
	return result, nil
}

func (a *App) publishDailyReport(rctx request.CTX, report *model.DailyReport) {
	a.publishTaskEvent(rctx, model.WebsocketDailyReportUpdated, report.TeamId, "report", report, "")
}

// SubmitDailyReport creates today's report for the user, or rewrites it (and re-snapshots the tasks) until it is approved.
func (a *App) SubmitDailyReport(rctx request.CTX, teamID, userID, message string) (*model.DailyReport, *model.AppError) {
	team, appErr := a.RequireDailyReportsEnabled(teamID)
	if appErr != nil {
		return nil, appErr
	}
	loc, err := time.LoadLocation(team.DailyReportTimezone)
	if err != nil {
		return nil, model.NewAppError("SubmitDailyReport", "model.team.is_valid.daily_report_timezone.app_error", nil, "team_id="+teamID, http.StatusBadRequest).Wrap(err)
	}
	date := time.Now().In(loc).Format(time.DateOnly)
	tasks, appErr := a.finishedTasksForDay(teamID, userID, loc, date)
	if appErr != nil {
		return nil, appErr
	}

	var saved *model.DailyReport
	existing, err := a.Srv().Store().DailyReport().GetForUserDate(teamID, userID, date)
	var nfErr *store.ErrNotFound
	switch {
	case err == nil:
		if existing.Status == model.DailyReportStatusApproved {
			return nil, model.NewAppError("SubmitDailyReport", "app.daily_report.approved.app_error", nil, "id="+existing.Id, http.StatusBadRequest)
		}
		existing.Message = message
		existing.Tasks = tasks
		saved, err = a.Srv().Store().DailyReport().Update(existing)
	case errors.As(err, &nfErr):
		saved, err = a.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: teamID, UserId: userID, Date: date, Message: message, Tasks: tasks})
	}
	if err != nil {
		return nil, dailyReportStoreError("SubmitDailyReport", teamID, err)
	}
	a.publishDailyReport(rctx, saved)
	return saved, nil
}

func (a *App) GetDailyReport(reportID string) (*model.DailyReport, *model.AppError) {
	report, err := a.Srv().Store().DailyReport().Get(reportID)
	if err != nil {
		return nil, dailyReportStoreError("GetDailyReport", reportID, err)
	}
	return report, nil
}

func (a *App) GetDailyReports(teamID, fromDate, toDate, userID string) ([]*model.DailyReport, *model.AppError) {
	if _, appErr := a.RequireDailyReportsEnabled(teamID); appErr != nil {
		return nil, appErr
	}
	reports, err := a.Srv().Store().DailyReport().GetForTeam(teamID, fromDate, toDate, userID)
	if err != nil {
		return nil, dailyReportStoreError("GetDailyReports", teamID, err)
	}
	return reports, nil
}

// ApproveDailyReport marks the report approved by approverID; an already approved report is returned unchanged.
func (a *App) ApproveDailyReport(rctx request.CTX, reportID, approverID string) (*model.DailyReport, *model.AppError) {
	report, appErr := a.GetDailyReport(reportID)
	if appErr != nil {
		return nil, appErr
	}
	if _, appErr := a.RequireDailyReportsEnabled(report.TeamId); appErr != nil {
		return nil, appErr
	}
	if report.Status == model.DailyReportStatusApproved {
		return report, nil
	}
	report.Status = model.DailyReportStatusApproved
	report.ApprovedBy = approverID
	report.ApprovedAt = model.GetMillis()
	updated, err := a.Srv().Store().DailyReport().Update(report)
	if err != nil {
		return nil, dailyReportStoreError("ApproveDailyReport", reportID, err)
	}
	a.publishDailyReport(rctx, updated)
	return updated, nil
}

// ExportDailyReportsCSV writes the reports as CSV; csv.Writer quotes cells, so message text cannot break out of its column.
func (a *App) ExportDailyReportsCSV(w io.Writer, reports []*model.DailyReport) *model.AppError {
	names := map[string]string{}
	name := func(id string) string {
		if id == "" {
			return ""
		}
		if n, ok := names[id]; ok {
			return n
		}
		n := id
		if u, err := a.Srv().Store().User().Get(request.EmptyContext(a.Log()), id); err == nil {
			n = u.Username
		}
		names[id] = n
		return n
	}

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"date", "user", "message", "finished_tasks", "status", "auto_approved", "approved_by", "approved_at", "submitted_at"})
	for _, r := range reports {
		titles := make([]string, len(r.Tasks))
		for i, t := range r.Tasks {
			titles[i] = t.Title
		}
		approvedAt := ""
		if r.ApprovedAt != 0 {
			approvedAt = time.UnixMilli(r.ApprovedAt).UTC().Format(time.RFC3339)
		}
		_ = cw.Write([]string{
			r.Date, name(r.UserId), r.Message, strings.Join(titles, "; "), r.Status,
			strconv.FormatBool(r.AutoApproved), name(r.ApprovedBy), approvedAt,
			time.UnixMilli(r.CreateAt).UTC().Format(time.RFC3339),
		})
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		return model.NewAppError("ExportDailyReportsCSV", "app.daily_report.export.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// RunDailyReportTick sends the 10 and 5 minute reminders and auto-approves reports left pending for 30 minutes.
// It runs every minute on the leader; each step logs its failures and carries on.
func (a *App) RunDailyReportTick(rctx request.CTX, now time.Time) {
	teams, err := a.Srv().Store().Team().GetAll()
	if err != nil {
		rctx.Logger().Error("RunDailyReportTick: failed to load the teams", mlog.Err(err))
	}
	for _, team := range teams {
		if team.DailyReportsEnabled && team.DeleteAt == 0 {
			a.sendDailyReportReminders(rctx, team, now)
		}
	}

	pending, err := a.Srv().Store().DailyReport().GetPendingBefore(now.Add(-dailyReportAutoApproveAfter).UnixMilli())
	if err != nil {
		rctx.Logger().Error("RunDailyReportTick: failed to load the pending reports", mlog.Err(err))
		return
	}
	for _, report := range pending {
		report.Status = model.DailyReportStatusApproved
		report.AutoApproved = true
		report.ApprovedAt = now.UnixMilli()
		updated, err := a.Srv().Store().DailyReport().Update(report)
		if err != nil {
			rctx.Logger().Error("RunDailyReportTick: failed to auto-approve", mlog.String("report_id", report.Id), mlog.Err(err))
			continue
		}
		a.publishDailyReport(rctx, updated)
	}
}

func (a *App) sendDailyReportReminders(rctx request.CTX, team *model.Team, now time.Time) {
	logger := rctx.Logger().With(mlog.String("team_id", team.Id))
	loc, err := time.LoadLocation(team.DailyReportTimezone)
	hour, minute, ok := model.ParseDailyReportTime(team.DailyReportTime)
	if err != nil || !ok {
		logger.Warn("Daily report reminders skipped: invalid team schedule", mlog.Err(err))
		return
	}
	local := now.In(loc)
	if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
		return
	}
	deadline := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc)
	minutes := int(deadline.Sub(now).Truncate(time.Minute) / time.Minute)
	if minutes != 10 && minutes != 5 {
		return
	}

	users, err := a.Srv().Store().User().GetProfiles(&model.UserGetOptions{InTeamId: team.Id, Active: true, Page: 0, PerPage: 10000})
	if err != nil {
		logger.Error("Daily report reminders: failed to load the team members", mlog.Err(err))
		return
	}
	date := local.Format(time.DateOnly)
	for _, user := range users {
		if user.IsBot {
			continue
		}
		_, err := a.Srv().Store().DailyReport().GetForUserDate(team.Id, user.Id, date)
		var nfErr *store.ErrNotFound
		if err == nil {
			continue
		}
		if !errors.As(err, &nfErr) {
			logger.Warn("Daily report reminders: failed to look up the report", mlog.String("user_id", user.Id), mlog.Err(err))
			continue
		}
		if appErr := a.postDailyReportReminder(rctx, team, user, minutes); appErr != nil {
			logger.Warn("Daily report reminders: failed to send the reminder", mlog.String("user_id", user.Id), mlog.Err(appErr))
		}
	}
}

func (a *App) postDailyReportReminder(rctx request.CTX, team *model.Team, user *model.User, minutes int) *model.AppError {
	bot, appErr := a.GetSystemBot(rctx)
	if appErr != nil {
		return appErr
	}
	channel, appErr := a.GetOrCreateDirectChannel(rctx, user.Id, bot.UserId)
	if appErr != nil {
		return appErr
	}
	T := i18n.GetUserTranslations(user.Locale)
	post := &model.Post{
		UserId:    bot.UserId,
		ChannelId: channel.Id,
		Message: T("app.daily_report.reminder", map[string]any{
			"Minutes": minutes,
			"Time":    team.DailyReportTime,
			"Link":    fmt.Sprintf("%s/%s/daily_reports", a.GetSiteURL(), team.Name),
		}),
	}
	_, _, appErr = a.CreatePost(rctx, post, channel, model.CreatePostFlags{})
	return appErr
}
