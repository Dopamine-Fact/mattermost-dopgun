// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

// EpisodeCreate is the request to create an episode: its channel, task section, folders and tasks, seeded from
// the team's templates.
type EpisodeCreate struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
}

type EpisodeCreated struct {
	Channel *Channel     `json:"channel"`
	Section *TaskSection `json:"section"`
	Failed  []string     `json:"failed"`   // template folder paths and task titles that could not be created
	TaskIds []string     `json:"task_ids"` // the seeded tasks, which the client deletes if it rolls the episode back
}
