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

type SqlDriveItemStore struct {
	*SqlStore
}

func newSqlDriveItemStore(sqlStore *SqlStore) store.DriveItemStore {
	return &SqlDriveItemStore{sqlStore}
}

var driveItemColumns = []string{"Id", "ChannelId", "ParentId", "Type", "Name", "FileId", "CreatorId", "CreateAt", "UpdateAt", "DeleteAt", "DeletedBy"}

func (s *SqlDriveItemStore) selectItems() sq.SelectBuilder {
	return s.getQueryBuilder().Select(driveItemColumns...).From("DriveItems")
}

func (s *SqlDriveItemStore) list(q sq.SelectBuilder, desc string) ([]*model.DriveItem, error) {
	items := []*model.DriveItem{}
	if err := s.GetReplica().SelectBuilder(&items, q); err != nil {
		return nil, errors.Wrapf(err, "failed to get DriveItems for %s", desc)
	}
	return items, nil
}

func (s *SqlDriveItemStore) Save(item *model.DriveItem) (*model.DriveItem, error) {
	item.PreSave()
	if err := item.IsValid(); err != nil {
		return nil, err
	}
	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("DriveItems").
		Columns(driveItemColumns...).
		Values(item.Id, item.ChannelId, item.ParentId, item.Type, item.Name, item.FileId, item.CreatorId, item.CreateAt, item.UpdateAt, item.DeleteAt, item.DeletedBy))
	if err != nil {
		if IsUniqueConstraintError(err, []string{"idx_driveitems_live_name"}) {
			return nil, store.NewErrConflict("DriveItem", err, "name="+item.Name)
		}
		if IsUniqueConstraintError(err, []string{"idx_driveitems_fileid_unique"}) {
			return nil, store.NewErrUniqueConstraint("FileId")
		}
		return nil, errors.Wrapf(err, "failed to save DriveItem with id=%s", item.Id)
	}
	return item, nil
}

func (s *SqlDriveItemStore) Get(id string) (*model.DriveItem, error) {
	var item model.DriveItem
	err := s.GetReplica().GetBuilder(&item, s.selectItems().Where(sq.Eq{"Id": id}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("DriveItem", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get DriveItem with id=%s", id)
	}
	return &item, nil
}

func (s *SqlDriveItemStore) GetMany(ids []string) ([]*model.DriveItem, error) {
	if len(ids) == 0 {
		return []*model.DriveItem{}, nil
	}
	return s.list(s.selectItems().Where(sq.Eq{"Id": ids}), "ids")
}

func (s *SqlDriveItemStore) GetChildren(channelID, parentID string, limit int) ([]*model.DriveItem, error) {
	return s.list(s.selectItems().
		Where(sq.Eq{"ChannelId": channelID, "ParentId": parentID, "DeleteAt": 0}).
		OrderBy("CASE WHEN Type = 'folder' THEN 0 ELSE 1 END", "lower(Name)", "Id").
		Limit(uint64(limit)), "channel_id="+channelID+" parent_id="+parentID)
}

func (s *SqlDriveItemStore) GetDescendants(channelID, folderID string) ([]*model.DriveItem, error) {
	items := []*model.DriveItem{}
	err := s.GetReplica().Select(&items, `
		WITH RECURSIVE tree AS (
			SELECT `+joinColumns("d")+` FROM DriveItems d WHERE d.ChannelId = $1 AND d.ParentId = $2 AND d.DeleteAt = 0
			UNION ALL
			SELECT `+joinColumns("c")+` FROM DriveItems c JOIN tree ON c.ParentId = tree.Id
			WHERE c.ChannelId = $1 AND c.DeleteAt = 0
		)
		SELECT * FROM tree`, channelID, folderID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get descendants of DriveItem with id=%s", folderID)
	}
	return items, nil
}

func (s *SqlDriveItemStore) GetAncestors(id string) ([]*model.DriveItem, error) {
	items := []*model.DriveItem{}
	err := s.GetReplica().Select(&items, `
		WITH RECURSIVE up AS (
			SELECT p.*, 1 AS Depth FROM DriveItems p
			WHERE p.Id = (SELECT ParentId FROM DriveItems WHERE Id = $1)
			UNION ALL
			SELECT g.*, up.Depth + 1 FROM DriveItems g JOIN up ON g.Id = up.ParentId
			WHERE up.Depth < 1000
		)
		SELECT `+joinColumns("up")+` FROM up ORDER BY Depth DESC`, id)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get ancestors of DriveItem with id=%s", id)
	}
	return items, nil
}

func (s *SqlDriveItemStore) NameExists(channelID, parentID, name, excludeID string) (bool, error) {
	q := s.getQueryBuilder().
		Select("COUNT(*)").
		From("DriveItems").
		Where(sq.Eq{"ChannelId": channelID, "ParentId": parentID, "DeleteAt": 0}).
		Where(sq.Expr("lower(Name) = lower(?)", name))
	if excludeID != "" {
		q = q.Where(sq.NotEq{"Id": excludeID})
	}
	var n int64
	if err := s.GetMaster().GetBuilder(&n, q); err != nil {
		return false, errors.Wrapf(err, "failed to check DriveItem name in channel_id=%s", channelID)
	}
	return n > 0, nil
}

func (s *SqlDriveItemStore) updateQuery(item *model.DriveItem) sq.UpdateBuilder {
	return s.getQueryBuilder().
		Update("DriveItems").
		Set("ChannelId", item.ChannelId).
		Set("ParentId", item.ParentId).
		Set("Name", item.Name).
		Set("UpdateAt", item.UpdateAt).
		Set("DeleteAt", item.DeleteAt).
		Set("DeletedBy", item.DeletedBy).
		Where(sq.Eq{"Id": item.Id})
}

func (s *SqlDriveItemStore) Update(item *model.DriveItem) (*model.DriveItem, error) {
	item.PreUpdate()
	if err := item.IsValid(); err != nil {
		return nil, err
	}
	res, err := s.GetMaster().ExecBuilder(s.updateQuery(item))
	if err != nil {
		if IsUniqueConstraintError(err, []string{"idx_driveitems_live_name"}) {
			return nil, store.NewErrConflict("DriveItem", err, "name="+item.Name)
		}
		return nil, errors.Wrapf(err, "failed to update DriveItem with id=%s", item.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("DriveItem", item.Id)
	}
	return item, nil
}

func (s *SqlDriveItemStore) UpdateMany(items []*model.DriveItem) (err error) {
	transaction, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(transaction, &err)

	for _, item := range items {
		item.PreUpdate()
		if appErr := item.IsValid(); appErr != nil {
			return appErr
		}
		if _, err = transaction.ExecBuilder(s.updateQuery(item)); err != nil {
			if IsUniqueConstraintError(err, []string{"idx_driveitems_live_name"}) {
				return store.NewErrConflict("DriveItem", err, "name="+item.Name)
			}
			return errors.Wrapf(err, "failed to update DriveItem with id=%s", item.Id)
		}
	}
	if err = transaction.Commit(); err != nil {
		return errors.Wrap(err, "commit_transaction")
	}
	return nil
}

func (s *SqlDriveItemStore) GetTrash(channelID string) ([]*model.DriveItem, error) {
	return s.list(s.selectItems().
		Where(sq.Eq{"ChannelId": channelID}).
		Where(sq.Gt{"DeleteAt": 0}).
		OrderBy("DeleteAt DESC", "Id"), "trash channel_id="+channelID)
}

func (s *SqlDriveItemStore) GetExpiredTrash(before int64, limit int) ([]*model.DriveItem, error) {
	return s.list(s.selectItems().
		Where(sq.Gt{"DeleteAt": 0}).
		Where(sq.Lt{"DeleteAt": before}).
		OrderBy("DeleteAt", "Id").
		Limit(uint64(limit)), "expired trash")
}

func (s *SqlDriveItemStore) GetByFileId(fileID string) (*model.DriveItem, error) {
	var item model.DriveItem
	err := s.GetReplica().GetBuilder(&item, s.selectItems().Where(sq.Eq{"FileId": fileID}).Limit(1))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("DriveItem", "file_id="+fileID)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get DriveItem with file_id=%s", fileID)
	}
	return &item, nil
}

func (s *SqlDriveItemStore) GetDangling(limit int) ([]*model.DriveItem, error) {
	return s.list(s.selectItems().
		Where(sq.Eq{"Type": model.DriveItemTypeFile}).
		Where(sq.Expr("NOT EXISTS (SELECT 1 FROM FileInfo WHERE FileInfo.Id = DriveItems.FileId AND FileInfo.DeleteAt = 0)")).
		OrderBy("Id").
		Limit(uint64(limit)), "dangling")
}

func (s *SqlDriveItemStore) PermanentDelete(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Delete("DriveItems").Where(sq.Eq{"Id": ids})); err != nil {
		return errors.Wrap(err, "failed to delete DriveItems")
	}
	return nil
}

func (s *SqlDriveItemStore) PermanentDeleteByChannel(channelID string) error {
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Delete("DriveItems").Where(sq.Eq{"ChannelId": channelID})); err != nil {
		return errors.Wrapf(err, "failed to delete DriveItems for channel_id=%s", channelID)
	}
	return nil
}

func joinColumns(alias string) string {
	out := ""
	for i, c := range driveItemColumns {
		if i > 0 {
			out += ", "
		}
		out += alias + "." + c
	}
	return out
}
