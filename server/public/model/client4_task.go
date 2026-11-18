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

func (c *Client4) GetTeamTasks(ctx context.Context, teamId string) ([]*Task, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamRoute(teamId).Join("tasks"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*Task](r)
}

func (c *Client4) CreateTask(ctx context.Context, task *Task) (*Task, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(task.TeamId).Join("tasks"), task)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*Task](r)
}

func (c *Client4) PatchTask(ctx context.Context, taskId string, patch *TaskPatch) (*Task, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, newClientRoute("tasks").Join(taskId), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*Task](r)
}

func (c *Client4) DeleteTask(ctx context.Context, taskId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, newClientRoute("tasks").Join(taskId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

func (c *Client4) GetTeamTaskSections(ctx context.Context, teamId string) ([]*TaskSection, *Response, error) {
	r, err := c.doAPIGet(ctx, c.teamRoute(teamId).Join("task_sections"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*TaskSection](r)
}

func (c *Client4) CreateTaskSection(ctx context.Context, section *TaskSection) (*TaskSection, *Response, error) {
	r, err := c.doAPIPostJSON(ctx, c.teamRoute(section.TeamId).Join("task_sections"), section)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*TaskSection](r)
}

func (c *Client4) PatchTaskSection(ctx context.Context, sectionId string, patch *TaskSectionPatch) (*TaskSection, *Response, error) {
	r, err := c.doAPIPatchJSON(ctx, newClientRoute("task_sections").Join(sectionId), patch)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*TaskSection](r)
}

func (c *Client4) DeleteTaskSection(ctx context.Context, sectionId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, newClientRoute("task_sections").Join(sectionId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

func (c *Client4) GetTaskComments(ctx context.Context, taskId string) ([]*TaskComment, *Response, error) {
	r, err := c.doAPIGet(ctx, newClientRoute("tasks").Join(taskId, "comments"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*TaskComment](r)
}

// CreateTaskComment posts a comment with attachments, given as file name to contents.
func (c *Client4) CreateTaskComment(ctx context.Context, taskId, message string, files map[string][]byte) (*TaskComment, *Response, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("message", message); err != nil {
		return nil, nil, err
	}
	for name, data := range files {
		part, err := writer.CreateFormFile("files", name)
		if err != nil {
			return nil, nil, err
		}
		if _, err := part.Write(data); err != nil {
			return nil, nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	r, err := c.doAPIRequestReaderRoute(ctx, http.MethodPost, newClientRoute("tasks").Join(taskId, "comments"), writer.FormDataContentType(), body, nil)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*TaskComment](r)
}

func (c *Client4) DeleteTaskComment(ctx context.Context, commentId string) (*Response, error) {
	r, err := c.doAPIDelete(ctx, newClientRoute("task_comments").Join(commentId))
	if err != nil {
		return BuildResponse(r), err
	}
	defer closeBody(r)
	return BuildResponse(r), nil
}

func (c *Client4) GetTaskCommentFile(ctx context.Context, commentId, fileId string) ([]byte, *Response, error) {
	r, err := c.doAPIGet(ctx, newClientRoute("task_comments").Join(commentId, "files", fileId), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	return data, BuildResponse(r), nil
}

// SetTaskSectionVideo uploads the video of a revision channel.
func (c *Client4) SetTaskSectionVideo(ctx context.Context, sectionId, name string, data []byte) (*TaskSection, *Response, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("video", name)
	if err != nil {
		return nil, nil, err
	}
	if _, err = part.Write(data); err != nil {
		return nil, nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}
	r, err := c.doAPIRequestReaderRoute(ctx, http.MethodPost, newClientRoute("task_sections").Join(sectionId, "video"), writer.FormDataContentType(), body, nil)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[*TaskSection](r)
}

// GetTaskSectionVideos lists every version of the section's video, oldest first.
func (c *Client4) GetTaskSectionVideos(ctx context.Context, sectionId string) ([]*TaskSectionVideo, *Response, error) {
	r, err := c.doAPIGet(ctx, newClientRoute("task_sections").Join(sectionId, "videos"), "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	return DecodeJSONFromResponse[[]*TaskSectionVideo](r)
}

// GetTaskSectionVideo streams one version of the section's video; an empty fileId means the latest.
func (c *Client4) GetTaskSectionVideo(ctx context.Context, sectionId, fileId string) ([]byte, *Response, error) {
	query := url.Values{}
	if fileId != "" {
		query.Set("file_id", fileId)
	}
	r, err := c.doAPIGetWithQuery(ctx, newClientRoute("task_sections").Join(sectionId, "video"), query, "")
	if err != nil {
		return nil, BuildResponse(r), err
	}
	defer closeBody(r)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, BuildResponse(r), err
	}
	return data, BuildResponse(r), nil
}
