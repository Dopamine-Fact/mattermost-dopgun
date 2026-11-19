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

type SqlTaskStore struct {
	*SqlStore
}

func newSqlTaskStore(sqlStore *SqlStore) store.TaskStore {
	return &SqlTaskStore{sqlStore}
}

var taskColumns = []string{"Id", "TeamId", "SectionId", "Title", "Description", "AssigneeId", "StartAt", "DueAt", "Status", "SortOrder", "VideoTime", "VideoFileId", "DepartmentId", "WaitsFor", "FolderId", "CreatorId", "CreateAt", "UpdateAt"}

var taskCommentColumns = []string{"Id", "TaskId", "UserId", "Message", "FileIds", "CreateAt"}

var taskSectionColumns = []string{"Id", "TeamId", "Name", "SortOrder", "ChannelId", "VideoFileId", "CreateAt", "UpdateAt"}

func (s *SqlTaskStore) Save(task *model.Task) (*model.Task, error) {
	task.PreSave()
	if err := task.IsValid(); err != nil {
		return nil, err
	}

	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("Tasks").
		Columns(taskColumns...).
		Values(task.Id, task.TeamId, task.SectionId, task.Title, task.Description, task.AssigneeId, task.StartAt, task.DueAt, task.Status, task.SortOrder, task.VideoTime, task.VideoFileId, task.DepartmentId, task.WaitsFor, task.FolderId, task.CreatorId, task.CreateAt, task.UpdateAt))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to save Task with id=%s", task.Id)
	}
	return task, nil
}

func (s *SqlTaskStore) Get(id string) (*model.Task, error) {
	var task model.Task
	err := s.GetReplica().GetBuilder(&task, s.getQueryBuilder().Select(taskColumns...).From("Tasks").Where(sq.Eq{"Id": id}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("Task", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get Task with id=%s", id)
	}
	return &task, nil
}

func (s *SqlTaskStore) GetForTeam(teamId string) ([]*model.Task, error) {
	tasks := []*model.Task{}
	err := s.GetReplica().SelectBuilder(&tasks, s.getQueryBuilder().
		Select(taskColumns...).
		From("Tasks").
		Where(sq.Eq{"TeamId": teamId}).
		OrderBy("SortOrder ASC", "Id ASC"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get Tasks for team_id=%s", teamId)
	}
	return tasks, nil
}

func (s *SqlTaskStore) Update(task *model.Task) (*model.Task, error) {
	task.PreUpdate()
	if err := task.IsValid(); err != nil {
		return nil, err
	}

	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("Tasks").
		Set("SectionId", task.SectionId).
		Set("Title", task.Title).
		Set("Description", task.Description).
		Set("AssigneeId", task.AssigneeId).
		Set("StartAt", task.StartAt).
		Set("DueAt", task.DueAt).
		Set("Status", task.Status).
		Set("SortOrder", task.SortOrder).
		Set("VideoTime", task.VideoTime).
		Set("DepartmentId", task.DepartmentId).
		Set("WaitsFor", task.WaitsFor).
		Set("UpdateAt", task.UpdateAt).
		Where(sq.Eq{"Id": task.Id}))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to update Task with id=%s", task.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("Task", task.Id)
	}
	return task, nil
}

// Delete removes the task and its comments together.
func (s *SqlTaskStore) Delete(id string) (err error) {
	tx, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "failed to start transaction")
	}
	defer finalizeTransactionX(tx, &err)

	if _, err = tx.ExecBuilder(s.getQueryBuilder().Delete("TaskComments").Where(sq.Eq{"TaskId": id})); err != nil {
		return errors.Wrapf(err, "failed to delete TaskComments for task_id=%s", id)
	}
	if _, err = tx.ExecBuilder(s.getQueryBuilder().Delete("Tasks").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to delete Task with id=%s", id)
	}
	return tx.Commit()
}

func (s *SqlTaskStore) SaveSection(section *model.TaskSection) (*model.TaskSection, error) {
	section.PreSave()
	if err := section.IsValid(); err != nil {
		return nil, err
	}

	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("TaskSections").
		Columns(taskSectionColumns...).
		Values(section.Id, section.TeamId, section.Name, section.SortOrder, section.ChannelId, section.VideoFileId, section.CreateAt, section.UpdateAt))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to save TaskSection with id=%s", section.Id)
	}
	return section, nil
}

func (s *SqlTaskStore) GetSection(id string) (*model.TaskSection, error) {
	var section model.TaskSection
	err := s.GetReplica().GetBuilder(&section, s.getQueryBuilder().Select(taskSectionColumns...).From("TaskSections").Where(sq.Eq{"Id": id}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("TaskSection", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskSection with id=%s", id)
	}
	return &section, nil
}

func (s *SqlTaskStore) GetSectionsForTeam(teamId string) ([]*model.TaskSection, error) {
	sections := []*model.TaskSection{}
	err := s.GetReplica().SelectBuilder(&sections, s.getQueryBuilder().
		Select(taskSectionColumns...).
		From("TaskSections").
		Where(sq.Eq{"TeamId": teamId}).
		OrderBy("SortOrder ASC", "CreateAt ASC"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskSections for team_id=%s", teamId)
	}
	return sections, nil
}

// GetSectionByChannel returns the task section linked to a channel; a channel has at most one.
func (s *SqlTaskStore) GetSectionByChannel(channelId string) (*model.TaskSection, error) {
	var section model.TaskSection
	err := s.GetReplica().GetBuilder(&section, s.getQueryBuilder().Select(taskSectionColumns...).From("TaskSections").Where(sq.Eq{"ChannelId": channelId}).Limit(1))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("TaskSection", "channel_id="+channelId)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskSection with channel_id=%s", channelId)
	}
	return &section, nil
}

func (s *SqlTaskStore) UpdateSection(section *model.TaskSection) (*model.TaskSection, error) {
	section.PreUpdate()
	if err := section.IsValid(); err != nil {
		return nil, err
	}

	res, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Update("TaskSections").
		Set("Name", section.Name).
		Set("SortOrder", section.SortOrder).
		Set("VideoFileId", section.VideoFileId).
		Set("UpdateAt", section.UpdateAt).
		Where(sq.Eq{"Id": section.Id}))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to update TaskSection with id=%s", section.Id)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.NewErrNotFound("TaskSection", section.Id)
	}
	return section, nil
}

// DeleteSection removes the section and its video versions, and moves its tasks to "no section" as ordinary tasks, in one transaction.
func (s *SqlTaskStore) DeleteSection(id string) (err error) {
	transaction, err := s.GetMaster().Begin()
	if err != nil {
		return errors.Wrap(err, "begin_transaction")
	}
	defer finalizeTransactionX(transaction, &err)

	if _, err = transaction.ExecBuilder(s.getQueryBuilder().
		Update("Tasks").
		Set("SectionId", "").
		Set("VideoFileId", "").
		Set("UpdateAt", model.GetMillis()).
		Where(sq.Eq{"SectionId": id})); err != nil {
		return errors.Wrapf(err, "failed to unassign Tasks from section_id=%s", id)
	}

	if _, err = transaction.ExecBuilder(s.getQueryBuilder().Delete("TaskSectionVideos").Where(sq.Eq{"SectionId": id})); err != nil {
		return errors.Wrapf(err, "failed to delete TaskSectionVideos for section_id=%s", id)
	}

	if _, err = transaction.ExecBuilder(s.getQueryBuilder().Delete("TaskSections").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to delete TaskSection with id=%s", id)
	}

	return transaction.Commit()
}

// SaveSectionVideo stores a new version of the section's video, numbered one past the section's latest in the same statement.
func (s *SqlTaskStore) SaveSectionVideo(video *model.TaskSectionVideo) (*model.TaskSectionVideo, error) {
	video.PreSave()
	err := s.GetMaster().Get(&video.Version, `INSERT INTO TaskSectionVideos (Id, SectionId, FileId, Version, CreatorId, CreateAt)
		SELECT $1, $2, $3, COALESCE(MAX(Version), 0) + 1, $4, $5 FROM TaskSectionVideos WHERE SectionId = $6
		RETURNING Version`, video.Id, video.SectionId, video.FileId, video.CreatorId, video.CreateAt, video.SectionId)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to save TaskSectionVideo for section_id=%s", video.SectionId)
	}
	return video, nil
}

func (s *SqlTaskStore) GetSectionVideos(sectionId string) ([]*model.TaskSectionVideo, error) {
	videos := []*model.TaskSectionVideo{}
	err := s.GetReplica().SelectBuilder(&videos, s.getQueryBuilder().
		Select("Id", "SectionId", "FileId", "Version", "CreatorId", "CreateAt").
		From("TaskSectionVideos").
		Where(sq.Eq{"SectionId": sectionId}).
		OrderBy("Version ASC"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskSectionVideos for section_id=%s", sectionId)
	}
	return videos, nil
}

func (s *SqlTaskStore) SaveComment(comment *model.TaskComment) (*model.TaskComment, error) {
	comment.PreSave()
	if err := comment.IsValid(); err != nil {
		return nil, err
	}

	_, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().
		Insert("TaskComments").
		Columns(taskCommentColumns...).
		Values(comment.Id, comment.TaskId, comment.UserId, comment.Message, comment.FileIds, comment.CreateAt))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to save TaskComment with id=%s", comment.Id)
	}
	return comment, nil
}

func (s *SqlTaskStore) GetComment(id string) (*model.TaskComment, error) {
	var comment model.TaskComment
	err := s.GetReplica().GetBuilder(&comment, s.getQueryBuilder().Select(taskCommentColumns...).From("TaskComments").Where(sq.Eq{"Id": id}))
	if err == sql.ErrNoRows {
		return nil, store.NewErrNotFound("TaskComment", id)
	} else if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskComment with id=%s", id)
	}
	return &comment, nil
}

func (s *SqlTaskStore) GetCommentsForTask(taskId string) ([]*model.TaskComment, error) {
	comments := []*model.TaskComment{}
	err := s.GetReplica().SelectBuilder(&comments, s.getQueryBuilder().
		Select(taskCommentColumns...).
		From("TaskComments").
		Where(sq.Eq{"TaskId": taskId}).
		OrderBy("CreateAt ASC", "Id ASC"))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get TaskComments for task_id=%s", taskId)
	}
	return comments, nil
}

// GetPostIdsForTask returns the ids of the live root posts naming a task, newest first, optionally in one channel
// and older than before.
func (s *SqlTaskStore) GetPostIdsForTask(taskId, channelId string, before int64, limit int) ([]string, error) {
	query := s.getQueryBuilder().
		Select("Id").
		From("Posts").
		Where(sq.Expr("Props->>'task_id' = ?", taskId)).
		Where(sq.Eq{"DeleteAt": 0, "RootId": ""}).
		OrderBy("CreateAt DESC").
		Limit(uint64(limit))
	if channelId != "" {
		query = query.Where(sq.Eq{"ChannelId": channelId})
	}
	if before > 0 {
		query = query.Where(sq.Lt{"CreateAt": before})
	}
	ids := []string{}
	if err := s.GetReplica().SelectBuilder(&ids, query); err != nil {
		return nil, errors.Wrapf(err, "failed to get post ids for task_id=%s", taskId)
	}
	return ids, nil
}

func (s *SqlTaskStore) DeleteComment(id string) error {
	if _, err := s.GetMaster().ExecBuilder(s.getQueryBuilder().Delete("TaskComments").Where(sq.Eq{"Id": id})); err != nil {
		return errors.Wrapf(err, "failed to delete TaskComment with id=%s", id)
	}
	return nil
}
