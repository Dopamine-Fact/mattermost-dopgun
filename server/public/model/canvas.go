// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

const (
	// A backstop well above the 512 KB batches clients post: one Yjs update cannot be split, and one refused would block its sender's later edits.
	CanvasUpdateMaxBytes    = 8 * 1024 * 1024
	CanvasSnapshotMaxBytes  = 20 * 1024 * 1024
	CanvasAwarenessMaxBytes = 4 * 1024
)

// Canvas is the metadata of a whiteboard channel; the document itself lives in CanvasUpdates and the snapshot.
type Canvas struct {
	ChannelId   string `json:"channel_id"`
	TeamId      string `json:"team_id"`
	CreatorId   string `json:"creator_id"`
	LastSeq     int64  `json:"last_seq"`
	SnapshotSeq int64  `json:"snapshot_seq"`
	CreateAt    int64  `json:"create_at"`
	UpdateAt    int64  `json:"update_at"`
}

type CanvasUpdate struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

type CanvasState struct {
	Snapshot    []byte          `json:"snapshot,omitempty"`
	SnapshotSeq int64           `json:"snapshot_seq"`
	Updates     []*CanvasUpdate `json:"updates"`
	LastSeq     int64           `json:"last_seq"`
}

type CanvasSnapshot struct {
	Data    []byte `json:"data"`
	UptoSeq int64  `json:"upto_seq"`
}

func (c *Canvas) PreSave() {
	if c.CreateAt == 0 {
		c.CreateAt = GetMillis()
	}
	c.UpdateAt = c.CreateAt
}
