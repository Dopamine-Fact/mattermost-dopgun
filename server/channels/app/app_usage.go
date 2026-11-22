// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
)

// SaveAppUsage stores already prepared rows; rows whose (UserId, StartAt) is stored are skipped.
func (a *App) SaveAppUsage(rows []*model.AppUsage) *model.AppError {
	if err := a.Srv().Store().AppUsage().SaveMany(rows); err != nil {
		return model.NewAppError("SaveAppUsage", "app.app_usage.save.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// GetAppUsageTotals sums app time per user, app and title inside [from, to), for every user when userID is "".
func (a *App) GetAppUsageTotals(userID string, from, to int64) ([]*model.AppUsageTotal, *model.AppError) {
	totals, err := a.Srv().Store().AppUsage().GetTotals(userID, from, to)
	if err != nil {
		return nil, model.NewAppError("GetAppUsageTotals", "app.app_usage.get.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return totals, nil
}
