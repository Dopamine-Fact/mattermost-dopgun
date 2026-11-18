// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestCreateEpisodeAPI(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id
	_, _, err := th.SystemAdminClient.PatchTeam(ctx, teamID, &model.TeamPatch{TasksEnabled: new(true), RevisionsEnabled: new(true)})
	require.NoError(t, err)

	t.Run("without manage_tasks is 403", func(t *testing.T) {
		_, resp, err := th.Client.CreateEpisode(ctx, teamID, &model.EpisodeCreate{Name: "ep-api-no", DisplayName: "No"})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	giveRankingRole(t, th, th.BasicUser, model.PermissionManageTasks.Id)

	t.Run("with both permissions is 201", func(t *testing.T) {
		got, resp, err := th.Client.CreateEpisode(ctx, teamID, &model.EpisodeCreate{Name: "ep-api-yes", DisplayName: "Yes"})
		require.NoError(t, err)
		CheckCreatedStatus(t, resp)
		require.Equal(t, got.Channel.Id, got.Section.ChannelId)
	})
}
