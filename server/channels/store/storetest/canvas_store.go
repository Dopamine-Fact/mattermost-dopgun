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

func TestCanvasStore(t *testing.T, rctx request.CTX, ss store.Store) {
	t.Run("SaveGet", func(t *testing.T) { testCanvasSaveGet(t, ss) })
	t.Run("AppendAndState", func(t *testing.T) { testCanvasAppendAndState(t, ss) })
	t.Run("SaveSnapshot", func(t *testing.T) { testCanvasSaveSnapshot(t, ss) })
	t.Run("TeamCanvasEnabled", func(t *testing.T) { testCanvasTeamEnabled(t, ss) })
}

func newTestCanvas(t *testing.T, ss store.Store) string {
	t.Helper()
	ch := model.NewId()
	_, err := ss.Canvas().Save(&model.Canvas{ChannelId: ch, TeamId: model.NewId(), CreatorId: model.NewId()})
	require.NoError(t, err)
	return ch
}

func testCanvasSaveGet(t *testing.T, ss store.Store) {
	ch := newTestCanvas(t, ss)

	_, err := ss.Canvas().Save(&model.Canvas{ChannelId: ch, TeamId: model.NewId(), CreatorId: model.NewId()})
	var conflict *store.ErrConflict
	require.ErrorAs(t, err, &conflict)

	got, err := ss.Canvas().Get(ch)
	require.NoError(t, err)
	require.Equal(t, ch, got.ChannelId)
	require.NotZero(t, got.CreateAt)

	_, err = ss.Canvas().Get(model.NewId())
	var nf *store.ErrNotFound
	require.ErrorAs(t, err, &nf)
}

func testCanvasAppendAndState(t *testing.T, ss store.Store) {
	ch := newTestCanvas(t, ss)
	other := newTestCanvas(t, ss)
	user := model.NewId()

	for i := int64(1); i <= 3; i++ {
		seq, err := ss.Canvas().AppendUpdate(ch, user, []byte{byte(i)})
		require.NoError(t, err)
		require.Equal(t, i, seq)
	}
	seq, err := ss.Canvas().AppendUpdate(other, user, []byte("x"))
	require.NoError(t, err)
	require.Equal(t, int64(1), seq)

	_, err = ss.Canvas().AppendUpdate(model.NewId(), user, []byte("x"))
	require.Error(t, err)

	st, err := ss.Canvas().GetState(ch, 0)
	require.NoError(t, err)
	require.Nil(t, st.Snapshot)
	require.Equal(t, int64(3), st.LastSeq)
	require.Len(t, st.Updates, 3)
	require.Equal(t, int64(1), st.Updates[0].Seq)
	require.Equal(t, []byte{3}, st.Updates[2].Data)

	st, err = ss.Canvas().GetState(ch, 2)
	require.NoError(t, err)
	require.Len(t, st.Updates, 1)
	require.Equal(t, int64(3), st.Updates[0].Seq)
}

func testCanvasSaveSnapshot(t *testing.T, ss store.Store) {
	ch := newTestCanvas(t, ss)
	user := model.NewId()
	for i := 0; i < 3; i++ {
		_, err := ss.Canvas().AppendUpdate(ch, user, []byte{byte(i)})
		require.NoError(t, err)
	}

	applied, err := ss.Canvas().SaveSnapshot(ch, []byte("s"), 2)
	require.NoError(t, err)
	require.True(t, applied)

	st, err := ss.Canvas().GetState(ch, 0)
	require.NoError(t, err)
	require.Equal(t, []byte("s"), st.Snapshot)
	require.Equal(t, int64(2), st.SnapshotSeq)
	require.Len(t, st.Updates, 1)
	require.Equal(t, int64(3), st.Updates[0].Seq)

	st, err = ss.Canvas().GetState(ch, 2)
	require.NoError(t, err)
	require.Nil(t, st.Snapshot)
	require.Len(t, st.Updates, 1)
	require.Equal(t, int64(3), st.Updates[0].Seq)

	applied, err = ss.Canvas().SaveSnapshot(ch, []byte("again"), 2)
	require.NoError(t, err)
	require.False(t, applied)

	applied, err = ss.Canvas().SaveSnapshot(ch, []byte("beyond"), 9)
	require.NoError(t, err)
	require.False(t, applied)
}

func testCanvasTeamEnabled(t *testing.T, ss store.Store) {
	team, err := ss.Team().Save(&model.Team{
		DisplayName:   "Canvas",
		Name:          "z-z-" + model.NewId() + "a",
		Email:         "success+" + model.NewId() + "@simulator.amazonses.com",
		Type:          model.TeamOpen,
		CanvasEnabled: true,
	})
	require.NoError(t, err)

	got, err := ss.Team().Get(team.Id)
	require.NoError(t, err)
	require.True(t, got.CanvasEnabled)
}
