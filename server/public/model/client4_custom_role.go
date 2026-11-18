// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"context"
	"net/url"
)

// GetTeamDepartments returns the team's departments in order, Stüdyo geneli first, each with its ranks.
func (c *Client4) GetTeamDepartments(ctx context.Context, teamId string) ([]*DepartmentWithRanks, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamRoute(teamId).Join("departments"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*DepartmentWithRanks](r)
}

func (c *Client4) CreateDepartment(ctx context.Context, teamId string, department *Department) (*Department, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(teamId).Join("departments"), department)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*Department](r)
}

func (c *Client4) PatchDepartment(ctx context.Context, teamId, departmentId string, patch *DepartmentPatch) (*Department, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, c.teamRoute(teamId).Join("departments", departmentId), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*Department](r)
}

func (c *Client4) DeleteDepartment(ctx context.Context, teamId, departmentId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, c.teamRoute(teamId).Join("departments", departmentId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

// ReorderDepartments sets the department order; ids name every department once, Stüdyo geneli first.
func (c *Client4) ReorderDepartments(ctx context.Context, teamId string, ids []string) ([]*DepartmentWithRanks, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, c.teamRoute(teamId).Join("departments", "order"), map[string][]string{"ids": ids})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*DepartmentWithRanks](r)
}

func (c *Client4) CreateRank(ctx context.Context, teamId, departmentId string, rank *CustomRole) (*CustomRole, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(teamId).Join("departments", departmentId, "ranks"), rank)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*CustomRole](r)
}

func (c *Client4) PatchRank(ctx context.Context, teamId, rankId string, patch *CustomRolePatch) (*CustomRole, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, c.teamRoute(teamId).Join("ranks", rankId), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*CustomRole](r)
}

func (c *Client4) DeleteRank(ctx context.Context, teamId, rankId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, c.teamRoute(teamId).Join("ranks", rankId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

// ReorderRanks sets the rank order inside a department, top first; ids name every rank of it once.
func (c *Client4) ReorderRanks(ctx context.Context, teamId, departmentId string, ids []string) ([]*DepartmentWithRanks, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, c.teamRoute(teamId).Join("departments", departmentId, "ranks", "order"), map[string][]string{"ids": ids})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*DepartmentWithRanks](r)
}

// SetMemberRanks replaces the ranks a team member holds, at most one per department.
func (c *Client4) SetMemberRanks(ctx context.Context, teamId, userId string, rankIds []string) (*TeamMember, *Response, error) {
	if rankIds == nil {
		rankIds = []string{}
	}
	r, err := c.doAPIPutJSON(ctx, c.teamMemberRoute(teamId, userId).Join("ranks"), map[string][]string{"rank_ids": rankIds})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*TeamMember](r)
}

// GetAssignableRanks returns the ids of the ranks the caller may give the member or take away.
func (c *Client4) GetAssignableRanks(ctx context.Context, teamId, userId string) ([]string, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamMemberRoute(teamId, userId).Join("assignable_ranks"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]string](r)
}

// GetActionableUserIds returns the team members the caller may act on with permission, one of the team task
// permissions.
func (c *Client4) GetActionableUserIds(ctx context.Context, teamId, permission string) ([]string, *Response, error) {
	r, err := c.doAPIGetWithQuery(ctx, c.teamRoute(teamId).Join("actionable_user_ids"), url.Values{"permission": {permission}}, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]string](r)
}
