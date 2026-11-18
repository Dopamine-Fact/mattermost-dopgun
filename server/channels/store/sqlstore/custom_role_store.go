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

type SqlCustomRoleStore struct {
	*SqlStore
}

func newSqlCustomRoleStore(sqlStore *SqlStore) store.CustomRoleStore {
	return &SqlCustomRoleStore{sqlStore}
}

var customRoleColumns = []string{"Id", "RoleName", "TeamId", "DepartmentId", "DisplayName", "Color", "Position", "CreateAt", "UpdateAt", "DeleteAt"}

const customRoleNameIndex = "idx_customroles_department_name"

func (s *SqlCustomRoleStore) Save(r *model.CustomRole) (*model.CustomRole, error) {
	r.PreSave()
	if err := r.IsValid(); err != nil {
		return nil, err
	}
	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("CustomRoles").
		Columns(customRoleColumns...).
		Values(r.Id, r.RoleName, r.TeamId, r.DepartmentId, r.DisplayName, r.Color, r.Position, r.CreateAt, r.UpdateAt, r.DeleteAt))
	if err != nil && IsUniqueConstraintError(err, []string{customRoleNameIndex}) {
		return nil, store.NewErrConflict("CustomRole", err, "display_name="+r.DisplayName)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to save CustomRole with id=%s", r.Id)
	}
	return r, nil
}

func (s *SqlCustomRoleStore) Update(r *model.CustomRole) (*model.CustomRole, error) {
	r.PreUpdate()
	if err := r.IsValid(); err != nil {
		return nil, err
	}
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("CustomRoles").
		Set("DisplayName", r.DisplayName).
		Set("Color", r.Color).
		Set("UpdateAt", r.UpdateAt).
		Where(sq.Eq{"Id": r.Id, "DeleteAt": 0}))
	if err != nil && IsUniqueConstraintError(err, []string{customRoleNameIndex}) {
		return nil, store.NewErrConflict("CustomRole", err, "display_name="+r.DisplayName)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to update CustomRole with id=%s", r.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("CustomRole", r.Id)
	}
	return r, nil
}

func (s *SqlCustomRoleStore) Get(id string) (*model.CustomRole, error) {
	var r model.CustomRole
	err := s.GetMaster().GetBuilder(&r, s.getQueryBuilder().
		Select(customRoleColumns...).
		From("CustomRoles").
		Where(sq.Eq{"Id": id, "DeleteAt": 0}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("CustomRole", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get CustomRole with id=%s", id)
	}
	return &r, nil
}

func (s *SqlCustomRoleStore) GetForTeam(teamID string) ([]*model.CustomRole, error) {
	roles := []*model.CustomRole{}
	err := s.GetMaster().SelectBuilder(&roles, s.getQueryBuilder().
		Select(customRoleColumns...).
		From("CustomRoles").
		Where(sq.Eq{"TeamId": teamID, "DeleteAt": 0}).
		OrderBy("DepartmentId", "Position", "CreateAt"))
	if err != nil {
		return nil, errors.Wrap(err, "failed to get CustomRoles")
	}
	return roles, nil
}

func (s *SqlCustomRoleStore) Delete(id string, at int64) error {
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("CustomRoles").
		Set("DeleteAt", at).
		Set("UpdateAt", at).
		Where(sq.Eq{"Id": id, "DeleteAt": 0}))
	if err != nil {
		return errors.Wrapf(err, "failed to delete CustomRole with id=%s", id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.NewErrNotFound("CustomRole", id)
	}
	return nil
}

func (s *SqlCustomRoleStore) SetPositions(departmentID string, orderedIDs []string, at int64) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(tx, &err)

	var live []string
	// FOR UPDATE: a concurrent create or delete cannot slip between the check and the writes.
	if err = tx.Select(&live, "SELECT Id FROM CustomRoles WHERE DepartmentId = ? AND DeleteAt = 0 FOR UPDATE", departmentID); err != nil {
		return errors.Wrap(err, "failed to lock CustomRoles")
	}
	liveSet := make(map[string]bool, len(live))
	for _, id := range live {
		liveSet[id] = true
	}
	seen := make(map[string]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if !liveSet[id] || seen[id] {
			return store.NewErrInvalidInput("CustomRole", "order", id)
		}
		seen[id] = true
	}
	if len(seen) != len(liveSet) {
		return store.NewErrInvalidInput("CustomRole", "order", len(orderedIDs))
	}
	for i, id := range orderedIDs {
		if _, err = tx.ExecBuilder(s.getQueryBuilder().Update("CustomRoles").Set("Position", i).Set("UpdateAt", at).Where(sq.Eq{"Id": id})); err != nil {
			return errors.Wrapf(err, "failed to set position of CustomRole with id=%s", id)
		}
	}
	return errors.Wrap(tx.Commit(), "commit_transaction")
}
