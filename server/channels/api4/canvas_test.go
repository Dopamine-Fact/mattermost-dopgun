// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func setCanvasEnabled(t *testing.T, th *TestHelper, teamID string, enabled bool) {
	t.Helper()
	_, _, err := th.SystemAdminClient.PatchTeam(context.Background(), teamID, &model.TeamPatch{CanvasEnabled: &enabled})
	require.NoError(t, err)
}

func waitCanvasEvent(t *testing.T, wsc *model.WebSocketClient, eventType model.WebsocketEventType) *model.WebSocketEvent {
	t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case ev := <-wsc.EventChannel:
			if ev.EventType() == eventType {
				return ev
			}
		case <-timeout:
			return nil
		}
	}
}

func TestCanvas(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	ctx := context.Background()
	teamID := th.BasicTeam.Id
	channelID := th.BasicChannel.Id

	t.Run("create requires the team flag", func(t *testing.T) {
		_, resp, err := th.Client.CreateCanvas(ctx, teamID, channelID)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
	})

	setCanvasEnabled(t, th, teamID, true)

	t.Run("create, duplicate, other team, archived", func(t *testing.T) {
		canvas, resp, err := th.Client.CreateCanvas(ctx, teamID, channelID)
		require.NoError(t, err)
		require.Equal(t, 201, resp.StatusCode)
		require.Equal(t, channelID, canvas.ChannelId)
		require.Equal(t, teamID, canvas.TeamId)
		require.Equal(t, th.BasicUser.Id, canvas.CreatorId)

		_, resp, err = th.Client.CreateCanvas(ctx, teamID, channelID)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		other := th.CreateTeamWithClient(t, th.SystemAdminClient)
		setCanvasEnabled(t, th, other.Id, true)
		_, resp, err = th.Client.CreateCanvas(ctx, other.Id, th.CreatePublicChannel(t).Id)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		archived := th.CreatePublicChannel(t)
		_, err = th.Client.DeleteChannel(ctx, archived.Id)
		require.NoError(t, err)
		_, resp, err = th.Client.CreateCanvas(ctx, teamID, archived.Id)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("get canvas on a plain channel is 404", func(t *testing.T) {
		_, resp, err := th.Client.GetCanvas(ctx, th.CreatePublicChannel(t).Id)
		require.Error(t, err)
		CheckNotFoundStatus(t, resp)

		canvas, _, err := th.Client.GetCanvas(ctx, channelID)
		require.NoError(t, err)
		require.Equal(t, channelID, canvas.ChannelId)
	})

	t.Run("updates, state and websocket", func(t *testing.T) {
		th.LoginBasic2(t)
		ws2 := th.CreateConnectedWebSocketClientWithClient(t, th.Client)
		th.LoginBasic(t)

		ws1, err := th.CreateWebSocketClient()
		require.NoError(t, err)
		defer ws1.Close()
		ws1.Listen()
		hello := <-ws1.EventChannel
		connID := hello.GetData()["connection_id"].(string)

		first := []byte{1, 2, 3, 0xff}
		second := []byte{9, 8, 7}

		th.Client.HTTPHeader = map[string]string{model.ConnectionId: connID}
		seq, _, err := th.Client.PostCanvasUpdate(ctx, channelID, first)
		th.Client.HTTPHeader = nil
		require.NoError(t, err)
		require.EqualValues(t, 1, seq)
		seq, _, err = th.Client.PostCanvasUpdate(ctx, channelID, second)
		require.NoError(t, err)
		require.EqualValues(t, 2, seq)

		ev := waitCanvasEvent(t, ws2, model.WebsocketEventCanvasUpdated)
		require.NotNil(t, ev)
		require.Equal(t, channelID, ev.GetData()["channel_id"])
		require.EqualValues(t, 1, ev.GetData()["seq"])
		require.Equal(t, base64.StdEncoding.EncodeToString(first), ev.GetData()["data"])

		// ws1 is the posting connection of update 1, so its first canvas_updated is update 2.
		ev = waitCanvasEvent(t, ws1, model.WebsocketEventCanvasUpdated)
		require.NotNil(t, ev)
		require.EqualValues(t, 2, ev.GetData()["seq"])

		state, _, err := th.Client.GetCanvasState(ctx, channelID, 1)
		require.NoError(t, err)
		require.Len(t, state.Updates, 1)
		require.EqualValues(t, 2, state.Updates[0].Seq)
		require.Equal(t, second, state.Updates[0].Data)
		require.EqualValues(t, 2, state.LastSeq)
	})

	t.Run("size limits and empty bodies", func(t *testing.T) {
		_, resp, err := th.Client.PostCanvasUpdate(ctx, channelID, make([]byte, model.CanvasUpdateMaxBytes+1))
		require.Error(t, err)
		CheckRequestEntityTooLargeStatus(t, resp)

		// The cap is a backstop well above the clients' 512 KB batches; a fresh canvas keeps this channel's seqs as the later subtests expect.
		big := th.CreatePublicChannel(t)
		_, _, err = th.Client.CreateCanvas(ctx, teamID, big.Id)
		require.NoError(t, err)
		_, _, err = th.Client.PostCanvasUpdate(ctx, big.Id, make([]byte, 1024*1024))
		require.NoError(t, err)

		_, resp, err = th.Client.PostCanvasUpdate(ctx, channelID, nil)
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)

		_, resp, err = th.Client.SaveCanvasSnapshot(ctx, channelID, &model.CanvasSnapshot{Data: make([]byte, model.CanvasSnapshotMaxBytes+1), UptoSeq: 2})
		require.Error(t, err)
		CheckRequestEntityTooLargeStatus(t, resp)

		_, resp, err = th.Client.SaveCanvasSnapshot(ctx, channelID, &model.CanvasSnapshot{UptoSeq: 2})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})

	t.Run("non-member is refused", func(t *testing.T) {
		user := th.CreateUser(t)
		client := th.CreateClient()
		_, _, err := client.Login(ctx, user.Email, user.Password)
		require.NoError(t, err)

		_, resp, err := client.GetCanvasState(ctx, channelID, 0)
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = client.PostCanvasUpdate(ctx, channelID, []byte{1})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		ws := th.CreateConnectedWebSocketClientWithClient(t, client)
		ws.SendMessage("canvas_awareness", map[string]any{"channel_id": channelID, "data": "AQID"})
		timeout := time.After(5 * time.Second)
		for {
			select {
			case r := <-ws.ResponseChannel:
				if r.Status == model.StatusFail {
					require.NotNil(t, r.Error)
					return
				}
			case <-timeout:
				require.FailNow(t, "no failure response to awareness from a non-member")
			}
		}
	})

	t.Run("snapshot compacts", func(t *testing.T) {
		applied, _, err := th.Client.SaveCanvasSnapshot(ctx, channelID, &model.CanvasSnapshot{Data: []byte{5, 5, 5}, UptoSeq: 2})
		require.NoError(t, err)
		require.True(t, applied)

		state, _, err := th.Client.GetCanvasState(ctx, channelID, 0)
		require.NoError(t, err)
		require.Equal(t, []byte{5, 5, 5}, state.Snapshot)
		require.EqualValues(t, 2, state.SnapshotSeq)
		require.Empty(t, state.Updates)
	})

	t.Run("awareness reaches other members", func(t *testing.T) {
		th.LoginBasic2(t)
		ws2 := th.CreateConnectedWebSocketClientWithClient(t, th.Client)
		th.LoginBasic(t)
		ws1 := th.CreateConnectedWebSocketClient(t)

		ws1.SendMessage("canvas_awareness", map[string]any{"channel_id": channelID, "data": "AQID"})
		ev := waitCanvasEvent(t, ws2, model.WebsocketEventCanvasAwareness)
		require.NotNil(t, ev)
		require.Equal(t, th.BasicUser.Id, ev.GetData()["user_id"])
		require.Equal(t, channelID, ev.GetData()["channel_id"])
		require.Equal(t, "AQID", ev.GetData()["data"])
	})

	t.Run("oversized awareness is refused and the connection stays usable", func(t *testing.T) {
		th.LoginBasic2(t)
		ws2 := th.CreateConnectedWebSocketClientWithClient(t, th.Client)
		th.LoginBasic(t)
		ws1 := th.CreateConnectedWebSocketClient(t)

		// decoded 4 KB + 1, base64 about 5.5 KB: over the limit, under the 8 KB frame cap
		big := base64.StdEncoding.EncodeToString(make([]byte, model.CanvasAwarenessMaxBytes+1))
		ws1.SendMessage("canvas_awareness", map[string]any{"channel_id": channelID, "data": big})
		timeout := time.After(5 * time.Second)
	wait:
		for {
			select {
			case r := <-ws1.ResponseChannel:
				if r.Status == model.StatusFail {
					require.NotNil(t, r.Error)
					break wait
				}
			case <-timeout:
				require.FailNow(t, "no failure response to oversized awareness")
			}
		}

		ws1.SendMessage("canvas_awareness", map[string]any{"channel_id": channelID, "data": "AQID"})
		ev := waitCanvasEvent(t, ws2, model.WebsocketEventCanvasAwareness)
		require.NotNil(t, ev)
		require.Equal(t, "AQID", ev.GetData()["data"])
	})

	t.Run("flag off and archived channel refuse writes", func(t *testing.T) {
		setCanvasEnabled(t, th, teamID, false)
		_, resp, err := th.Client.PostCanvasUpdate(ctx, channelID, []byte{1})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)
		_, resp, err = th.Client.SaveCanvasSnapshot(ctx, channelID, &model.CanvasSnapshot{Data: []byte{1}, UptoSeq: 2})
		require.Error(t, err)
		CheckForbiddenStatus(t, resp)

		setCanvasEnabled(t, th, teamID, true)
		ch := th.CreatePublicChannel(t)
		_, _, err = th.Client.CreateCanvas(ctx, teamID, ch.Id)
		require.NoError(t, err)
		_, err = th.Client.DeleteChannel(ctx, ch.Id)
		require.NoError(t, err)
		_, resp, err = th.Client.PostCanvasUpdate(ctx, ch.Id, []byte{1})
		require.Error(t, err)
		CheckBadRequestStatus(t, resp)
	})
}
