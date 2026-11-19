// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
)

// GetStatusPeriods returns the periods overlapping [from, to), for every user when userID is "".
func (a *App) GetStatusPeriods(userID string, from, to int64) ([]*model.StatusPeriod, *model.AppError) {
	periods, err := a.Srv().Store().StatusPeriod().GetRange(userID, from, to)
	if err != nil {
		return nil, model.NewAppError("GetStatusPeriods", "app.status_period.get.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return periods, nil
}
