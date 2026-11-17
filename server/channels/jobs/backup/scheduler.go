// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/jobs"
)

func MakeScheduler(jobServer *jobs.JobServer) *jobs.DailyScheduler {
	startTime := func(cfg *model.Config) *time.Time {
		parsedTime, err := time.Parse("15:04", *cfg.BackupSettings.DailyRunTime)
		if err != nil {
			return nil
		}
		return &parsedTime
	}
	isEnabled := func(cfg *model.Config) bool {
		return *cfg.BackupSettings.Enable
	}
	return jobs.NewDailyScheduler(jobServer, model.JobTypeBackup, startTime, isEnabled)
}
