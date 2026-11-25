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

type SqlPersonalNoteStore struct {
	*SqlStore
}

func newSqlPersonalNoteStore(sqlStore *SqlStore) store.PersonalNoteStore {
	return &SqlPersonalNoteStore{sqlStore}
}

var personalNoteColumns = []string{"Id", "TeamId", "UserId", "Title", "Message", "Visibility", "Date", "Time",
	"RemindMinutes", "RemindAt", "DoneAt", "CreateAt", "UpdateAt"}

func (s *SqlPersonalNoteStore) selectNotes() sq.SelectBuilder {
	cols := make([]string, len(personalNoteColumns))
	for i, c := range personalNoteColumns {
		cols[i] = "PersonalNotes." + c
	}
	return s.getQueryBuilder().Select(cols...).From("PersonalNotes")
}

func (s *SqlPersonalNoteStore) Save(n *model.PersonalNote) (*model.PersonalNote, error) {
	if n.Id == "" {
		n.PreSave()
	}
	if err := n.IsValid(); err != nil {
		return nil, err
	}
	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("PersonalNotes").
		Columns(personalNoteColumns...).
		Values(n.Id, n.TeamId, n.UserId, n.Title, n.Message, n.Visibility, n.Date, n.Time,
			n.RemindMinutes, n.RemindAt, n.DoneAt, n.CreateAt, n.UpdateAt))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to save PersonalNote with id=%s", n.Id)
	}
	return n, nil
}

func (s *SqlPersonalNoteStore) Get(id string) (*model.PersonalNote, error) {
	var n model.PersonalNote
	if err := s.GetReplica().GetBuilder(&n, s.selectNotes().Where(sq.Eq{"Id": id})); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.NewErrNotFound("PersonalNote", id)
		}
		return nil, errors.Wrapf(err, "failed to get PersonalNote with id=%s", id)
	}
	return &n, nil
}

func (s *SqlPersonalNoteStore) Update(n *model.PersonalNote) (*model.PersonalNote, error) {
	if err := n.IsValid(); err != nil {
		return nil, err
	}
	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("PersonalNotes").
		Set("Title", n.Title).
		Set("Message", n.Message).
		Set("Visibility", n.Visibility).
		Set("Date", n.Date).
		Set("Time", n.Time).
		Set("RemindMinutes", n.RemindMinutes).
		Set("RemindAt", n.RemindAt).
		Set("DoneAt", n.DoneAt).
		Set("UpdateAt", n.UpdateAt).
		Where(sq.Eq{"Id": n.Id}))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to update PersonalNote with id=%s", n.Id)
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return nil, store.NewErrNotFound("PersonalNote", n.Id)
	}
	return n, nil
}

func (s *SqlPersonalNoteStore) Delete(id string) error {
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Delete("PersonalNotes").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to delete PersonalNote with id=%s", id)
	}
	return nil
}

func (s *SqlPersonalNoteStore) GetForTeam(teamID, userID string, opts store.PersonalNoteListOptions) ([]*model.PersonalNote, error) {
	visible := sq.Or{sq.Eq{"PersonalNotes.UserId": userID}}
	if !opts.OnlyMine {
		visible = append(visible, sq.And{
			sq.Eq{"PersonalNotes.Visibility": model.PersonalNoteVisibilityTeam},
			sq.Expr(`EXISTS (SELECT 1 FROM TeamMembers tm JOIN Users u ON u.Id = tm.UserId
				WHERE tm.TeamId = PersonalNotes.TeamId AND tm.UserId = PersonalNotes.UserId AND tm.DeleteAt = 0 AND u.DeleteAt = 0)`),
		})
	}
	q := s.selectNotes().Where(sq.Eq{"PersonalNotes.TeamId": teamID}).Where(visible)
	if opts.Undated {
		q = q.Where(sq.Eq{"PersonalNotes.Date": ""}).OrderBy("(PersonalNotes.DoneAt = 0) DESC", "PersonalNotes.CreateAt DESC")
	} else {
		q = q.Where(sq.And{
			sq.NotEq{"PersonalNotes.Date": ""},
			sq.GtOrEq{"PersonalNotes.Date": opts.FromDate},
			sq.LtOrEq{"PersonalNotes.Date": opts.ToDate},
		}).OrderBy("PersonalNotes.Date", "PersonalNotes.Time", "PersonalNotes.CreateAt")
	}
	if opts.Limit > 0 {
		q = q.Limit(uint64(opts.Limit))
	}
	notes := []*model.PersonalNote{}
	if err := s.GetReplica().SelectBuilder(&notes, q); err != nil {
		return nil, errors.Wrapf(err, "failed to get PersonalNotes for team_id=%s", teamID)
	}
	return notes, nil
}

func (s *SqlPersonalNoteStore) GetDueReminders(now int64, limit int) ([]*model.PersonalNote, error) {
	notes := []*model.PersonalNote{}
	q := s.selectNotes().
		Where(sq.And{sq.Gt{"RemindAt": 0}, sq.LtOrEq{"RemindAt": now}}).
		OrderBy("RemindAt").
		Limit(uint64(limit))
	if err := s.GetMaster().SelectBuilder(&notes, q); err != nil {
		return nil, errors.Wrap(err, "failed to get due PersonalNote reminders")
	}
	return notes, nil
}

func (s *SqlPersonalNoteStore) ClearReminder(id string) error {
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Update("PersonalNotes").Set("RemindAt", 0).Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to clear reminder of PersonalNote with id=%s", id)
	}
	return nil
}
