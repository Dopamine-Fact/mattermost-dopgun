# Revision channels as real channels — design

## Intent
Revision channels must behave like ordinary channels: any number of them, created from the sidebar's Add Channels menu, with chat. A "Revisions" tab above the chat shows the video and its revisions. Teams can turn the feature on or off.

## Approaches
1. **Link a task section to a channel (picked).** `TaskSection.ChannelId` ties a section to a normal channel. Existing video upload, revision and notification code keeps working; revisions remain tasks and show on the board as the channel's column.
2. Store the link in `Channel.Props` — rejected: untyped JSON, hard to validate or query.
3. A separate revision-channel table — rejected: rewrites video/time/status and revisions stop being tasks.

## Design
- **Team toggle:** `Team.RevisionsEnabled` (`revisions_enabled`), set in team settings beside the tasks toggle. When off: no Add Channels entry, no Revisions tab, server rejects video uploads.
- **Create:** Add Channels → "Create revision channel" (managers only, `manage_team_tasks`): name + video → create channel, create linked section, upload video; on failure delete channel and section.
- **Channel view:** a channel with a linked section shows tabs **Messages | Revisions** under the header. Revisions = today's view (video, ←/→ frame step, add revision, list); selecting a revision opens its detail (status, assignee, comments, files).
- **Tasks page:** the separate Revisions tab goes away; revisions stay on board/list/timeline.
- **Notification:** unchanged DM; the link of a revision points to its channel's Revisions tab.

## Out of scope
Deleting the section when the channel is archived; migrating old revision sections.
