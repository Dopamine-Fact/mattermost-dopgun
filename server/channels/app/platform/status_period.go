// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package platform

import (
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

// originClientDesktop mirrors web.OriginClientDesktop, which this package cannot import.
const originClientDesktop = "desktop"

// goUpdateStatusPeriod re-evaluates the user's period off the caller's goroutine (status writers and the hub).
func (ps *PlatformService) goUpdateStatusPeriod(userID string) {
	ps.Go(func() { ps.updateStatusPeriod(userID) })
}

// updateStatusPeriod brings the user's StatusPeriods in line with their current status. It reads the current status
// rather than a caller's snapshot, so goroutines that run out of order still settle on the latest one.
func (ps *PlatformService) updateStatusPeriod(userID string) {
	if !*ps.Config().ServiceSettings.EnableUserStatuses {
		return
	}
	ps.statusPeriodMut.Lock()
	defer ps.statusPeriodMut.Unlock()

	status, appErr := ps.GetStatus(userID)
	if appErr != nil {
		return // no status yet
	}
	desktop := false
	if hub := ps.GetHubForUserId(userID); hub != nil {
		desktop = hub.DesktopConnCountForUser(userID) > 0
	}
	cached, known := ps.statusPeriodKinds.Load(userID)
	now := model.GetMillis()

	kind := ""
	switch status.Status {
	case model.StatusOnline, model.StatusDnd:
		if desktop {
			kind = model.StatusPeriodActive
		}
	case model.StatusAway:
		// Only the desktop app sees system-wide idle, so an auto-Away without it neither starts a break nor
		// ends one (the app may just have dropped as the machine slept). A manual Away counts from any client.
		if !status.Manual && !desktop {
			return
		}
		kind = model.StatusPeriodAway
	case model.StatusOffline:
		// A break keeps running while the machine sleeps; only an active period ends.
		if known && (cached == model.StatusPeriodAway || cached == "") {
			return
		}
		if err := ps.Store.StatusPeriod().End(userID, model.StatusPeriodActive, now); err != nil {
			ps.Log().Warn("Failed to end status period", mlog.String("user_id", userID), mlog.Err(err))
			return
		}
		ps.statusPeriodKinds.Store(userID, "")
		return
	}

	if known && cached == kind {
		return
	}
	if err := ps.Store.StatusPeriod().Switch(userID, kind, now); err != nil {
		ps.Log().Warn("Failed to switch status period", mlog.String("user_id", userID), mlog.Err(err))
		return
	}
	ps.statusPeriodKinds.Store(userID, kind)
}
