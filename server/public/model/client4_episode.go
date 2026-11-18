// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import "context"

func (c *Client4) CreateEpisode(ctx context.Context, teamID string, in *EpisodeCreate) (*EpisodeCreated, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(teamID).Join("episodes"), in)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*EpisodeCreated](r)
}
