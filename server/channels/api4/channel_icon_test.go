// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/channels/utils/testutils"
)

func uploadChannelIcon(t *testing.T, client *model.Client4, channelID string, data []byte) int {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("image", "icon.png")
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	r, err := client.DoAPIRequestReader(context.Background(), http.MethodPost, client.APIURL+"/channels/"+channelID+"/image", writer.FormDataContentType(), body, nil)
	if r == nil {
		require.NoError(t, err)
	}
	defer r.Body.Close()
	return r.StatusCode
}

func TestChannelIcon(t *testing.T) {
	mainHelper.Parallel(t)
	th := Setup(t).InitBasic(t)
	channel := th.BasicChannel
	iconURL := "/channels/" + channel.Id + "/image"

	data, err := testutils.ReadTestFile("test.png")
	require.NoError(t, err)

	// Channel member with default permissions can set the icon.
	require.Equal(t, http.StatusOK, uploadChannelIcon(t, th.Client, channel.Id, data))
	updated, appErr := th.App.GetChannel(th.Context, channel.Id)
	require.Nil(t, appErr)
	require.NotZero(t, updated.LastIconUpdate)

	r, err := th.Client.DoAPIGet(context.Background(), iconURL, "")
	require.NoError(t, err)
	require.Equal(t, "image/png", r.Header.Get("Content-Type"))
	r.Body.Close()

	// DM channels cannot have icons.
	dm := th.CreateDmChannel(t, th.BasicUser2)
	require.Equal(t, http.StatusBadRequest, uploadChannelIcon(t, th.Client, dm.Id, data))

	// A user outside the team cannot set it.
	outsider := th.CreateUser(t)
	outsiderClient := th.CreateClient()
	_, _, err = outsiderClient.Login(context.Background(), outsider.Email, outsider.Password)
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, uploadChannelIcon(t, outsiderClient, channel.Id, data))

	// Removing clears LastIconUpdate and the icon is no longer served.
	r, err = th.Client.DoAPIDelete(context.Background(), iconURL)
	require.NoError(t, err)
	r.Body.Close()
	updated, appErr = th.App.GetChannel(th.Context, channel.Id)
	require.Nil(t, appErr)
	require.Zero(t, updated.LastIconUpdate)

	r, _ = th.Client.DoAPIGet(context.Background(), iconURL, "")
	require.Equal(t, http.StatusNotFound, r.StatusCode)
	r.Body.Close()

	require.NoError(t, th.cleanupTestFile(&model.FileInfo{Path: "channels/" + channel.Id + "/channelIcon.png"}))
}
