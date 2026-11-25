// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestSetChannelParent(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()

	parent := th.CreatePublicChannel(t)
	child := th.CreatePrivateChannel(t)

	updated, _, err := th.Client.SetChannelParent(ctx, child.Id, parent.Id)
	require.NoError(t, err)
	require.Equal(t, parent.Id, updated.ParentId)

	stored, appErr := th.App.GetChannel(th.Context, child.Id)
	require.Nil(t, appErr)
	require.Equal(t, parent.Id, stored.ParentId)

	t.Run("one level only", func(t *testing.T) {
		other := th.CreatePublicChannel(t)
		// the parent can't become a sub-channel while it has sub-channels
		_, resp, err := th.Client.SetChannelParent(ctx, parent.Id, other.Id)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
		// and nothing can be put under a sub-channel
		_, resp, err = th.Client.SetChannelParent(ctx, other.Id, child.Id)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("same team only", func(t *testing.T) {
		otherTeam := th.CreateTeam(t)
		th.LinkUserToTeam(t, th.BasicUser, otherTeam)
		otherTeamChannel := th.CreateChannelWithClientAndTeam(t, th.Client, model.ChannelTypeOpen, otherTeam.Id)
		_, resp, err := th.Client.SetChannelParent(ctx, otherTeamChannel.Id, parent.Id)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("needs permission on the parent", func(t *testing.T) {
		hidden, _, err := th.SystemAdminClient.CreateChannel(ctx, &model.Channel{TeamId: th.BasicTeam.Id, Name: model.NewId(), DisplayName: "hidden", Type: model.ChannelTypePrivate})
		require.NoError(t, err)
		_, resp, err := th.Client.SetChannelParent(ctx, th.CreatePublicChannel(t).Id, hidden.Id)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	t.Run("detach", func(t *testing.T) {
		updated, _, err := th.Client.SetChannelParent(ctx, child.Id, "")
		require.NoError(t, err)
		require.Empty(t, updated.ParentId)
	})
}
