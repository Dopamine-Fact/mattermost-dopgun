// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"context"
	"io"
	"net/url"
)

func dailyReportQuery(kv ...string) url.Values {
	q := url.Values{}
	for i := 0; i < len(kv); i += 2 {
		if kv[i+1] != "" {
			q.Set(kv[i], kv[i+1])
		}
	}
	return q
}

// GetDailyReports lists reports; empty from/to default to today and empty userID to everyone the caller may see.
func (c *Client4) GetDailyReports(ctx context.Context, teamID, from, to, userID string) ([]*DailyReport, *Response, error) {
	q := dailyReportQuery("from", from, "to", to, "user_id", userID)
	r, err := c.doAPIGetWithQuery(ctx, c.teamRoute(teamID).Join("daily_reports"), q, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*DailyReport](r)
}

func (c *Client4) SubmitDailyReport(ctx context.Context, teamID, message string) (*DailyReport, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, c.teamRoute(teamID).Join("daily_reports", "mine"), map[string]string{"message": message})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DailyReport](r)
}

func (c *Client4) ApproveDailyReport(ctx context.Context, reportID string) (*DailyReport, *Response, error) {
	r, err := c.doAPIPost(ctx, newClientRoute("daily_reports").Join(reportID, "approve"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DailyReport](r)
}

func (c *Client4) ExportDailyReports(ctx context.Context, teamID, from, to string) ([]byte, *Response, error) {
	q := dailyReportQuery("from", from, "to", to)
	r, err := c.doAPIGetWithQuery(ctx, c.teamRoute(teamID).Join("daily_reports", "export"), q, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	data, err := io.ReadAll(r.Body)
	return data, BuildResponse(r), err
}
