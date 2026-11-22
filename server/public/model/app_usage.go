// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

const (
	AppUsageMaxBatch = 200

	appUsageMaxAppRunes   = 128
	appUsageMaxTitleRunes = 512
	appUsageMaxLength     = int64(24 * 60 * 60 * 1000)
	appUsageMaxAhead      = int64(5 * 60 * 1000)
)

// AppUsage is a stretch of time the desktop app saw one window focused while its user was active.
type AppUsage struct {
	Id      string `json:"id"`
	UserId  string `json:"user_id"`
	App     string `json:"app"`
	Title   string `json:"title"`
	StartAt int64  `json:"start_at"`
	EndAt   int64  `json:"end_at"`
}

// AppUsageTotal is the time one user spent in one app window within a range.
type AppUsageTotal struct {
	UserId string `json:"user_id"`
	App    string `json:"app"`
	Title  string `json:"title"`
	Ms     int64  `json:"ms"`
}

// Prepare stamps the row for userID, truncates App and Title, and reports whether it is acceptable at now (ms).
func (u *AppUsage) Prepare(userID string, now int64) bool {
	u.Id = NewId()
	u.UserId = userID
	u.App = truncateRunes(u.App, appUsageMaxAppRunes)
	u.Title = truncateRunes(u.Title, appUsageMaxTitleRunes)
	return u.App != "" && u.StartAt < u.EndAt && u.EndAt-u.StartAt <= appUsageMaxLength && u.EndAt <= now+appUsageMaxAhead
}

func truncateRunes(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
