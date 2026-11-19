// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package platform

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/i18n"
)

type periodRow struct {
	Kind string
	Open bool
}

func registerOriginConn(t *testing.T, th *TestHelper, s *httptest.Server, origin string) *WebConn {
	t.Helper()
	session, err := th.Service.CreateSession(th.Context, &model.Session{UserId: th.BasicUser.Id})
	require.NoError(t, err)
	c, _, err := (&websocket.Dialer{}).Dial("ws://"+s.Listener.Addr().String()+"/ws", nil)
	require.NoError(t, err)
	wc := th.Service.NewWebConn(&WebConnConfig{
		WebSocket:    c,
		Session:      *session,
		TFunc:        i18n.IdentityTfunc(),
		Locale:       "en",
		OriginClient: origin,
	}, th.Suite, &hookRunner{})
	require.NoError(t, th.Service.HubRegister(wc))
	go wc.Pump()
	return wc
}

func periodRows(t *testing.T, th *TestHelper) []periodRow {
	t.Helper()
	periods, err := th.Service.Store.StatusPeriod().GetRange(th.BasicUser.Id, 0, 1<<62)
	require.NoError(t, err)
	rows := []periodRow{}
	for _, p := range periods {
		rows = append(rows, periodRow{p.Kind, p.EndAt == 0})
	}
	return rows
}

func requirePeriods(t *testing.T, th *TestHelper, want ...periodRow) {
	t.Helper()
	if want == nil {
		want = []periodRow{}
	}
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		periods, err := th.Service.Store.StatusPeriod().GetRange(th.BasicUser.Id, 0, 1<<62)
		require.NoError(c, err)
		rows := []periodRow{}
		for _, p := range periods {
			rows = append(rows, periodRow{p.Kind, p.EndAt == 0})
		}
		assert.Equal(c, want, rows)
	}, 5*time.Second, 20*time.Millisecond)
}

func requireNoPeriodsFor(t *testing.T, th *TestHelper, d time.Duration) {
	t.Helper()
	require.Never(t, func() bool { return len(periodRows(t, th)) > 0 }, d, 20*time.Millisecond)
}

func TestStatusPeriodDesktopOnlyActive(t *testing.T) {
	th := Setup(t).InitBasic(t)
	s := httptest.NewServer(dummyWebsocketHandler(t))
	defer s.Close()
	uid := th.BasicUser.Id

	web := registerOriginConn(t, th, s, "web")
	defer web.Close()
	th.Service.SetStatusOnline(uid, false)
	requireNoPeriodsFor(t, th, 300*time.Millisecond)

	desktop := registerOriginConn(t, th, s, "desktop")
	defer desktop.Close()
	th.Service.SetStatusOnline(uid, false)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, true})
}

func TestStatusPeriodAutoAwayNeedsDesktop(t *testing.T) {
	th := Setup(t).InitBasic(t)
	uid := th.BasicUser.Id

	th.Service.SaveAndBroadcastStatus(&model.Status{UserId: uid, Status: model.StatusOnline, LastActivityAt: 1})
	th.Service.SetStatusAwayIfNeeded(uid, false)
	require.Equal(t, model.StatusAway, th.Service.GetStatusFromCache(uid).Status)
	requireNoPeriodsFor(t, th, 300*time.Millisecond)

	th.Service.SetStatusOnline(uid, true)
	th.Service.SetStatusAwayIfNeeded(uid, true)
	requirePeriods(t, th, periodRow{model.StatusPeriodAway, true})
}

func TestStatusPeriodOfflineKeepsAway(t *testing.T) {
	th := Setup(t).InitBasic(t)
	s := httptest.NewServer(dummyWebsocketHandler(t))
	defer s.Close()
	uid := th.BasicUser.Id

	desktop := registerOriginConn(t, th, s, "desktop")
	defer desktop.Close()
	th.Service.SetStatusOnline(uid, false)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, true})

	th.Service.SetStatusAwayIfNeeded(uid, true)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, false}, periodRow{model.StatusPeriodAway, true})

	th.Service.SetStatusOffline(uid, false, true)
	requireNoChange := func() {
		require.Never(t, func() bool {
			rows := periodRows(t, th)
			return len(rows) != 2 || !rows[1].Open
		}, 300*time.Millisecond, 20*time.Millisecond)
	}
	requireNoChange()

	th.Service.SetStatusOnline(uid, true)
	requirePeriods(t, th,
		periodRow{model.StatusPeriodActive, false},
		periodRow{model.StatusPeriodAway, false},
		periodRow{model.StatusPeriodActive, true},
	)
}

func TestStatusPeriodRepeatedOnlineNoWrites(t *testing.T) {
	th := Setup(t).InitBasic(t)
	s := httptest.NewServer(dummyWebsocketHandler(t))
	defer s.Close()
	uid := th.BasicUser.Id

	desktop := registerOriginConn(t, th, s, "desktop")
	defer desktop.Close()
	for range 5 {
		th.Service.SetStatusOnline(uid, false)
	}
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, true})
	require.Never(t, func() bool { return len(periodRows(t, th)) != 1 }, 300*time.Millisecond, 20*time.Millisecond)
}

func TestStatusPeriodSecondDesktopConnKeepsActive(t *testing.T) {
	th := Setup(t).InitBasic(t)
	s := httptest.NewServer(dummyWebsocketHandler(t))
	defer s.Close()
	uid := th.BasicUser.Id

	d1 := registerOriginConn(t, th, s, "desktop")
	d2 := registerOriginConn(t, th, s, "desktop")
	// A web conn keeps the user online, so only the desktop count decides the period.
	web := registerOriginConn(t, th, s, "web")
	defer web.Close()
	th.Service.SetStatusOnline(uid, false)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, true})

	th.Service.HubUnregister(d1)
	require.Never(t, func() bool {
		rows := periodRows(t, th)
		return len(rows) != 1 || !rows[0].Open
	}, 300*time.Millisecond, 20*time.Millisecond)

	th.Service.HubUnregister(d2)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, false})
}

func TestStatusPeriodDesktopDisconnectKeepsAutoAway(t *testing.T) {
	th := Setup(t).InitBasic(t)
	s := httptest.NewServer(dummyWebsocketHandler(t))
	defer s.Close()
	uid := th.BasicUser.Id

	desktop := registerOriginConn(t, th, s, "desktop")
	defer desktop.Close()
	th.Service.SetStatusOnline(uid, false)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, true})
	th.Service.SaveAndBroadcastStatus(&model.Status{UserId: uid, Status: model.StatusOnline, LastActivityAt: 1})
	th.Service.SetStatusAwayIfNeeded(uid, false)
	require.Equal(t, model.StatusAway, th.Service.GetStatusFromCache(uid).Status)
	requirePeriods(t, th, periodRow{model.StatusPeriodActive, false}, periodRow{model.StatusPeriodAway, true})

	// The laptop sleeps: the desktop conn drops while the status is still an auto-Away.
	th.Service.HubUnregister(desktop)
	require.Never(t, func() bool {
		rows := periodRows(t, th)
		return len(rows) != 2 || !rows[1].Open
	}, 300*time.Millisecond, 20*time.Millisecond)
}
