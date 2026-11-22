// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	sq "github.com/mattermost/squirrel"
	"github.com/pkg/errors"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

type SqlAppUsageStore struct {
	*SqlStore
}

func newSqlAppUsageStore(sqlStore *SqlStore) store.AppUsageStore {
	return &SqlAppUsageStore{sqlStore}
}

func (s *SqlAppUsageStore) SaveMany(rows []*model.AppUsage) error {
	if len(rows) == 0 {
		return nil
	}
	query := s.getQueryBuilder().Insert("AppUsage").Columns("Id", "UserId", "App", "Title", "StartAt", "EndAt")
	for _, r := range rows {
		query = query.Values(r.Id, r.UserId, r.App, r.Title, r.StartAt, r.EndAt)
	}
	// A retried batch repeats (UserId, StartAt); those rows are already stored.
	_, err := s.GetMaster().ExecBuilder(query.Suffix("ON CONFLICT (UserId, StartAt) DO NOTHING"))
	return errors.Wrap(err, "failed to save AppUsage")
}

func (s *SqlAppUsageStore) GetTotals(userID string, from, to int64) ([]*model.AppUsageTotal, error) {
	query := s.getQueryBuilder().
		Select("UserId", "App", "Title").
		Column(sq.Expr("SUM(LEAST(EndAt, ?) - GREATEST(StartAt, ?)) AS Ms", to, from)).
		From("AppUsage").
		Where(sq.Lt{"StartAt": to}).
		// No valid interval is longer than AppUsageMaxLength, so this bound lets the StartAt index limit the scan.
		Where(sq.GtOrEq{"StartAt": from - model.AppUsageMaxLength}).
		Where(sq.Gt{"EndAt": from}).
		GroupBy("UserId", "App", "Title").
		OrderBy("UserId", "Ms DESC")
	if userID != "" {
		query = query.Where(sq.Eq{"UserId": userID})
	}
	totals := []*model.AppUsageTotal{}
	if err := s.GetReplica().SelectBuilder(&totals, query); err != nil {
		return nil, errors.Wrap(err, "failed to get AppUsage totals")
	}
	return totals, nil
}
