// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// DriveAction is what a caller wants to do in a channel drive.
type DriveAction int

const (
	DriveRead DriveAction = iota
	DriveCreate
	DriveModify
)

const (
	driveListLimit   = 2000
	drivePurgeBatch  = 1000
	driveZipMaxBytes = 200 * 1024 * 1024
)

type driveItemState int

const (
	driveLive driveItemState = iota
	driveTrashed
	driveAnyState
)

type DriveListing = model.DriveListing

func driveError(where, id string, status int) *model.AppError {
	return model.NewAppError(where, "app.drive."+id+".app_error", nil, "", status)
}

func driveStoreError(where string, err error) *model.AppError {
	var appErr *model.AppError
	var nf *store.ErrNotFound
	var conflict *store.ErrConflict
	var unique *store.ErrUniqueConstraint
	switch {
	case errors.As(err, &appErr):
		return appErr
	case errors.As(err, &nf):
		return driveError(where, "not_found", http.StatusNotFound).Wrap(err)
	case errors.As(err, &conflict):
		return driveError(where, "name_exists", http.StatusBadRequest).Wrap(err)
	case errors.As(err, &unique):
		return driveError(where, "invalid_file", http.StatusBadRequest).Wrap(err)
	}
	return driveError(where, "store", http.StatusInternalServerError).Wrap(err)
}

// RequireDriveChannel returns the channel when its team has the file drive turned on.
func (a *App) RequireDriveChannel(rctx request.CTX, channelID string) (*model.Channel, *model.AppError) {
	channel, appErr := a.GetChannel(rctx, channelID)
	if appErr != nil {
		return nil, appErr
	}
	disabled := model.NewAppError("RequireDriveChannel", "app.drive.disabled.app_error", nil, "channel_id="+channelID, http.StatusForbidden)
	if channel.IsGroupOrDirect() || channel.TeamId == "" {
		return nil, disabled
	}
	team, appErr := a.GetTeam(channel.TeamId)
	if appErr != nil {
		return nil, appErr
	}
	if !team.FilesEnabled || team.DeleteAt > 0 {
		return nil, disabled
	}
	return channel, nil
}

// DriveCan applies the drive permission rules; item is required for DriveModify.
func (a *App) DriveCan(rctx request.CTX, session model.Session, channel *model.Channel, action DriveAction, item *model.DriveItem) bool {
	if ok, _ := a.SessionHasPermissionToReadChannel(rctx, session, channel); !ok {
		return false
	}
	if !a.HasPermissionToChannelAction(rctx, session.UserId, session.Roles, channel.Id, model.AccessControlPolicyActionDownloadFileAttachment) {
		return false
	}
	if action == DriveRead {
		return true
	}
	if channel.DeleteAt > 0 {
		return false
	}
	if ok, _ := a.SessionHasPermissionToChannel(rctx, session, channel.Id, model.PermissionUploadFile); !ok {
		return false
	}
	if action == DriveCreate {
		return true
	}
	if item == nil {
		return false
	}
	if ok, _ := a.SessionHasPermissionToChannel(rctx, session, channel.Id, model.PermissionManageChannelRoles); ok {
		return true
	}
	if item.CreatorId != session.UserId {
		return false
	}
	if item.IsFolder() {
		descendants, err := a.Srv().Store().DriveItem().GetDescendants(channel.Id, item.Id)
		if err != nil {
			rctx.Logger().Warn("Failed to read drive folder contents", mlog.String("item_id", item.Id), mlog.Err(err))
			return false
		}
		for _, d := range descendants {
			if d.CreatorId != session.UserId {
				return false
			}
		}
	}
	return true
}

// driveFolderPath validates parentID as a live folder of channel and returns root→parent.
func (a *App) driveFolderPath(channel *model.Channel, parentID string) ([]*model.DriveItem, *model.AppError) {
	if parentID == "" {
		return []*model.DriveItem{}, nil
	}
	invalid := driveError("driveFolderPath", "invalid_parent", http.StatusBadRequest)
	parent, err := a.Srv().Store().DriveItem().Get(parentID)
	if err != nil {
		var nf *store.ErrNotFound
		if errors.As(err, &nf) {
			return nil, invalid
		}
		return nil, driveStoreError("driveFolderPath", err)
	}
	if !parent.IsFolder() || parent.ChannelId != channel.Id || parent.DeleteAt > 0 {
		return nil, invalid
	}
	ancestors, err := a.Srv().Store().DriveItem().GetAncestors(parent.Id)
	if err != nil {
		return nil, driveStoreError("driveFolderPath", err)
	}
	for _, anc := range ancestors {
		if anc.DeleteAt > 0 {
			return nil, invalid
		}
	}
	return append(ancestors, parent), nil
}

// getDriveItems loads ids, which must all belong to channel and be in the wanted state.
func (a *App) getDriveItems(channel *model.Channel, ids []string, state driveItemState) ([]*model.DriveItem, *model.AppError) {
	unique := map[string]bool{}
	for _, id := range ids {
		unique[id] = true
	}
	items, err := a.Srv().Store().DriveItem().GetMany(ids)
	if err != nil {
		return nil, driveStoreError("getDriveItems", err)
	}
	if len(items) != len(unique) {
		return nil, driveError("getDriveItems", "not_found", http.StatusNotFound)
	}
	for _, it := range items {
		if it.ChannelId != channel.Id || (state == driveLive && it.DeleteAt > 0) || (state == driveTrashed && it.DeleteAt == 0) {
			return nil, driveError("getDriveItems", "not_found", http.StatusNotFound)
		}
	}
	return items, nil
}

// GetDriveItem loads one live item of channel.
func (a *App) GetDriveItem(channel *model.Channel, id string) (*model.DriveItem, *model.AppError) {
	items, appErr := a.getDriveItems(channel, []string{id}, driveLive)
	if appErr != nil {
		return nil, appErr
	}
	return items[0], nil
}

// uniqueDriveName returns name, or "name (2).ext", "name (3).ext"… when it is taken in the
// folder or by an earlier item of the same batch (taken, may be nil).
func (a *App) uniqueDriveName(channelID, parentID, name string, isFolder bool, taken map[string]bool) (string, *model.AppError) {
	base, ext := name, ""
	if !isFolder {
		if i := strings.LastIndex(name, "."); i > 0 {
			base, ext = name[:i], name[i:]
		}
	}
	for n := 1; n < 10000; n++ {
		candidate := name
		if n > 1 {
			candidate = base + " (" + strconv.Itoa(n) + ")" + ext
		}
		if taken[strings.ToLower(candidate)] {
			continue
		}
		exists, err := a.Srv().Store().DriveItem().NameExists(channelID, parentID, candidate, "")
		if err != nil {
			return "", driveStoreError("uniqueDriveName", err)
		}
		if !exists {
			if taken != nil {
				taken[strings.ToLower(candidate)] = true
			}
			return candidate, nil
		}
	}
	return "", driveError("uniqueDriveName", "name_exists", http.StatusBadRequest)
}

// saveDriveItem saves item under its name, or the next free "name (n)". A concurrent save can take
// the name between the check and the insert; the unique index refuses it and the next number is tried.
func (a *App) saveDriveItem(item *model.DriveItem, taken map[string]bool) (*model.DriveItem, *model.AppError) {
	want := item.Name
	for range 20 {
		name, appErr := a.uniqueDriveName(item.ChannelId, item.ParentId, want, item.IsFolder(), taken)
		if appErr != nil {
			return nil, appErr
		}
		item.Name = name
		saved, err := a.Srv().Store().DriveItem().Save(item)
		if conflict := new(store.ErrConflict); !errors.As(err, &conflict) {
			if err != nil {
				return nil, driveStoreError("saveDriveItem", err)
			}
			return saved, nil
		}
	}
	return nil, driveError("saveDriveItem", "name_exists", http.StatusBadRequest)
}

// driveSafeName turns an uploaded file name into a valid drive item name.
func driveSafeName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, name)
	if utf8.RuneCountInString(name) > model.DriveItemNameMaxRunes {
		name = string([]rune(name)[:model.DriveItemNameMaxRunes])
	}
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if !model.IsValidDriveItemName(name) {
		return "file"
	}
	return name
}

// syncDriveFileName keeps FileInfo.Name (used for downloads) equal to the drive item name.
func (a *App) syncDriveFileName(rctx request.CTX, item *model.DriveItem) *model.AppError {
	if item.IsFolder() {
		return nil
	}
	info, err := a.Srv().Store().FileInfo().Get(item.FileId)
	if err != nil {
		return driveStoreError("syncDriveFileName", err)
	}
	if info.Name == item.Name {
		return nil
	}
	info.Name = item.Name
	info.Extension = strings.ToLower(strings.TrimPrefix(path.Ext(item.Name), "."))
	if _, err := a.Srv().Store().FileInfo().Upsert(rctx, info); err != nil {
		return driveStoreError("syncDriveFileName", err)
	}
	return nil
}

func (a *App) publishDriveChanged(channelID string, parentIDs ...string) {
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range parentIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	data, _ := json.Marshal(ids)
	message := model.NewWebSocketEvent(model.WebsocketEventDriveChanged, "", channelID, "", nil, "")
	message.Add("parent_ids", string(data))
	a.Publish(message)
}

// embedDriveFiles fills FileInfo on file items and drops those whose file is gone.
func (a *App) embedDriveFiles(items []*model.DriveItem) ([]*model.DriveItem, *model.AppError) {
	fileIDs := []string{}
	for _, it := range items {
		if !it.IsFolder() {
			fileIDs = append(fileIDs, it.FileId)
		}
	}
	infos := map[string]*model.FileInfo{}
	if len(fileIDs) > 0 {
		list, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, false, true, false)
		if err != nil {
			return nil, driveStoreError("embedDriveFiles", err)
		}
		for _, info := range list {
			infos[info.Id] = info
		}
	}
	out := make([]*model.DriveItem, 0, len(items))
	for _, it := range items {
		if !it.IsFolder() {
			if it.FileInfo = infos[it.FileId]; it.FileInfo == nil {
				continue
			}
		}
		out = append(out, it)
	}
	return out, nil
}

func (a *App) ListDriveFolder(rctx request.CTX, session model.Session, channel *model.Channel, parentID string) (*DriveListing, *model.AppError) {
	v, appErr := a.driveViewerFor(rctx, session, channel)
	if appErr != nil {
		return nil, appErr
	}
	folderPath, mirrored, appErr := a.driveReadPath(v, channel, parentID)
	if appErr != nil {
		return nil, appErr
	}
	listing := &DriveListing{Path: folderPath, Items: []*model.DriveItem{}}
	if mirrored {
		listing.Access = model.DriveAccessRead
	} else {
		switch _, w := driveRuleAccess(folderPath, v.depts); w { // for managers too: it picks the icon, not the permission
		case driveWriteAllowed:
			listing.Access = model.DriveAccessWrite
		case driveWriteDenied:
			listing.Access = model.DriveAccessRead
		}
	}
	listID := parentID
	if len(folderPath) > 0 {
		last := folderPath[len(folderPath)-1]
		listID = last.Id
		if last.MirrorOf != "" {
			listing.Access = model.DriveAccessRead
			listID = last.MirrorOf
			if _, appErr := a.driveFolderPath(channel, listID); appErr != nil {
				if appErr.StatusCode >= http.StatusInternalServerError {
					return nil, appErr
				}
				listing.SourceMissing = true // the source is gone, trashed or not in this channel
				return listing, nil
			}
		}
	}
	items, err := a.Srv().Store().DriveItem().GetChildren(channel.Id, listID, driveListLimit)
	if err != nil {
		return nil, driveStoreError("ListDriveFolder", err)
	}
	items = slices.DeleteFunc(items, func(it *model.DriveItem) bool {
		visible, _ := v.access([]*model.DriveItem{it})
		return it.IsFolder() && !visible
	})
	if listing.Items, appErr = a.embedDriveFiles(items); appErr != nil {
		return nil, appErr
	}
	return listing, nil
}

// driveVisibleTree returns the live items below root that v may see (folders whose own view excludes v are dropped
// with their subtrees); a mirror root yields its source's tree (empty when the source is gone).
func (a *App) driveVisibleTree(v *driveViewer, root *model.DriveItem) ([]*model.DriveItem, *model.AppError) {
	rootID := root.Id
	if root.MirrorOf != "" {
		rootID = root.MirrorOf
		if _, appErr := a.driveFolderPath(&model.Channel{Id: root.ChannelId}, rootID); appErr != nil {
			if appErr.StatusCode >= http.StatusInternalServerError {
				return nil, appErr
			}
			return nil, nil
		}
	}
	descendants, err := a.Srv().Store().DriveItem().GetDescendants(root.ChannelId, rootID)
	if err != nil {
		return nil, driveStoreError("driveVisibleTree", err)
	}
	children := map[string][]*model.DriveItem{}
	for _, d := range descendants {
		children[d.ParentId] = append(children[d.ParentId], d)
	}
	out := []*model.DriveItem{}
	var walk func(id string)
	walk = func(id string) {
		for _, c := range children[id] {
			if visible, _ := v.access([]*model.DriveItem{c}); !visible {
				continue
			}
			out = append(out, c)
			walk(c.Id)
		}
	}
	walk(rootID)
	return out, nil
}

// driveCheckReadable answers 404 unless v may read every item: its parent is reachable and, for a folder, its own
// view admits v.
func (a *App) driveCheckReadable(v *driveViewer, channel *model.Channel, items []*model.DriveItem) *model.AppError {
	parents := map[string]bool{}
	for _, it := range items {
		if !parents[it.ParentId] {
			if _, _, appErr := a.driveReadPath(v, channel, it.ParentId); appErr != nil {
				return appErr
			}
			parents[it.ParentId] = true
		}
		if visible, _ := v.access([]*model.DriveItem{it}); it.IsFolder() && !visible {
			return driveError("driveCheckReadable", "not_found", http.StatusNotFound)
		}
	}
	return nil
}

func (a *App) CreateDriveFolder(rctx request.CTX, userID string, channel *model.Channel, parentID, name string) (*model.DriveItem, *model.AppError) {
	if !model.IsValidDriveItemName(name) {
		return nil, driveError("CreateDriveFolder", "invalid_name", http.StatusBadRequest)
	}
	if _, appErr := a.driveFolderPath(channel, parentID); appErr != nil {
		return nil, appErr
	}
	item, appErr := a.saveDriveItem(&model.DriveItem{ChannelId: channel.Id, ParentId: parentID, Type: model.DriveItemTypeFolder, Name: name, CreatorId: userID}, nil)
	if appErr != nil {
		return nil, appErr
	}
	a.publishDriveChanged(channel.Id, parentID)
	return item, nil
}

// AddDriveFile places the caller's fresh, unattached upload into the drive.
func (a *App) AddDriveFile(rctx request.CTX, userID string, channel *model.Channel, parentID, fileID string) (*model.DriveItem, *model.AppError) {
	info, err := a.Srv().Store().FileInfo().Get(fileID)
	if err != nil {
		return nil, driveStoreError("AddDriveFile", err)
	}
	if info.CreatorId != userID || info.PostId != "" || info.ChannelId != channel.Id || info.DeleteAt != 0 {
		return nil, driveError("AddDriveFile", "invalid_file", http.StatusBadRequest)
	}
	if _, err = a.Srv().Store().DriveItem().GetByFileId(fileID); err == nil {
		return nil, driveError("AddDriveFile", "invalid_file", http.StatusBadRequest)
	} else if nf := new(store.ErrNotFound); !errors.As(err, &nf) {
		return nil, driveStoreError("AddDriveFile", err)
	}
	if _, appErr := a.driveFolderPath(channel, parentID); appErr != nil {
		return nil, appErr
	}
	item, appErr := a.saveDriveItem(&model.DriveItem{ChannelId: channel.Id, ParentId: parentID, Type: model.DriveItemTypeFile, Name: driveSafeName(info.Name), FileId: fileID, CreatorId: userID}, nil)
	if appErr != nil {
		return nil, appErr
	}
	if appErr := a.syncDriveFileName(rctx, item); appErr != nil {
		return nil, appErr
	}
	a.publishDriveChanged(channel.Id, parentID)
	return item, nil
}

func (a *App) RenameDriveItem(rctx request.CTX, item *model.DriveItem, name string) (*model.DriveItem, *model.AppError) {
	if !model.IsValidDriveItemName(name) {
		return nil, driveError("RenameDriveItem", "invalid_name", http.StatusBadRequest)
	}
	exists, err := a.Srv().Store().DriveItem().NameExists(item.ChannelId, item.ParentId, name, item.Id)
	if err != nil {
		return nil, driveStoreError("RenameDriveItem", err)
	}
	if exists {
		return nil, driveError("RenameDriveItem", "name_exists", http.StatusBadRequest)
	}
	item.Name = name
	updated, err := a.Srv().Store().DriveItem().Update(item)
	if err != nil {
		return nil, driveStoreError("RenameDriveItem", err)
	}
	if appErr := a.syncDriveFileName(rctx, updated); appErr != nil {
		return nil, appErr
	}
	a.publishDriveChanged(item.ChannelId, item.ParentId)
	return updated, nil
}

func (a *App) MoveDriveItems(rctx request.CTX, session model.Session, src *model.Channel, ids []string, dst *model.Channel, dstParentID string) *model.AppError {
	items, appErr := a.getDriveItems(src, ids, driveLive)
	if appErr != nil {
		return appErr
	}
	for _, it := range items {
		if !a.DriveCan(rctx, session, src, DriveModify, it) {
			return driveError("MoveDriveItems", "forbidden", http.StatusForbidden)
		}
	}
	cross := dst.Id != src.Id
	if cross && !a.DriveCan(rctx, session, dst, DriveCreate, nil) {
		return driveError("MoveDriveItems", "forbidden", http.StatusForbidden)
	}
	dstPath, appErr := a.driveFolderPath(dst, dstParentID)
	if appErr != nil {
		return appErr
	}
	moving := map[string]bool{}
	for _, it := range items {
		moving[it.Id] = true
	}
	for _, p := range dstPath {
		if moving[p.Id] {
			return driveError("MoveDriveItems", "move_into_self", http.StatusBadRequest)
		}
	}

	changed := map[string]*model.DriveItem{}
	order := []*model.DriveItem{}
	oldParents := []string{}
	taken := map[string]bool{}
	for _, it := range items {
		if it.ParentId == dstParentID && !cross {
			continue
		}
		oldParents = append(oldParents, it.ParentId)
		name, appErr := a.uniqueDriveName(dst.Id, dstParentID, it.Name, it.IsFolder(), taken)
		if appErr != nil {
			return appErr
		}
		it.Name, it.ParentId, it.ChannelId = name, dstParentID, dst.Id
		changed[it.Id] = it
		order = append(order, it)
	}
	if cross {
		for _, it := range items {
			if !it.IsFolder() {
				continue
			}
			descendants, err := a.Srv().Store().DriveItem().GetDescendants(src.Id, it.Id)
			if err != nil {
				return driveStoreError("MoveDriveItems", err)
			}
			for _, d := range descendants {
				if c, ok := changed[d.Id]; ok {
					c.ChannelId = dst.Id
					continue
				}
				d.ChannelId = dst.Id
				changed[d.Id] = d
				order = append(order, d)
			}
		}
	}
	if len(order) == 0 {
		return nil
	}
	if err := a.Srv().Store().DriveItem().UpdateMany(order); err != nil {
		return driveStoreError("MoveDriveItems", err)
	}
	for _, it := range order {
		if it.IsFolder() {
			continue
		}
		if cross {
			if err := a.Srv().Store().FileInfo().SetChannelId(rctx, it.FileId, dst.Id); err != nil {
				return driveStoreError("MoveDriveItems", err)
			}
		}
		if appErr := a.syncDriveFileName(rctx, it); appErr != nil {
			return appErr
		}
	}
	a.publishDriveChanged(src.Id, oldParents...)
	if cross {
		a.publishDriveChanged(dst.Id, dstParentID)
	} else {
		a.publishDriveChanged(src.Id, dstParentID)
	}
	return nil
}

// copyDriveFile duplicates the bytes of info into the upload layout of dst and adds the copy.
func (a *App) copyDriveFile(rctx request.CTX, userID string, info *model.FileInfo, dst *model.Channel, parentID, name string, taken map[string]bool) *model.AppError {
	name, appErr := a.uniqueDriveName(dst.Id, parentID, driveSafeName(name), false, taken)
	if appErr != nil {
		return appErr
	}
	cp := *info
	cp.Id = model.NewId()
	cp.CreatorId, cp.ChannelId, cp.PostId = userID, dst.Id, ""
	cp.CreateAt, cp.UpdateAt, cp.DeleteAt = 0, 0, 0
	cp.RemoteId = nil
	cp.Name = name
	cp.Extension = strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))

	prefix := time.Now().Format("20060102") + "/teams/noteam/channels/" + dst.Id + "/users/" + userID + "/" + cp.Id + "/"
	written := []string{}
	cleanup := func() {
		for _, p := range written {
			if err := a.RemoveFile(p); err != nil {
				rctx.Logger().Warn("Failed to remove partial drive copy", mlog.String("path", p), mlog.Err(err))
			}
		}
	}
	for _, p := range []*string{&cp.Path, &cp.PreviewPath, &cp.ThumbnailPath} {
		if *p == "" {
			continue
		}
		to := prefix + path.Base(*p)
		if err := a.FileBackend().CopyFile(*p, to); err != nil {
			cleanup()
			return driveError("copyDriveFile", "copy", http.StatusInternalServerError).Wrap(err)
		}
		written = append(written, to)
		*p = to
	}
	if _, err := a.Srv().Store().FileInfo().Save(rctx, &cp); err != nil {
		cleanup()
		return driveStoreError("copyDriveFile", err)
	}
	item, appErr := a.saveDriveItem(&model.DriveItem{ChannelId: dst.Id, ParentId: parentID, Type: model.DriveItemTypeFile, Name: name, FileId: cp.Id, CreatorId: userID}, nil)
	if appErr != nil {
		cleanup()
		return appErr
	}
	if item.Name != name {
		return a.syncDriveFileName(rctx, item)
	}
	return nil
}

func (a *App) copyDriveTree(rctx request.CTX, userID string, v *driveViewer, item *model.DriveItem, dst *model.Channel, parentID string, taken map[string]bool) *model.AppError {
	children := map[string][]*model.DriveItem{}
	rootID := item.Id // children of a mirror hang below its source
	if item.MirrorOf != "" {
		rootID = item.MirrorOf
	}
	if item.IsFolder() {
		descendants, appErr := a.driveVisibleTree(v, item)
		if appErr != nil {
			return appErr
		}
		for _, d := range descendants {
			children[d.ParentId] = append(children[d.ParentId], d)
		}
	}
	var walk func(it *model.DriveItem, parentID string, taken map[string]bool) *model.AppError
	walk = func(it *model.DriveItem, parentID string, taken map[string]bool) *model.AppError {
		if !it.IsFolder() {
			info, err := a.Srv().Store().FileInfo().Get(it.FileId)
			if err != nil {
				return driveStoreError("copyDriveTree", err)
			}
			return a.copyDriveFile(rctx, userID, info, dst, parentID, it.Name, taken)
		}
		folder, appErr := a.saveDriveItem(&model.DriveItem{ChannelId: dst.Id, ParentId: parentID, Type: model.DriveItemTypeFolder, Name: it.Name, CreatorId: userID}, taken)
		if appErr != nil {
			return appErr
		}
		inner := map[string]bool{}
		id := it.Id
		if it == item {
			id = rootID
		}
		for _, c := range children[id] {
			if appErr := walk(c, folder.Id, inner); appErr != nil {
				return appErr
			}
		}
		return nil
	}
	return walk(item, parentID, taken)
}

// CopyDriveItems copies drive items and chat attachments of src into dst; every copy owns its bytes.
func (a *App) CopyDriveItems(rctx request.CTX, session model.Session, src *model.Channel, ids, chatFileIDs []string, dst *model.Channel, dstParentID string) *model.AppError {
	if !a.DriveCan(rctx, session, src, DriveRead, nil) || !a.DriveCan(rctx, session, dst, DriveCreate, nil) {
		return driveError("CopyDriveItems", "forbidden", http.StatusForbidden)
	}
	if _, appErr := a.driveFolderPath(dst, dstParentID); appErr != nil {
		return appErr
	}
	v, appErr := a.driveViewerFor(rctx, session, src)
	if appErr != nil {
		return appErr
	}
	var items []*model.DriveItem
	if len(ids) > 0 {
		if items, appErr = a.getDriveItems(src, ids, driveLive); appErr != nil {
			return appErr
		}
		if appErr = a.driveCheckReadable(v, src, items); appErr != nil {
			return appErr
		}
	}
	var chatFiles []*model.FileInfo
	if len(chatFileIDs) > 0 {
		var err error
		if chatFiles, err = a.Srv().Store().FileInfo().GetByIds(chatFileIDs, false, false, true); err != nil {
			return driveStoreError("CopyDriveItems", err)
		}
		if len(chatFiles) != len(chatFileIDs) {
			return driveError("CopyDriveItems", "not_found", http.StatusNotFound)
		}
		for _, info := range chatFiles {
			if info.ChannelId != src.Id || info.DeleteAt != 0 || (info.PostId == "" && info.CreatorId != model.BookmarkFileOwner) {
				return driveError("CopyDriveItems", "forbidden", http.StatusForbidden)
			}
			if info.PostId == "" {
				continue
			}
			// burn-on-read posts keep their content in TemporaryPosts; their files never leave chat
			_, err := a.Srv().Store().TemporaryPost().Get(rctx, info.PostId, false)
			if err == nil {
				return driveError("CopyDriveItems", "forbidden", http.StatusForbidden)
			}
			if nf := new(store.ErrNotFound); !errors.As(err, &nf) {
				return driveStoreError("CopyDriveItems", err)
			}
		}
	}

	taken := map[string]bool{}
	for _, it := range items {
		if appErr := a.copyDriveTree(rctx, session.UserId, v, it, dst, dstParentID, taken); appErr != nil {
			return appErr
		}
	}
	for _, info := range chatFiles {
		if appErr := a.copyDriveFile(rctx, session.UserId, info, dst, dstParentID, info.Name, taken); appErr != nil {
			return appErr
		}
	}
	a.publishDriveChanged(dst.Id, dstParentID)
	return nil
}

// permanentDeleteDriveItems removes the subtrees of roots, their FileInfos and their bytes.
func (a *App) permanentDeleteDriveItems(rctx request.CTX, roots []*model.DriveItem) *model.AppError {
	all := map[string]*model.DriveItem{}
	for _, r := range roots {
		all[r.Id] = r
		if !r.IsFolder() {
			continue
		}
		descendants, err := a.Srv().Store().DriveItem().GetDescendants(r.ChannelId, r.Id)
		if err != nil {
			return driveStoreError("permanentDeleteDriveItems", err)
		}
		for _, d := range descendants {
			all[d.Id] = d
		}
	}
	ids := make([]string, 0, len(all))
	fileIDs := []string{}
	for id, it := range all {
		ids = append(ids, id)
		if !it.IsFolder() {
			fileIDs = append(fileIDs, it.FileId)
		}
	}
	if len(fileIDs) > 0 {
		infos, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, true, false, true)
		if err != nil {
			return driveStoreError("permanentDeleteDriveItems", err)
		}
		now := model.GetMillis()
		for _, info := range infos {
			if info.DeleteAt == 0 {
				info.DeleteAt = now
				if _, err := a.Srv().Store().FileInfo().Upsert(rctx, info); err != nil {
					return driveStoreError("permanentDeleteDriveItems", err)
				}
			}
			for _, p := range []string{info.Path, info.PreviewPath, info.ThumbnailPath} {
				if p == "" {
					continue
				}
				if appErr := a.RemoveFile(p); appErr != nil {
					rctx.Logger().Warn("Failed to remove drive file", mlog.String("path", p), mlog.Err(appErr))
				}
			}
		}
	}
	if err := a.Srv().Store().DriveItem().PermanentDelete(ids); err != nil {
		return driveStoreError("permanentDeleteDriveItems", err)
	}
	return nil
}

// DeleteDriveItems moves items to the trash, or deletes them for good when permanent is set.
func (a *App) DeleteDriveItems(rctx request.CTX, session model.Session, channel *model.Channel, ids []string, permanent bool) *model.AppError {
	state := driveLive
	if permanent {
		state = driveAnyState
	}
	items, appErr := a.getDriveItems(channel, ids, state)
	if appErr != nil {
		return appErr
	}
	parents := []string{}
	for _, it := range items {
		if !a.DriveCan(rctx, session, channel, DriveModify, it) {
			return driveError("DeleteDriveItems", "forbidden", http.StatusForbidden)
		}
		parents = append(parents, it.ParentId)
	}
	if permanent {
		if appErr := a.permanentDeleteDriveItems(rctx, items); appErr != nil {
			return appErr
		}
	} else {
		now := model.GetMillis()
		for _, it := range items {
			it.DeleteAt, it.DeletedBy = now, session.UserId
		}
		if err := a.Srv().Store().DriveItem().UpdateMany(items); err != nil {
			return driveStoreError("DeleteDriveItems", err)
		}
	}
	a.publishDriveChanged(channel.Id, parents...)
	return nil
}

func (a *App) GetDriveTrash(rctx request.CTX, session model.Session, channel *model.Channel) ([]*model.DriveItem, *model.AppError) {
	v, appErr := a.driveViewerFor(rctx, session, channel)
	if appErr != nil {
		return nil, appErr
	}
	items, err := a.Srv().Store().DriveItem().GetTrash(channel.Id)
	if err != nil {
		return nil, driveStoreError("GetDriveTrash", err)
	}
	if !v.manager {
		kept := items[:0]
		for _, it := range items {
			// shortcut: one query per trashed item, batch if the bin gets large
			path, err := a.Srv().Store().DriveItem().GetAncestors(it.Id)
			if err != nil {
				return nil, driveStoreError("GetDriveTrash", err)
			}
			if it.IsFolder() {
				path = append(path, it)
			}
			if visible, _ := v.access(path); visible {
				kept = append(kept, it)
			}
		}
		items = kept
	}
	return a.embedDriveFiles(items)
}

// RestoreDriveItems brings trashed items back to their folder, or to the root when it is gone.
func (a *App) RestoreDriveItems(rctx request.CTX, session model.Session, channel *model.Channel, ids []string) *model.AppError {
	items, appErr := a.getDriveItems(channel, ids, driveTrashed)
	if appErr != nil {
		return appErr
	}
	taken := map[string]map[string]bool{}
	parents := []string{}
	for _, it := range items {
		if !a.DriveCan(rctx, session, channel, DriveModify, it) {
			return driveError("RestoreDriveItems", "forbidden", http.StatusForbidden)
		}
		parentID := it.ParentId
		if _, appErr := a.driveFolderPath(channel, parentID); appErr != nil {
			if appErr.StatusCode >= http.StatusInternalServerError {
				return appErr
			}
			parentID = ""
		}
		if taken[parentID] == nil {
			taken[parentID] = map[string]bool{}
		}
		name, appErr := a.uniqueDriveName(channel.Id, parentID, it.Name, it.IsFolder(), taken[parentID])
		if appErr != nil {
			return appErr
		}
		it.ParentId, it.Name, it.DeleteAt, it.DeletedBy = parentID, name, 0, ""
		parents = append(parents, parentID)
	}
	if err := a.Srv().Store().DriveItem().UpdateMany(items); err != nil {
		return driveStoreError("RestoreDriveItems", err)
	}
	for _, it := range items {
		if appErr := a.syncDriveFileName(rctx, it); appErr != nil {
			return appErr
		}
	}
	a.publishDriveChanged(channel.Id, parents...)
	return nil
}

// EmptyDriveTrash permanently deletes the trashed items the caller may modify.
func (a *App) EmptyDriveTrash(rctx request.CTX, session model.Session, channel *model.Channel) *model.AppError {
	trash, err := a.Srv().Store().DriveItem().GetTrash(channel.Id)
	if err != nil {
		return driveStoreError("EmptyDriveTrash", err)
	}
	mine := []*model.DriveItem{}
	for _, it := range trash {
		if a.DriveCan(rctx, session, channel, DriveModify, it) {
			mine = append(mine, it)
		}
	}
	if len(mine) == 0 {
		return nil
	}
	if appErr := a.permanentDeleteDriveItems(rctx, mine); appErr != nil {
		return appErr
	}
	a.publishDriveChanged(channel.Id)
	return nil
}

// GetDriveChatFiles lists the files posted in the channel's chat (the read-only chat folder).
func (a *App) GetDriveChatFiles(rctx request.CTX, channelID string, page, perPage int, sortBy string, desc bool) ([]*model.FileInfo, *model.AppError) {
	return a.GetFileInfos(rctx, page, perPage, &model.GetFileInfosOptions{
		ChannelIds:          []string{channelID},
		ChatAttachmentsOnly: true,
		SortBy:              sortBy,
		SortDescending:      desc,
	})
}

// WriteDriveZip streams the selected items as a zip, keeping folder paths.
func (a *App) WriteDriveZip(rctx request.CTX, session model.Session, channel *model.Channel, ids []string, w io.Writer) *model.AppError {
	if !a.DriveCan(rctx, session, channel, DriveRead, nil) {
		return driveError("WriteDriveZip", "forbidden", http.StatusForbidden)
	}
	items, appErr := a.getDriveItems(channel, ids, driveLive)
	if appErr != nil {
		return appErr
	}
	v, appErr := a.driveViewerFor(rctx, session, channel)
	if appErr != nil {
		return appErr
	}
	if appErr = a.driveCheckReadable(v, channel, items); appErr != nil {
		return appErr
	}
	type entry struct{ name, fileID string }
	entries := []entry{}
	for _, it := range items {
		if !it.IsFolder() {
			entries = append(entries, entry{it.Name, it.FileId})
			continue
		}
		descendants, appErr := a.driveVisibleTree(v, it)
		if appErr != nil {
			return appErr
		}
		byID := map[string]*model.DriveItem{}
		for _, d := range descendants {
			byID[d.Id] = d
		}
		paths := map[string]string{it.Id: it.Name}
		if it.MirrorOf != "" {
			paths[it.MirrorOf] = it.Name
		}
		var pathOf func(id string) string
		pathOf = func(id string) string {
			if p, ok := paths[id]; ok {
				return p
			}
			d := byID[id]
			p := pathOf(d.ParentId) + "/" + d.Name
			paths[id] = p
			return p
		}
		for _, d := range descendants {
			if !d.IsFolder() {
				entries = append(entries, entry{pathOf(d.Id), d.FileId})
			}
		}
	}

	fileIDs := make([]string, 0, len(entries))
	for _, e := range entries {
		fileIDs = append(fileIDs, e.fileID)
	}
	infos := map[string]*model.FileInfo{}
	var total int64
	if len(fileIDs) > 0 {
		list, err := a.Srv().Store().FileInfo().GetByIds(fileIDs, false, false, false)
		if err != nil {
			return driveStoreError("WriteDriveZip", err)
		}
		for _, info := range list {
			infos[info.Id] = info
			total += info.Size
		}
	}
	if total > driveZipMaxBytes {
		return driveError("WriteDriveZip", "zip_too_large", http.StatusRequestEntityTooLarge)
	}

	datas := make([]model.FileData, 0, len(entries))
	for _, e := range entries {
		info := infos[e.fileID]
		if info == nil {
			continue
		}
		data, appErr := a.ReadFile(info.Path)
		if appErr != nil {
			return appErr
		}
		datas = append(datas, model.FileData{Filename: e.name, Body: data})
	}
	if err := a.WriteZipFile(w, datas); err != nil {
		return driveError("WriteDriveZip", "zip", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// permanentDeleteDriveChannel removes a deleted channel's whole drive, bytes included.
func (a *App) permanentDeleteDriveChannel(rctx request.CTX, channelID string) *model.AppError {
	live, err := a.Srv().Store().DriveItem().GetDescendants(channelID, "")
	if err != nil {
		return driveStoreError("permanentDeleteDriveChannel", err)
	}
	trash, err := a.Srv().Store().DriveItem().GetTrash(channelID)
	if err != nil {
		return driveStoreError("permanentDeleteDriveChannel", err)
	}
	if appErr := a.permanentDeleteDriveItems(rctx, append(live, trash...)); appErr != nil {
		return appErr
	}
	if err := a.Srv().Store().DriveItem().PermanentDeleteByChannel(channelID); err != nil {
		return driveStoreError("permanentDeleteDriveChannel", err)
	}
	return nil
}

// RunDriveTrashPurge deletes trash older than the retention period and items whose file is gone.
func (a *App) RunDriveTrashPurge(rctx request.CTX, now time.Time) {
	expired, err := a.Srv().Store().DriveItem().GetExpiredTrash(now.Add(-model.DriveTrashRetention).UnixMilli(), drivePurgeBatch)
	if err != nil {
		rctx.Logger().Error("Failed to get expired drive trash", mlog.Err(err))
	} else if appErr := a.permanentDeleteDriveItems(rctx, expired); appErr != nil {
		rctx.Logger().Error("Failed to purge expired drive trash", mlog.Err(appErr))
	}

	dangling, err := a.Srv().Store().DriveItem().GetDangling(drivePurgeBatch)
	if err != nil {
		rctx.Logger().Error("Failed to get dangling drive items", mlog.Err(err))
		return
	}
	ids := make([]string, 0, len(dangling))
	for _, it := range dangling {
		ids = append(ids, it.Id)
	}
	if err := a.Srv().Store().DriveItem().PermanentDelete(ids); err != nil {
		rctx.Logger().Error("Failed to delete dangling drive items", mlog.Err(err))
	}
}
