# Files tab in episode channels — short design

## Intent

Episode work happens in the episode channel (Messages, Revisions, Tasks, Canvas), but its files live in the
separate file explorer page (`/<team>/files/<channel>/<folder>`). The team wants the channel's files inside the
channel, without leaving it.

## Approaches

- **A. Make the explorer embeddable (picked).** The explorer takes its channel, folder and a URL builder from
  outside; the route page and the channel tab each supply their own. In the tab, the folder lives in `?folder=`,
  like `?revision=`, so browser back/forward and shared links work. Cost: a refactor of navigation in a
  ~750-line component.
- B. Mount the unchanged explorer under an in-memory router inside the tab. Least code, but browser back does
  not work, the all-channels tree navigates to other channels inside the tab, and the sidebar marks "Files" as
  the current page.
- C. A new, simple file list for the channel. More new code and fewer features (no preview, recycle bin,
  drag and drop, copy/move).

## Design

- **Where:** a "Files" tab in `ChannelTabs`, shown when the channel already has a tab bar (it has a task
  section or is a canvas, which covers every episode channel) and the team has `files_enabled`. Channels without
  a tab bar are unchanged. *(my call: same rule for revision-only and canvas-only channels, since they share the
  tab bar)*
- **What it shows:** the full explorer for this channel: toolbar, address bar, search, icon/detail views,
  preview pane, uploads with their panel, drag and drop, context menu, cut/copy/paste, chat attachments and the
  recycle bin.
- **What it leaves out:** the all-channels tree. The breadcrumb starts at the channel, not at "Files"; "up"
  from the channel root does nothing.
- **Navigation:** opening a folder pushes `?folder=<id>` (chat attachments and recycle bin use their existing
  folder ids); the route page keeps its `/files/<channel>/<folder>` URLs unchanged. Every `history.push` in the
  explorer goes through one URL builder passed in by the host.
- **Side effects that belong to the page only:** marking "Files" in the sidebar and redirecting when files are
  off stay in the route page, not in the tab.
- **Deep link:** `?folder=` on a channel URL opens the Files tab at that folder, like `?revision=` opens
  Revisions.

## Left to the builder

The exact prop names, how the tree is hidden (prop or host-supplied layout), and the tab's position (after
Tasks, before Canvas).

## Non-goals

Moving files between channels from the tab (the page still does it with its tree); per-channel default folders
(the settings panel is a separate piece of work).
