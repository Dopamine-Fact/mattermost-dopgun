// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	PersonalNoteVisibilityPrivate = "private"
	PersonalNoteVisibilityTeam    = "team"

	PersonalNoteTitleMaxRunes   = 200
	PersonalNoteMessageMaxRunes = 4000

	PersonalNoteNoReminder       = -1
	PersonalNoteRemindMaxMinutes = 10080
	// PersonalNoteAllDayHour is the local hour an all-day note's reminder counts back from.
	PersonalNoteAllDayHour = 9
)

// PersonalNote is a team member's note. Date and Time are wall-clock values shown the same to every viewer.
type PersonalNote struct {
	Id            string `json:"id"`
	TeamId        string `json:"team_id"`
	UserId        string `json:"user_id"`
	Title         string `json:"title"`
	Message       string `json:"message"`
	Visibility    string `json:"visibility"`
	Date          string `json:"date"` // YYYY-MM-DD, "" = undated
	Time          string `json:"time"` // HH:MM, "" = all day
	RemindMinutes int    `json:"remind_minutes"`
	RemindAt      int64  `json:"remind_at"`
	DoneAt        int64  `json:"done_at"`
	CreateAt      int64  `json:"create_at"`
	UpdateAt      int64  `json:"update_at"`
}

type PersonalNotePatch struct {
	Title         *string `json:"title"`
	Message       *string `json:"message"`
	Visibility    *string `json:"visibility"`
	Date          *string `json:"date"`
	Time          *string `json:"time"`
	RemindMinutes *int    `json:"remind_minutes"`
	Done          *bool   `json:"done"`
}

func (n *PersonalNote) Auditable() map[string]any {
	return map[string]any{
		"id":         n.Id,
		"team_id":    n.TeamId,
		"user_id":    n.UserId,
		"visibility": n.Visibility,
		"date":       n.Date,
	}
}

func (n *PersonalNote) PreSave() {
	if n.Id == "" {
		n.Id = NewId()
	}
	if n.Visibility == "" {
		n.Visibility = PersonalNoteVisibilityPrivate
	}
	n.Title = strings.TrimSpace(n.Title)
	n.CreateAt = GetMillis()
	n.UpdateAt = n.CreateAt
}

func (n *PersonalNote) PreUpdate() {
	n.Title = strings.TrimSpace(n.Title)
	n.UpdateAt = GetMillis()
}

func (n *PersonalNote) Patch(p *PersonalNotePatch) {
	if p.Title != nil {
		n.Title = *p.Title
	}
	if p.Message != nil {
		n.Message = *p.Message
	}
	if p.Visibility != nil {
		n.Visibility = *p.Visibility
	}
	if p.Date != nil {
		n.Date = *p.Date
	}
	if p.Time != nil {
		n.Time = *p.Time
	}
	if p.RemindMinutes != nil {
		n.RemindMinutes = *p.RemindMinutes
	}
	if p.Done != nil {
		if !*p.Done {
			n.DoneAt = 0
		} else if n.DoneAt == 0 {
			n.DoneAt = GetMillis()
		}
	}
}

func validPersonalNoteDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return len(s) == 10 && err == nil
}

func validPersonalNoteTime(s string) bool {
	_, err := time.Parse("15:04", s)
	return len(s) == 5 && err == nil
}

func (n *PersonalNote) IsValid() *AppError {
	invalid := func(field string) *AppError {
		return NewAppError("PersonalNote.IsValid", "model.personal_note.is_valid."+field+".app_error", nil, "id="+n.Id, http.StatusBadRequest)
	}
	if !IsValidId(n.Id) {
		return invalid("id")
	}
	if !IsValidId(n.TeamId) {
		return invalid("team_id")
	}
	if !IsValidId(n.UserId) {
		return invalid("user_id")
	}
	if titleLen := utf8.RuneCountInString(n.Title); titleLen > PersonalNoteTitleMaxRunes || strings.TrimSpace(n.Title) == "" {
		return invalid("title")
	}
	if utf8.RuneCountInString(n.Message) > PersonalNoteMessageMaxRunes {
		return invalid("message")
	}
	if n.Visibility != PersonalNoteVisibilityPrivate && n.Visibility != PersonalNoteVisibilityTeam {
		return invalid("visibility")
	}
	if n.Date != "" && !validPersonalNoteDate(n.Date) {
		return invalid("date")
	}
	if n.Time != "" && (n.Date == "" || !validPersonalNoteTime(n.Time)) {
		return invalid("time")
	}
	if n.RemindMinutes != PersonalNoteNoReminder && (n.Date == "" || n.RemindMinutes < 0 || n.RemindMinutes > PersonalNoteRemindMaxMinutes) {
		return invalid("remind_minutes")
	}
	return nil
}

// ComputeRemindAt sets RemindAt from Date/Time in loc (all-day notes count from 09:00); 0 when there is nothing to send.
func (n *PersonalNote) ComputeRemindAt(loc *time.Location, now int64) {
	n.RemindAt = 0
	if n.Date == "" || n.RemindMinutes == PersonalNoteNoReminder || n.DoneAt != 0 {
		return
	}
	start, err := time.ParseInLocation("2006-01-02", n.Date, loc)
	if err != nil {
		return
	}
	if n.Time == "" {
		start = time.Date(start.Year(), start.Month(), start.Day(), PersonalNoteAllDayHour, 0, 0, 0, loc)
	} else if clock, err := time.Parse("15:04", n.Time); err == nil {
		start = time.Date(start.Year(), start.Month(), start.Day(), clock.Hour(), clock.Minute(), 0, 0, loc)
	} else {
		return
	}
	if at := start.Add(-time.Duration(n.RemindMinutes) * time.Minute).UnixMilli(); at > now {
		n.RemindAt = at
	}
}
