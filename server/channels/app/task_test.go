// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

func taskSession(th *TestHelper, admin bool) request.CTX {
	roles := "team_user"
	if admin {
		roles += " team_admin"
	}
	member := &model.TeamMember{TeamId: th.BasicTeam.Id, UserId: th.BasicUser.Id, Roles: roles}
	return th.Context.WithSession(&model.Session{UserId: th.BasicUser.Id, Roles: "system_user", TeamMembers: []*model.TeamMember{member}})
}

func TestPatchTaskRules(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	rev := newRevisionSection(t, th) // turns tasks on and gives a revision section
	mk := func(section, title string, waitsFor ...string) *model.Task {
		task, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, SectionId: section, CreatorId: th.BasicUser.Id, Title: title, WaitsFor: waitsFor}, "")
		require.Nil(t, appErr)
		return task
	}
	mkSection := func(name string) *model.TaskSection {
		s, appErr := th.App.CreateTaskSection(th.Context, &model.TaskSection{TeamId: th.BasicTeam.Id, Name: name}, "")
		require.Nil(t, appErr)
		return s
	}
	th.AddPermissionToRole(t, model.PermissionManageTasks.Id, model.TeamAdminRoleId) // fresh test databases may lack the migration
	member, manager := taskSession(th, false), taskSession(th, true)
	status := func(s string) *model.TaskPatch { return &model.TaskPatch{Status: &s} }
	waits := func(ids ...string) *model.TaskPatch {
		w := model.StringArray(ids)
		return &model.TaskPatch{WaitsFor: &w}
	}
	reload := func(id string) *model.Task {
		task, appErr := th.App.GetTask(id)
		require.Nil(t, appErr)
		return task
	}
	requireErr := func(appErr *model.AppError, id string) {
		require.NotNil(t, appErr)
		require.Equal(t, id, appErr.Id)
		require.Equal(t, 400, appErr.StatusCode)
	}

	sectionS, sectionT := mkSection("S"), mkSection("T")
	a := mk(sectionS.Id, "A")
	b := mk(sectionS.Id, "B", a.Id)
	c := mk(sectionT.Id, "C")

	t.Run("lock", func(t *testing.T) {
		_, appErr := th.App.PatchTask(member, b, status(model.TaskStatusInProgress), "")
		requireErr(appErr, "app.task.locked.app_error")
		_, appErr = th.App.PatchTask(member, b, &model.TaskPatch{AssigneeId: &th.BasicUser.Id}, "")
		requireErr(appErr, "app.task.locked.app_error")
		_, appErr = th.App.PatchTask(manager, b, status(model.TaskStatusInProgress), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(manager, reload(b.Id), status(model.TaskStatusTodo), "")
		require.Nil(t, appErr)

		_, appErr = th.App.PatchTask(member, a, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusInProgress), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusTodo), "")
		require.Nil(t, appErr)

		// The start lock gates To do only; done waits for A from any column and for anyone.
		_, appErr = th.App.PatchTask(member, reload(a.Id), status(model.TaskStatusTodo), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusDone), "")
		requireErr(appErr, "app.task.waits_for_open.app_error")
		_, appErr = th.App.PatchTask(manager, reload(b.Id), status(model.TaskStatusInProgress), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusDone), "")
		requireErr(appErr, "app.task.waits_for_open.app_error")
		_, appErr = th.App.PatchTask(manager, reload(b.Id), status(model.TaskStatusDone), "")
		requireErr(appErr, "app.task.waits_for_open.app_error")
		require.Equal(t, model.TaskStatusInProgress, reload(b.Id).Status)

		_, appErr = th.App.PatchTask(member, reload(a.Id), status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(member, reload(b.Id), status(model.TaskStatusTodo), "")
		require.Nil(t, appErr)
	})

	t.Run("waits for validation", func(t *testing.T) {
		for _, ids := range [][]string{{c.Id}, {b.Id}, {a.Id, a.Id}, {"missing"}} {
			_, appErr := th.App.PatchTask(manager, reload(b.Id), waits(ids...), "")
			requireErr(appErr, "app.task.waits_for.app_error")
		}
		_, appErr := th.App.PatchTask(manager, reload(a.Id), waits(b.Id), "")
		requireErr(appErr, "app.task.waits_for.app_error")
		saved, appErr := th.App.PatchTask(manager, reload(a.Id), waits(), "")
		require.Nil(t, appErr)
		require.Equal(t, model.StringArray{}, saved.WaitsFor)
	})

	t.Run("section move and delete drop links", func(t *testing.T) {
		moved, appErr := th.App.PatchTask(manager, reload(a.Id), &model.TaskPatch{SectionId: &sectionT.Id}, "")
		require.Nil(t, appErr)
		require.Equal(t, model.StringArray{}, moved.WaitsFor)
		require.Equal(t, model.StringArray{}, reload(b.Id).WaitsFor)

		d := mk(sectionS.Id, "D")
		e := mk(sectionS.Id, "E", d.Id)
		require.Nil(t, th.App.DeleteTask(manager, d, ""))
		require.Equal(t, model.StringArray{}, reload(e.Id).WaitsFor)
	})

	t.Run("revisions take no rules", func(t *testing.T) {
		rev = uploadVersion(t, th, rev, "clip")
		revision := mk(rev.Id, "R")
		clone := *revision
		clone.VideoFileId = rev.VideoFileId
		revision, err := th.App.Srv().Store().Task().Update(&clone)
		require.NoError(t, err)
		dept := model.NewId()
		_, appErr := th.App.PatchTask(manager, revision, &model.TaskPatch{DepartmentId: &dept}, "")
		requireErr(appErr, "app.task.revision_rules.app_error")
	})
}

func TestTaskApprovalAndSubtasks(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	newRevisionSection(t, th) // turns tasks on
	setApproval := func(on bool) {
		team, appErr := th.App.GetTeam(th.BasicTeam.Id)
		require.Nil(t, appErr)
		clone := *team
		clone.TaskApprovalEnabled = on
		_, err := th.App.Srv().Store().Team().Update(&clone)
		require.NoError(t, err)
	}
	mk := func(title, parentID string) *model.Task {
		task, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, CreatorId: th.BasicUser.Id, Title: title, ParentId: parentID}, "")
		require.Nil(t, appErr)
		return task
	}
	reload := func(id string) *model.Task {
		task, appErr := th.App.GetTask(id)
		require.Nil(t, appErr)
		return task
	}
	status := func(s string) *model.TaskPatch { return &model.TaskPatch{Status: &s} }
	requireErr := func(appErr *model.AppError, id string) {
		require.NotNil(t, appErr)
		require.Equal(t, id, appErr.Id)
	}
	act := func(task *model.Task, action string) (*model.Task, *model.AppError) {
		return th.App.ApplyTaskApproval(th.Context, reload(task.Id), action, "")
	}

	t.Run("without approval done is complete at once", func(t *testing.T) {
		setApproval(false)
		task := mk("plain", "")
		done, appErr := th.App.PatchTask(th.Context, task, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		require.Equal(t, model.TaskApprovalApproved, done.ApprovalStatus)
		reopened, appErr := th.App.PatchTask(th.Context, done, status(model.TaskStatusTodo), "")
		require.Nil(t, appErr, "without the chain an approval on arrival does not lock")
		require.Equal(t, "", reopened.ApprovalStatus)
	})

	t.Run("approval chain", func(t *testing.T) {
		setApproval(true)
		task := mk("chained", "")
		done, appErr := th.App.PatchTask(th.Context, task, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		require.Equal(t, model.TaskApprovalPendingSupervisor, done.ApprovalStatus)

		_, appErr = act(task, model.TaskApprovalActionRevert)
		requireErr(appErr, "app.task.approval_invalid.app_error")

		step, appErr := act(task, model.TaskApprovalActionApprove)
		require.Nil(t, appErr)
		require.Equal(t, model.TaskApprovalPendingDirector, step.ApprovalStatus)

		rejected, appErr := act(task, model.TaskApprovalActionReject)
		require.Nil(t, appErr)
		require.Equal(t, model.TaskApprovalRejected, rejected.ApprovalStatus)
		require.Equal(t, model.TaskStatusInProgress, rejected.Status)

		// Back to done restarts the chain.
		redone, appErr := th.App.PatchTask(th.Context, rejected, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		require.Equal(t, model.TaskApprovalPendingSupervisor, redone.ApprovalStatus)
		_, appErr = act(task, model.TaskApprovalActionApprove)
		require.Nil(t, appErr)
		approved, appErr := act(task, model.TaskApprovalActionApprove)
		require.Nil(t, appErr)
		require.True(t, approved.IsComplete())

		_, appErr = th.App.PatchTask(th.Context, approved, &model.TaskPatch{AssigneeId: &th.BasicUser2.Id}, "")
		requireErr(appErr, "app.task.approved_locked.app_error")
		title := "renamed"
		_, appErr = th.App.PatchTask(th.Context, approved, &model.TaskPatch{Title: &title}, "")
		require.Nil(t, appErr)

		reverted, appErr := act(task, model.TaskApprovalActionRevert)
		require.Nil(t, appErr)
		require.Equal(t, "", reverted.ApprovalStatus)
		require.Equal(t, model.TaskStatusInProgress, reverted.Status)

		// Leaving done before approval clears the stage.
		pending, appErr := th.App.PatchTask(th.Context, reverted, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		left, appErr := th.App.PatchTask(th.Context, pending, status(model.TaskStatusTodo), "")
		require.Nil(t, appErr)
		require.Equal(t, "", left.ApprovalStatus)
	})

	t.Run("waits-for counts only complete tasks", func(t *testing.T) {
		setApproval(true)
		first, second := mk("first", ""), mk("second", "")
		_, appErr := th.App.PatchTask(th.Context, first, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		waiting := *second
		waiting.WaitsFor = model.StringArray{first.Id}
		require.Len(t, th.App.taskLocked(&waiting, tasksByID([]*model.Task{reload(first.Id)})), 1)
	})

	t.Run("subtasks", func(t *testing.T) {
		setApproval(false)
		parent := mk("parent", "")
		child := mk("child", parent.Id)
		require.Equal(t, parent.Id, child.ParentId)

		_, appErr := th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, CreatorId: th.BasicUser.Id, Title: "grandchild", ParentId: child.Id}, "")
		requireErr(appErr, "app.task.invalid_parent.app_error")
		other := mk("other", "")
		_, appErr = th.App.PatchTask(th.Context, parent, &model.TaskPatch{ParentId: &other.Id}, "")
		requireErr(appErr, "app.task.invalid_parent.app_error")

		_, appErr = th.App.PatchTask(th.Context, parent, status(model.TaskStatusDone), "")
		requireErr(appErr, "app.task.subtasks_open.app_error")
		_, appErr = th.App.PatchTask(th.Context, child, status(model.TaskStatusDone), "")
		require.Nil(t, appErr)
		_, appErr = th.App.PatchTask(th.Context, reload(parent.Id), status(model.TaskStatusDone), "")
		require.Nil(t, appErr)

		_, appErr = th.App.CreateTask(th.Context, &model.Task{TeamId: th.BasicTeam.Id, CreatorId: th.BasicUser.Id, Title: "late", ParentId: parent.Id}, "")
		requireErr(appErr, "app.task.parent_done.app_error")
		_, appErr = act(child, model.TaskApprovalActionRevert)
		requireErr(appErr, "app.task.parent_done.app_error")

		require.Nil(t, th.App.DeleteTask(th.Context, reload(parent.Id), ""))
		require.Equal(t, "", reload(child.Id).ParentId)
	})

	t.Run("approval waits for subtasks", func(t *testing.T) {
		setApproval(true)
		parent := mk("approval parent", "")
		mk("approval child", parent.Id)
		_, appErr := th.App.PatchTask(th.Context, parent, status(model.TaskStatusDone), "")
		requireErr(appErr, "app.task.subtasks_open.app_error")
	})
}
