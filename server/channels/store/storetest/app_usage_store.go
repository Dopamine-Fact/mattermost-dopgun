// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package storetest

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

func TestAppUsageStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveManyIgnoresDuplicates", func(t *testing.T) { testAppUsageSaveManyIgnoresDuplicates(t, ss) })
	t.Run("GetTotalsClampsAndGroups", func(t *testing.T) { testAppUsageGetTotalsClampsAndGroups(t, ss) })
	t.Run("GetTotalsCrossesMidnight", func(t *testing.T) { testAppUsageGetTotalsCrossesMidnight(t, ss) })
	t.Run("GetTotalsFiltersUser", func(t *testing.T) { testAppUsageGetTotalsFiltersUser(t, ss) })
	t.Run("GetTotalsAssumesMaxLength", func(t *testing.T) { testAppUsageGetTotalsAssumesMaxLength(t, ss) })
}

func appUsageRow(userID, app, title string, start, end int64) *model.AppUsage {
	return &model.AppUsage{Id: model.NewId(), UserId: userID, App: app, Title: title, StartAt: start, EndAt: end}
}

// totalsByKey maps "app/title" to ms for one user's totals.
func totalsByKey(t *testing.T, ss store.Store, userID string, from, to int64) map[string]int64 {
	totals, err := ss.AppUsage().GetTotals(userID, from, to)
	require.NoError(t, err)
	out := map[string]int64{}
	for _, r := range totals {
		require.Equal(t, userID, r.UserId)
		out[r.App+"/"+r.Title] = r.Ms
	}
	return out
}

func testAppUsageSaveManyIgnoresDuplicates(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{appUsageRow(u, "chrome", "A", 1000, 2000)}))
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{
		appUsageRow(u, "Photoshop", "dup", 1000, 2000),
		appUsageRow(u, "Slack", "new", 5000, 6000),
	}))
	require.Equal(t, map[string]int64{"chrome/A": 1000, "Slack/new": 1000}, totalsByKey(t, ss, u, 0, 1<<62))
	require.NoError(t, ss.AppUsage().SaveMany(nil))
}

func testAppUsageGetTotalsClampsAndGroups(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{
		appUsageRow(u, "chrome", "A", 0, 60000),
		appUsageRow(u, "chrome", "A", 60000, 120000),
		appUsageRow(u, "chrome", "B", 120000, 150000),
		appUsageRow(u, "Photoshop", "x", 150000, 250000),
	}))
	require.Equal(t, map[string]int64{"chrome/A": 90000, "chrome/B": 30000, "Photoshop/x": 50000}, totalsByKey(t, ss, u, 30000, 200000))
}

func testAppUsageGetTotalsCrossesMidnight(t *testing.T, ss store.Store) {
	u := model.NewId()
	day := int64(24 * 60 * 60 * 1000)
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{appUsageRow(u, "chrome", "A", day-60000, day+60000)}))
	require.Equal(t, map[string]int64{"chrome/A": 60000}, totalsByKey(t, ss, u, day, 2*day))
	require.Equal(t, map[string]int64{"chrome/A": 60000}, totalsByKey(t, ss, u, 0, day))
}

func testAppUsageGetTotalsFiltersUser(t *testing.T, ss store.Store) {
	u1, u2 := model.NewId(), model.NewId()
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{
		appUsageRow(u1, "chrome", "A", 0, 1000),
		appUsageRow(u2, "Slack", "B", 0, 2000),
	}))
	require.Equal(t, map[string]int64{"Slack/B": 2000}, totalsByKey(t, ss, u2, 0, 1<<62))

	all, err := ss.AppUsage().GetTotals("", 0, 1<<62)
	require.NoError(t, err)
	users := map[string]bool{}
	for _, r := range all {
		users[r.UserId] = true
	}
	require.True(t, users[u1] && users[u2], "empty user id returns every user's totals")
}

// GetTotals bounds StartAt from below by the longest valid interval so it can use the StartAt index.
func testAppUsageGetTotalsAssumesMaxLength(t *testing.T, ss store.Store) {
	u := model.NewId()
	day := 10 * model.AppUsageMaxLength
	require.NoError(t, ss.AppUsage().SaveMany([]*model.AppUsage{
		appUsageRow(u, "chrome", "A", day-model.AppUsageMaxLength, day+60000),
		appUsageRow(u, "chrome", "B", day-2*model.AppUsageMaxLength, day+60000),
	}))
	require.Equal(t, map[string]int64{"chrome/A": 60000}, totalsByKey(t, ss, u, day, day+model.AppUsageMaxLength))
}
