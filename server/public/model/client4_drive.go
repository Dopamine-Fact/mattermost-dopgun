// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"context"
	"io"
	"net/url"
	"strconv"
)

func (c *Client4) driveRoute(channelID string) clientRoute {
	return c.channelRoute(channelID).Join("drive")
}

// driveDo sends a JSON write that answers with a status body only.
func (c *Client4) driveDo(ctx context.Context, route clientRoute, body any) (*Response, error) {
	r, err := c.doAPIPostJSON(ctx, route, body)
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

// GetDriveFolder lists a folder of the channel drive; parentID "" is the root.
func (c *Client4) GetDriveFolder(ctx context.Context, channelID, parentID string) (*DriveListing, *Response, error) {
	r, err := c.doAPIGetWithQuery(ctx, c.driveRoute(channelID).Join("items"), url.Values{"parent_id": {parentID}}, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DriveListing](r)
}

func (c *Client4) createDriveItem(ctx context.Context, channelID string, body map[string]string) (*DriveItem, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.driveRoute(channelID).Join("items"), body)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DriveItem](r)
}

func (c *Client4) CreateDriveFolder(ctx context.Context, channelID, parentID, name string) (*DriveItem, *Response, error) {
	return c.createDriveItem(ctx, channelID, map[string]string{"type": DriveItemTypeFolder, "parent_id": parentID, "name": name})
}

// AddDriveFile places an upload made with UploadFile (and not posted) into the drive.
func (c *Client4) AddDriveFile(ctx context.Context, channelID, parentID, fileID string) (*DriveItem, *Response, error) {
	return c.createDriveItem(ctx, channelID, map[string]string{"type": DriveItemTypeFile, "parent_id": parentID, "file_id": fileID})
}

func (c *Client4) RenameDriveItem(ctx context.Context, channelID, itemID, name string) (*DriveItem, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, c.driveRoute(channelID).Join("items", itemID), map[string]string{"name": name})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DriveItem](r)
}

// RenameDriveTaskFile renames a message file listed in a task's drive folder.
func (c *Client4) RenameDriveTaskFile(ctx context.Context, channelID, fileID, name string) (*FileInfo, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, c.driveRoute(channelID).Join("task_files", fileID), map[string]string{"name": name})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*FileInfo](r)
}

// DeleteDriveTaskFile removes a message file listed in a task's drive folder from its post.
func (c *Client4) DeleteDriveTaskFile(ctx context.Context, channelID, fileID string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, c.driveRoute(channelID).Join("task_files", fileID))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

// MoveDriveItems moves items of channelID into targetParentID of targetChannelID ("" = same channel).
func (c *Client4) MoveDriveItems(ctx context.Context, channelID string, itemIDs []string, targetChannelID, targetParentID string) (*Response, error) {
	return c.driveDo(ctx, c.driveRoute(channelID).Join("move"), map[string]any{"item_ids": itemIDs, "target_channel_id": targetChannelID, "target_parent_id": targetParentID})
}

// CopyDriveItems copies drive items and chat files (fileIDs) of channelID into targetParentID of targetChannelID.
func (c *Client4) CopyDriveItems(ctx context.Context, channelID string, itemIDs, fileIDs []string, targetChannelID, targetParentID string) (*Response, error) {
	return c.driveDo(ctx, c.driveRoute(channelID).Join("copy"), map[string]any{"item_ids": itemIDs, "file_ids": fileIDs, "target_channel_id": targetChannelID, "target_parent_id": targetParentID})
}

// DeleteDriveItems moves items to the recycle bin, or deletes them for good when permanent.
func (c *Client4) DeleteDriveItems(ctx context.Context, channelID string, itemIDs []string, permanent bool) (*Response, error) {
	return c.driveDo(ctx, c.driveRoute(channelID).Join("delete"), map[string]any{"item_ids": itemIDs, "permanent": permanent})
}

func (c *Client4) GetDriveTrash(ctx context.Context, channelID string) ([]*DriveItem, *Response, error) {
	r, err := c.doAPIGet(ctx, c.driveRoute(channelID).Join("trash"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*DriveItem](r)
}

func (c *Client4) RestoreDriveItems(ctx context.Context, channelID string, itemIDs []string) (*Response, error) {
	return c.driveDo(ctx, c.driveRoute(channelID).Join("trash", "restore"), map[string]any{"item_ids": itemIDs})
}

func (c *Client4) EmptyDriveTrash(ctx context.Context, channelID string) (*Response, error) {
	return c.driveDo(ctx, c.driveRoute(channelID).Join("trash", "empty"), map[string]any{})
}

// GetDriveChatFiles lists files posted in the channel's chat; sortBy is "name", "size" or "create_at".
func (c *Client4) GetDriveChatFiles(ctx context.Context, channelID string, page, perPage int, sortBy string, desc bool) ([]*FileInfo, *Response, error) {
	q := url.Values{"page": {strconv.Itoa(page)}, "per_page": {strconv.Itoa(perPage)}, "sort_by": {sortBy}, "sort_desc": {strconv.FormatBool(desc)}}
	r, err := c.doAPIGetWithQuery(ctx, c.driveRoute(channelID).Join("chat_files"), q, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*FileInfo](r)
}

// DownloadDriveZip returns the selected items as a zip archive.
func (c *Client4) DownloadDriveZip(ctx context.Context, channelID string, itemIDs []string) ([]byte, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.driveRoute(channelID).Join("download"), map[string]any{"item_ids": itemIDs})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	data, err := io.ReadAll(r.Body)
	return data, BuildResponse(r), err
}
