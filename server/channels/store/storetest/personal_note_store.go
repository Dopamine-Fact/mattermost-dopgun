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

func TestPersonalNoteStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGetUpdateDelete", func(t *testing.T) { testPersonalNoteSaveGetUpdateDelete(t, ss) })
	t.Run("GetForTeam", func(t *testing.T) { testPersonalNoteGetForTeam(t, rctx, ss) })
	t.Run("Reminders", func(t *testing.T) { testPersonalNoteReminders(t, ss) })
	t.Run("TeamNotesEnabled", func(t *testing.T) { testPersonalNoteTeamNotesEnabled(t, ss) })
}

func newPersonalNote(teamID, userID, title, date, tm, visibility string) *model.PersonalNote {
	return &model.PersonalNote{TeamId: teamID, UserId: userID, Title: title, Date: date, Time: tm, Visibility: visibility, RemindMinutes: model.PersonalNoteNoReminder}
}

func savePersonalNote(t *testing.T, ss store.Store, n *model.PersonalNote) *model.PersonalNote {
	t.Helper()
	saved, err := ss.PersonalNote().Save(n)
	require.NoError(t, err)
	return saved
}

func personalNoteTitles(notes []*model.PersonalNote) []string {
	titles := make([]string, 0, len(notes))
	for _, n := range notes {
		titles = append(titles, n.Title)
	}
	return titles
}

func testPersonalNoteSaveGetUpdateDelete(t *testing.T, ss store.Store) {
	n := savePersonalNote(t, ss, newPersonalNote(model.NewId(), model.NewId(), "Send report", "2026-11-25", "10:00", model.PersonalNoteVisibilityPrivate))

	got, err := ss.PersonalNote().Get(n.Id)
	require.NoError(t, err)
	require.Equal(t, n, got)

	got.Title = "Send the report"
	got.DoneAt = 5
	_, err = ss.PersonalNote().Update(got)
	require.NoError(t, err)
	got, err = ss.PersonalNote().Get(n.Id)
	require.NoError(t, err)
	require.Equal(t, "Send the report", got.Title)
	require.Equal(t, int64(5), got.DoneAt)

	require.NoError(t, ss.PersonalNote().Delete(n.Id))
	_, err = ss.PersonalNote().Get(n.Id)
	var nfErr *store.ErrNotFound
	require.ErrorAs(t, err, &nfErr)

	_, err = ss.PersonalNote().Get(model.NewId())
	require.ErrorAs(t, err, &nfErr)
}

func testPersonalNoteGetForTeam(t *testing.T, rctx request.CTX, ss store.Store) {
	teamID := model.NewId()
	member := func(deactivated, left bool) string {
		u, err := ss.User().Save(rctx, &model.User{Email: MakeEmail(), Username: model.NewUsername()})
		require.NoError(t, err)
		if deactivated {
			u.DeleteAt = model.GetMillis()
			_, err = ss.User().Update(rctx, u, true)
			require.NoError(t, err)
		}
		m, err := ss.Team().SaveMember(rctx, &model.TeamMember{TeamId: teamID, UserId: u.Id}, -1)
		require.NoError(t, err)
		if left {
			m.DeleteAt = model.GetMillis()
			_, err = ss.Team().UpdateMember(rctx, m)
			require.NoError(t, err)
		}
		return u.Id
	}
	a, b, c := member(false, false), member(false, false), member(false, false)
	d, e := member(false, true), member(true, false)

	const day = "2026-11-25"
	savePersonalNote(t, ss, newPersonalNote(teamID, a, "A private", day, "", model.PersonalNoteVisibilityPrivate))
	savePersonalNote(t, ss, newPersonalNote(teamID, a, "A team", day, "10:00", model.PersonalNoteVisibilityTeam))
	savePersonalNote(t, ss, newPersonalNote(teamID, a, "A undated", "", "", model.PersonalNoteVisibilityPrivate))
	doneUndated := newPersonalNote(teamID, a, "A undated done", "", "", model.PersonalNoteVisibilityPrivate)
	doneUndated.DoneAt = model.GetMillis()
	savePersonalNote(t, ss, doneUndated)
	savePersonalNote(t, ss, newPersonalNote(teamID, b, "B private", day, "", model.PersonalNoteVisibilityPrivate))
	savePersonalNote(t, ss, newPersonalNote(teamID, b, "B team", day, "", model.PersonalNoteVisibilityTeam))
	savePersonalNote(t, ss, newPersonalNote(teamID, d, "D team", day, "", model.PersonalNoteVisibilityTeam))
	savePersonalNote(t, ss, newPersonalNote(teamID, e, "E team", day, "", model.PersonalNoteVisibilityTeam))
	savePersonalNote(t, ss, newPersonalNote(model.NewId(), a, "other team", day, "", model.PersonalNoteVisibilityTeam))
	savePersonalNote(t, ss, newPersonalNote(teamID, a, "out of range", "2026-12-01", "", model.PersonalNoteVisibilityTeam))

	november := store.PersonalNoteListOptions{FromDate: "2026-11-01", ToDate: "2026-11-30"}

	notes, err := ss.PersonalNote().GetForTeam(teamID, a, november)
	require.NoError(t, err)
	titles := personalNoteTitles(notes)
	require.ElementsMatch(t, []string{"A private", "A team", "B team"}, titles)
	require.Equal(t, "A team", titles[2], "all-day notes come before timed ones")

	notes, err = ss.PersonalNote().GetForTeam(teamID, c, november)
	require.NoError(t, err)
	require.Equal(t, []string{"B team", "A team"}, personalNoteTitles(notes))

	onlyMine := november
	onlyMine.OnlyMine = true
	notes, err = ss.PersonalNote().GetForTeam(teamID, a, onlyMine)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"A private", "A team"}, personalNoteTitles(notes))

	notes, err = ss.PersonalNote().GetForTeam(teamID, a, store.PersonalNoteListOptions{Undated: true})
	require.NoError(t, err)
	require.Equal(t, []string{"A undated", "A undated done"}, personalNoteTitles(notes))

	limited := november
	limited.Limit = 1
	notes, err = ss.PersonalNote().GetForTeam(teamID, a, limited)
	require.NoError(t, err)
	require.Len(t, notes, 1)
}

func testPersonalNoteReminders(t *testing.T, ss store.Store) {
	now := model.GetMillis()
	teamID, userID := model.NewId(), model.NewId()
	due := newPersonalNote(teamID, userID, "due", "2026-11-25", "10:00", model.PersonalNoteVisibilityPrivate)
	due.RemindMinutes, due.RemindAt = 0, now-1000
	due = savePersonalNote(t, ss, due)
	future := newPersonalNote(teamID, userID, "future", "2026-11-25", "10:00", model.PersonalNoteVisibilityPrivate)
	future.RemindMinutes, future.RemindAt = 0, now+60*60*1000
	future = savePersonalNote(t, ss, future)
	savePersonalNote(t, ss, newPersonalNote(teamID, userID, "none", "2026-11-25", "10:00", model.PersonalNoteVisibilityPrivate))

	dueIDs := func() []string {
		notes, err := ss.PersonalNote().GetDueReminders(now, 200)
		require.NoError(t, err)
		ids := []string{}
		for _, n := range notes {
			require.True(t, n.RemindAt > 0 && n.RemindAt <= now)
			ids = append(ids, n.Id)
		}
		return ids
	}
	ids := dueIDs()
	require.Contains(t, ids, due.Id)
	require.NotContains(t, ids, future.Id)

	require.NoError(t, ss.PersonalNote().ClearReminder(due.Id))
	got, err := ss.PersonalNote().Get(due.Id)
	require.NoError(t, err)
	require.Zero(t, got.RemindAt)
	require.NotContains(t, dueIDs(), due.Id)
}

func testPersonalNoteTeamNotesEnabled(t *testing.T, ss store.Store) {
	team, err := ss.Team().Save(&model.Team{DisplayName: "Notes", Name: NewTestID(), Email: MakeEmail(), Type: model.TeamOpen, NotesEnabled: true})
	require.NoError(t, err)
	got, err := ss.Team().Get(team.Id)
	require.NoError(t, err)
	require.True(t, got.NotesEnabled)

	got.NotesEnabled = false
	_, err = ss.Team().Update(got)
	require.NoError(t, err)
	got, err = ss.Team().Get(team.Id)
	require.NoError(t, err)
	require.False(t, got.NotesEnabled)
}
