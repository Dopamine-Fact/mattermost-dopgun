// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import "context"

func (c *Client4) GetCustomRoles(ctx context.Context) ([]*CustomRole, *Response, error) {
	r, err := c.doAPIGet(ctx, newClientRoute("custom_roles"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*CustomRole](r)
}

func (c *Client4) CreateCustomRole(ctx context.Context, role *CustomRole) (*CustomRole, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, newClientRoute("custom_roles"), role)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*CustomRole](r)
}

func (c *Client4) PatchCustomRole(ctx context.Context, roleId string, patch *CustomRolePatch) (*CustomRole, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, newClientRoute("custom_roles").Join(roleId), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*CustomRole](r)
}

func (c *Client4) DeleteCustomRole(ctx context.Context, roleId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, newClientRoute("custom_roles").Join(roleId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

// ReorderCustomRoles sets the hierarchy, top first; ids must name every role exactly once.
func (c *Client4) ReorderCustomRoles(ctx context.Context, ids []string) ([]*CustomRole, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, newClientRoute("custom_roles").Join("order"), map[string][]string{"ids": ids})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*CustomRole](r)
}

// SetUserCustomRoles replaces the custom roles a user holds.
func (c *Client4) SetUserCustomRoles(ctx context.Context, userId string, roleIds []string) (*User, *Response, error) {
	if roleIds == nil {
		roleIds = []string{}
	}
	r, err := c.doAPIPutJSON(ctx, c.userRoute(userId).Join("custom_roles"), map[string][]string{"role_ids": roleIds})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*User](r)
}

// GetActionableUserIds returns the team members the caller may assign tasks to or review.
func (c *Client4) GetActionableUserIds(ctx context.Context, teamId string) ([]string, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamRoute(teamId).Join("custom_roles", "actionable_users"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]string](r)
}
