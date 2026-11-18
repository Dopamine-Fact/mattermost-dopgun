# Episodes tab in Team Settings — short design

## Intent

The Info tab of Team Settings holds the team's name, description and picture plus every dopgun feature switch and
the two episode templates. It has grown too long to scan. The team wants the episode settings in a panel of their own.

## Approaches

- **A. A new "Episodes" tab (picked).** Move the Tasks/Revisions/Canvas switches and the default episode folders and
  tasks into a new tab with its own save panel. Info keeps name, description, picture, daily reports and the Files
  switch. Cost: a second copy of the small save/cancel plumbing.
- B. Collapse the sections on the Info tab. Less code, but the tab stays long and the templates stay hidden behind
  the switches.
- C. Move only the two templates. Leaves the switches that control them on another tab.

## Design

- **Tab:** "Episodes" (tr "Bölümler"), icon `icon-video-outline`, right after Info. Same visibility as Info (the
  modal is already limited to people who can manage the team).
- **Contents, in order:** the Tasks, Revisions and Canvas switches (`TeamTasksSection`, unchanged), then the
  default episode folders and tasks (`TeamEpisodeTemplatesSection`, unchanged), shown only while tasks and revisions
  are on, as today.
- **Saving:** its own `SaveChangesPanel` and `patchTeam` call with only the fields it owns (`tasks_enabled`,
  `revisions_enabled`, `canvas_enabled`, and the templates when changed). The server's template errors
  (`model.team.is_valid.episode_folders.app_error`, `...episode_tasks...`) show under the field, as today.
  Unsaved changes block switching tabs, as on every tab.
- **Info tab:** loses those fields, their state and their part of the patch; everything else is unchanged.
- Webapp only; no server or API change. The section components and their i18n strings move as they are.

## Non-goals

New episode settings, per-channel templates, changing how templates are applied when an episode is created.
