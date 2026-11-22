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

func TestAppUsage(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	day := int64(24 * 60 * 60 * 1000)
	now := model.GetMillis()

	post := func(client *model.Client4, rows []map[string]any) int {
		body, err := json.Marshal(rows)
		require.NoError(t, err)
		r, _ := client.DoAPIPost(context.Background(), "/app_usage", string(body))
		require.NotNil(t, r)
		defer r.Body.Close()
		return r.StatusCode
	}
	get := func(client *model.Client4, query string) (int, []*model.AppUsageTotal) {
		r, err := client.DoAPIGet(context.Background(), "/app_usage?"+query, "")
		require.NotNil(t, r)
		defer r.Body.Close()
		if err != nil {
			return r.StatusCode, nil
		}
		var totals []*model.AppUsageTotal
		require.NoError(t, json.NewDecoder(r.Body).Decode(&totals))
		return r.StatusCode, totals
	}
	row := func(app string, start, end int64) map[string]any {
		return map[string]any{"user_id": th.BasicUser2.Id, "app": app, "title": "A", "start_at": start, "end_at": end}
	}
	rangeQ := fmt.Sprintf("from=%d&to=%d", now-day, now+1)

	t.Run("rows are stored under the session user", func(t *testing.T) {
		require.Equal(t, http.StatusOK, post(th.Client, []map[string]any{row("chrome", now-120000, now-60000)}))
		status, totals := get(th.SystemAdminClient, rangeQ+"&user_id="+th.BasicUser.Id)
		require.Equal(t, http.StatusOK, status)
		require.Equal(t, []*model.AppUsageTotal{{UserId: th.BasicUser.Id, App: "chrome", Title: "A", Ms: 60000}}, totals)
		_, totals = get(th.SystemAdminClient, rangeQ+"&user_id="+th.BasicUser2.Id)
		require.Empty(t, totals)
	})

	t.Run("a retried batch is not counted twice", func(t *testing.T) {
		require.Equal(t, http.StatusOK, post(th.Client, []map[string]any{row("chrome", now-120000, now-60000)}))
		_, totals := get(th.SystemAdminClient, rangeQ+"&user_id="+th.BasicUser.Id)
		require.Len(t, totals, 1)
		require.Equal(t, int64(60000), totals[0].Ms)
	})

	t.Run("bad batches are rejected whole", func(t *testing.T) {
		tooMany := make([]map[string]any, model.AppUsageMaxBatch+1)
		for i := range tooMany {
			tooMany[i] = row("many", now-day+int64(i)*10, now-day+int64(i)*10+5)
		}
		require.Equal(t, http.StatusBadRequest, post(th.Client, tooMany))
		require.Equal(t, http.StatusBadRequest, post(th.Client, []map[string]any{row("good", now-50000, now-40000), row("bad", now-30000, now-30000)}))
		require.Equal(t, http.StatusBadRequest, post(th.Client, []map[string]any{row("", now-30000, now-20000)}))
		_, totals := get(th.SystemAdminClient, rangeQ+"&user_id="+th.BasicUser.Id)
		require.Len(t, totals, 1, "nothing from a rejected batch is stored")
	})

	t.Run("regular users cannot read usage, not even their own", func(t *testing.T) {
		status, _ := get(th.Client, rangeQ)
		require.Equal(t, http.StatusForbidden, status)
		status, _ = get(th.Client, rangeQ+"&user_id="+th.BasicUser.Id)
		require.Equal(t, http.StatusForbidden, status)
	})

	t.Run("system admin query validation", func(t *testing.T) {
		status, _ := get(th.SystemAdminClient, fmt.Sprintf("from=0&to=%d", 32*day))
		require.Equal(t, http.StatusBadRequest, status)
		status, _ = get(th.SystemAdminClient, fmt.Sprintf("to=%d", day))
		require.Equal(t, http.StatusBadRequest, status)
		status, _ = get(th.SystemAdminClient, rangeQ+"&user_id=bad")
		require.Equal(t, http.StatusBadRequest, status)
	})
}
