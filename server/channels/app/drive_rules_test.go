// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"archive/zip"
	"bytes"
	"net/http"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func ruleFolder(r model.DriveRules) *model.DriveItem {
	return &model.DriveItem{Type: model.DriveItemTypeFolder, DriveRules: r}
}

func TestDriveRuleAccess(t *testing.T) {
	view := func(ids ...string) *model.DriveItem { return ruleFolder(model.DriveRules{ViewDepartments: ids}) }
	write := func(ids ...string) *model.DriveItem { return ruleFolder(model.DriveRules{WriteDepartments: ids}) }
	plain := ruleFolder(model.DriveRules{})
	readonly := ruleFolder(model.DriveRules{ReadOnly: true})
	set := func(ids ...string) map[string]bool {
		m := map[string]bool{}
		for _, id := range ids {
			m[id] = true
		}
		return m
	}
	cases := []struct {
		name    string
		path    []*model.DriveItem
		depts   map[string]bool
		visible bool
		write   driveWrite
	}{
		{"empty path", nil, set("anim"), true, driveWriteDefault},
		{"view list excludes", []*model.DriveItem{view("bg")}, set("anim"), false, driveWriteDefault},
		{"view list includes", []*model.DriveItem{view("bg")}, set("bg"), true, driveWriteDefault},
		{"narrows down", []*model.DriveItem{view("bg"), plain}, set("anim"), false, driveWriteDefault},
		{"write list allows", []*model.DriveItem{write("bg"), plain}, set("bg"), true, driveWriteAllowed},
		{"write list denies", []*model.DriveItem{write("bg"), plain}, set("anim"), true, driveWriteDenied},
		{"nearest readonly wins", []*model.DriveItem{write("bg"), readonly}, set("bg"), true, driveWriteDenied},
		{"nearest write wins", []*model.DriveItem{readonly, write("bg")}, set("bg"), true, driveWriteAllowed},
		{"mirror denies", []*model.DriveItem{ruleFolder(model.DriveRules{MirrorOf: model.NewId()})}, set("bg"), true, driveWriteDenied},
		{"below a mirror denies", []*model.DriveItem{ruleFolder(model.DriveRules{MirrorOf: model.NewId(), ViewDepartments: []string{"anim"}}), write("anim")}, set("anim"), true, driveWriteDenied},
		{"any department", []*model.DriveItem{view("anim"), write("bg")}, set("bg", "anim"), true, driveWriteAllowed},
		{"no departments", []*model.DriveItem{view("anim")}, nil, false, driveWriteDefault},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			visible, w := driveRuleAccess(c.path, c.depts)
			assert.Equal(t, c.visible, visible)
			assert.Equal(t, c.write, w)
		})
	}
}

// driveRulesWorld is the BG/ANIM fixture of the episode folder rules tests.
type driveRulesWorld struct {
	BG, Anim         *model.Department
	BGUser, AnimUser *model.User // hold a rank of BG / ANIM
	Admin            *model.User // channel admin, no rank
	Channel          *model.Channel
	Folders          map[string]*model.DriveItem // by name; "Anim/Layout" is the mirror, "BG/Layout" its source
}

// driveRulesFixture builds, in BasicChannel:
//
//	BG (view bg) / Layout / sub, secret (view bg)
//	Anim (view anim) / Layout (mirror of BG/Layout, view anim)
func driveRulesFixture(t *testing.T, th *TestHelper) *driveRulesWorld {
	t.Helper()
	team := th.BasicTeam.Id
	f := &driveRulesWorld{Channel: th.BasicChannel, Folders: map[string]*model.DriveItem{}, BGUser: th.BasicUser, AnimUser: th.BasicUser2}
	f.BG = newDepartment(t, th, team, "BG")
	f.Anim = newDepartment(t, th, team, "ANIM")
	giveRanks(t, th, team, f.BGUser, newRank(t, th, team, f.BG.Id, "Artist"))
	giveRanks(t, th, team, f.AnimUser, newRank(t, th, team, f.Anim.Id, "Animator"))
	th.AddUserToChannel(t, th.BasicUser2, th.BasicChannel)
	f.Admin = th.CreateUser(t)
	th.LinkUserToTeam(t, f.Admin, th.BasicTeam)
	th.AddUserToChannel(t, f.Admin, th.BasicChannel)
	_, appErr := th.App.UpdateChannelMemberSchemeRoles(th.Context, th.BasicChannel.Id, f.Admin.Id, false, true, true)
	require.Nil(t, appErr)

	add := func(key, parent, name string, rules model.DriveRules) {
		pid := ""
		if parent != "" {
			pid = f.Folders[parent].Id
		}
		item, err := th.App.Srv().Store().DriveItem().Save(&model.DriveItem{ChannelId: f.Channel.Id, ParentId: pid, Type: model.DriveItemTypeFolder, Name: name, CreatorId: th.BasicUser.Id, DriveRules: rules})
		require.NoError(t, err)
		f.Folders[key] = item
	}
	add("BG", "", "BG", model.DriveRules{ViewDepartments: []string{f.BG.Id}})
	add("BG/Layout", "BG", "Layout", model.DriveRules{})
	add("BG/Layout/sub", "BG/Layout", "sub", model.DriveRules{})
	add("BG/Layout/secret", "BG/Layout", "secret", model.DriveRules{ViewDepartments: []string{f.BG.Id}})
	add("Anim", "", "Anim", model.DriveRules{ViewDepartments: []string{f.Anim.Id}})
	add("Anim/Layout", "Anim", "Layout", model.DriveRules{ViewDepartments: []string{f.Anim.Id}, MirrorOf: f.Folders["BG/Layout"].Id})
	return f
}

func TestDriveManagerWriteThroughMirror(t *testing.T) {
	mirror := ruleFolder(model.DriveRules{MirrorOf: model.NewId()})
	m := &driveViewer{manager: true}
	for _, path := range [][]*model.DriveItem{{mirror}, {mirror, ruleFolder(model.DriveRules{})}} {
		visible, w := m.access(path)
		assert.True(t, visible)
		assert.Equal(t, driveWriteDenied, w)
	}
	visible, w := m.access([]*model.DriveItem{ruleFolder(model.DriveRules{ReadOnly: true})})
	assert.True(t, visible)
	assert.Equal(t, driveWriteAllowed, w)
}

func TestDriveReadPath(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	viewer := func(u *model.User) *driveViewer {
		v, appErr := th.App.driveViewerFor(th.Context, driveSession(u), f.Channel)
		require.Nil(t, appErr)
		return v
	}
	names := func(path []*model.DriveItem) []string {
		out := []string{}
		for _, i := range path {
			out = append(out, i.Name)
		}
		return out
	}

	t.Run("mirror route to a subfolder", func(t *testing.T) {
		path, mirrored, appErr := th.App.driveReadPath(viewer(f.AnimUser), f.Channel, f.Folders["BG/Layout/sub"].Id)
		require.Nil(t, appErr)
		assert.Equal(t, []string{"Anim", "Layout", "sub"}, names(path))
		assert.True(t, mirrored)
	})
	t.Run("mirror route to the source", func(t *testing.T) {
		path, mirrored, appErr := th.App.driveReadPath(viewer(f.AnimUser), f.Channel, f.Folders["BG/Layout"].Id)
		require.Nil(t, appErr)
		assert.Equal(t, []string{"Anim", "Layout"}, names(path))
		assert.True(t, mirrored)
	})
	t.Run("no route to the source parent", func(t *testing.T) {
		_, _, appErr := th.App.driveReadPath(viewer(f.AnimUser), f.Channel, f.Folders["BG"].Id)
		require.NotNil(t, appErr)
		assert.Equal(t, http.StatusNotFound, appErr.StatusCode)
	})
	t.Run("own path when visible", func(t *testing.T) {
		path, mirrored, appErr := th.App.driveReadPath(viewer(f.BGUser), f.Channel, f.Folders["BG/Layout/sub"].Id)
		require.Nil(t, appErr)
		assert.Equal(t, []string{"BG", "Layout", "sub"}, names(path))
		assert.False(t, mirrored)
	})
	t.Run("manager sees everything", func(t *testing.T) {
		path, mirrored, appErr := th.App.driveReadPath(viewer(f.Admin), f.Channel, f.Folders["BG"].Id)
		require.Nil(t, appErr)
		assert.Equal(t, []string{"BG"}, names(path))
		assert.False(t, mirrored)
	})
	t.Run("member without a rank gets 404", func(t *testing.T) {
		plain := th.CreateUser(t)
		th.LinkUserToTeam(t, plain, th.BasicTeam)
		th.AddUserToChannel(t, plain, th.BasicChannel)
		_, _, appErr := th.App.driveReadPath(viewer(plain), f.Channel, f.Folders["BG/Layout/sub"].Id)
		require.NotNil(t, appErr)
		assert.Equal(t, http.StatusNotFound, appErr.StatusCode)
	})
	t.Run("restricted source subfolder stays hidden", func(t *testing.T) {
		_, _, appErr := th.App.driveReadPath(viewer(f.AnimUser), f.Channel, f.Folders["BG/Layout/secret"].Id)
		require.NotNil(t, appErr)
		assert.Equal(t, http.StatusNotFound, appErr.StatusCode)
	})
	t.Run("root", func(t *testing.T) {
		path, mirrored, appErr := th.App.driveReadPath(viewer(f.AnimUser), f.Channel, "")
		require.Nil(t, appErr)
		assert.Empty(t, path)
		assert.False(t, mirrored)
	})
}

func listAs(t *testing.T, th *TestHelper, u *model.User, ch *model.Channel, parentID string) (*DriveListing, *model.AppError) {
	t.Helper()
	return th.App.ListDriveFolder(th.Context, driveSession(u), ch, parentID)
}

func itemNames(items []*model.DriveItem) []string {
	out := []string{}
	for _, i := range items {
		out = append(out, i.Name)
	}
	return out
}

func TestDriveListRules(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id, "plan.txt")
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout/secret"].Id, "hidden.txt")

	l, appErr := listAs(t, th, f.AnimUser, f.Channel, "")
	require.Nil(t, appErr)
	assert.Equal(t, []string{"Anim"}, itemNames(l.Items))

	l, appErr = listAs(t, th, f.AnimUser, f.Channel, f.Folders["Anim/Layout"].Id)
	require.Nil(t, appErr)
	assert.Equal(t, []string{"sub", "plan.txt"}, itemNames(l.Items)) // secret is hidden
	assert.Equal(t, model.DriveAccessRead, l.Access)
	assert.False(t, l.SourceMissing)

	l, appErr = listAs(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DriveAccessDefault, l.Access)
	assert.Len(t, l.Items, 3)

	_, appErr = listAs(t, th, f.AnimUser, f.Channel, f.Folders["BG"].Id)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)

	// a write rule shows as write for those it allows, read for the rest
	item, err := th.App.Srv().Store().DriveItem().Get(f.Folders["BG/Layout/sub"].Id)
	require.NoError(t, err)
	item.WriteDepartments = []string{f.BG.Id}
	_, err = th.App.Srv().Store().DriveItem().Update(item)
	require.NoError(t, err)
	l, appErr = listAs(t, th, f.BGUser, f.Channel, item.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DriveAccessWrite, l.Access)
	l, appErr = listAs(t, th, f.AnimUser, f.Channel, item.Id)
	require.Nil(t, appErr)
	assert.Equal(t, model.DriveAccessRead, l.Access)
}

func TestDriveListMirrorSourceMissing(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id, "plan.txt")
	require.Nil(t, th.App.DeleteDriveItems(th.Context, driveSession(f.Admin), f.Channel, []string{f.Folders["BG/Layout"].Id}, false))

	l, appErr := listAs(t, th, f.AnimUser, f.Channel, f.Folders["Anim/Layout"].Id)
	require.Nil(t, appErr)
	assert.Empty(t, l.Items)
	assert.True(t, l.SourceMissing)
}

func TestDriveTrashRules(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	file := driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id, "gone.txt")
	require.Nil(t, th.App.DeleteDriveItems(th.Context, driveSession(f.BGUser), f.Channel, []string{file.Id}, false))

	trash, appErr := th.App.GetDriveTrash(th.Context, driveSession(f.AnimUser), f.Channel)
	require.Nil(t, appErr)
	assert.Empty(t, trash)
	trash, appErr = th.App.GetDriveTrash(th.Context, driveSession(f.BGUser), f.Channel)
	require.Nil(t, appErr)
	assert.Equal(t, []string{"gone.txt"}, itemNames(trash))
	trash, appErr = th.App.GetDriveTrash(th.Context, driveSession(f.Admin), f.Channel)
	require.Nil(t, appErr)
	assert.Len(t, trash, 1)
}

func zipNames(t *testing.T, buf *bytes.Buffer) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	require.NoError(t, err)
	out := []string{}
	for _, zf := range zr.File {
		out = append(out, zf.Name)
	}
	slices.Sort(out)
	return out
}

func TestDriveZipRules(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id, "plan.txt")
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout/sub"].Id, "deep.txt")
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout/secret"].Id, "hidden.txt")
	s := driveSession(f.AnimUser)

	var buf bytes.Buffer
	require.Nil(t, th.App.WriteDriveZip(th.Context, s, f.Channel, []string{f.Folders["Anim/Layout"].Id}, &buf))
	assert.Equal(t, []string{"Layout/plan.txt", "Layout/sub/deep.txt"}, zipNames(t, &buf))

	appErr := th.App.WriteDriveZip(th.Context, s, f.Channel, []string{f.Folders["BG"].Id}, &bytes.Buffer{})
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)

	buf.Reset()
	require.Nil(t, th.App.WriteDriveZip(th.Context, driveSession(f.BGUser), f.Channel, []string{f.Folders["BG/Layout"].Id}, &buf))
	assert.Len(t, zipNames(t, &buf), 3)
}

func TestDriveCopyOutOfMirror(t *testing.T) {
	th := setupDrive(t)
	f := driveRulesFixture(t, th)
	plan := driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout"].Id, "plan.txt")
	driveAddFile(t, th, f.BGUser, f.Channel, f.Folders["BG/Layout/sub"].Id, "deep.txt")
	s := driveSession(f.AnimUser)
	animID := f.Folders["Anim"].Id

	require.Nil(t, th.App.CopyDriveItems(th.Context, s, f.Channel, []string{plan.Id}, nil, f.Channel, animID))
	l, appErr := listAs(t, th, f.AnimUser, f.Channel, animID)
	require.Nil(t, appErr)
	var copied *model.DriveItem
	for _, i := range l.Items {
		if i.Name == "plan.txt" {
			copied = i
		}
	}
	require.NotNil(t, copied)
	assert.Equal(t, f.AnimUser.Id, copied.CreatorId)
	assert.False(t, copied.HasRules())

	appErr = th.App.CopyDriveItems(th.Context, s, f.Channel, []string{f.Folders["BG/Layout/secret"].Id}, nil, f.Channel, animID)
	require.NotNil(t, appErr)
	assert.Equal(t, http.StatusNotFound, appErr.StatusCode)

	// copying the mirror yields its source's visible tree; copying a rule folder yields plain folders
	for _, id := range []string{f.Folders["Anim/Layout"].Id, f.Folders["BG/Layout"].Id} {
		src := driveSession(f.AnimUser)
		if id == f.Folders["BG/Layout"].Id {
			src = driveSession(f.Admin)
		}
		require.Nil(t, th.App.CopyDriveItems(th.Context, src, f.Channel, []string{id}, nil, f.Channel, ""))
	}
	all, err := th.App.Srv().Store().DriveItem().GetDescendants(f.Channel.Id, "")
	require.NoError(t, err)
	copies := 0
	for _, it := range all {
		if it.CreatorId == f.AnimUser.Id || it.CreatorId == f.Admin.Id {
			copies++
			assert.False(t, it.HasRules(), it.Name)
		}
	}
	assert.GreaterOrEqual(t, copies, 5)
}
