// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"database/sql"

	sq "github.com/mattermost/squirrel"
	"github.com/pkg/errors"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

type SqlCanvasStore struct {
	*SqlStore
}

func newSqlCanvasStore(sqlStore *SqlStore) store.CanvasStore {
	return &SqlCanvasStore{sqlStore}
}

var canvasColumns = []string{"ChannelId", "TeamId", "CreatorId", "LastSeq", "SnapshotSeq", "CreateAt", "UpdateAt"}

func (s *SqlCanvasStore) Save(canvas *model.Canvas) (*model.Canvas, error) {
	canvas.PreSave()

	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("Canvases").
		Columns(canvasColumns...).
		Values(canvas.ChannelId, canvas.TeamId, canvas.CreatorId, canvas.LastSeq, canvas.SnapshotSeq, canvas.CreateAt, canvas.UpdateAt))
	if err != nil {
		if IsUniqueConstraintError(err, []string{"canvases_pkey", "PRIMARY"}) {
			return nil, store.NewErrConflict("Canvas", err, "channel_id="+canvas.ChannelId)
		}
		return nil, errors.Wrapf(err, "failed to save Canvas with channel_id=%s", canvas.ChannelId)
	}
	return canvas, nil
}

func (s *SqlCanvasStore) Get(channelID string) (*model.Canvas, error) {
	var canvas model.Canvas
	err := s.GetReplica().GetBuilder(&canvas, s.getQueryBuilder().Select(canvasColumns...).From("Canvases").Where(sq.Eq{"ChannelId": channelID}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("Canvas", channelID)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get Canvas with channel_id=%s", channelID)
	}
	return &canvas, nil
}

// AppendUpdate takes the canvas row lock via the UPDATE, so seqs are gapless and commit in order.
func (s *SqlCanvasStore) AppendUpdate(channelID, userID string, data []byte) (seq int64, err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return 0, errors.Wrap(err, "failed to start transaction")
	}
	defer finalizeTransactionX(tx, &err)

	now := model.GetMillis()
	err = tx.GetBuilder(&seq, s.getQueryBuilder().
		Update("Canvases").
		Set("LastSeq", sq.Expr("LastSeq + 1")).
		Set("UpdateAt", now).
		Where(sq.Eq{"ChannelId": channelID}).
		Suffix("RETURNING LastSeq"))
	if err == sql.ErrNoRows {
		return 0, store.NewErrNotFound("Canvas", channelID)
	} else if err != nil {
		return 0, errors.Wrapf(err, "failed to bump LastSeq for channel_id=%s", channelID)
	}

	if _, err = tx.ExecBuilder(s.getQueryBuilder().
		Insert("CanvasUpdates").
		Columns("ChannelId", "Seq", "UserId", "Data", "CreateAt").
		Values(channelID, seq, userID, data, now)); err != nil {
		return 0, errors.Wrapf(err, "failed to insert CanvasUpdate for channel_id=%s", channelID)
	}
	if err = tx.Commit(); err != nil {
		return 0, errors.Wrap(err, "failed to commit transaction")
	}
	return seq, nil
}

func (s *SqlCanvasStore) GetState(channelID string, afterSeq int64) (state *model.CanvasState, err error) {
	// Master + one repeatable-read snapshot: a lagging replica or a SaveSnapshot committing between the two reads would look like a seq gap.
	tx, err := s.GetMaster().BeginWithIsolation(&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, errors.Wrap(err, "failed to start transaction")
	}
	defer finalizeTransactionX(tx, &err)

	var head struct {
		LastSeq      int64
		SnapshotSeq  int64
		SnapshotData []byte
	}
	err = tx.GetBuilder(&head, s.getQueryBuilder().
		Select("LastSeq", "SnapshotSeq", "SnapshotData").From("Canvases").Where(sq.Eq{"ChannelId": channelID}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("Canvas", channelID)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get Canvas with channel_id=%s", channelID)
	}

	state = &model.CanvasState{SnapshotSeq: head.SnapshotSeq, LastSeq: head.LastSeq, Updates: []*model.CanvasUpdate{}}
	from := afterSeq
	if afterSeq < head.SnapshotSeq {
		state.Snapshot = head.SnapshotData
		from = head.SnapshotSeq
	}

	err = tx.SelectBuilder(&state.Updates, s.getQueryBuilder().
		Select("Seq", "Data").From("CanvasUpdates").
		Where(sq.Eq{"ChannelId": channelID}).Where(sq.Gt{"Seq": from}).
		OrderBy("Seq ASC"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get CanvasUpdates for channel_id=%s", channelID)
	}
	if err = tx.Commit(); err != nil {
		return nil, errors.Wrap(err, "failed to commit transaction")
	}
	return state, nil
}

func (s *SqlCanvasStore) SaveSnapshot(channelID string, data []byte, uptoSeq int64) (applied bool, err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return false, errors.Wrap(err, "failed to start transaction")
	}
	defer finalizeTransactionX(tx, &err)

	res, err := tx.ExecBuilder(s.getQueryBuilder().
		Update("Canvases").
		Set("SnapshotData", data).
		Set("SnapshotSeq", uptoSeq).
		Where(sq.Eq{"ChannelId": channelID}).
		Where(sq.Lt{"SnapshotSeq": uptoSeq}).
		Where(sq.GtOrEq{"LastSeq": uptoSeq}))
	if err != nil {
		return false, errors.Wrapf(err, "failed to save snapshot for channel_id=%s", channelID)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, errors.Wrap(err, "failed to read affected rows")
	}
	if n == 0 {
		return false, nil
	}

	if _, err = tx.ExecBuilder(s.getQueryBuilder().
		Delete("CanvasUpdates").
		Where(sq.Eq{"ChannelId": channelID}).
		Where(sq.LtOrEq{"Seq": uptoSeq})); err != nil {
		return false, errors.Wrapf(err, "failed to compact CanvasUpdates for channel_id=%s", channelID)
	}
	if err = tx.Commit(); err != nil {
		return false, errors.Wrap(err, "failed to commit transaction")
	}
	return true, nil
}
