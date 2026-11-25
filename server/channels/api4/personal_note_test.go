// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func setupPersonalNotes(t *testing.T) (*TestHelper, context.Context) {
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, th.BasicTeam.Id, &model.TeamPatch{NotesEnabled: new(true)})
	require.NoError(t, err)
	return th, ctx
}

func createNote(t *testing.T, ctx context.Context, client *model.Client4, teamID string, note *model.PersonalNote) *model.PersonalNote {
	t.Helper()
	if note.RemindMinutes == 0 {
		note.RemindMinutes = model.PersonalNoteNoReminder
	}
	created, _, err := client.CreatePersonalNote(ctx, teamID, note)
	require.NoError(t, err)
	return created
}

func loginClient(t *testing.T, ctx context.Context, th *TestHelper, user *model.User) *model.Client4 {
	t.Helper()
	client := th.CreateClient()
	_, _, err := client.Login(ctx, user.Email, user.Password)
	require.NoError(t, err)
	return client
}

func TestPersonalNotesDisabled(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id

	_, resp, err := th.Client.GetPersonalNotes(ctx, teamID, "2026-11-01", "2026-11-30", false, false)
	CheckErrorID(t, err, "app.note.disabled.app_error")
	CheckForbiddenStatus(t, resp)
	_, resp, err = th.Client.CreatePersonalNote(ctx, teamID, &model.PersonalNote{Title: "x", RemindMinutes: -1})
	CheckErrorID(t, err, "app.note.disabled.app_error")
	CheckForbiddenStatus(t, resp)
	noteID := model.NewId()
	_, resp, err = th.Client.GetPersonalNote(ctx, teamID, noteID)
	CheckErrorID(t, err, "app.note.disabled.app_error")
	CheckForbiddenStatus(t, resp)
	_, resp, err = th.Client.PatchPersonalNote(ctx, teamID, noteID, &model.PersonalNotePatch{Title: new("y")})
	CheckErrorID(t, err, "app.note.disabled.app_error")
	CheckForbiddenStatus(t, resp)
	resp, err = th.Client.DeletePersonalNote(ctx, teamID, noteID)
	CheckErrorID(t, err, "app.note.disabled.app_error")
	CheckForbiddenStatus(t, resp)
}

func TestPersonalNotesMembership(t *testing.T) {
	mainHelper.Parallel(t)
	th, ctx := setupPersonalNotes(t)
	teamID := th.BasicTeam.Id

	outsider := loginClient(t, ctx, th, th.CreateUser(t))
	_, resp, err := outsider.GetPersonalNotes(ctx, teamID, "2026-11-01", "2026-11-30", false, false)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)

	// A system admin outside the team cannot read it either.
	team := th.CreateTeam(t)
	_, _, err = th.SystemAdminClient.PatchTeam(ctx, team.Id, &model.TeamPatch{NotesEnabled: new(true)})
	require.NoError(t, err)
	_, resp, err = th.SystemAdminClient.GetPersonalNotes(ctx, team.Id, "2026-11-01", "2026-11-30", false, false)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)

	// A member who left the team is outside it.
	client2 := loginClient(t, ctx, th, th.BasicUser2)
	th.UnlinkUserFromTeam(t, th.BasicUser2, th.BasicTeam)
	_, resp, err = client2.GetPersonalNotes(ctx, teamID, "2026-11-01", "2026-11-30", false, false)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp)
}

func TestPersonalNoteCreate(t *testing.T) {
	mainHelper.Parallel(t)
	th, ctx := setupPersonalNotes(t)
	teamID := th.BasicTeam.Id

	created := createNote(t, ctx, th.Client, teamID, &model.PersonalNote{
		Title: "  Send report  ", UserId: th.BasicUser2.Id, TeamId: model.NewId(),
		Date: "2099-01-01", Time: "10:00", RemindMinutes: 15,
	})
	require.Equal(t, th.BasicUser.Id, created.UserId)
	require.Equal(t, teamID, created.TeamId)
	require.Equal(t, "Send report", created.Title)
	require.Equal(t, model.PersonalNoteVisibilityPrivate, created.Visibility)
	require.Positive(t, created.RemindAt)

	_, resp, err := th.Client.CreatePersonalNote(ctx, teamID, &model.PersonalNote{Title: "   ", RemindMinutes: -1})
	CheckErrorID(t, err, "model.personal_note.is_valid.title.app_error")
	CheckBadRequestStatus(t, resp)
}

func TestPersonalNotePrivacy(t *testing.T) {
	mainHelper.Parallel(t)
	th, ctx := setupPersonalNotes(t)
	teamID := th.BasicTeam.Id
	client2 := loginClient(t, ctx, th, th.BasicUser2)

	private := createNote(t, ctx, th.Client, teamID, &model.PersonalNote{Title: "secret", Date: "2026-11-25"})
	shared := createNote(t, ctx, th.Client, teamID, &model.PersonalNote{Title: "shared", Date: "2026-11-25", Visibility: model.PersonalNoteVisibilityTeam})

	_, resp, err := client2.GetPersonalNote(ctx, teamID, private.Id)
	CheckErrorID(t, err, "app.note.not_found.app_error")
	CheckNotFoundStatus(t, resp)
	_, resp, err = client2.PatchPersonalNote(ctx, teamID, private.Id, &model.PersonalNotePatch{Title: new("mine now")})
	CheckErrorID(t, err, "app.note.not_found.app_error")
	CheckNotFoundStatus(t, resp)
	resp, err = client2.DeletePersonalNote(ctx, teamID, private.Id)
	CheckErrorID(t, err, "app.note.not_found.app_error")
	CheckNotFoundStatus(t, resp)

	// The owner asking through another team they belong to gets 404 too.
	other := th.CreateTeam(t)
	_, _, err = th.SystemAdminClient.PatchTeam(ctx, other.Id, &model.TeamPatch{NotesEnabled: new(true)})
	require.NoError(t, err)
	_, resp, err = th.Client.GetPersonalNote(ctx, other.Id, private.Id)
	CheckErrorID(t, err, "app.note.not_found.app_error")
	CheckNotFoundStatus(t, resp)

	got, _, err := client2.GetPersonalNote(ctx, teamID, shared.Id)
	require.NoError(t, err)
	require.Equal(t, "shared", got.Title)
	_, resp, err = client2.PatchPersonalNote(ctx, teamID, shared.Id, &model.PersonalNotePatch{Title: new("hijack")})
	CheckErrorID(t, err, "app.note.not_owner.app_error")
	CheckForbiddenStatus(t, resp)
	resp, err = client2.DeletePersonalNote(ctx, teamID, shared.Id)
	CheckErrorID(t, err, "app.note.not_owner.app_error")
	CheckForbiddenStatus(t, resp)

	_, err = th.Client.DeletePersonalNote(ctx, teamID, private.Id)
	require.NoError(t, err)
	_, resp, err = th.Client.GetPersonalNote(ctx, teamID, private.Id)
	require.Error(t, err)
	CheckNotFoundStatus(t, resp)
}

func TestPersonalNotesList(t *testing.T) {
	mainHelper.Parallel(t)
	th, ctx := setupPersonalNotes(t)
	teamID := th.BasicTeam.Id
	client2 := loginClient(t, ctx, th, th.BasicUser2)

	createNote(t, ctx, th.Client, teamID, &model.PersonalNote{Title: "mine", Date: "2026-11-25"})
	createNote(t, ctx, th.Client, teamID, &model.PersonalNote{Title: "mine undated"})
	createNote(t, ctx, client2, teamID, &model.PersonalNote{Title: "theirs shared", Date: "2026-11-26", Visibility: model.PersonalNoteVisibilityTeam})
	createNote(t, ctx, client2, teamID, &model.PersonalNote{Title: "theirs private", Date: "2026-11-26"})

	titles := func(notes []*model.PersonalNote) []string {
		out := []string{}
		for _, n := range notes {
			out = append(out, n.Title)
		}
		return out
	}

	notes, _, err := th.Client.GetPersonalNotes(ctx, teamID, "2026-11-01", "2026-11-30", false, false)
	require.NoError(t, err)
	require.Equal(t, []string{"mine", "theirs shared"}, titles(notes))

	notes, _, err = th.Client.GetPersonalNotes(ctx, teamID, "2026-11-01", "2026-11-30", false, true)
	require.NoError(t, err)
	require.Equal(t, []string{"mine"}, titles(notes))

	notes, _, err = th.Client.GetPersonalNotes(ctx, teamID, "", "", true, false)
	require.NoError(t, err)
	require.Equal(t, []string{"mine undated"}, titles(notes))

	for name, rng := range map[string][2]string{
		"63 days":  {"2026-11-01", "2027-01-02"},
		"reversed": {"2026-11-30", "2026-11-01"},
		"missing":  {"", ""},
		"bad date": {"2026-11-01", "tomorrow"},
	} {
		t.Run(name, func(t *testing.T) {
			_, resp, err := th.Client.GetPersonalNotes(ctx, teamID, rng[0], rng[1], false, false)
			CheckErrorID(t, err, "api.note.invalid_range.app_error")
			CheckBadRequestStatus(t, resp)
		})
	}
	notes, _, err = th.Client.GetPersonalNotes(ctx, teamID, "2026-11-01", "2027-01-01", false, false)
	require.NoError(t, err, "a 62-day range is allowed")
	require.Len(t, notes, 2)
}

func TestPersonalNotePatchDone(t *testing.T) {
	mainHelper.Parallel(t)
	th, ctx := setupPersonalNotes(t)
	teamID := th.BasicTeam.Id

	note := createNote(t, ctx, th.Client, teamID, &model.PersonalNote{Title: "todo", Date: "2099-01-01", Time: "10:00", RemindMinutes: 30})
	require.Positive(t, note.RemindAt)

	done, _, err := th.Client.PatchPersonalNote(ctx, teamID, note.Id, &model.PersonalNotePatch{Done: new(true)})
	require.NoError(t, err)
	require.Positive(t, done.DoneAt)
	require.Zero(t, done.RemindAt)

	undone, _, err := th.Client.PatchPersonalNote(ctx, teamID, note.Id, &model.PersonalNotePatch{Done: new(false)})
	require.NoError(t, err)
	require.Zero(t, undone.DoneAt)
	require.Equal(t, note.RemindAt, undone.RemindAt)

	_, resp, err := th.Client.PatchPersonalNote(ctx, teamID, note.Id, &model.PersonalNotePatch{Time: new("25:00")})
	CheckErrorID(t, err, "model.personal_note.is_valid.time.app_error")
	CheckBadRequestStatus(t, resp)
}
