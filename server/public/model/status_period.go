// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

const (
	StatusPeriodActive = "active"
	StatusPeriodAway   = "away"
)

// StatusPeriod is a stretch of time a user spent active in the desktop app or on a break. EndAt is 0 while it runs.
type StatusPeriod struct {
	Id      string `json:"id"`
	UserId  string `json:"user_id"`
	Kind    string `json:"kind"`
	StartAt int64  `json:"start_at"`
	EndAt   int64  `json:"end_at"`
}
