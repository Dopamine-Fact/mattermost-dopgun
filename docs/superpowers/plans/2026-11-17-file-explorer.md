# File Explorer (Channel Drives) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows-Explorer-like "Files" page where each channel is a folder with its own drive (folders, upload, rename, move, copy, delete to Recycle Bin), plus a read-only "Chat attachments" folder, with image previews.

**Architecture:** New `DriveItems` table (folders + file entries pointing at `FileInfo`) per channel, behind a per-team `FilesEnabled` toggle. App layer owns permissions and all operations; REST under `/api/v4/channels/{channel_id}/drive`. Webapp page `/:team/files` in layout C (tree, toolbar, address bar, grid/details, preview pane, status bar).

**Tech Stack:** Go (squirrel, store layers, testlib), PostgreSQL migrations, React + Redux (TypeScript), react-intl, existing `FilePreviewModal`, `uploadFile` action.

**Spec:** `docs/superpowers/specs/2026-11-17-file-explorer-design.md` — read it first; this plan does not repeat its rules.

## Global Constraints

- Follow the daily reports feature as the template for every wiring point (commits `f5acf63bf4`, `46ade5c195`, `8418cb7243`, `ba623de8db`).
- Store methods take `request.CTX` where they need context, never `context.Context` (server/AGENTS.md).
- Never run `go mod tidy`; use `make modules-tidy`. After editing `server/i18n/en.json` run `make i18n-extract` and fill every new `description`.
- Regenerate store layers/mocks with `make store-layers` and `make store-mocks` (from `server/`), never by hand.
- Migration number `000250`, postgres only, add both files to `server/channels/db/migrations/migrations.list`.
- Item name rule: 1–255 chars, not `.`/`..`, none of `\ / : * ? " < > |`, no trailing space or dot. Unique per folder case-insensitively among live items.
- Recycle Bin retention: 30 days. Folder listing cap: 2000 children. Zip cap: 200 MB total (413 above). Chat attachments page size: 60.
- Strings in en + tr (webapp `en.json`/`tr.json`, server `en.json`/`tr.json`).
- Do not touch unrelated uncommitted files in the working tree (`imaging/psd*.go`, `web/files.go`, `file_thumbnail.test.tsx`, `constants.tsx`, `utils.test.tsx` belong to other work).

## Review Focus

1. **Drive file id sent in `CreatePost`** → must fail and leave the file in the drive (Task 1 store test + Task 3 API test).
2. **Cross-channel move then old member fetches `/files/{id}`** → 403 immediately, not after cache expiry (Task 3 API test).
3. **Non-admin deletes a folder containing someone else's file** → 403, nothing deleted (Task 2 app test).
4. **Moving a folder into its own descendant** → 400, tree unchanged (Task 2 app test).
5. **Two uploads with the same name into one folder (incl. different case)** → second becomes `name (2).ext`, never a DB unique-violation 500 (Task 2 app test).

---

### Task 1: Model, migration, store

**Files:**
- Create: `server/public/model/drive_item.go`, `server/public/model/drive_item_test.go`
- Create: `server/channels/db/migrations/postgres/000250_create_drive_items.{up,down}.sql`; Modify: `migrations.list`
- Create: `server/channels/store/sqlstore/drive_item_store.go`, `drive_item_store_test.go`, `server/channels/store/storetest/drive_item_store.go`
- Modify: `server/channels/store/store.go`, `sqlstore/store.go`, `storetest/store.go`, `sqlstore/team_store.go`, `sqlstore/file_info_store.go`, `server/public/model/team.go`, `server/public/model/file_info.go`
- Generated: retry/timer layers, mocks

**Interfaces — Produces:**
```go
const (DriveItemTypeFolder = "folder"; DriveItemTypeFile = "file"; DriveTrashRetention = 30 * 24 * time.Hour)
type DriveItem struct {
    Id, ChannelId, ParentId, Type, Name, FileId, CreatorId string
    CreateAt, UpdateAt, DeleteAt int64
    DeletedBy string
    FileInfo *FileInfo `json:"file_info,omitempty"` // filled by app on reads
}
func (o *DriveItem) PreSave(); func (o *DriveItem) IsValid() *AppError; func IsValidDriveItemName(name string) bool
// Team: FilesEnabled bool `json:"files_enabled"`; TeamPatch: FilesEnabled *bool
// FileInfo: FileinfoSortByName = "Name"; GetFileInfosOptions.ChatAttachmentsOnly bool
type DriveItemStore interface {
    Save(item *model.DriveItem) (*model.DriveItem, error)
    Get(id string) (*model.DriveItem, error)
    GetMany(ids []string) ([]*model.DriveItem, error)
    GetChildren(channelID, parentID string, limit int) ([]*model.DriveItem, error) // live only, folders first, then lower(Name)
    GetDescendants(channelID, folderID string) ([]*model.DriveItem, error)          // live, recursive (CTE)
    GetAncestors(id string) ([]*model.DriveItem, error)                              // root → parent order
    NameExists(channelID, parentID, name, excludeID string) (bool, error)          // case-insensitive, live only
    Update(item *model.DriveItem) (*model.DriveItem, error)
    UpdateMany(items []*model.DriveItem) error                                      // one transaction
    GetTrash(channelID string) ([]*model.DriveItem, error)                          // DeleteAt > 0, newest first
    GetExpiredTrash(before int64, limit int) ([]*model.DriveItem, error)
    GetByFileId(fileID string) (*model.DriveItem, error)
    GetDangling(limit int) ([]*model.DriveItem, error)                              // file items whose FileInfo is missing or DeleteAt>0
    PermanentDelete(ids []string) error
    PermanentDeleteByChannel(channelID string) error
}
```
Store accessor: `Store.DriveItem() DriveItemStore`.

- [ ] **Step 1: Write failing tests.** `TestDriveItemIsValid` (table: `"a.png"` ok; `""`, `"."`, `".."`, `"a/b"`, `"a:b"`, `"x "`, `"x."`, 256 chars → invalid; bad Type → invalid; file with empty FileId → invalid). `storetest.TestDriveItemStore` subtests: `SaveGet`, `ChildrenFoldersFirstSortedByName`, `ChildrenHideDeleted`, `DescendantsRecursive`, `AncestorsOrder`, `NameExistsCaseInsensitiveLiveOnly` (`"A.png"` vs `"a.PNG"` → true; deleted twin → false), `TrashAndExpired`, `Dangling` (FileInfo soft-deleted → returned), `PermanentDeleteByChannel`. In `storetest/file_info_store.go`: `GetWithOptionsSortByName`; `ChatAttachmentsOnly` keeps a posted file and a `bookmark` file, drops an unattached upload and a file whose post is in `TemporaryPosts`; `AttachToPostRejectsDriveFile` (FileInfo referenced by a DriveItem → `AttachToPost` returns error, PostId stays ""). Team store: `FilesEnabled` round-trips through Save/Update.
- [ ] **Step 2: Run** `cd server && go test ./public/model -run TestDriveItem && go test ./channels/store/sqlstore -run 'TestDriveItemStore|TestFileInfoStore|TestTeamStore'` → FAIL (undefined).
- [ ] **Step 3: Migration.** Up: `ALTER TABLE Teams ADD COLUMN IF NOT EXISTS FilesEnabled boolean NOT NULL DEFAULT false;` + `CREATE TABLE IF NOT EXISTS DriveItems (...)` with columns from Interfaces (varchar(26) ids, `Name varchar(256)`, `Type varchar(16)`, bigint times), index `idx_driveitems_channel_parent_delete (ChannelId, ParentId, DeleteAt)`, index `idx_driveitems_fileid (FileId)`, unique `idx_driveitems_live_name ON DriveItems (ChannelId, ParentId, lower(Name)) WHERE DeleteAt = 0`. Down drops table and column.
- [ ] **Step 4: Implement** model, store, team fields (copy `DailyReportsEnabled` wiring in `team.go`/`team_store.go`), `FileinfoSortByName` → `ORDER BY FileInfo.Name`, `ChatAttachmentsOnly` → the two `Where`s from `file_info_store.go:578-582`, and `AttachToPost` extra `Where(sq.Expr("NOT EXISTS (SELECT 1 FROM DriveItems WHERE DriveItems.FileId = FileInfo.Id)"))`. Then `make store-layers store-mocks`.
- [ ] **Step 5: Run** the Step 2 commands → PASS. Also `go build ./...`.
- [ ] **Step 6: Commit** `feat: drive item model, migration and store`.

### Task 2: App layer

**Files:**
- Create: `server/channels/app/drive.go`, `server/channels/app/drive_test.go`
- Modify: `server/channels/app/channels.go` (+`driveTrashTask leaderTask`, stop), `server/channels/app/server.go` (hourly `runOnLeader` like daily reports), `server/channels/app/channel.go:3895` (`PermanentDeleteChannel` → `DriveItem().PermanentDeleteByChannel`), `server/public/model/websocket_message.go` (`WebsocketDriveChanged = "drive_changed"`), `server/i18n/en.json`, `tr.json`

**Interfaces — Produces:**
```go
type DriveAction int // DriveRead, DriveCreate, DriveModify
type DriveListing struct { Items []*model.DriveItem `json:"items"`; Path []*model.DriveItem `json:"path"` }
func (a *App) RequireDriveChannel(rctx request.CTX, channelID string) (*model.Channel, *model.AppError) // team FilesEnabled, not DM/GM
func (a *App) DriveCan(rctx request.CTX, session model.Session, channel *model.Channel, action DriveAction, item *model.DriveItem) bool
func (a *App) ListDriveFolder(rctx request.CTX, channel *model.Channel, parentID string) (*DriveListing, *model.AppError)
func (a *App) CreateDriveFolder(rctx request.CTX, userID string, channel *model.Channel, parentID, name string) (*model.DriveItem, *model.AppError)
func (a *App) AddDriveFile(rctx request.CTX, userID string, channel *model.Channel, parentID, fileID string) (*model.DriveItem, *model.AppError)
func (a *App) RenameDriveItem(rctx request.CTX, item *model.DriveItem, name string) (*model.DriveItem, *model.AppError)
func (a *App) MoveDriveItems(rctx request.CTX, session model.Session, src *model.Channel, ids []string, dst *model.Channel, dstParentID string) *model.AppError
func (a *App) CopyDriveItems(rctx request.CTX, session model.Session, src *model.Channel, ids, chatFileIDs []string, dst *model.Channel, dstParentID string) *model.AppError
func (a *App) DeleteDriveItems(rctx request.CTX, session model.Session, channel *model.Channel, ids []string, permanent bool) *model.AppError
func (a *App) GetDriveTrash(rctx request.CTX, channel *model.Channel) ([]*model.DriveItem, *model.AppError)
func (a *App) RestoreDriveItems(rctx request.CTX, session model.Session, channel *model.Channel, ids []string) *model.AppError
func (a *App) EmptyDriveTrash(rctx request.CTX, session model.Session, channel *model.Channel) *model.AppError
func (a *App) GetDriveChatFiles(rctx request.CTX, channelID string, page, perPage int, sortBy string, desc bool) ([]*model.FileInfo, *model.AppError)
func (a *App) WriteDriveZip(rctx request.CTX, session model.Session, channel *model.Channel, ids []string, w io.Writer) *model.AppError
func (a *App) RunDriveTrashPurge(rctx request.CTX, now time.Time)
```
Rules (from spec): admin test = `PermissionManageChannelRoles` on channel; read = `SessionHasPermissionToReadChannel` + ABAC download action when `FeatureFlags.PermissionPolicies`; create = read + `PermissionUploadFile` + channel not archived; modify = create + (creator or admin), folders need every live descendant to be the caller's unless admin. Name clash on add/copy/move → `uniqueDriveName(channelID, parentID, name) string` giving `name (2).ext`, `name (3).ext`… (extension = text after the last dot, none for folders). Every FileInfo change (rename, ChannelId on cross-channel move, soft delete) goes through `FileInfo().Upsert`. Copy duplicates `Path`, `PreviewPath`, `ThumbnailPath` with `FileBackend().CopyFile` into `<date>/teams/noteam/channels/<dst>/users/<user>/<newId>/<name>` (same layout as uploads) and saves a new FileInfo (`CreatorId` = caller, `ChannelId` = dst, `PostId` ""). Chat file copy validates `ChannelId == src`, `DeleteAt == 0`, posted-or-bookmark, not in `TemporaryPosts`. Restore: parent gone or deleted → root; name clash → unique name. Permanent delete: rows of the subtree + FileInfo soft delete + `RemoveFile` of its three paths. Purge: `GetExpiredTrash(now-30d)` + `GetDangling`. After each write: publish `WebsocketDriveChanged` to the channel with `parent_ids` (JSON array). Zip: sum sizes first, > 200 MB → 413 `app.drive.zip_too_large.app_error`; entries keep folder paths.

- [ ] **Step 1: Write failing tests** in `drive_test.go` (use `Setup(t).InitBasic(t)`; enable `FilesEnabled` on `th.BasicTeam`): `TestDriveDisabledTeam` (403), `TestDriveCreateAndList` (folders first; path for nested folder), `TestDriveNameClash` (`a.png`, `A.PNG` → `A (2).PNG`; folder `Docs` twice → `Docs (2)`), `TestDriveRenameRules` (bad name 400; existing name 400; renames FileInfo.Name), `TestDrivePermissions` (BasicUser2 can't rename/delete BasicUser's item; after `UpdateChannelMemberSchemeRoles(..., isSchemeAdmin=true)` they can), `TestDriveFolderDeleteWithOthersFiles` (403, nothing changed), `TestDriveMoveIntoDescendant` (400), `TestDriveCrossChannelMove` (FileInfo.ChannelId updated; requires membership in both), `TestDriveCopyDuplicatesBytes` (new FileInfo, different Path, reading it returns same bytes; deleting original's post via `PermanentDeleteFilesByPost` leaves copy readable), `TestDriveCopyChatFileRules` (burn-on-read → 403; other channel → 403), `TestDriveTrashRestore` (restore to root when parent permanently deleted), `TestDrivePurge` (31-day-old trash and dangling items removed, 29-day kept), `TestDriveArchivedReadOnly`, `TestDriveZipCap`.
- [ ] **Step 2: Run** `cd server && go test ./channels/app -run TestDrive` → FAIL.
- [ ] **Step 3: Implement** `drive.go`, ticker wiring (`time.Hour`), channel delete hook, websocket constant, i18n ids `app.drive.*`; `make i18n-extract`, fill descriptions.
- [ ] **Step 4: Run** Step 2 → PASS; `go vet ./channels/app`.
- [ ] **Step 5: Commit** `feat: drive app layer, permissions and trash purge`.

### Task 3: REST API and Go client

**Files:**
- Create: `server/channels/api4/drive.go`, `drive_test.go`, `server/public/model/client4_drive.go`
- Modify: `server/channels/api4/api.go` (`api.InitDrive()`), `server/public/model/audit_events.go`

**Interfaces — Consumes:** Task 2. **Produces:** routes on `api.BaseRoutes.Channel` with `APISessionRequired`:
`GET /drive/items?parent_id=` → `DriveListing` · `POST /drive/items` body `{type, name?, file_id?, parent_id}` → item (201) · `PATCH /drive/items/{item_id}` `{name}` · `POST /drive/move` / `POST /drive/copy` `{item_ids, file_ids?, target_channel_id, target_parent_id}` · `POST /drive/delete` `{item_ids, permanent}` · `GET /drive/trash` · `POST /drive/trash/restore` `{item_ids}` · `POST /drive/trash/empty` · `GET /drive/chat_files?page&per_page&sort_by&sort_desc` · `POST /drive/download` `{item_ids}` → `application/zip`, `Content-Disposition: attachment; filename="<channel-name>.zip"`.
Every handler: `RequireChannelId`, `RequireDriveChannel`, `DriveCan(...DriveRead)` before anything else; item ids must belong to the URL channel (404 otherwise). `per_page` ≤ 200. Client4: `GetDriveFolder`, `CreateDriveFolder`, `AddDriveFile`, `RenameDriveItem`, `MoveDriveItems`, `CopyDriveItems`, `DeleteDriveItems`, `GetDriveTrash`, `RestoreDriveItems`, `EmptyDriveTrash`, `GetDriveChatFiles`, `DownloadDriveZip`. Audit records for every write.

- [ ] **Step 1: Write failing tests** `TestDriveAPI` subtests: `NonMember403`, `ToggleOff403`, `ABACDenied403` (copy the `PermissionPolicies` setup from `getFileInfosForPost` tests), `UploadAndList`, `ClaimOthersFile403` (BasicUser2 `AddDriveFile` with BasicUser's upload id), `ItemFromOtherChannel404`, `CreatePostWithDriveFileFails` (post creation errors or the file stays in drive with `PostId==""`), `MoveRevokesOldChannelImmediately` (old-channel member: `GetFile` → 200 before, 403 right after move), `ChatFilesFiltersAndSorts`, `DownloadZip` (zip contains `Folder/a.png`).
- [ ] **Step 2: Run** `cd server && go test ./channels/api4 -run TestDriveAPI` → FAIL.
- [ ] **Step 3: Implement** handlers + client.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: drive REST API`.

### Task 4: Webapp plumbing — types, client, toggle, link, route

**Files:**
- Create: `webapp/platform/types/src/drive.ts`, `webapp/channels/src/components/file_explorer/{index.ts,file_explorer_link.tsx,file_explorer_link.test.tsx}`, `webapp/channels/src/components/team_settings/team_info_tab/team_files_section.tsx`
- Modify: `webapp/platform/types/src/teams.ts` (`files_enabled?: boolean`), `webapp/platform/client/src/client4.ts`, `team_info_tab.tsx` (+test), `sidebar/sidebar_list/sidebar_list.tsx`, `channel_layout/center_channel/center_channel.tsx`, `types/store/lhs.ts` (if the link highlights like daily reports), `i18n/en.json`, `tr.json`

**Interfaces — Produces:**
```ts
export type DriveItem = {id: string; channel_id: string; parent_id: string; type: 'folder'|'file'; name: string; file_id: string; creator_id: string; create_at: number; update_at: number; delete_at: number; deleted_by: string; file_info?: FileInfo};
export type DriveListing = {items: DriveItem[]; path: DriveItem[]};
// Client4 (paths per Task 3): getDriveFolder(channelId, parentId), createDriveFolder(channelId, parentId, name), addDriveFile(channelId, parentId, fileId), renameDriveItem(channelId, itemId, name), moveDriveItems(channelId, itemIds, targetChannelId, targetParentId), copyDriveItems(channelId, itemIds, fileIds, targetChannelId, targetParentId), deleteDriveItems(channelId, itemIds, permanent), getDriveTrash(channelId), restoreDriveItems(channelId, itemIds), emptyDriveTrash(channelId), getDriveChatFiles(channelId, page, perPage, sortBy, sortDesc): Promise<FileInfo[]>, getDriveZipUrl / downloadDriveZip(channelId, itemIds): Promise<Blob>
```
Route: `/:team/files/:channelName?/:folderId?` (reserved folderIds `chat`, `trash`) rendering lazy `FileExplorer` (placeholder component in this task: renders title "Files"). Link label "Files", shown only when `team.files_enabled`; route redirects to the team default channel when off.

- [ ] **Step 1: Write failing tests:** `file_explorer_link.test.tsx` (hidden when `files_enabled` false, visible + href `/team/files` when true); `team_info_tab.test.tsx` new case (toggling Files calls `patchTeam` with `{files_enabled: true}`).
- [ ] **Step 2: Run** `cd webapp/channels && npx jest file_explorer_link team_info_tab` → FAIL.
- [ ] **Step 3: Implement** (mirror daily reports link/section/route).
- [ ] **Step 4: Run** → PASS; `npm run check-types` in `webapp/channels`.
- [ ] **Step 5: Commit** `feat: files team setting, sidebar link and route`.

### Task 5: Explorer shell — layout C, navigation, views, preview pane

**Files (all under `webapp/channels/src/components/file_explorer/`):** `file_explorer.tsx` (page, state, data loading), `explorer_tree.tsx`, `explorer_toolbar.tsx`, `explorer_address_bar.tsx`, `explorer_items.tsx` (grid + details), `explorer_preview_pane.tsx`, `explorer_status_bar.tsx`, `use_explorer_data.ts`, `file_explorer.scss`, tests `file_explorer.test.tsx`, `explorer_items.test.tsx`

**Interfaces — Produces:** `useExplorerData(channelId?: string, folderId?: string)` → `{items: ExplorerEntry[]; path: DriveItem[]; loading; error; reload(); loadMore?()}` where `type ExplorerEntry = {key: string; kind: 'channel'|'folder'|'file'|'chat'|'trash'; name: string; driveItem?: DriveItem; fileInfo?: FileInfo; channel?: Channel; readOnly: boolean; canModify: boolean}`. Root entries come from `getMyChannels` filtered to `O`/`P`, `delete_at === 0`, sorted by display name. Inside a channel: `chat` entry, drive items, (trash shown in tree only). `chat` folder pages via `getDriveChatFiles` (60, infinite scroll); drive folders load in one call. `canModify` = creator is current user or `haveIChannelPermission(manage_channel_roles)`.
Views: Large icons (images → `getFileThumbnailUrl`, others → existing file-type icon) / Details (Name, Date modified, Type, Size, Uploaded by; client-side sort for drive folders, server sort for `chat`). View + preview-pane visibility in localStorage (try/catch). Preview pane auto-hidden < 1100px. Address bar: Back/Forward (router history), Up, clickable breadcrumb, "Search this folder" client filter. Double-click/Enter: folder → navigate; file → `openModal(FILE_PREVIEW_MODAL)` with `fileInfos` = folder's files, `startIndex`, `post: {channel_id} as Post` (bookmark pattern, `bookmark_item_content.tsx:66`). Websocket `drive_changed` for the open channel+folder → `reload()`. Empty states and error + retry per spec. A11y: items container `role="grid"`, tiles `role="gridcell"` with roving tabindex and accessible names, visible focus.

- [ ] **Step 1: Write failing tests:** root lists only O/P member channels (DM and archived channel absent); entering a channel shows "Chat attachments" first, folders before files; thumbnail `src` for an image; Details header click sorts by size; double-click file dispatches `openModal` with the right `startIndex`; `drive_changed` for the open folder calls the client again.
- [ ] **Step 2: Run** `npx jest file_explorer explorer_items` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check-types`.
- [ ] **Step 5: Commit** `feat: file explorer layout, navigation and previews`.

### Task 6: Selection, keyboard, context menu, file operations, Recycle Bin

**Files:** `use_explorer_selection.ts` (+test), `explorer_context_menu.tsx`, `explorer_actions.ts` (+test), `explorer_trash_view.tsx`, `explorer_rename_input.tsx`; modify Task 5 components.

**Interfaces — Produces:** `useExplorerSelection(keys: string[])` → `{selected: Set<string>; anchor; click(key, {ctrl, shift}); selectAll(); clear(); setFromRect(keys: string[], additive: boolean)}`. `explorerActions` thunks: `createFolder`, `rename`, `cut`/`copy` (in-memory clipboard `{mode: 'cut'|'copy'; channelId; itemIds; chatFileIds}`), `paste(targetChannelId, targetParentId)` (cut → move, copy → copy), `remove(ids, permanent)`, `restore(ids)`, `emptyTrash()`, `download(entries)` (one file → `getFileDownloadUrl`; otherwise `downloadDriveZip`).
Rubber band: mousedown on empty area, rectangle overlay, intersecting tiles selected (Ctrl adds). Keys per spec: arrows, Enter, Backspace/Alt+↑, Alt+←/→, F2, Delete, Shift+Delete (confirm), Ctrl+A/C/X/V, Ctrl+Shift+N, F5, Esc. Delete → toast "Moved N items to Recycle Bin" with Undo (= restore). Permanent delete and Empty always confirm (existing `ConfirmModal`). Toolbar/context menu items disabled when not allowed (`readOnly`, `!canModify`, archived channel). Recycle Bin view: Details with Deleted on, Deleted by, Original location; Restore / Delete permanently / Empty. Server errors shown as toast with the server message.

- [ ] **Step 1: Write failing tests:** selection — Ctrl toggles, Shift selects range from anchor, `setFromRect` additive vs replace, Esc clears; actions — cut+paste calls `moveDriveItems`, copy+paste from chat calls `copyDriveItems` with `file_ids`, Delete key calls `deleteDriveItems(…, false)` and Undo calls `restoreDriveItems`, Shift+Delete only after confirm; context menu Rename disabled for a chat attachment and for another user's file when not admin; F2 + Enter calls `renameDriveItem`.
- [ ] **Step 2: Run** `npx jest explorer_selection explorer_actions file_explorer` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: explorer selection, context menu, file operations and recycle bin`.

### Task 7: Drag and drop + uploads

**Files:** `use_explorer_dnd.ts` (+test), `explorer_drop_overlay.tsx`, `explorer_upload_panel.tsx`, `use_explorer_uploads.ts` (+test); modify Task 5/6 components.

**Interfaces — Consumes:** `uploadFile` (`actions/file_actions.ts:34`), `addDriveFile`, `createDriveFolder`, `explorerActions`. **Produces:** `useExplorerUploads()` → `{uploads: Upload[]; enqueue(files: Array<{file: File; relPath: string}>, channelId, parentId); cancel(id)}`.
Internal drag (tiles and tree nodes): same channel → move, other channel → copy, Ctrl forces copy, Shift forces move, from `chat` always copy; drop on itself/descendant/read-only target not allowed. OS drag: overlay "Drop to upload to ~channel › Folder"; drop on folder tile uploads there. Dropped folders: walk `webkitGetAsEntry()`, create folders first (`createDriveFolder`, use returned id for children), then files. Upload panel bottom-right: per-file progress, cancel, error text (e.g. size limit); toolbar "Upload ▾" offers files and folder (`<input webkitdirectory>`). After each file upload succeeds → `addDriveFile`; reload on completion.

- [ ] **Step 1: Write failing tests:** `resolveDropEffect({sameChannel, ctrl, shift, fromChat})` table (→ `'move'|'copy'`); dropping a tile on its own descendant is rejected; `enqueue` with `relPath` `"A/B/c.png"` creates folders `A`, then `B` inside `A`, then uploads into `B`; a failed upload shows its error and the others continue.
- [ ] **Step 2: Run** `npx jest explorer_dnd explorer_uploads` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check-types`; `npx eslint src/components/file_explorer`.
- [ ] **Step 5: Commit** `feat: explorer drag and drop and uploads`.

### Task 8: End-to-end check in the running app

- [ ] **Step 1:** Start server + webapp (project's usual dev commands), enable Files on a team in Team Settings.
- [ ] **Step 2:** Walk through as two users (member + channel admin): upload by drag (files and a folder), rename, cut/paste, drag to another channel (copy), delete → Undo, Recycle Bin restore/empty, Chat attachments copy-out, zip download, preview pane and modal on images, keyboard-only pass, narrow window (< 1100px) hides preview pane. Second user's open explorer updates live.
- [ ] **Step 3:** Fix anything found (with a test), commit `fix: file explorer e2e findings`.
