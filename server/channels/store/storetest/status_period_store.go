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

func TestStatusPeriodStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SwitchOpensAndCloses", func(t *testing.T) { testStatusPeriodSwitchOpensAndCloses(t, ss) })
	t.Run("SwitchSameKindIsNoop", func(t *testing.T) { testStatusPeriodSwitchSameKindIsNoop(t, ss) })
	t.Run("SwitchEmptyClosesOnly", func(t *testing.T) { testStatusPeriodSwitchEmptyClosesOnly(t, ss) })
	t.Run("EndOnlyMatchingKind", func(t *testing.T) { testStatusPeriodEndOnlyMatchingKind(t, ss) })
	t.Run("GetRangeOverlap", func(t *testing.T) { testStatusPeriodGetRangeOverlap(t, ss) })
}

type periodShape struct {
	Kind         string
	StartAt, End int64
}

func userPeriods(t *testing.T, ss store.Store, userID string) []periodShape {
	rows, err := ss.StatusPeriod().GetRange(userID, 0, 1<<62)
	require.NoError(t, err)
	out := make([]periodShape, len(rows))
	for i, r := range rows {
		require.Equal(t, userID, r.UserId)
		out[i] = periodShape{r.Kind, r.StartAt, r.EndAt}
	}
	return out
}

func testStatusPeriodSwitchOpensAndCloses(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodActive, 100))
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodAway, 200))
	require.Equal(t, []periodShape{{model.StatusPeriodActive, 100, 200}, {model.StatusPeriodAway, 200, 0}}, userPeriods(t, ss, u))
}

func testStatusPeriodSwitchSameKindIsNoop(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodActive, 100))
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodActive, 150))
	require.Equal(t, []periodShape{{model.StatusPeriodActive, 100, 0}}, userPeriods(t, ss, u))
}

func testStatusPeriodSwitchEmptyClosesOnly(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodActive, 100))
	require.NoError(t, ss.StatusPeriod().Switch(u, "", 300))
	require.NoError(t, ss.StatusPeriod().Switch(u, "", 400))
	require.Equal(t, []periodShape{{model.StatusPeriodActive, 100, 300}}, userPeriods(t, ss, u))
}

func testStatusPeriodEndOnlyMatchingKind(t *testing.T, ss store.Store) {
	u := model.NewId()
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodAway, 100))
	require.NoError(t, ss.StatusPeriod().End(u, model.StatusPeriodActive, 200))
	require.Equal(t, []periodShape{{model.StatusPeriodAway, 100, 0}}, userPeriods(t, ss, u))
	require.NoError(t, ss.StatusPeriod().End(u, model.StatusPeriodAway, 250))
	require.Equal(t, []periodShape{{model.StatusPeriodAway, 100, 250}}, userPeriods(t, ss, u))
}

func testStatusPeriodGetRangeOverlap(t *testing.T, ss store.Store) {
	u, other := model.NewId(), model.NewId()
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodActive, 50))
	require.NoError(t, ss.StatusPeriod().Switch(u, "", 150))
	require.NoError(t, ss.StatusPeriod().Switch(u, model.StatusPeriodAway, 250))
	require.NoError(t, ss.StatusPeriod().Switch(other, model.StatusPeriodActive, 150))

	rows, err := ss.StatusPeriod().GetRange(u, 100, 200)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, int64(50), rows[0].StartAt)

	rows, err = ss.StatusPeriod().GetRange(u, 200, 300)
	require.NoError(t, err)
	require.Len(t, rows, 1, "open row overlapping the range is returned")
	require.Equal(t, int64(250), rows[0].StartAt)

	rows, err = ss.StatusPeriod().GetRange("", 100, 200)
	require.NoError(t, err)
	users := map[string]bool{}
	for _, r := range rows {
		users[r.UserId] = true
	}
	require.True(t, users[u] && users[other], "empty user id returns every user's rows")
}
