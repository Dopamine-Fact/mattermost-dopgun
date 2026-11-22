// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (api *API) InitAppUsage() {
	api.BaseRoutes.APIRoot.Handle("/app_usage", api.APISessionRequired(postAppUsage)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/app_usage", api.APISessionRequired(getAppUsage)).Methods(http.MethodGet)
}

// postAppUsage stores the desktop app's foreground-window intervals for the session user; one bad row rejects the batch.
func postAppUsage(c *Context, w http.ResponseWriter, r *http.Request) {
	var rows []*model.AppUsage
	if err := json.NewDecoder(r.Body).Decode(&rows); err != nil {
		c.SetInvalidParamWithErr("app_usage", err)
		return
	}
	if len(rows) > model.AppUsageMaxBatch {
		c.SetInvalidParam("app_usage")
		return
	}
	now := model.GetMillis()
	userID := c.AppContext.Session().UserId
	for _, row := range rows {
		if row == nil || !row.Prepare(userID, now) {
			c.SetInvalidParam("app_usage")
			return
		}
	}
	if appErr := c.App.SaveAppUsage(rows); appErr != nil {
		c.Err = appErr
		return
	}
	ReturnStatusOK(w)
}

// getAppUsage serves per-app totals to system admins only, for one user or, with no user_id, everyone.
func getAppUsage(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionTo(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}
	q := r.URL.Query()
	from, err := strconv.ParseInt(q.Get("from"), 10, 64)
	if err != nil {
		c.SetInvalidParamWithErr("from", err)
		return
	}
	to, err := strconv.ParseInt(q.Get("to"), 10, 64)
	if err != nil {
		c.SetInvalidParamWithErr("to", err)
		return
	}
	if to <= from || to-from > statusPeriodMaxSpan {
		c.SetInvalidParam("to")
		return
	}
	userID := q.Get("user_id")
	if userID != "" && !model.IsValidId(userID) {
		c.SetInvalidParam("user_id")
		return
	}

	totals, appErr := c.App.GetAppUsageTotals(userID, from, to)
	if appErr != nil {
		c.Err = appErr
		return
	}
	if err := json.NewEncoder(w).Encode(totals); err != nil {
		c.Logger.Warn("Error while writing response", mlog.Err(err))
	}
}
