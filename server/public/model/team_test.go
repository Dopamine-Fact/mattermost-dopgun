// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTeamIsValid(t *testing.T) {
	o := Team{}

	appErr := o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.Id = NewId()
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.CreateAt = GetMillis()
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.UpdateAt = GetMillis()
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.Email = strings.Repeat("01234567890", 20)
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.Email = "corey+test@hulen.com"
	o.DisplayName = strings.Repeat("01234567890", 20)
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.DisplayName = "1234"
	o.Name = "ZZZZZZZ"
	appErr = o.IsValid()
	require.NotNil(t, appErr, "should be invalid")

	o.Name = "zzzzz"
	o.Type = TeamOpen
	o.InviteId = NewId()
	appErr = o.IsValid()
	require.Nil(t, appErr, appErr)
}

func TestTeamPreSave(t *testing.T) {
	o := Team{DisplayName: "test"}
	o.PreSave()
	o.Etag()
}

func TestTeamPreSaveDailyReportDefaults(t *testing.T) {
	o := Team{DisplayName: "test"}
	o.PreSave()
	assert.Equal(t, "18:00", o.DailyReportTime)
	assert.Equal(t, "Europe/Istanbul", o.DailyReportTimezone)

	o = Team{DisplayName: "test", DailyReportTime: "09:30", DailyReportTimezone: "UTC"}
	o.PreSave()
	assert.Equal(t, "09:30", o.DailyReportTime)
	assert.Equal(t, "UTC", o.DailyReportTimezone)
}

func TestTeamPreUpdate(t *testing.T) {
	o := Team{DisplayName: "test"}
	o.PreUpdate()
}

var domains = []struct {
	value    string
	expected bool
}{
	{"spin-punch", true},
	{"-spin-punch", false},
	{"spin-punch-", false},
	{"spin_punch", false},
	{"a", false},
	{"aa", true},
	{"aaa", true},
	{"aaa-999b", true},
	{"b00b", true},
	{"b)", false},
	{"test", true},
}

func TestValidTeamName(t *testing.T) {
	for _, v := range domains {
		actual := IsValidTeamName(v.value)
		assert.Equal(t, v.expected, actual)
	}
}

var tReservedDomains = []struct {
	value    string
	expected bool
}{
	{"admin", true},
	{"Admin-punch", true},
	{"spin-punch-admin", false},
	{"playbooks", true},
	{"boards", true},
}

func TestReservedTeamName(t *testing.T) {
	for _, v := range tReservedDomains {
		actual := IsReservedTeamName(v.value)
		assert.Equal(t, v.expected, actual)
	}
}

func TestCleanTeamName(t *testing.T) {
	actual := CleanTeamName("Jimbo's Admin")
	require.Equal(t, "jimbos-admin", actual, "didn't clean name properly")

	actual = CleanTeamName("Admin Really cool")
	require.Equal(t, "really-cool", actual, "didn't clean name properly")

	actual = CleanTeamName("super-duper-guys")
	require.Equal(t, "super-duper-guys", actual, "didn't clean name properly")
}

func TestTeamPatch(t *testing.T) {
	p := &TeamPatch{
		DisplayName:      new(string),
		Description:      new(string),
		CompanyName:      new(string),
		AllowedDomains:   new(string),
		AllowOpenInvite:  new(bool),
		GroupConstrained: new(bool),
	}

	*p.DisplayName = NewId()
	*p.Description = NewId()
	*p.CompanyName = NewId()
	*p.AllowedDomains = NewId()
	*p.AllowOpenInvite = true
	*p.GroupConstrained = true

	o := Team{Id: NewId()}
	o.Patch(p)

	require.Equal(t, *p.DisplayName, o.DisplayName, "DisplayName did not update")
	require.Equal(t, *p.Description, o.Description, "Description did not update")
	require.Equal(t, *p.CompanyName, o.CompanyName, "CompanyName did not update")
	require.Equal(t, *p.AllowedDomains, o.AllowedDomains, "AllowedDomains did not update")
	require.Equal(t, *p.AllowOpenInvite, o.AllowOpenInvite, "AllowOpenInvite did not update")
	require.Equal(t, *p.GroupConstrained, *o.GroupConstrained)
}

func TestTeamHasPolicyAction(t *testing.T) {
	t.Run("nil team returns false", func(t *testing.T) {
		var team *Team
		require.False(t, team.HasPolicyAction("membership"))
		require.False(t, team.HasMembershipPolicyAction())
	})

	t.Run("nil PolicyActions map returns false", func(t *testing.T) {
		team := &Team{}
		require.False(t, team.HasPolicyAction("membership"))
		require.False(t, team.HasMembershipPolicyAction())
	})

	t.Run("empty PolicyActions map returns false", func(t *testing.T) {
		team := &Team{PolicyActions: map[string]bool{}}
		require.False(t, team.HasPolicyAction("membership"))
		require.False(t, team.HasMembershipPolicyAction())
	})

	t.Run("membership=true returns true", func(t *testing.T) {
		team := &Team{PolicyActions: map[string]bool{"membership": true}}
		require.True(t, team.HasPolicyAction("membership"))
		require.True(t, team.HasMembershipPolicyAction())
	})

	t.Run("membership=false returns false", func(t *testing.T) {
		team := &Team{PolicyActions: map[string]bool{"membership": false}}
		require.False(t, team.HasPolicyAction("membership"))
		require.False(t, team.HasMembershipPolicyAction())
	})
}

func TestTeamSanitizePreservesPolicyEnforced(t *testing.T) {
	t.Run("PolicyEnforced is preserved after Sanitize", func(t *testing.T) {
		team := &Team{
			Id:             NewId(),
			Email:          "test@example.com",
			InviteId:       NewId(),
			PolicyEnforced: true,
		}
		team.Sanitize()
		require.True(t, team.PolicyEnforced, "PolicyEnforced must survive Sanitize")
	})

	t.Run("Email and InviteId are stripped by Sanitize (regression)", func(t *testing.T) {
		team := &Team{
			Id:       NewId(),
			Email:    "test@example.com",
			InviteId: NewId(),
		}
		team.Sanitize()
		require.Empty(t, team.Email, "Email must be cleared by Sanitize")
		require.Empty(t, team.InviteId, "InviteId must be cleared by Sanitize")
	})
}

func TestEpisodeTemplateLines(t *testing.T) {
	require.Equal(t, []string{"a", "b/c"}, EpisodeTemplateLines(" a \n\n b/c \r\n"))
	require.Empty(t, EpisodeTemplateLines(""))
}

func TestTeamEpisodeTemplatesIsValid(t *testing.T) {
	validTeam := func() Team {
		return Team{Id: NewId(), CreateAt: GetMillis(), UpdateAt: GetMillis(), Email: "a@b.com", DisplayName: "T", Name: "zzzzz", Type: TeamOpen, InviteId: NewId()}
	}
	lines := func(n int) string {
		var names []string
		for i := range n {
			names = append(names, fmt.Sprintf("x%d", i)) // folder paths must be unique
		}
		return strings.Join(names, "\n")
	}

	for _, folders := range []string{"Animasyon/Layout\nSes", lines(100), ""} {
		o := validTeam()
		o.EpisodeFolders = folders
		require.Nil(t, o.IsValid(), folders)
	}

	for _, folders := range []string{lines(101), strings.Repeat("a", 4001), "../x", "a//b", "/a", strings.Repeat("é", 256)} {
		o := validTeam()
		o.EpisodeFolders = folders
		appErr := o.IsValid()
		require.NotNil(t, appErr, folders)
		require.Equal(t, "model.team.is_valid.episode_folders.app_error", appErr.Id)
	}

	o := validTeam()
	o.EpisodeTasks = lines(100)
	require.Nil(t, o.IsValid())
	o.EpisodeTasks = "../x\na//b"
	require.Nil(t, o.IsValid(), "task lines are not paths")

	for _, tasks := range []string{lines(101), strings.Repeat("a", 4001)} {
		o := validTeam()
		o.EpisodeTasks = tasks
		appErr := o.IsValid()
		require.NotNil(t, appErr)
		require.Equal(t, "model.team.is_valid.episode_tasks.app_error", appErr.Id)
	}
}

func js(folders []*EpisodeFolder) string {
	b, _ := json.Marshal(folders)
	return string(b)
}

func make101Folders() []*EpisodeFolder {
	var folders []*EpisodeFolder
	for i := range 101 {
		folders = append(folders, &EpisodeFolder{Path: fmt.Sprintf("F%d", i)})
	}
	return folders
}

func TestParseEpisodeFolders(t *testing.T) {
	bg := NewId()
	got, err := ParseEpisodeFolders(" Layout \n\nLayout/Ref\r\n")
	require.NoError(t, err)
	require.Equal(t, []*EpisodeFolder{{Path: "Layout"}, {Path: "Layout/Ref"}}, got)

	got, err = ParseEpisodeFolders(`[{"path":"BG/Layout","view_departments":["` + bg + `"]},{"path":"Anim/Layout","mirror_of":"BG/Layout"}]`)
	require.NoError(t, err)
	require.Equal(t, "BG/Layout", got[1].MirrorOf)

	got, err = ParseEpisodeFolders("")
	require.NoError(t, err)
	require.Empty(t, got)

	_, err = ParseEpisodeFolders("[{")
	require.Error(t, err)
}

func TestIsValidEpisodeFolders(t *testing.T) {
	bg, anim := NewId(), NewId()
	for name, tc := range map[string]struct {
		folders []*EpisodeFolder
		ok      bool
	}{
		"rule-less":             {[]*EpisodeFolder{{Path: "A"}, {Path: "A/B"}}, true},
		"write within view":     {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{bg, anim}, WriteDepartments: []string{bg}}}, true},
		"write outside view":    {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{bg}, WriteDepartments: []string{anim}}}, false},
		"write with everyone":   {[]*EpisodeFolder{{Path: "A", WriteDepartments: []string{anim}}}, true},
		"bad department id":     {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{"x"}}}, false},
		"bad segment":           {[]*EpisodeFolder{{Path: "A/../B"}}, false},
		"duplicate path":        {[]*EpisodeFolder{{Path: "A"}, {Path: "a"}}, false},
		"mirror ok":             {[]*EpisodeFolder{{Path: "BG/L"}, {Path: "AN/L", MirrorOf: "BG/L"}}, true},
		"mirror of itself":      {[]*EpisodeFolder{{Path: "A", MirrorOf: "A"}}, false},
		"mirror of unknown":     {[]*EpisodeFolder{{Path: "A", MirrorOf: "B"}}, false},
		"mirror of mirror":      {[]*EpisodeFolder{{Path: "S"}, {Path: "M1", MirrorOf: "S"}, {Path: "M2", MirrorOf: "M1"}}, false},
		"mirror of ancestor":    {[]*EpisodeFolder{{Path: "A"}, {Path: "A/M", MirrorOf: "A"}}, false},
		"mirror of descendant":  {[]*EpisodeFolder{{Path: "A/S"}, {Path: "A", MirrorOf: "A/S"}}, false},
		"mirror with writers":   {[]*EpisodeFolder{{Path: "S"}, {Path: "M", MirrorOf: "S", WriteDepartments: []string{bg}}}, false},
		"mirror with subfolder": {[]*EpisodeFolder{{Path: "S"}, {Path: "M", MirrorOf: "S"}, {Path: "M/X"}}, false},
	} {
		t.Run(name, func(t *testing.T) { require.Equal(t, tc.ok, isValidEpisodeFolders(js(tc.folders))) })
	}
	require.True(t, isValidEpisodeFolders("Layout\nLayout/Ref"))
	require.False(t, isValidEpisodeFolders(js(make101Folders())))
}
