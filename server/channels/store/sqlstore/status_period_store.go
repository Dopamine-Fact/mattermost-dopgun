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

type SqlStatusPeriodStore struct {
	*SqlStore
}

func newSqlStatusPeriodStore(sqlStore *SqlStore) store.StatusPeriodStore {
	return &SqlStatusPeriodStore{sqlStore}
}

func (s *SqlStatusPeriodStore) Switch(userID, kind string, at int64) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(tx, &err)

	var open model.StatusPeriod
	// FOR UPDATE: two status changes for one user at once cannot both open a row.
	err = tx.Get(&open, "SELECT Id, Kind FROM StatusPeriods WHERE UserId = ? AND EndAt = 0 FOR UPDATE", userID)
	if err != nil && err != sql.ErrNoRows {
		return errors.Wrapf(err, "failed to get open StatusPeriod for user_id=%s", userID)
	}
	hasOpen := err == nil
	err = nil
	if hasOpen && open.Kind == kind {
		return nil
	}
	if hasOpen {
		if _, err = tx.ExecBuilder(s.getQueryBuilder().Update("StatusPeriods").Set("EndAt", at).Where(sq.Eq{"Id": open.Id})); err != nil {
			return errors.Wrapf(err, "failed to close StatusPeriod id=%s", open.Id)
		}
	}
	if kind == "" {
		return tx.Commit()
	}
	if _, err = tx.ExecBuilder(s.getQueryBuilder().Insert("StatusPeriods").
		Columns("Id", "UserId", "Kind", "StartAt", "EndAt").
		Values(model.NewId(), userID, kind, at, 0)); err != nil {
		return errors.Wrapf(err, "failed to open StatusPeriod for user_id=%s", userID)
	}
	return tx.Commit()
}

func (s *SqlStatusPeriodStore) End(userID, kind string, at int64) error {
	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Update("StatusPeriods").Set("EndAt", at).
		Where(sq.Eq{"UserId": userID, "Kind": kind, "EndAt": 0}))
	return errors.Wrapf(err, "failed to end StatusPeriod for user_id=%s", userID)
}

func (s *SqlStatusPeriodStore) EndOpenActive(now int64) error {
	_, err := s.GetMaster().Exec(`UPDATE StatusPeriods AS p
		SET EndAt = GREATEST(p.StartAt, LEAST(?, COALESCE((SELECT st.LastActivityAt FROM Status st WHERE st.UserId = p.UserId), 0)))
		WHERE p.Kind = ? AND p.EndAt = 0`, now, model.StatusPeriodActive)
	return errors.Wrap(err, "failed to end open active StatusPeriods")
}

func (s *SqlStatusPeriodStore) GetRange(userID string, from, to int64) ([]*model.StatusPeriod, error) {
	query := s.getQueryBuilder().
		Select("Id", "UserId", "Kind", "StartAt", "EndAt").
		From("StatusPeriods").
		Where(sq.Lt{"StartAt": to}).
		Where(sq.Or{sq.Eq{"EndAt": 0}, sq.Gt{"EndAt": from}}).
		OrderBy("UserId", "StartAt")
	if userID != "" {
		query = query.Where(sq.Eq{"UserId": userID})
	}
	periods := []*model.StatusPeriod{}
	if err := s.GetReplica().SelectBuilder(&periods, query); err != nil {
		return nil, errors.Wrap(err, "failed to get StatusPeriods")
	}
	return periods, nil
}
