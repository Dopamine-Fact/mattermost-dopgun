// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestCustomRoleAPI(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()

	ids := func(roles []*model.CustomRole) []string {
		out := make([]string, len(roles))
		for i, r := range roles {
			out[i] = r.Id
		}
		return out
	}

	t.Run("system admin CRUD and reorder", func(t *testing.T) {
		a, resp, err := th.SystemAdminClient.CreateCustomRole(ctx, &model.CustomRole{DisplayName: "Producer " + model.NewId()[:6], Color: "#aa0000", Permissions: []string{model.PermissionManageTasks.Id}})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		require.Equal(t, []string{model.PermissionManageTasks.Id}, a.Permissions)
		b, _, err := th.SystemAdminClient.CreateCustomRole(ctx, &model.CustomRole{DisplayName: "Intern " + model.NewId()[:6], Color: "#00aa00"})
		require.NoError(t, err)

		name := "Executive " + model.NewId()[:6]
		patched, _, err := th.SystemAdminClient.PatchCustomRole(ctx, a.Id, &model.CustomRolePatch{DisplayName: &name, Permissions: &[]string{}})
		require.NoError(t, err)
		require.Equal(t, name, patched.DisplayName)
		require.Empty(t, patched.Permissions)

		// Regular members can read the list, for chips and pickers.
		all, _, err := th.Client.GetCustomRoles(ctx)
		require.NoError(t, err)
		order := ids(all)
		ia, ib := slices.Index(order, a.Id), slices.Index(order, b.Id)
		require.True(t, ia >= 0 && ib > ia)
		order[ia], order[ib] = order[ib], order[ia]
		reordered, _, err := th.SystemAdminClient.ReorderCustomRoles(ctx, order)
		require.NoError(t, err)
		require.Equal(t, order, ids(reordered))

		_, err = th.SystemAdminClient.DeleteCustomRole(ctx, b.Id)
		require.NoError(t, err)
		all, _, err = th.Client.GetCustomRoles(ctx)
		require.NoError(t, err)
		require.NotContains(t, ids(all), b.Id)
		_, err = th.SystemAdminClient.DeleteCustomRole(ctx, b.Id)
		require.Error(t, err)
	})

	t.Run("regular user cannot manage roles", func(t *testing.T) {
		_, resp, err := th.Client.CreateCustomRole(ctx, &model.CustomRole{DisplayName: "Nope", Color: "#000000"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		resp, err = th.Client.DeleteCustomRole(ctx, model.NewId())
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.ReorderCustomRoles(ctx, []string{})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	mkRole := func(name, dept string, perms ...string) *model.CustomRole {
		r, appErr := th.App.CreateCustomRole(th.Context, &model.CustomRole{DisplayName: name + " " + model.NewId()[:6], Color: "#123456", Department: dept, Permissions: perms})
		require.Nil(t, appErr)
		return r
	}
	leadAnim := mkRole("LeadAnim", "Anim", model.PermissionAssignCustomRoles.Id)
	leadProg := mkRole("LeadProg", "Prog")
	anim := mkRole("Anim", "Anim")
	prog := mkRole("Prog", "Prog")
	member := func(roles ...*model.CustomRole) *model.User {
		u := th.CreateUser(t)
		th.LinkUserToTeam(t, u, th.BasicTeam)
		_, appErr := th.App.SetUserCustomRoles(th.Context, th.SystemAdminUser.Id, u.Id, ids(roles))
		require.Nil(t, appErr)
		return u
	}
	lead := member(leadAnim)
	leadClient := th.CreateClient()
	_, _, err := leadClient.Login(ctx, lead.Email, lead.Password)
	require.NoError(t, err)

	t.Run("assigning roles follows the hierarchy", func(t *testing.T) {
		newbie := member()
		user, _, err := leadClient.SetUserCustomRoles(ctx, newbie.Id, []string{anim.Id})
		require.NoError(t, err)
		require.Contains(t, user.Roles, anim.RoleName)

		_, resp, err := leadClient.SetUserCustomRoles(ctx, newbie.Id, []string{anim.Id, leadAnim.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		progUser := member(prog)
		_, resp, err = leadClient.SetUserCustomRoles(ctx, progUser.Id, []string{prog.Id, anim.Id})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		// Without assign_custom_roles nobody gets this far.
		_, resp, err = th.Client.SetUserCustomRoles(ctx, newbie.Id, nil)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("actionable users", func(t *testing.T) {
		animUser, progUser, leadProgUser, roleless := member(anim), member(prog), member(leadProg), member()
		got, _, err := leadClient.GetActionableUserIds(ctx, th.BasicTeam.Id)
		require.NoError(t, err)
		for _, id := range []string{lead.Id, animUser.Id, roleless.Id, th.BasicUser2.Id} {
			require.Contains(t, got, id)
		}
		require.NotContains(t, got, progUser.Id)
		require.NotContains(t, got, leadProgUser.Id)

		other := th.CreateTeamWithClient(t, th.SystemAdminClient)
		_, resp, err := leadClient.GetActionableUserIds(ctx, other.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})
}
