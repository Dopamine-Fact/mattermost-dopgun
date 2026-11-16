// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"database/sql"
	"encoding/json"

	sq "github.com/mattermost/squirrel"
	"github.com/pkg/errors"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

type SqlDailyReportStore struct {
	*SqlStore
}

func newSqlDailyReportStore(sqlStore *SqlStore) store.DailyReportStore {
	return &SqlDailyReportStore{sqlStore}
}

var dailyReportColumns = []string{"Id", "TeamId", "UserId", "Date", "Message", "Tasks", "Status", "AutoApproved", "ApprovedBy", "ApprovedAt", "CreateAt", "UpdateAt"}

// dailyReportRow is a DailyReports row as scanned: Tasks is the raw JSON column.
type dailyReportRow struct {
	Id           string
	TeamId       string
	UserId       string
	Date         string
	Message      string
	Tasks        []byte
	Status       string
	AutoApproved bool
	ApprovedBy   string
	ApprovedAt   int64
	CreateAt     int64
	UpdateAt     int64
}

func (row *dailyReportRow) toModel() (*model.DailyReport, error) {
	r := &model.DailyReport{
		Id: row.Id, TeamId: row.TeamId, UserId: row.UserId, Date: row.Date, Message: row.Message,
		Status: row.Status, AutoApproved: row.AutoApproved, ApprovedBy: row.ApprovedBy, ApprovedAt: row.ApprovedAt,
		CreateAt: row.CreateAt, UpdateAt: row.UpdateAt,
	}
	if err := json.Unmarshal(row.Tasks, &r.Tasks); err != nil {
		return nil, errors.Wrapf(err, "failed to decode Tasks of DailyReport with id=%s", row.Id)
	}
	if r.Tasks == nil {
		r.Tasks = []model.DailyReportTask{}
	}
	return r, nil
}

func (s *SqlDailyReportStore) Save(r *model.DailyReport) (*model.DailyReport, error) {
	r.PreSave()
	if err := r.IsValid(); err != nil {
		return nil, err
	}
	tasks, err := json.Marshal(r.Tasks)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode Tasks")
	}

	_, err = s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("DailyReports").
		Columns(dailyReportColumns...).
		Values(r.Id, r.TeamId, r.UserId, r.Date, r.Message, string(tasks), r.Status, r.AutoApproved, r.ApprovedBy, r.ApprovedAt, r.CreateAt, r.UpdateAt))
	if err != nil {
		if IsUniqueConstraintError(err, []string{"dailyreports_teamid_userid_date_key"}) {
			return nil, store.NewErrConflict("DailyReport", err, "team_id="+r.TeamId+" user_id="+r.UserId+" date="+r.Date)
		}
		return nil, errors.Wrapf(err, "failed to save DailyReport with id=%s", r.Id)
	}
	return r, nil
}

func (s *SqlDailyReportStore) Update(r *model.DailyReport) (*model.DailyReport, error) {
	r.PreUpdate()
	if err := r.IsValid(); err != nil {
		return nil, err
	}
	tasks, err := json.Marshal(r.Tasks)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode Tasks")
	}

	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("DailyReports").
		Set("Message", r.Message).
		Set("Tasks", string(tasks)).
		Set("Status", r.Status).
		Set("AutoApproved", r.AutoApproved).
		Set("ApprovedBy", r.ApprovedBy).
		Set("ApprovedAt", r.ApprovedAt).
		Set("UpdateAt", r.UpdateAt).
		Where(sq.Eq{"Id": r.Id, "Status": model.DailyReportStatusPending}))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to update DailyReport with id=%s", r.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, s.missOrConflict(r.Id)
	}
	return r, nil
}

// Approve approves a pending report without touching its content; see DailyReportStore.Approve.
func (s *SqlDailyReportStore) Approve(id, approverID string, auto bool, approvedAt int64) error {
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("DailyReports").
		Set("Status", model.DailyReportStatusApproved).
		Set("AutoApproved", auto).
		Set("ApprovedBy", approverID).
		Set("ApprovedAt", approvedAt).
		Set("UpdateAt", model.GetMillis()).
		Where(sq.Eq{"Id": id, "Status": model.DailyReportStatusPending}))
	if err != nil {
		return errors.Wrapf(err, "failed to approve DailyReport with id=%s", id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return s.missOrConflict(id)
	}
	return nil
}

// missOrConflict explains a guarded write that matched no row: the report is gone, or it is no longer pending.
func (s *SqlDailyReportStore) missOrConflict(id string) error {
	var n int
	if err := s.GetMaster().GetBuilder(&n, s.getQueryBuilder().Select("COUNT(*)").From("DailyReports").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to look up DailyReport with id=%s", id)
	}
	if n == 0 {
		return store.NewErrNotFound("DailyReport", id)
	}
	return store.NewErrConflict("DailyReport", errors.New("report is no longer pending"), "id="+id)
}

func (s *SqlDailyReportStore) Get(id string) (*model.DailyReport, error) {
	return s.getOne("id="+id, id, sq.Eq{"Id": id})
}

func (s *SqlDailyReportStore) GetForUserDate(teamID, userID, date string) (*model.DailyReport, error) {
	return s.getOne("team_id="+teamID+" user_id="+userID+" date="+date, teamID+"/"+userID+"/"+date,
		sq.Eq{"TeamId": teamID, "UserId": userID, "Date": date})
}

func (s *SqlDailyReportStore) getOne(desc, notFoundID string, where sq.Sqlizer) (*model.DailyReport, error) {
	var row dailyReportRow
	err := s.GetReplica().GetBuilder(&row, s.getQueryBuilder().Select(dailyReportColumns...).From("DailyReports").Where(where))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("DailyReport", notFoundID)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get DailyReport with %s", desc)
	}
	return row.toModel()
}

func (s *SqlDailyReportStore) GetForTeam(teamID, fromDate, toDate, userID string) ([]*model.DailyReport, error) {
	q := s.getQueryBuilder().
		Select(dailyReportColumns...).
		From("DailyReports").
		Where(sq.Eq{"TeamId": teamID}).
		Where(sq.GtOrEq{"Date": fromDate}).
		Where(sq.LtOrEq{"Date": toDate}).
		OrderBy("Date DESC", "CreateAt ASC", "Id ASC")
	if userID != "" {
		q = q.Where(sq.Eq{"UserId": userID})
	}
	return s.selectReports(q, "team_id="+teamID)
}

func (s *SqlDailyReportStore) GetPendingBefore(createdBefore int64) ([]*model.DailyReport, error) {
	return s.selectReports(s.getQueryBuilder().
		Select(dailyReportColumns...).
		From("DailyReports").
		Where(sq.Eq{"Status": model.DailyReportStatusPending}).
		Where(sq.Lt{"CreateAt": createdBefore}).
		OrderBy("CreateAt ASC", "Id ASC"), "pending")
}

func (s *SqlDailyReportStore) selectReports(q sq.SelectBuilder, desc string) ([]*model.DailyReport, error) {
	var rows []dailyReportRow
	if err := s.GetReplica().SelectBuilder(&rows, q); err != nil {
		return nil, errors.Wrapf(err, "failed to get DailyReports for %s", desc)
	}
	reports := make([]*model.DailyReport, 0, len(rows))
	for i := range rows {
		r, err := rows[i].toModel()
		if err != nil {
			return nil, err
		}
		reports = append(reports, r)
	}
	return reports, nil
}
