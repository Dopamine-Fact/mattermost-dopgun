// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"mime"
	"net/http"
	"slices"
	"strconv"

	"github.com/gorilla/mux"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

func (api *API) InitDrive() {
	r := api.BaseRoutes.Channel
	r.Handle("/drive/items", api.APISessionRequired(listDriveFolder)).Methods(http.MethodGet)
	r.Handle("/drive/items", api.APISessionRequired(createDriveItem)).Methods(http.MethodPost)
	r.Handle("/drive/items/{item_id:[A-Za-z0-9]+}", api.APISessionRequired(patchDriveItem)).Methods(http.MethodPatch)
	r.Handle("/drive/move", api.APISessionRequired(moveDriveItems)).Methods(http.MethodPost)
	r.Handle("/drive/copy", api.APISessionRequired(copyDriveItems)).Methods(http.MethodPost)
	r.Handle("/drive/delete", api.APISessionRequired(deleteDriveItems)).Methods(http.MethodPost)
	r.Handle("/drive/trash", api.APISessionRequired(getDriveTrash)).Methods(http.MethodGet)
	r.Handle("/drive/trash/restore", api.APISessionRequired(restoreDriveItems)).Methods(http.MethodPost)
	r.Handle("/drive/trash/empty", api.APISessionRequired(emptyDriveTrash)).Methods(http.MethodPost)
	r.Handle("/drive/chat_files", api.APISessionRequired(getDriveChatFiles)).Methods(http.MethodGet)
	r.Handle("/drive/download", api.APISessionRequired(downloadDriveItems)).Methods(http.MethodPost)
}

// requireDrive resolves the URL channel's drive and checks the caller may read it.
func requireDrive(c *Context) *model.Channel {
	if c.RequireChannelId(); c.Err != nil {
		return nil
	}
	channel, appErr := c.App.RequireDriveChannel(c.AppContext, c.Params.ChannelId)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	if !c.App.DriveCan(c.AppContext, *c.AppContext.Session(), channel, app.DriveRead, nil) {
		c.SetPermissionError(model.PermissionReadChannelContent)
		return nil
	}
	return channel
}

// driveTarget resolves a move/copy destination; "" means the URL channel.
func driveTarget(c *Context, src *model.Channel, targetID string) *model.Channel {
	if targetID == "" || targetID == src.Id {
		return src
	}
	if !model.IsValidId(targetID) {
		c.SetInvalidParam("target_channel_id")
		return nil
	}
	dst, appErr := c.App.RequireDriveChannel(c.AppContext, targetID)
	if appErr != nil {
		c.Err = appErr
		return nil
	}
	return dst
}

type driveIDsBody struct {
	ItemIds         []string `json:"item_ids"`
	FileIds         []string `json:"file_ids"`
	TargetChannelId string   `json:"target_channel_id"`
	TargetParentId  string   `json:"target_parent_id"`
	Permanent       bool     `json:"permanent"`
}

// decodeDriveIDs reads the body; at least one id is required unless allowEmpty.
func decodeDriveIDs(c *Context, r *http.Request, allowEmpty bool) *driveIDsBody {
	var body driveIDsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("body", err)
		return nil
	}
	if !allowEmpty && len(body.ItemIds)+len(body.FileIds) == 0 {
		c.SetInvalidParam("item_ids")
		return nil
	}
	for _, id := range slices.Concat(body.ItemIds, body.FileIds) {
		if !model.IsValidId(id) {
			c.SetInvalidParam("item_ids")
			return nil
		}
	}
	return &body
}

func listDriveFolder(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	listing, appErr := c.App.ListDriveFolder(c.AppContext, *c.AppContext.Session(), channel, r.URL.Query().Get("parent_id"))
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, listing)
}

func createDriveItem(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	var body struct {
		Type     string `json:"type"`
		Name     string `json:"name"`
		FileId   string `json:"file_id"`
		ParentId string `json:"parent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		c.SetInvalidParamWithErr("body", err)
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventCreateDriveItem, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)
	model.AddEventParameterToAuditRec(auditRec, "type", body.Type)
	model.AddEventParameterToAuditRec(auditRec, "file_id", body.FileId)

	if !c.App.DriveCanCreateIn(c.AppContext, *c.AppContext.Session(), channel, body.ParentId) {
		c.SetPermissionError(model.PermissionUploadFile)
		return
	}
	userID := c.AppContext.Session().UserId
	var item *model.DriveItem
	var appErr *model.AppError
	switch body.Type {
	case model.DriveItemTypeFolder:
		item, appErr = c.App.CreateDriveFolder(c.AppContext, userID, channel, body.ParentId, body.Name, model.DriveRules{})
	case model.DriveItemTypeFile:
		if !model.IsValidId(body.FileId) {
			c.SetInvalidParam("file_id")
			return
		}
		item, appErr = c.App.AddDriveFile(c.AppContext, userID, channel, body.ParentId, body.FileId)
	default:
		c.SetInvalidParam("type")
		return
	}
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(item)
	writeTaskJSON(w, http.StatusCreated, item)
}

func patchDriveItem(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	var body struct {
		Name *string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == nil {
		c.SetInvalidParam("name")
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventPatchDriveItem, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)

	item, appErr := c.App.GetDriveItem(channel, mux.Vars(r)["item_id"])
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.AddEventPriorState(item)
	if !c.App.DriveCan(c.AppContext, *c.AppContext.Session(), channel, app.DriveModify, item) {
		c.SetPermissionError(model.PermissionManageChannelRoles)
		return
	}
	updated, appErr := c.App.RenameDriveItem(c.AppContext, item, *body.Name)
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	auditRec.AddEventResultState(updated)
	writeTaskJSON(w, http.StatusOK, updated)
}

func moveDriveItems(c *Context, w http.ResponseWriter, r *http.Request) {
	transferDriveItems(c, w, r, false)
}

func copyDriveItems(c *Context, w http.ResponseWriter, r *http.Request) {
	transferDriveItems(c, w, r, true)
}

func transferDriveItems(c *Context, w http.ResponseWriter, r *http.Request, isCopy bool) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	body := decodeDriveIDs(c, r, false)
	if c.Err != nil {
		return
	}
	if !isCopy && len(body.FileIds) > 0 {
		c.SetInvalidParam("file_ids")
		return
	}
	event := model.AuditEventMoveDriveItems
	if isCopy {
		event = model.AuditEventCopyDriveItems
	}
	auditRec := c.MakeAuditRecord(event, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)
	model.AddEventParameterToAuditRec(auditRec, "item_ids", body.ItemIds)
	model.AddEventParameterToAuditRec(auditRec, "file_ids", body.FileIds)
	model.AddEventParameterToAuditRec(auditRec, "target_channel_id", body.TargetChannelId)
	model.AddEventParameterToAuditRec(auditRec, "target_parent_id", body.TargetParentId)

	dst := driveTarget(c, channel, body.TargetChannelId)
	if c.Err != nil {
		return
	}
	session := *c.AppContext.Session()
	var appErr *model.AppError
	if isCopy {
		appErr = c.App.CopyDriveItems(c.AppContext, session, channel, body.ItemIds, body.FileIds, dst, body.TargetParentId)
	} else {
		appErr = c.App.MoveDriveItems(c.AppContext, session, channel, body.ItemIds, dst, body.TargetParentId)
	}
	if appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	ReturnStatusOK(w)
}

func deleteDriveItems(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	body := decodeDriveIDs(c, r, false)
	if c.Err != nil {
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventDeleteDriveItems, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)
	model.AddEventParameterToAuditRec(auditRec, "item_ids", body.ItemIds)
	model.AddEventParameterToAuditRec(auditRec, "permanent", body.Permanent)

	if appErr := c.App.DeleteDriveItems(c.AppContext, *c.AppContext.Session(), channel, body.ItemIds, body.Permanent); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	ReturnStatusOK(w)
}

func getDriveTrash(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	items, appErr := c.App.GetDriveTrash(c.AppContext, *c.AppContext.Session(), channel)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, items)
}

func restoreDriveItems(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	body := decodeDriveIDs(c, r, false)
	if c.Err != nil {
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventRestoreDriveItems, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)
	model.AddEventParameterToAuditRec(auditRec, "item_ids", body.ItemIds)

	if appErr := c.App.RestoreDriveItems(c.AppContext, *c.AppContext.Session(), channel, body.ItemIds); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	ReturnStatusOK(w)
}

func emptyDriveTrash(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventEmptyDriveTrash, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)

	if appErr := c.App.EmptyDriveTrash(c.AppContext, *c.AppContext.Session(), channel); appErr != nil {
		c.Err = appErr
		return
	}
	auditRec.Success()
	ReturnStatusOK(w)
}

var driveChatFileSorts = map[string]string{
	"":          model.FileinfoSortByCreated,
	"create_at": model.FileinfoSortByCreated,
	"name":      model.FileinfoSortByName,
	"size":      model.FileinfoSortBySize,
}

func getDriveChatFiles(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	q := r.URL.Query()
	sortBy, ok := driveChatFileSorts[q.Get("sort_by")]
	if !ok {
		c.SetInvalidParam("sort_by")
		return
	}
	desc := true
	if v := q.Get("sort_desc"); v != "" {
		var err error
		if desc, err = strconv.ParseBool(v); err != nil {
			c.SetInvalidParamWithErr("sort_desc", err)
			return
		}
	}
	files, appErr := c.App.GetDriveChatFiles(c.AppContext, channel.Id, c.Params.Page, c.Params.PerPage, sortBy, desc)
	if appErr != nil {
		c.Err = appErr
		return
	}
	writeTaskJSON(w, http.StatusOK, files)
}

// zipResponse sends the download headers only once the archive starts, so earlier errors stay JSON.
type zipResponse struct {
	http.ResponseWriter
	filename string
	started  bool
}

func (z *zipResponse) Write(p []byte) (int, error) {
	if !z.started {
		z.started = true
		h := z.Header()
		h.Set("Content-Type", "application/zip")
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": z.filename}))
		h.Set("X-Content-Type-Options", "nosniff")
		z.WriteHeader(http.StatusOK)
	}
	return z.ResponseWriter.Write(p)
}

func downloadDriveItems(c *Context, w http.ResponseWriter, r *http.Request) {
	channel := requireDrive(c)
	if c.Err != nil {
		return
	}
	body := decodeDriveIDs(c, r, false)
	if c.Err != nil {
		return
	}
	auditRec := c.MakeAuditRecord(model.AuditEventDownloadDriveItems, model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)
	model.AddEventParameterToAuditRec(auditRec, "channel_id", channel.Id)
	model.AddEventParameterToAuditRec(auditRec, "item_ids", body.ItemIds)

	zw := &zipResponse{ResponseWriter: w, filename: channel.Name + ".zip"}
	if appErr := c.App.WriteDriveZip(c.AppContext, *c.AppContext.Session(), channel, body.ItemIds, zw); appErr != nil {
		if zw.started {
			c.AppContext.Logger().Warn("Drive zip download failed midway", mlog.String("channel_id", channel.Id), mlog.Err(appErr))
			return
		}
		c.Err = appErr
		return
	}
	auditRec.Success()
}
