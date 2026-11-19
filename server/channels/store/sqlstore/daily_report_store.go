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

var dailyReportColumns = []string{"Id", "TeamId", "UserId", "Date", "Message", "Tasks", "Status", "AutoApproved", "ApprovedBy", "ApprovedAt",
	"Edited", "PreviousMessage", "RejectedBy", "RejectedAt", "RejectReason", "CreateAt", "UpdateAt"}

// dailyReportRow is a DailyReports row as scanned: Tasks is the raw JSON column.
type dailyReportRow struct {
	Id              string
	TeamId          string
	UserId          string
	Date            string
	Message         string
	Tasks           []byte
	Status          string
	AutoApproved    bool
	ApprovedBy      string
	ApprovedAt      int64
	Edited          bool
	PreviousMessage string
	RejectedBy      string
	RejectedAt      int64
	RejectReason    string
	CreateAt        int64
	UpdateAt        int64
}

func (row *dailyReportRow) toModel() (*model.DailyReport, error) {
	r := &model.DailyReport{
		Id: row.Id, TeamId: row.TeamId, UserId: row.UserId, Date: row.Date, Message: row.Message,
		Status: row.Status, AutoApproved: row.AutoApproved, ApprovedBy: row.ApprovedBy, ApprovedAt: row.ApprovedAt,
		Edited: row.Edited, PreviousMessage: row.PreviousMessage,
		RejectedBy: row.RejectedBy, RejectedAt: row.RejectedAt, RejectReason: row.RejectReason,
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
		Values(r.Id, r.TeamId, r.UserId, r.Date, r.Message, string(tasks), r.Status, r.AutoApproved, r.ApprovedBy, r.ApprovedAt,
			r.Edited, r.PreviousMessage, r.RejectedBy, r.RejectedAt, r.RejectReason, r.CreateAt, r.UpdateAt))
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
		Set("Edited", r.Edited).
		Set("PreviousMessage", r.PreviousMessage).
		// The rejection columns belong to Reject alone: an edit that read the report before a reject must not erase it.
		Set("UpdateAt", r.UpdateAt).
		Where(sq.Eq{"Id": r.Id}))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to update DailyReport with id=%s", r.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("DailyReport", r.Id)
	}
	return r, nil
}

// Approve approves a pending report without touching its content; see DailyReportStore.Approve.
func (s *SqlDailyReportStore) Approve(id, approverID string, auto bool, approvedAt, seenUpdateAt int64) error {
	return s.review(id, "approve", s.getQueryBuilder().
		Update("DailyReports").
		Set("Status", model.DailyReportStatusApproved).
		Set("AutoApproved", auto).
		Set("ApprovedBy", approverID).
		Set("ApprovedAt", approvedAt).
		Set("UpdateAt", model.GetMillis()).
		Where(reviewWhere(id, seenUpdateAt, model.DailyReportStatusPending)))
}

// Excuse turns a draft into an excused day; see DailyReportStore.Excuse.
func (s *SqlDailyReportStore) Excuse(id, reviewerID string, excusedAt int64) error {
	return s.review(id, "excuse", s.getQueryBuilder().
		Update("DailyReports").
		Set("Status", model.DailyReportStatusExcused).
		Set("ApprovedBy", reviewerID).
		Set("ApprovedAt", excusedAt).
		Set("UpdateAt", model.GetMillis()).
		Where(reviewWhere(id, 0, model.DailyReportStatusDraft)))
}

// Reject rejects a pending or approved report; see DailyReportStore.Reject.
func (s *SqlDailyReportStore) Reject(id, rejecterID, reason string, rejectedAt, seenUpdateAt int64) error {
	return s.review(id, "reject", s.getQueryBuilder().
		Update("DailyReports").
		Set("Status", model.DailyReportStatusRejected).
		Set("RejectedBy", rejecterID).
		Set("RejectedAt", rejectedAt).
		Set("RejectReason", reason).
		Set("UpdateAt", model.GetMillis()).
		Where(reviewWhere(id, seenUpdateAt, model.DailyReportStatusPending, model.DailyReportStatusApproved)))
}

// reviewWhere matches the report in one of the given states and, when seenUpdateAt > 0, only as the reviewer saw it.
func reviewWhere(id string, seenUpdateAt int64, statuses ...string) sq.And {
	where := sq.And{sq.Eq{"Id": id, "Status": statuses}}
	if seenUpdateAt > 0 {
		where = append(where, sq.Eq{"UpdateAt": seenUpdateAt})
	}
	return where
}

func (s *SqlDailyReportStore) review(id, action string, q sq.UpdateBuilder) error {
	res, err := s.GetMaster().ExecBuilder(q)
	if err != nil {
		return errors.Wrapf(err, "failed to %s DailyReport with id=%s", action, id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return s.missOrConflict(id)
	}
	return nil
}

// missOrConflict explains a guarded write that matched no row: the report is gone, or it changed state.
func (s *SqlDailyReportStore) missOrConflict(id string) error {
	var n int
	if err := s.GetMaster().GetBuilder(&n, s.getQueryBuilder().Select("COUNT(*)").From("DailyReports").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to look up DailyReport with id=%s", id)
	}
	if n == 0 {
		return store.NewErrNotFound("DailyReport", id)
	}
	return store.NewErrConflict("DailyReport", errors.New("report changed"), "id="+id)
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
	// Master, not replica: submit reads back what it or a concurrent submit just wrote.
	err := s.GetMaster().GetBuilder(&row, s.getQueryBuilder().Select(dailyReportColumns...).From("DailyReports").Where(where))
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

func (s *SqlDailyReportStore) GetPendingBefore(updatedBefore int64) ([]*model.DailyReport, error) {
	return s.selectReports(s.getQueryBuilder().
		Select(dailyReportColumns...).
		From("DailyReports").
		Where(sq.Eq{"Status": model.DailyReportStatusPending}).
		Where(sq.Lt{"UpdateAt": updatedBefore}).
		OrderBy("UpdateAt ASC", "Id ASC"), "pending")
}

func (s *SqlDailyReportStore) GetBeforeDate(teamID, status, beforeDate string) ([]*model.DailyReport, error) {
	return s.selectReports(s.getQueryBuilder().
		Select(dailyReportColumns...).
		From("DailyReports").
		Where(sq.Eq{"TeamId": teamID, "Status": status}).
		Where(sq.Lt{"Date": beforeDate}).
		OrderBy("Date ASC", "Id ASC"), "team_id="+teamID+" status="+status)
}

func (s *SqlDailyReportStore) Delete(id string) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(tx, &err)

	if _, err = tx.ExecBuilder(s.getQueryBuilder().Delete("DailyReportFiles").Where(sq.Eq{"ReportId": id})); err != nil {
		return errors.Wrapf(err, "failed to delete DailyReportFiles for report_id=%s", id)
	}
	res, err := tx.ExecBuilder(s.getQueryBuilder().Delete("DailyReports").Where(sq.Eq{"Id": id}))
	if err != nil {
		return errors.Wrapf(err, "failed to delete DailyReport with id=%s", id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.NewErrNotFound("DailyReport", id)
	}
	return errors.Wrap(tx.Commit(), "commit_transaction")
}

func (s *SqlDailyReportStore) AddFile(reportID, fileID string, createAt int64) error {
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Insert("DailyReportFiles").
		Columns("ReportId", "FileId", "CreateAt").Values(reportID, fileID, createAt)); err != nil {
		return errors.Wrapf(err, "failed to link file_id=%s to report_id=%s", fileID, reportID)
	}
	return nil
}

func (s *SqlDailyReportStore) RemoveFile(reportID, fileID string) error {
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Delete("DailyReportFiles").
		Where(sq.Eq{"ReportId": reportID, "FileId": fileID}))
	if err != nil {
		return errors.Wrapf(err, "failed to unlink file_id=%s from report_id=%s", fileID, reportID)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.NewErrNotFound("DailyReportFile", reportID+"/"+fileID)
	}
	return nil
}

func (s *SqlDailyReportStore) GetFileIds(reportIDs []string) (map[string][]string, error) {
	result := map[string][]string{}
	if len(reportIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		ReportId string
		FileId   string
	}
	// Master: an upload reads its own link back to count and return the files.
	if err := s.GetMaster().SelectBuilder(&rows, s.getQueryBuilder().Select("ReportId", "FileId").From("DailyReportFiles").
		Where(sq.Eq{"ReportId": reportIDs}).OrderBy("CreateAt ASC", "FileId ASC")); err != nil {
		return nil, errors.Wrap(err, "failed to get DailyReportFiles")
	}
	for _, row := range rows {
		result[row.ReportId] = append(result[row.ReportId], row.FileId)
	}
	return result, nil
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

func (s *SqlDailyReportStore) GetAssignees(teamID string) ([]string, error) {
	userIDs := []string{}
	if err := s.GetMaster().SelectBuilder(&userIDs, s.getQueryBuilder().
		Select("UserId").From("DailyReportAssignees").Where(sq.Eq{"TeamId": teamID}).OrderBy("UserId")); err != nil {
		return nil, errors.Wrapf(err, "failed to get DailyReportAssignees for team_id=%s", teamID)
	}
	return userIDs, nil
}

func (s *SqlDailyReportStore) SetAssignees(teamID string, userIDs []string) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(tx, &err)

	if _, err = tx.ExecBuilder(s.getQueryBuilder().Delete("DailyReportAssignees").Where(sq.Eq{"TeamId": teamID})); err != nil {
		return errors.Wrapf(err, "failed to clear DailyReportAssignees for team_id=%s", teamID)
	}
	if len(userIDs) > 0 {
		q := s.getQueryBuilder().Insert("DailyReportAssignees").Columns("TeamId", "UserId")
		for _, id := range userIDs {
			q = q.Values(teamID, id)
		}
		if _, err = tx.ExecBuilder(q); err != nil {
			return errors.Wrapf(err, "failed to save DailyReportAssignees for team_id=%s", teamID)
		}
	}
	return errors.Wrap(tx.Commit(), "commit_transaction")
}
