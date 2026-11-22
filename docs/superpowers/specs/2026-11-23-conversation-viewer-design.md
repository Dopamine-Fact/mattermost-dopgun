# Conversation viewer — design

## Intent

When an incident comes up, a System Admin wants to read one person's conversations (DMs, group messages and channels)
in the System Console, in order, with who said what. Occasional investigation, not archiving.

## Goals

- New System Console page **User Management → Conversations** (`user_management/conversations`), System Admins only,
  next to Breaks.
- Pick a user → list of that user's DMs, group messages and channels, named by the other party / channel display name,
  most recently active first.
- Click one → its messages oldest-at-top, newest-at-bottom, each with sender, date/time and text; a "Load older" button
  pages back.

## Non-goals

- File export (CSV/PDF), system-wide keyword search, date-range filter (scroll back with "Load older" instead).
- Audit log of who viewed what (user ruled out).
- Rendering markdown, images or attachments: text is shown as-is, attachments as a file count.

## Anti-goals

- Any non-admin reaching the page or the data.
- Side effects on the viewed conversation: the admin must not join channels, mark anything read, or appear as a member.

## Constraints

- System Admins can already read any channel via the API (`SessionHasPermissionToChannel` grants on
  `manage_system`, `server/channels/app/authorization.go:131`) and list any user's channels including DMs
  (`GET /api/v4/users/{user_id}/channels`). Neither joins or marks read.
- That endpoint lists channels the user is a member of now; a channel they left does not appear. DMs/GMs never drop.

## Approaches

- A. Revive the old Compliance Monitoring page (CSV in a zip, read in Excel). Hard to follow a conversation; DMs named
  by user ids.
- **B. New in-console viewer (chosen by the user).** Webapp-only, reuses existing APIs.
- C. Both: twice the work for a file output nobody needs now.

## Design

- `webapp/platform/client/src/client4.ts`: add `getChannelsForUser(userId)` → `GET {users}/{userId}/channels`.
- `webapp/channels/src/components/admin_console/conversation_viewer/conversation_viewer.tsx`, modelled on
  `breaks_report.tsx` (local state, `Client4` called directly, nothing put in the redux channel/post stores so the rest
  of the app is unaffected):
  - User picker: text input + `Client4.autocompleteUsers` results (or the existing admin user selector if one fits).
  - Channel list from `getChannelsForUser`, sorted by `last_post_at` desc. DM/GM label = the other members' display
    names (`getMissingProfilesByIds` + `displayUsername`, ids parsed from the DM name `a__b`; GM uses `display_name`).
  - Posts via `Client4.getPosts(channelId, 0, 60)`, then `getPostsBefore(channelId, oldestId, 0, 60)` for "Load older".
    Show root posts and replies alike in time order; system messages shown dimmed.
- `admin_definition.tsx`: entry after `breaks_report`, `isHidden: it.not(it.isSystemAdmin)`.
- i18n strings in `webapp/channels/src/i18n/en.json` (+ tr if the Breaks page has tr strings).
- One component test like `breaks_report.test.tsx`: mocked Client4, picks a user, opens a DM, sees messages in order.

## Left to the builder

- Exact styling (reuse admin console classes).
- Whether deleted posts are shown (default: no, the API leaves them out).
