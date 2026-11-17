// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"regexp"
	"strconv"
	"time"
	"unicode/utf8"
)

const (
	DailyReportStatusPending  = "pending"
	DailyReportStatusApproved = "approved"
	DailyReportStatusRejected = "rejected"

	DailyReportMessageMaxRunes      = 16000
	DailyReportRejectReasonMaxRunes = 1000
)

var dailyReportTimeRegexp = regexp.MustCompile(`^(\d{2}):(\d{2})$`)

// ParseDailyReportTime parses a team's "HH:MM" report time.
func ParseDailyReportTime(s string) (hour, minute int, ok bool) {
	m := dailyReportTimeRegexp.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	hour, _ = strconv.Atoi(m[1])
	minute, _ = strconv.Atoi(m[2])
	if hour > 23 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

// DailyReportTask is a snapshot of a task as it was when the report was written.
type DailyReportTask struct {
	Id          string `json:"id"`
	Title       string `json:"title"`
	SectionName string `json:"section_name"`
}

// DailyReport is one user's end-of-day report for a team; Date is the team-local day as YYYY-MM-DD.
type DailyReport struct {
	Id           string            `json:"id"`
	TeamId       string            `json:"team_id"`
	UserId       string            `json:"user_id"`
	Date         string            `json:"date"`
	Message      string            `json:"message"`
	Tasks        []DailyReportTask `json:"tasks"`
	Status       string            `json:"status"`
	AutoApproved bool              `json:"auto_approved"`
	ApprovedBy   string            `json:"approved_by"`
	ApprovedAt   int64             `json:"approved_at"`
	// Edited is set once the author resubmits; PreviousMessage is the text the reviewer last saw.
	Edited          bool   `json:"edited"`
	PreviousMessage string `json:"previous_message"`
	RejectedBy      string `json:"rejected_by"`
	RejectedAt      int64  `json:"rejected_at"`
	RejectReason    string `json:"reject_reason"`
	CreateAt        int64  `json:"create_at"`
	UpdateAt        int64  `json:"update_at"`
}

func (r *DailyReport) Auditable() map[string]any {
	return map[string]any{
		"id":      r.Id,
		"team_id": r.TeamId,
		"user_id": r.UserId,
		"date":    r.Date,
		"status":  r.Status,
	}
}

func (r *DailyReport) PreSave() {
	if r.Id == "" {
		r.Id = NewId()
	}
	r.CreateAt = GetMillis()
	r.UpdateAt = r.CreateAt
	if r.Status == "" {
		r.Status = DailyReportStatusPending
	}
	if r.Tasks == nil {
		r.Tasks = []DailyReportTask{}
	}
}

func (r *DailyReport) PreUpdate() {
	r.UpdateAt = GetMillis()
	if r.Tasks == nil {
		r.Tasks = []DailyReportTask{}
	}
}

func (r *DailyReport) IsValid() *AppError {
	if !IsValidId(r.Id) {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.id.app_error", nil, "", http.StatusBadRequest)
	}
	if !IsValidId(r.TeamId) {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.team_id.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if !IsValidId(r.UserId) {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.user_id.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if _, err := time.Parse(time.DateOnly, r.Date); err != nil {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.date.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if utf8.RuneCountInString(r.Message) > DailyReportMessageMaxRunes || utf8.RuneCountInString(r.PreviousMessage) > DailyReportMessageMaxRunes {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.message.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.Status != DailyReportStatusPending && r.Status != DailyReportStatusApproved && r.Status != DailyReportStatusRejected {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.status.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if utf8.RuneCountInString(r.RejectReason) > DailyReportRejectReasonMaxRunes {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.reject_reason.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	if r.CreateAt == 0 || r.UpdateAt == 0 {
		return NewAppError("DailyReport.IsValid", "model.daily_report.is_valid.create_at.app_error", nil, "id="+r.Id, http.StatusBadRequest)
	}
	return nil
}
