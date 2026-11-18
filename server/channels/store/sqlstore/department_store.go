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

type SqlDepartmentStore struct {
	*SqlStore
}

func newSqlDepartmentStore(sqlStore *SqlStore) store.DepartmentStore {
	return &SqlDepartmentStore{sqlStore}
}

var departmentColumns = []string{"Id", "TeamId", "Name", "Color", "Position", "IsStudio", "CreateAt", "UpdateAt", "DeleteAt"}

var departmentUniqueIndexes = []string{"idx_departments_team_name", "idx_departments_team_studio"}

func (s *SqlDepartmentStore) Save(d *model.Department) (*model.Department, error) {
	d.PreSave()
	if err := d.IsValid(); err != nil {
		return nil, err
	}
	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("Departments").
		Columns(departmentColumns...).
		Values(d.Id, d.TeamId, d.Name, d.Color, d.Position, d.IsStudio, d.CreateAt, d.UpdateAt, d.DeleteAt))
	if err != nil && IsUniqueConstraintError(err, departmentUniqueIndexes) {
		return nil, store.NewErrConflict("Department", err, "name="+d.Name)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to save Department with id=%s", d.Id)
	}
	return d, nil
}

func (s *SqlDepartmentStore) Update(d *model.Department) (*model.Department, error) {
	d.PreUpdate()
	if err := d.IsValid(); err != nil {
		return nil, err
	}
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("Departments").
		Set("Name", d.Name).
		Set("Color", d.Color).
		Set("UpdateAt", d.UpdateAt).
		Where(sq.Eq{"Id": d.Id, "DeleteAt": 0}))
	if err != nil && IsUniqueConstraintError(err, departmentUniqueIndexes) {
		return nil, store.NewErrConflict("Department", err, "name="+d.Name)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to update Department with id=%s", d.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("Department", d.Id)
	}
	return d, nil
}

func (s *SqlDepartmentStore) Get(id string) (*model.Department, error) {
	var d model.Department
	err := s.GetMaster().GetBuilder(&d, s.getQueryBuilder().
		Select(departmentColumns...).
		From("Departments").
		Where(sq.Eq{"Id": id, "DeleteAt": 0}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("Department", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get Department with id=%s", id)
	}
	return &d, nil
}

func (s *SqlDepartmentStore) GetForTeam(teamID string) ([]*model.Department, error) {
	departments := []*model.Department{}
	err := s.GetMaster().SelectBuilder(&departments, s.getQueryBuilder().
		Select(departmentColumns...).
		From("Departments").
		Where(sq.Eq{"TeamId": teamID, "DeleteAt": 0}).
		OrderBy("Position", "CreateAt"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get Departments for team_id=%s", teamID)
	}
	return departments, nil
}

func (s *SqlDepartmentStore) Delete(id string, at int64) error {
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("Departments").
		Set("DeleteAt", at).
		Set("UpdateAt", at).
		Where(sq.Eq{"Id": id, "DeleteAt": 0}))
	if err != nil {
		return errors.Wrapf(err, "failed to delete Department with id=%s", id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.NewErrNotFound("Department", id)
	}
	return nil
}

func (s *SqlDepartmentStore) SetPositions(teamID string, orderedIDs []string, at int64) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(tx, &err)

	var live []string
	// FOR UPDATE: a concurrent create or delete cannot slip between the check and the writes.
	if err = tx.Select(&live, "SELECT Id FROM Departments WHERE TeamId = ? AND DeleteAt = 0 FOR UPDATE", teamID); err != nil {
		return errors.Wrap(err, "failed to lock Departments")
	}
	liveSet := make(map[string]bool, len(live))
	for _, id := range live {
		liveSet[id] = true
	}
	seen := make(map[string]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if !liveSet[id] || seen[id] {
			return store.NewErrInvalidInput("Department", "order", id)
		}
		seen[id] = true
	}
	if len(seen) != len(liveSet) {
		return store.NewErrInvalidInput("Department", "order", len(orderedIDs))
	}
	for i, id := range orderedIDs {
		if _, err = tx.ExecBuilder(s.getQueryBuilder().Update("Departments").Set("Position", i).Set("UpdateAt", at).Where(sq.Eq{"Id": id})); err != nil {
			return errors.Wrapf(err, "failed to set position of Department with id=%s", id)
		}
	}
	return errors.Wrap(tx.Commit(), "commit_transaction")
}
