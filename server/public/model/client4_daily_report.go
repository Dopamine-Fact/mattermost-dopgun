// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
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

// ApproveDailyReport approves a pending report. updateAt > 0 is the version the reviewer saw: if the report changed
// since, it is a 409 and nothing happens. 0 skips that check.
func (c *Client4) ApproveDailyReport(ctx context.Context, reportID string, updateAt int64) (*DailyReport, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, newClientRoute("daily_reports").Join(reportID, "approve"), map[string]int64{"update_at": updateAt})
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

// UpdateDailyReport edits the caller's own report; it goes back to pending and is marked edited.
func (c *Client4) UpdateDailyReport(ctx context.Context, reportID, message string) (*DailyReport, *Response, error) {
	r, err := c.doAPIPutJSON(ctx, newClientRoute("daily_reports").Join(reportID), map[string]string{"message": message})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DailyReport](r)
}

// RejectDailyReport sends the report back with a required reason; updateAt works as in ApproveDailyReport.
func (c *Client4) RejectDailyReport(ctx context.Context, reportID, reason string, updateAt int64) (*DailyReport, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, newClientRoute("daily_reports").Join(reportID, "reject"), map[string]any{"reason": reason, "update_at": updateAt})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DailyReport](r)
}

type dailyReportAssignees struct {
	UserIDs []string `json:"user_ids"`
}

func (c *Client4) GetDailyReportAssignees(ctx context.Context, teamID string) ([]string, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamRoute(teamID).Join("daily_reports", "assignees"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	out, resp, err := DecodeJSONFromResponse[dailyReportAssignees](r)
	return out.UserIDs, resp, err
}

// SetDailyReportAssignees replaces who must report; an empty list means everyone.
func (c *Client4) SetDailyReportAssignees(ctx context.Context, teamID string, userIDs []string) ([]string, *Response, error) {
	if userIDs == nil {
		userIDs = []string{} // the server wants a list; nil would be sent as null
	}
	r, err := c.doAPIPutJSON(ctx, c.teamRoute(teamID).Join("daily_reports", "assignees"), dailyReportAssignees{UserIDs: userIDs})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	out, resp, err := DecodeJSONFromResponse[dailyReportAssignees](r)
	return out.UserIDs, resp, err
}

func (c *Client4) uploadDailyReportFile(ctx context.Context, route clientRoute, name string, data []byte) (*FileInfo, *Response, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		return nil, nil, err
	}
	if _, err = part.Write(data); err != nil {
		return nil, nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}
	r, err := c.doAPIRequestReaderRoute(ctx, http.MethodPost, route, writer.FormDataContentType(), body, nil)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*FileInfo](r)
}

// AddMyDailyReportFile attaches a screenshot or short video to the caller's report for today, starting a draft
// when there is no report yet.
func (c *Client4) AddMyDailyReportFile(ctx context.Context, teamID, name string, data []byte) (*FileInfo, *Response, error) {
	return c.uploadDailyReportFile(ctx, c.teamRoute(teamID).Join("daily_reports", "mine", "files"), name, data)
}

// AddDailyReportFile attaches a file to one of the caller's own reports.
func (c *Client4) AddDailyReportFile(ctx context.Context, reportID, name string, data []byte) (*FileInfo, *Response, error) {
	return c.uploadDailyReportFile(ctx, newClientRoute("daily_reports").Join(reportID, "files"), name, data)
}

func (c *Client4) RemoveDailyReportFile(ctx context.Context, reportID, fileID string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, newClientRoute("daily_reports").Join(reportID, "files", fileID))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

func (c *Client4) GetDailyReportFile(ctx context.Context, reportID, fileID string) ([]byte, *Response, error) {
	r, err := c.doAPIGet(ctx, newClientRoute("daily_reports").Join(reportID, "files", fileID), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	data, err := io.ReadAll(r.Body)
	return data, BuildResponse(r), err
}

// ExcuseDailyReport marks userID's day (YYYY-MM-DD, today or earlier) as needing no report.
func (c *Client4) ExcuseDailyReport(ctx context.Context, teamID, userID, date string) (*DailyReport, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(teamID).Join("daily_reports", "excuse"), map[string]string{"user_id": userID, "date": date})
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*DailyReport](r)
}
