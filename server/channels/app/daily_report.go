// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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

// dailyReportEvent is the websocket payload. It goes to the whole team, so it carries no content: clients refetch.
func dailyReportEvent(r *model.DailyReport) map[string]string {
	return map[string]string{"id": r.Id, "team_id": r.TeamId, "user_id": r.UserId, "date": r.Date}
}

func (a *App) publishDailyReport(rctx request.CTX, report *model.DailyReport) {
	a.publishTaskEvent(rctx, model.WebsocketDailyReportUpdated, report.TeamId, "report", dailyReportEvent(report), "")
}

// resubmit rewrites a report the author changed: back to pending and marked edited. PreviousMessage keeps the text the
// reviewer last saw: the reviewed version, or the first submission while nobody has acted yet. The last rejection stays.
func resubmit(r *model.DailyReport, message string, tasks []model.DailyReportTask) {
	if r.Status != model.DailyReportStatusPending || r.PreviousMessage == "" {
		r.PreviousMessage = r.Message
	}
	r.Message = message
	r.Tasks = tasks
	r.Edited = true
	r.Status = model.DailyReportStatusPending
	r.AutoApproved, r.ApprovedBy, r.ApprovedAt = false, "", 0
}

func teamLocation(where string, team *model.Team) (*time.Location, *model.AppError) {
	loc, err := time.LoadLocation(team.DailyReportTimezone)
	if err != nil {
		return nil, model.NewAppError(where, "model.team.is_valid.daily_report_timezone.app_error", nil, "team_id="+team.Id, http.StatusBadRequest).Wrap(err)
	}
	return loc, nil
}

func (a *App) requireDailyReportAssignee(rctx request.CTX, where, teamID, userID string) *model.AppError {
	ok, appErr := a.IsDailyReportAssignee(rctx, teamID, userID)
	if appErr != nil {
		return appErr
	}
	if !ok {
		return model.NewAppError(where, "app.daily_report.not_assignee.app_error", nil, "team_id="+teamID+" user_id="+userID, http.StatusForbidden)
	}
	return nil
}

// SubmitDailyReport creates today's report for the user, or resubmits it (and re-snapshots the tasks) whatever its state.
func (a *App) SubmitDailyReport(rctx request.CTX, teamID, userID, message string) (*model.DailyReport, *model.AppError) {
	team, appErr := a.RequireDailyReportsEnabled(teamID)
	if appErr != nil {
		return nil, appErr
	}
	if appErr = a.requireDailyReportAssignee(rctx, "SubmitDailyReport", teamID, userID); appErr != nil {
		return nil, appErr
	}
	loc, appErr := teamLocation("SubmitDailyReport", team)
	if appErr != nil {
		return nil, appErr
	}
	date := time.Now().In(loc).Format(time.DateOnly)
	tasks, appErr := a.finishedTasksForDay(teamID, userID, loc, date)
	if appErr != nil {
		return nil, appErr
	}

	var saved *model.DailyReport
	existing, err := a.Srv().Store().DailyReport().GetForUserDate(teamID, userID, date)
	var nfErr *store.ErrNotFound
	var conflictErr *store.ErrConflict
	if errors.As(err, &nfErr) {
		saved, err = a.Srv().Store().DailyReport().Save(&model.DailyReport{TeamId: teamID, UserId: userID, Date: date, Message: message, Tasks: tasks})
		if errors.As(err, &conflictErr) { // a concurrent submit created it first: rewrite that one
			existing, err = a.Srv().Store().DailyReport().GetForUserDate(teamID, userID, date)
		}
	}
	if err == nil && saved == nil {
		resubmit(existing, message, tasks)
		saved, err = a.Srv().Store().DailyReport().Update(existing)
	}
	if err != nil {
		return nil, dailyReportStoreError("SubmitDailyReport", teamID, err)
	}
	a.publishDailyReport(rctx, saved)
	return saved, nil
}

// UpdateDailyReport lets the author resubmit any of their own reports, e.g. yesterday's rejected one.
func (a *App) UpdateDailyReport(rctx request.CTX, reportID, userID, message string) (*model.DailyReport, *model.AppError) {
	report, appErr := a.GetDailyReport(reportID)
	if appErr != nil {
		return nil, appErr
	}
	if report.UserId != userID {
		return nil, model.NewAppError("UpdateDailyReport", "app.daily_report.not_author.app_error", nil, "id="+reportID, http.StatusForbidden)
	}
	team, appErr := a.RequireDailyReportsEnabled(report.TeamId)
	if appErr != nil {
		return nil, appErr
	}
	if appErr = a.requireDailyReportAssignee(rctx, "UpdateDailyReport", report.TeamId, userID); appErr != nil {
		return nil, appErr
	}
	loc, appErr := teamLocation("UpdateDailyReport", team)
	if appErr != nil {
		return nil, appErr
	}
	tasks, appErr := a.finishedTasksForDay(report.TeamId, userID, loc, report.Date)
	if appErr != nil {
		return nil, appErr
	}
	resubmit(report, message, tasks)
	saved, err := a.Srv().Store().DailyReport().Update(report)
	if err != nil {
		return nil, dailyReportStoreError("UpdateDailyReport", reportID, err)
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
// seenUpdateAt > 0 is the UpdateAt the reviewer looked at: if the report changed since, nothing happens and it is a 409.
func (a *App) ApproveDailyReport(rctx request.CTX, reportID, approverID string, seenUpdateAt int64) (*model.DailyReport, *model.AppError) {
	report, wrote, appErr := a.reviewDailyReport(rctx, "ApproveDailyReport", reportID, model.DailyReportStatusApproved,
		func(s store.DailyReportStore) error {
			return s.Approve(reportID, approverID, false, model.GetMillis(), seenUpdateAt)
		})
	if appErr != nil || !wrote {
		return report, appErr
	}
	if appErr := a.postDailyReportReviewed(rctx, report, "app.daily_report.approved_dm", report.ApprovedBy, nil); appErr != nil {
		rctx.Logger().Warn("ApproveDailyReport: failed to DM the author", mlog.String("report_id", reportID), mlog.Err(appErr))
	}
	return report, nil
}

// RejectDailyReport sends the report back to its author with a required reason and DMs them. Pending and approved
// (including auto-approved) reports can be rejected; an already rejected report is returned unchanged.
func (a *App) RejectDailyReport(rctx request.CTX, reportID, rejecterID, reason string, seenUpdateAt int64) (*model.DailyReport, *model.AppError) {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > model.DailyReportRejectReasonMaxRunes {
		return nil, model.NewAppError("RejectDailyReport", "app.daily_report.reject_reason.app_error",
			map[string]any{"Max": model.DailyReportRejectReasonMaxRunes}, "id="+reportID, http.StatusBadRequest)
	}
	report, wrote, appErr := a.reviewDailyReport(rctx, "RejectDailyReport", reportID, model.DailyReportStatusRejected,
		func(s store.DailyReportStore) error {
			return s.Reject(reportID, rejecterID, reason, model.GetMillis(), seenUpdateAt)
		})
	if appErr != nil || !wrote {
		return report, appErr
	}
	if appErr := a.postDailyReportReviewed(rctx, report, "app.daily_report.rejected_dm", report.RejectedBy, map[string]any{
		"Reason": strings.ReplaceAll(report.RejectReason, "\n", "\n> "), // the template quotes the first line
	}); appErr != nil {
		rctx.Logger().Warn("RejectDailyReport: failed to DM the author", mlog.String("report_id", reportID), mlog.Err(appErr))
	}
	return report, nil
}

// reviewDailyReport moves the report to status through write. A report already in that status is returned as is;
// any other conflict means it changed under the reviewer, which is a 409. wrote tells whether this call made the change.
func (a *App) reviewDailyReport(rctx request.CTX, where, reportID, status string, write func(store.DailyReportStore) error) (report *model.DailyReport, wrote bool, appErr *model.AppError) {
	report, appErr = a.GetDailyReport(reportID)
	if appErr != nil {
		return nil, false, appErr
	}
	if _, appErr = a.RequireDailyReportsEnabled(report.TeamId); appErr != nil {
		return nil, false, appErr
	}
	if report.Status == status {
		return report, false, nil
	}
	err := write(a.Srv().Store().DailyReport())
	var conflictErr *store.ErrConflict
	if errors.As(err, &conflictErr) {
		current, appErr := a.GetDailyReport(reportID)
		if appErr != nil {
			return nil, false, appErr
		}
		if current.Status == status { // another reviewer got there first; theirs stands
			return current, false, nil
		}
		if status == model.DailyReportStatusApproved && current.Status == model.DailyReportStatusRejected {
			return nil, false, model.NewAppError(where, "app.daily_report.approve_rejected.app_error", nil, "id="+reportID, http.StatusConflict).Wrap(err)
		}
		return nil, false, model.NewAppError(where, "app.daily_report.changed.app_error", nil, "id="+reportID, http.StatusConflict).Wrap(err)
	}
	if err != nil {
		return nil, false, dailyReportStoreError(where, reportID, err)
	}
	updated, appErr := a.GetDailyReport(reportID)
	if appErr != nil {
		return nil, true, appErr
	}
	a.publishDailyReport(rctx, updated)
	return updated, true, nil
}

// postDailyReportReviewed DMs the author the translation id, filled with Date, Reviewer, Link and extra.
func (a *App) postDailyReportReviewed(rctx request.CTX, report *model.DailyReport, id, reviewerID string, extra map[string]any) *model.AppError {
	author, appErr := a.GetUser(rctx, report.UserId)
	if appErr != nil {
		return appErr
	}
	reviewer, appErr := a.GetUser(rctx, reviewerID)
	if appErr != nil {
		return appErr
	}
	team, appErr := a.GetTeam(report.TeamId)
	if appErr != nil {
		return appErr
	}
	args := map[string]any{
		"Date":     report.Date,
		"Reviewer": reviewer.Username,
		"Link":     fmt.Sprintf("%s/%s/daily_reports", a.GetSiteURL(), team.Name),
	}
	maps.Copy(args, extra)
	T := i18n.GetUserTranslations(author.Locale)
	return a.postDailyReportDM(rctx, author, T(id, args))
}

// GetDailyReportAssignees lists who must report for the team; empty means every member. Listed users who have since
// left the team, been deactivated or turned into bots no longer count.
func (a *App) GetDailyReportAssignees(rctx request.CTX, teamID string) ([]string, *model.AppError) {
	ids, err := a.Srv().Store().DailyReport().GetAssignees(teamID)
	if err == nil {
		ids, err = a.activeDailyReportUsers(rctx, teamID, ids)
	}
	if err != nil {
		return nil, dailyReportStoreError("GetDailyReportAssignees", teamID, err)
	}
	return ids, nil
}

func (a *App) IsDailyReportAssignee(rctx request.CTX, teamID, userID string) (bool, *model.AppError) {
	ids, appErr := a.GetDailyReportAssignees(rctx, teamID)
	if appErr != nil {
		return false, appErr
	}
	return len(ids) == 0 || slices.Contains(ids, userID), nil
}

// SetDailyReportAssignees replaces the team's list. Ids that are not active, non-bot team members are dropped.
func (a *App) SetDailyReportAssignees(rctx request.CTX, teamID string, userIDs []string) ([]string, *model.AppError) {
	if _, appErr := a.RequireDailyReportsEnabled(teamID); appErr != nil {
		return nil, appErr
	}
	keep, err := a.activeDailyReportUsers(rctx, teamID, userIDs)
	if err != nil {
		return nil, dailyReportStoreError("SetDailyReportAssignees", teamID, err)
	}
	if err := a.Srv().Store().DailyReport().SetAssignees(teamID, keep); err != nil {
		return nil, dailyReportStoreError("SetDailyReportAssignees", teamID, err)
	}
	a.publishTaskEvent(rctx, model.WebsocketDailyReportUpdated, teamID, "assignees", keep, "")
	return keep, nil
}

// activeDailyReportUsers keeps the ids of active, non-bot team members, sorted and without duplicates.
func (a *App) activeDailyReportUsers(rctx request.CTX, teamID string, userIDs []string) ([]string, error) {
	keep := []string{}
	if len(userIDs) == 0 {
		return keep, nil
	}
	members, err := a.Srv().Store().Team().GetMembersByIds(teamID, userIDs, nil)
	if err != nil {
		return nil, err
	}
	memberIDs := make([]string, 0, len(members))
	for _, m := range members {
		if m.DeleteAt == 0 {
			memberIDs = append(memberIDs, m.UserId)
		}
	}
	users, err := a.Srv().Store().User().GetProfileByIds(rctx, memberIDs, &store.UserGetByIdsOpts{}, false)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if !u.IsBot && u.DeleteAt == 0 && !slices.Contains(keep, u.Id) {
			keep = append(keep, u.Id)
		}
	}
	slices.Sort(keep)
	return keep, nil
}

// ExportDailyReportsCSV writes the reports as CSV. csv.Writer quotes cells, so text cannot break out of its column,
// and csvSafe stops spreadsheets from reading user-written cells as formulas.
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
	_ = cw.Write([]string{"date", "user", "message", "finished_tasks", "status", "rejected_by", "reject_reason", "edited",
		"auto_approved", "approved_by", "approved_at", "submitted_at"})
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
			r.Date, csvSafe(name(r.UserId)), csvSafe(r.Message), csvSafe(strings.Join(titles, "; ")), r.Status,
			csvSafe(name(r.RejectedBy)), csvSafe(r.RejectReason), strconv.FormatBool(r.Edited),
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

// csvSafe prefixes cells a spreadsheet would run as a formula with a single quote.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
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
		err := a.Srv().Store().DailyReport().Approve(report.Id, "", true, now.UnixMilli(), report.UpdateAt)
		var conflictErr *store.ErrConflict
		var nfErr *store.ErrNotFound
		if errors.As(err, &conflictErr) || errors.As(err, &nfErr) {
			rctx.Logger().Debug("RunDailyReportTick: report changed before auto-approval, skipping", mlog.String("report_id", report.Id))
			continue
		}
		if err != nil {
			rctx.Logger().Error("RunDailyReportTick: failed to auto-approve", mlog.String("report_id", report.Id), mlog.Err(err))
			continue
		}
		updated, appErr := a.GetDailyReport(report.Id)
		if appErr != nil {
			rctx.Logger().Error("RunDailyReportTick: failed to reload the approved report", mlog.String("report_id", report.Id), mlog.Err(appErr))
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
	// Measure from the wall-clock minute, so a tick landing a few ms late still counts as its own minute.
	minutes := int(deadline.Sub(local.Truncate(time.Minute)) / time.Minute)
	if minutes != 10 && minutes != 5 {
		return
	}

	users, err := a.Srv().Store().User().GetProfiles(&model.UserGetOptions{InTeamId: team.Id, Active: true, Page: 0, PerPage: 10000})
	if err != nil {
		logger.Error("Daily report reminders: failed to load the team members", mlog.Err(err))
		return
	}
	date := local.Format(time.DateOnly)
	reports, err := a.Srv().Store().DailyReport().GetForTeam(team.Id, date, date, "")
	if err != nil {
		logger.Error("Daily report reminders: failed to load the reports", mlog.Err(err))
		return
	}
	assignees, appErr := a.GetDailyReportAssignees(rctx, team.Id)
	if appErr != nil {
		logger.Error("Daily report reminders: failed to load the assignees", mlog.Err(appErr))
		return
	}
	reported := make(map[string]bool, len(reports))
	for _, r := range reports {
		reported[r.UserId] = true
	}
	for _, user := range users {
		if user.IsBot || reported[user.Id] || (len(assignees) > 0 && !slices.Contains(assignees, user.Id)) {
			continue
		}
		if appErr := a.postDailyReportReminder(rctx, team, user, minutes); appErr != nil {
			logger.Warn("Daily report reminders: failed to send the reminder", mlog.String("user_id", user.Id), mlog.Err(appErr))
		}
	}
}

func (a *App) postDailyReportReminder(rctx request.CTX, team *model.Team, user *model.User, minutes int) *model.AppError {
	T := i18n.GetUserTranslations(user.Locale)
	return a.postDailyReportDM(rctx, user, T("app.daily_report.reminder", map[string]any{
		"Minutes": minutes,
		"Time":    team.DailyReportTime,
		"Link":    fmt.Sprintf("%s/%s/daily_reports", a.GetSiteURL(), team.Name),
	}))
}

// postDailyReportDM sends the user a direct message from the system bot.
func (a *App) postDailyReportDM(rctx request.CTX, user *model.User, message string) *model.AppError {
	bot, appErr := a.GetSystemBot(rctx)
	if appErr != nil {
		return appErr
	}
	channel, appErr := a.GetOrCreateDirectChannel(rctx, user.Id, bot.UserId)
	if appErr != nil {
		return appErr
	}
	_, _, appErr = a.CreatePost(rctx, &model.Post{UserId: bot.UserId, ChannelId: channel.Id, Message: message}, channel, model.CreatePostFlags{})
	return appErr
}
