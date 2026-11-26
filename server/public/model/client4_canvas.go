// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

func (c *Client4) CreateCanvas(ctx context.Context, teamId, channelId string) (*Canvas, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(teamId).Join("canvases"), map[string]string{"channel_id": channelId})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*Canvas](r)
}

// GetCanvas returns a nil canvas (and no error) when the channel has none.
func (c *Client4) GetCanvas(ctx context.Context, channelId string) (*Canvas, *Response, error) {
	r, err := c.doAPIGet(ctx, c.channelRoute(channelId).Join("canvas"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	if r.StatusCode == http.StatusNoContent {
		return nil, BuildResponse(r), nil
	}
	return DecodeJSONFromResponse[*Canvas](r)
}

func (c *Client4) GetCanvasState(ctx context.Context, channelId string, afterSeq int64) (*CanvasState, *Response, error) {
	r, err := c.doAPIGetWithQuery(ctx, c.channelRoute(channelId).Join("canvas", "state"), url.Values{"after": {strconv.FormatInt(afterSeq, 10)}}, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*CanvasState](r)
}

// PostCanvasUpdate returns the seq the server gave the update.
func (c *Client4) PostCanvasUpdate(ctx context.Context, channelId string, data []byte) (int64, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.channelRoute(channelId).Join("canvas", "updates"), map[string][]byte{"data": data})
	if err != nil {
		return 0, BuildResponse(r), err
	}
	defer closeBody(r)
	res, resp, err := DecodeJSONFromResponse[map[string]int64](r)
	return res["seq"], resp, err
}

// SaveCanvasSnapshot reports whether the server applied the snapshot.
func (c *Client4) SaveCanvasSnapshot(ctx context.Context, channelId string, snap *CanvasSnapshot) (bool, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, c.channelRoute(channelId).Join("canvas", "snapshot"), snap)
	if err != nil {
		return false, BuildResponse(r), err
	}
	defer closeBody(r)
	res, resp, err := DecodeJSONFromResponse[map[string]bool](r)
	return res["applied"], resp, err
}
