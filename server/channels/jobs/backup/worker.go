// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package backup

import (
	"context"
	"errors"
	"maps"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/jobs"
)

const jobName = "Backup"

// workerEnabled ignores BackupSettings.Enable so "Back up now" works while the schedule is off.
func workerEnabled(cfg *model.Config) bool {
	return *cfg.BackupSettings.AmazonS3Bucket != ""
}

func MakeWorker(jobServer *jobs.JobServer) *jobs.SimpleWorker {
	execute := func(logger mlog.LoggerIFace, job *model.Job) error {
		defer jobServer.HandleJobPanic(logger, job)

		cfg := jobServer.Config()
		if *cfg.BackupSettings.AmazonS3Bucket == "" {
			return errors.New("backup S3 bucket is not configured")
		}

		store, err := newBackupStore(&cfg.BackupSettings)
		if err != nil {
			return err
		}

		data, err := runBackup(context.Background(), cfg, store, execPgDump, time.Now())
		if err != nil {
			return err
		}

		if job.Data == nil {
			job.Data = model.StringMap{}
		}
		maps.Copy(job.Data, data)
		if appErr := jobServer.UpdateInProgressJobData(job); appErr != nil {
			logger.Warn("Failed to save backup job data", mlog.Err(appErr))
		}

		logger.Info("Backup written",
			mlog.String("folder", data["folder"]),
			mlog.String("db_bytes", data["db_bytes"]),
			mlog.String("files_bytes", data["files_bytes"]),
			mlog.String("duration_ms", data["duration_ms"]),
		)
		return nil
	}

	return jobs.NewSimpleWorker(jobName, jobServer, execute, workerEnabled)
}
