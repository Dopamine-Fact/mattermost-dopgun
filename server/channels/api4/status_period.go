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

const statusPeriodMaxSpan = int64(31 * 24 * 60 * 60 * 1000)

func (api *API) InitStatusPeriods() {
	api.BaseRoutes.APIRoot.Handle("/status_periods", api.APISessionRequired(getStatusPeriods)).Methods(http.MethodGet)
}

// getStatusPeriods serves the caller's own periods; system admins may ask for one user or, with no user_id, everyone.
func getStatusPeriods(c *Context, w http.ResponseWriter, r *http.Request) {
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
	isAdmin := c.App.SessionHasPermissionTo(*c.AppContext.Session(), model.PermissionManageSystem)
	switch {
	case userID == "" && !isAdmin:
		userID = c.AppContext.Session().UserId
	case userID != "" && userID != c.AppContext.Session().UserId && !isAdmin:
		c.SetPermissionError(model.PermissionManageSystem)
		return
	case userID != "" && !model.IsValidId(userID):
		c.SetInvalidParam("user_id")
		return
	}

	periods, appErr := c.App.GetStatusPeriods(userID, from, to)
	if appErr != nil {
		c.Err = appErr
		return
	}
	if err := json.NewEncoder(w).Encode(periods); err != nil {
		c.Logger.Warn("Error while writing response", mlog.Err(err))
	}
}
