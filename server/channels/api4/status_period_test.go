// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestGetStatusPeriods(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ps := th.App.Srv().Store().StatusPeriod()
	day := int64(24 * 60 * 60 * 1000)
	require.NoError(t, ps.Switch(th.BasicUser.Id, model.StatusPeriodAway, 1000))
	require.NoError(t, ps.Switch(th.BasicUser2.Id, model.StatusPeriodActive, 2000))

	get := func(client *model.Client4, query string) (int, []*model.StatusPeriod) {
		r, err := client.DoAPIGet(context.Background(), "/status_periods?"+query, "")
		require.NotNil(t, r)
		defer r.Body.Close()
		if err != nil {
			return r.StatusCode, nil
		}
		var periods []*model.StatusPeriod
		require.NoError(t, json.NewDecoder(r.Body).Decode(&periods))
		return r.StatusCode, periods
	}
	users := func(periods []*model.StatusPeriod) map[string]bool {
		m := map[string]bool{}
		for _, p := range periods {
			m[p.UserId] = true
		}
		return m
	}
	rangeQ := fmt.Sprintf("from=0&to=%d", day)

	t.Run("regular user without user_id gets own rows", func(t *testing.T) {
		status, periods := get(th.Client, rangeQ)
		require.Equal(t, http.StatusOK, status)
		require.Equal(t, map[string]bool{th.BasicUser.Id: true}, users(periods))
		require.Equal(t, model.StatusPeriodAway, periods[0].Kind)
		require.Zero(t, periods[0].EndAt)
	})

	t.Run("regular user asking for another user is forbidden", func(t *testing.T) {
		status, _ := get(th.Client, rangeQ+"&user_id="+th.BasicUser2.Id)
		require.Equal(t, http.StatusForbidden, status)
	})

	t.Run("system admin without user_id gets everyone", func(t *testing.T) {
		status, periods := get(th.SystemAdminClient, rangeQ)
		require.Equal(t, http.StatusOK, status)
		require.True(t, users(periods)[th.BasicUser.Id])
		require.True(t, users(periods)[th.BasicUser2.Id])
	})

	t.Run("system admin can ask for one user", func(t *testing.T) {
		status, periods := get(th.SystemAdminClient, rangeQ+"&user_id="+th.BasicUser2.Id)
		require.Equal(t, http.StatusOK, status)
		require.Equal(t, map[string]bool{th.BasicUser2.Id: true}, users(periods))
	})

	t.Run("span over 31 days is rejected", func(t *testing.T) {
		status, _ := get(th.SystemAdminClient, fmt.Sprintf("from=0&to=%d", 32*day))
		require.Equal(t, http.StatusBadRequest, status)
	})

	t.Run("missing from is rejected", func(t *testing.T) {
		status, _ := get(th.Client, fmt.Sprintf("to=%d", day))
		require.Equal(t, http.StatusBadRequest, status)
	})

	t.Run("to before from is rejected", func(t *testing.T) {
		status, _ := get(th.Client, fmt.Sprintf("from=%d&to=0", day))
		require.Equal(t, http.StatusBadRequest, status)
	})
}
