// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"context"
	"net/url"
	"strconv"
)

func (c *Client4) personalNotesRoute(teamID string) clientRoute {
	return c.teamRoute(teamID).Join("notes")
}

// GetPersonalNotes lists dated notes in [from, to], or undated notes when undated is true.
func (c *Client4) GetPersonalNotes(ctx context.Context, teamID, from, to string, undated, onlyMine bool) ([]*PersonalNote, *Response, error) {
	q := url.Values{}
	if from != "" {
		q.Set("from", from)
	}
	if to != "" {
		q.Set("to", to)
	}
	if undated {
		q.Set("undated", "true")
	}
	q.Set("only_mine", strconv.FormatBool(onlyMine))
	r, err := c.doAPIGetWithQuery(ctx, c.personalNotesRoute(teamID), q, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*PersonalNote](r)
}

func (c *Client4) GetPersonalNote(ctx context.Context, teamID, noteID string) (*PersonalNote, *Response, error) {
	r, err := c.doAPIGet(ctx, c.personalNotesRoute(teamID).Join(noteID), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*PersonalNote](r)
}

func (c *Client4) CreatePersonalNote(ctx context.Context, teamID string, note *PersonalNote) (*PersonalNote, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.personalNotesRoute(teamID), note)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*PersonalNote](r)
}

func (c *Client4) PatchPersonalNote(ctx context.Context, teamID, noteID string, patch *PersonalNotePatch) (*PersonalNote, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, c.personalNotesRoute(teamID).Join(noteID, "patch"), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*PersonalNote](r)
}

func (c *Client4) DeletePersonalNote(ctx context.Context, teamID, noteID string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, c.personalNotesRoute(teamID).Join(noteID))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}
