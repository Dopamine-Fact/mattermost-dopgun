# Episode Folder Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part 1 of the episode template rules: per-folder view/write/mirror rules set in Team Settings › Episodes,
seeded by the server into new episodes, and enforced in the drive API.

**Architecture:** The team's folder template stays in `Teams.EpisodeFolders`, now holding a JSON list (old text lines
still parse as rule-less entries, so nothing migrates). Each drive folder carries its own rules in four new
`DriveItems` columns. One pure function judges a folder path for a person's departments; the drive app calls it in
list, create, change, copy, download and trash. A new `POST /teams/{team_id}/episodes` creates channel, task section,
folders and tasks in one call.

**Tech Stack:** Go (model, app, sqlstore, api4), Postgres migrations, React/TypeScript (webapp `channels`), Jest/RTL.

**Spec:** `docs/superpowers/specs/2026-11-19-episode-template-rules-design.md`

## Global Constraints

- Rules apply to newly created episodes only; existing drive folders get no rules (column defaults).
- Channel managers (`manage_channel_roles` on the channel) bypass every folder rule.
- `upload_file` stays required for any change; today's own-items rule stays wherever no write rule applies.
- Template limit stays 100 folders; folder names follow `IsValidDriveItemName`.
- Stüdyo geneli is an ordinary department in rules (no implicit bypass).
- i18n: add strings to `server/i18n/en.json` and `webapp/channels/src/i18n/en.json` by hand, in sorted position, each
  with a `description`. Never run `make i18n-extract`. Never run `go mod tidy`.
- Never push or merge without the user's explicit yes.

## Rulings in this plan (my calls on things the spec left open)

- **No `via` parameter.** The spec says drive calls through a mirror carry the mirror id. Instead the server finds the
  route itself: a folder the person cannot see on its own path is opened through a visible mirror of it or of a folder
  above it, read-only. Same access, no new parameter in the API, URL or explorer state. Cost if wrong: someone who
  sees both the source and its mirror gets the source's breadcrumbs inside the mirror.
- **Nesting in the panel is by "Add subfolder", not drag.** Cost if wrong: one more interaction to add later.
- **An item whose subtree holds a rule folder** can be renamed, moved or deleted only by channel managers (it would
  carry the skeleton with it).
- **Copying or downloading a mirror** copies or zips its source's visible contents; a mirror nested inside a copied
  folder becomes an empty plain folder.
- **The seeding endpoint deletes the channel for good** (not archive) when the task section cannot be created, so the
  name is free again.

## Review Focus

- A department deleted after the template was saved: its id stays in rules; it matches nobody, so the folder is
  visible to managers only — the panel must show it as "Deleted department" and let it be removed.
- A trashed or cross-channel-moved mirror source: the mirror lists nothing with `source_missing`, never errors.
- A person in two departments where one sees and the other writes: visibility and write are judged over the union.
- A write-department member deleting a plain folder full of other people's files inside their folder: allowed
  (decision 9) — and a plain member doing the same where no rule applies: still refused (own-items).
- Old text template opened in the new panel and saved untouched: no change is detected, nothing is written.

---

## File map

Server:
- `server/public/model/team.go` — `EpisodeFolder`, `ParseEpisodeFolders`, `isValidEpisodeFolders`.
- `server/public/model/drive_item.go` — `DriveRules`, `DriveListing.Access/SourceMissing`.
- `server/public/model/episode.go` (new) — `EpisodeCreate`, `EpisodeCreated`.
- `server/channels/db/migrations/postgres/000258_drive_folder_rules.{up,down}.sql`,
  `000259_drive_items_mirror_index.{up,down}.sql`, `migrations.list`.
- `server/channels/store/store.go`, `sqlstore/drive_item_store.go`, `storetest/drive_item_store.go`, generated layers
  and mock.
- `server/channels/app/drive_rules.go` (new) — rule evaluation; `drive.go` — enforcement.
- `server/channels/app/episode.go` (new) — `CreateEpisode`; `server/channels/api4/episode.go` (new) — route.
- `server/public/model/client4_episode.go` (new) — `CreateEpisode` for API tests.

Webapp (`webapp/`):
- `platform/types/src/drive.ts`, `platform/types/src/teams.ts`, `platform/client/src/client4.ts`.
- `channels/src/actions/tasks.ts` — `createEpisodeChannel` on the new endpoint.
- `channels/src/components/team_settings/team_episodes_tab/episode_folders.ts` (new) — parse/serialize/tree ops.
- `.../team_episodes_tab/episode_folder_panel.tsx` (new) + `.scss` — the panel.
- `.../team_episodes_tab/team_episodes_tab.tsx`, `team_episode_templates_section.tsx` — wiring.
- `channels/src/components/file_explorer/use_explorer_data.ts`, `file_explorer.tsx`, `explorer_items.tsx` — access,
  icons, note.

Commands (server tests need the test Postgres the earlier server tasks used):
- Model: `cd server/public && go test ./model -run <Name>`
- Store: `cd server && go test ./channels/store/sqlstore -run TestDriveItemStore`
- App: `cd server && go test ./channels/app -run <Name>`
- API: `cd server && go test ./channels/api4 -run <Name>`
- Webapp (from `webapp/channels`): `TZ=UTC npx jest <paths>`, `npx tsc --noEmit -p .`, `npx eslint <files>`

---

### Task 1: Structured folder template

**Files:**
- Modify: `server/public/model/team.go:21-22,109,149,172-191,292`
- Test: `server/public/model/team_test.go`
- Modify: `server/i18n/en.json` (only if the folders error message text changes; the id stays)

**Interfaces:**
- Produces:
  ```go
  const TeamEpisodeFoldersMaxRunes = 100000 // JSON with department ids; tasks keep TeamEpisodeTemplateMaxRunes
  // EpisodeFolder is one folder of the episode template. Empty ViewDepartments = everyone. Empty WriteDepartments
  // with ReadOnly false = the viewers may change it. MirrorOf is another entry's Path.
  type EpisodeFolder struct {
      Path             string   `json:"path"`
      ViewDepartments  []string `json:"view_departments,omitempty"`
      WriteDepartments []string `json:"write_departments,omitempty"`
      ReadOnly         bool     `json:"read_only,omitempty"`
      MirrorOf         string   `json:"mirror_of,omitempty"`
  }
  // ParseEpisodeFolders reads the JSON list, or (text not starting with "[") the old one-path-per-line format.
  func ParseEpisodeFolders(text string) ([]*EpisodeFolder, error)
  // Rules returns the drive rules a folder seeded from e gets (write defaults to the viewers when they are restricted).
  func (e *EpisodeFolder) Rules() DriveRules  // DriveRules comes from Task 2; add this method in Task 2
  ```

- [ ] **Step 1: Write the failing tests** in `team_test.go`:

```go
func TestParseEpisodeFolders(t *testing.T) {
	got, err := ParseEpisodeFolders(" Layout \n\nLayout/Ref\r\n")
	require.NoError(t, err)
	require.Equal(t, []*EpisodeFolder{{Path: "Layout"}, {Path: "Layout/Ref"}}, got)

	got, err = ParseEpisodeFolders(`[{"path":"BG/Layout","view_departments":["` + bg + `"]},{"path":"Anim/Layout","mirror_of":"BG/Layout"}]`)
	require.NoError(t, err)
	require.Equal(t, "BG/Layout", got[1].MirrorOf)

	got, err = ParseEpisodeFolders("")
	require.NoError(t, err)
	require.Empty(t, got)

	_, err = ParseEpisodeFolders("[{")
	require.Error(t, err)
}

func TestIsValidEpisodeFolders(t *testing.T) {
	// bg, anim are NewId() values; js(...) marshals []*EpisodeFolder to a string
	for name, tc := range map[string]struct{ folders []*EpisodeFolder; ok bool }{
		"rule-less":               {[]*EpisodeFolder{{Path: "A"}, {Path: "A/B"}}, true},
		"write within view":       {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{bg, anim}, WriteDepartments: []string{bg}}}, true},
		"write outside view":      {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{bg}, WriteDepartments: []string{anim}}}, false},
		"write with everyone":     {[]*EpisodeFolder{{Path: "A", WriteDepartments: []string{anim}}}, true},
		"bad department id":       {[]*EpisodeFolder{{Path: "A", ViewDepartments: []string{"x"}}}, false},
		"bad segment":             {[]*EpisodeFolder{{Path: "A/../B"}}, false},
		"duplicate path":          {[]*EpisodeFolder{{Path: "A"}, {Path: "a"}}, false},
		"mirror ok":               {[]*EpisodeFolder{{Path: "BG/L"}, {Path: "AN/L", MirrorOf: "BG/L"}}, true},
		"mirror of itself":        {[]*EpisodeFolder{{Path: "A", MirrorOf: "A"}}, false},
		"mirror of unknown":       {[]*EpisodeFolder{{Path: "A", MirrorOf: "B"}}, false},
		"mirror of mirror":        {[]*EpisodeFolder{{Path: "S"}, {Path: "M1", MirrorOf: "S"}, {Path: "M2", MirrorOf: "M1"}}, false},
		"mirror of ancestor":      {[]*EpisodeFolder{{Path: "A"}, {Path: "A/M", MirrorOf: "A"}}, false},
		"mirror of descendant":    {[]*EpisodeFolder{{Path: "A/S"}, {Path: "A", MirrorOf: "A/S"}}, false},
		"mirror with writers":     {[]*EpisodeFolder{{Path: "S"}, {Path: "M", MirrorOf: "S", WriteDepartments: []string{bg}}}, false},
		"mirror with subfolder":   {[]*EpisodeFolder{{Path: "S"}, {Path: "M", MirrorOf: "S"}, {Path: "M/X"}}, false},
	} {
		t.Run(name, func(t *testing.T) { require.Equal(t, tc.ok, isValidEpisodeFolders(js(tc.folders))) })
	}
	require.True(t, isValidEpisodeFolders("Layout\nLayout/Ref"))
	require.False(t, isValidEpisodeFolders(js(make101Folders())))
}
```

Update `TestTeamEpisodeTemplatesIsValid` so its folder cases still pass through `IsValid` (old text format).

- [ ] **Step 2: Run** `cd server/public && go test ./model -run 'TestParseEpisodeFolders|TestIsValidEpisodeFolders|TestTeamEpisodeTemplatesIsValid'`
  Expected: FAIL, `undefined: ParseEpisodeFolders`.

- [ ] **Step 3: Implement** in `team.go`: `EpisodeFolder`, `ParseEpisodeFolders`, `isValidEpisodeFolders(text string) bool`
  (rune limit `TeamEpisodeFoldersMaxRunes`, ≤ `TeamEpisodeTemplateMaxLines` entries, every segment valid, unique paths
  case-insensitive, department ids `IsValidId`, the write ⊆ view and mirror rules above). `IsValid` calls it for
  folders; tasks keep `isValidEpisodeTemplate(text, false)`. The `episode_folders` counts at lines 109 and 149 count
  parsed entries (0 when it does not parse).

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Parse and validate the structured episode folder template"`

---

### Task 2: Folder rules on drive items

**Files:**
- Modify: `server/public/model/drive_item.go`, `server/public/model/team.go` (`EpisodeFolder.Rules`)
- Create: `server/channels/db/migrations/postgres/000258_drive_folder_rules.up.sql` / `.down.sql`,
  `000259_drive_items_mirror_index.up.sql` / `.down.sql`; Modify: `server/channels/db/migrations/migrations.list`
- Modify: `server/channels/store/store.go:1300-1325`, `server/channels/store/sqlstore/drive_item_store.go:24,38-56,133-143`
- Regenerate: `cd server && make store-layers && make store-mocks`
- Test: `server/public/model/drive_item_test.go` (create if missing), `server/channels/store/storetest/drive_item_store.go`
- Modify: `server/i18n/en.json` — `model.drive_item.is_valid.rules.app_error` ("Invalid drive folder rules.")

**Interfaces:**
- Produces:
  ```go
  // DriveRules are a folder's access rules from an episode template; items inside follow their folder.
  type DriveRules struct {
      ViewDepartments  StringArray `json:"view_departments,omitempty"`
      WriteDepartments StringArray `json:"write_departments,omitempty"`
      ReadOnly         bool        `json:"read_only,omitempty"`
      MirrorOf         string      `json:"mirror_of,omitempty"` // source folder id
  }
  func (r DriveRules) HasRules() bool  // any field set
  // DriveItem embeds DriveRules (flattened in JSON and in sqlx).
  type DriveListing struct {
      Items []*DriveItem; Path []*DriveItem
      Access        string `json:"access"`                   // "" no write rule, "write", "read"
      SourceMissing bool   `json:"source_missing,omitempty"` // a mirror whose source is gone
  }
  const (DriveAccessDefault = ""; DriveAccessWrite = "write"; DriveAccessRead = "read")
  // DriveItemStore:
  // GetMirrors lists live mirrors in the channel whose MirrorOf is one of sourceIDs.
  GetMirrors(channelID string, sourceIDs []string) ([]*model.DriveItem, error)
  ```

- [ ] **Step 1: Write the failing tests.**
  - Model: `TestDriveItemRulesIsValid` — a file with any rule → `model.drive_item.is_valid.rules.app_error`; a folder
    with `ViewDepartments{"x"}` → same error; `MirrorOf: "x"` → same error; a folder with valid ids → nil.
    `TestEpisodeFolderRules` — `{View:[bg]}.Rules()` gives `Write == [bg]`; `{View:[bg], ReadOnly:true}` gives empty
    write; `{}` gives zero rules; mirror entries return rules without `MirrorOf` (the seeder fills the id).
  - Store: `t.Run("Rules", ...)` — save a folder with all four fields, `Get` returns them equal; set
    `DriveRules{}` and `Update`, `Get` returns zero rules. `t.Run("GetMirrors", ...)` — two mirrors of S in channel
    1, one trashed, one mirror of S in channel 2: `GetMirrors(ch1, []string{S})` returns only the live one in ch1;
    `GetMirrors(ch1, nil)` returns empty without error.

- [ ] **Step 2: Run** model and store tests. Expected: FAIL to compile (`DriveRules` undefined).

- [ ] **Step 3: Implement.**
  - Migration 000258 (transactional):
    ```sql
    ALTER TABLE DriveItems ADD COLUMN IF NOT EXISTS ViewDepartments text NOT NULL DEFAULT '[]';
    ALTER TABLE DriveItems ADD COLUMN IF NOT EXISTS WriteDepartments text NOT NULL DEFAULT '[]';
    ALTER TABLE DriveItems ADD COLUMN IF NOT EXISTS ReadOnly boolean NOT NULL DEFAULT false;
    ALTER TABLE DriveItems ADD COLUMN IF NOT EXISTS MirrorOf varchar(26) NOT NULL DEFAULT '';
    ```
    Down drops the four columns. Migration 000259 is `-- morph:nontransactional` +
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driveitems_mirrorof ON DriveItems (ChannelId, MirrorOf) WHERE MirrorOf <> '' AND DeleteAt = 0;`
    (down: `DROP INDEX CONCURRENTLY IF EXISTS ...`). Append the four files to `migrations.list` in order.
  - Store: add the four columns to `driveItemColumns`, `Save` values and `updateQuery` (so a cross-team move can clear
    them). `GetMirrors` returns `[]` for empty `sourceIDs`. A nil `StringArray` must write `'[]'`, not `'null'`
    (convert in `Save`/`updateQuery` or make `HasRules` and readers treat both alike — the test asserts round-trip).
  - `IsValid`: rules only on folders; ids valid.

- [ ] **Step 4: Run** `make store-layers store-mocks`, then the model and store tests. Expected: PASS; `go build ./...` clean.

- [ ] **Step 5: Commit** `git commit -m "Store folder rules on drive items"`

---

### Task 3: Rule evaluation

**Files:**
- Create: `server/channels/app/drive_rules.go`, `server/channels/app/drive_rules_test.go`

**Interfaces:**
- Consumes: `model.DriveRules`, `DriveItemStore.GetAncestors/GetMirrors`, `driveFolderPath` (drive.go).
- Produces:
  ```go
  type driveWrite int
  const (driveWriteDefault driveWrite = iota; driveWriteAllowed; driveWriteDenied)

  // driveRuleAccess judges a folder path (root first, the folder last) for someone in depts. Visible: every folder
  // on it has no view list or lists one of depts. Write: denied when a mirror is on the path; else the nearest folder
  // with ReadOnly or write departments decides; default when none has one.
  func driveRuleAccess(path []*model.DriveItem, depts map[string]bool) (visible bool, write driveWrite)

  // driveViewer is one person in one channel's drive.
  type driveViewer struct {
      manager bool            // manage_channel_roles: bypasses every folder rule
      depts   map[string]bool // department ids of the person's ranks in the channel's team
  }
  func (a *App) driveViewerFor(rctx request.CTX, session model.Session, channel *model.Channel) (*driveViewer, *model.AppError)
  func (v *driveViewer) access(path []*model.DriveItem) (visible bool, write driveWrite) // manager → true, allowed

  // driveReadPath is how v reaches folderID ("" = root): its own path when visible, else the path through the first
  // live mirror (of the folder or a folder above it) that v can see: mirror's path + the source folders below the
  // mirrored one. mirrored is true for the second. 404 driveError "not_found" when neither.
  func (a *App) driveReadPath(v *driveViewer, channel *model.Channel, folderID string) (path []*model.DriveItem, mirrored bool, appErr *model.AppError)
  ```
  Departments: team member `ExplicitRoles` → `model.RankIdsFromRoles` → `CustomRole().GetForTeam(channel.TeamId)`
  id → `DepartmentId`.

- [ ] **Step 1: Write the failing tests.**
  - `TestDriveRuleAccess` (pure, table): folders built as `&model.DriveItem{Type: folder, DriveRules: ...}`.
    - `[]` → visible, default.
    - `[BG-only]` with `{anim}` → not visible; with `{bg}` → visible.
    - `[BG-only, plain]` with `{anim}` → not visible (narrows down the path).
    - `[write:{bg}, plain]` with `{bg}` → allowed; with `{anim}` → denied.
    - `[write:{bg}, readonly]` with `{bg}` → denied (nearest wins); `[readonly, write:{bg}]` with `{bg}` → allowed.
    - `[mirror]` with anyone → visible, denied; `[mirror(view anim), sub(write anim)]` with `{anim}` → denied.
    - two departments `{bg, anim}` on `[view:{anim}, write:{bg}]` → visible, allowed.
  - `TestDriveReadPath` (DB, `setupDrive`): BasicUser holds a rank of department BG, BasicUser2 a rank of ANIM (create
    departments and ranks via `th.App.CreateDepartment` / rank store and `SetMemberRanks` as the department tests do).
    Tree: `BG(view bg)/Layout/sub`, `Anim(view anim)/Layout(mirror of BG/Layout, view anim)`.
    - user2 on `sub` → path names `[Anim, Layout, sub]`, mirrored true.
    - user2 on `BG/Layout` → path `[Anim, Layout]`, mirrored true.
    - user2 on `BG` → 404.
    - user1 on `sub` → `[BG, Layout, sub]`, mirrored false.
    - a channel admin with no rank on `BG` → visible (manager).
    - a source subfolder `BG/Layout/secret(view bg)`: user2 on `secret` → 404.

- [ ] **Step 2: Run** `go test ./channels/app -run 'TestDriveRuleAccess|TestDriveReadPath'`. Expected: FAIL (undefined).

- [ ] **Step 3: Implement** `drive_rules.go` with the signatures above.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Judge drive folder rules for a person"`

---

### Task 4: Enforce rules on reads (list, mirrors, trash, download, copy source)

**Files:**
- Modify: `server/channels/app/drive.go` — `ListDriveFolder`, `GetDriveTrash`, `WriteDriveZip`, `CopyDriveItems`,
  `copyDriveTree`
- Modify: `server/channels/api4/drive.go` — pass the session to `ListDriveFolder` and `GetDriveTrash`
- Test: `server/channels/app/drive_test.go` (update the `driveListNames` helper and callers), `server/channels/api4/drive_test.go`

**Interfaces:**
- Consumes: Task 3's `driveViewerFor`, `driveReadPath`, `access`.
- Produces (signature changes):
  ```go
  func (a *App) ListDriveFolder(rctx request.CTX, session model.Session, channel *model.Channel, parentID string) (*DriveListing, *model.AppError)
  func (a *App) GetDriveTrash(rctx request.CTX, session model.Session, channel *model.Channel) ([]*model.DriveItem, *model.AppError)
  // driveVisibleTree returns the live items below root that v may see (folders whose own view excludes v are dropped
  // with their subtrees); a mirror root yields its source's tree (empty when the source is gone).
  func (a *App) driveVisibleTree(v *driveViewer, root *model.DriveItem) ([]*model.DriveItem, *model.AppError)
  ```
  Listing: path from `driveReadPath`; when the last folder is a mirror, children are the source's (`SourceMissing`
  when the source is not live in this channel); child folders whose own view excludes v are dropped; `Access` =
  `read` when mirrored or write denied, `write` when allowed, `""` otherwise (computed from departments even for
  managers — it drives icons, not permission). Trash: an item is listed when the person is a manager or its
  ancestors plus itself (if a folder) are visible (`GetAncestors` per item; `// shortcut: one query per trashed item,
  batch if the bin gets large`). Download and copy: every selected item's parent must pass `driveReadPath`, a selected
  folder's own view must include v, and their contents come from `driveVisibleTree`.

- [ ] **Step 1: Write the failing tests** (same BG/ANIM fixture as Task 3; factor it into a `driveRulesFixture` helper
  in `drive_rules_test.go`):
  - `TestDriveListRules`: user2 listing root sees `Anim` but not `BG`; listing the mirror shows the source files with
    `Access == "read"`; user1 listing `BG/Layout` gets `Access == "write"`; listing `BG` as user2 → 404.
  - `TestDriveListMirrorSourceMissing`: trash `BG/Layout`, user2 lists the mirror → no items, `SourceMissing` true.
  - `TestDriveTrashRules`: user1 trashes a file in `BG/Layout`; user2's trash list does not contain it, user1's does.
  - `TestDriveZipRules`: user2 zips the mirror → zip has the source files, not `secret/`'s; user2 zips `BG` → 404.
  - `TestDriveCopyOutOfMirror`: user2 copies a file listed in the mirror into `Anim` root → copy exists, owned by user2,
    with zero rules; copying `BG/Layout/secret` as user2 → 404; a channel admin copying `BG/Layout` → the copy and its
    subfolders have zero rules.
  - API: `TestDriveAPIRules` — `GET /drive/items?parent_id=<BG>` as user2 → 404; as user1 → 200.

- [ ] **Step 2: Run** `go test ./channels/app -run 'TestDrive' && go test ./channels/api4 -run TestDriveAPI`.
  Expected: new tests FAIL; compile errors at old `ListDriveFolder` callers until updated.

- [ ] **Step 3: Implement** as described; update every `ListDriveFolder`/`GetDriveTrash` caller (app tests pass
  `driveSession(user)`).

- [ ] **Step 4: Run** the same commands. Expected: PASS, including every existing drive test.

- [ ] **Step 5: Commit** `git commit -m "Apply folder rules to drive reads and mirrors"`

---

### Task 5: Enforce rules on changes and live updates

**Files:**
- Modify: `server/channels/app/drive.go` — `DriveCan` (DriveModify), new `DriveCanCreateIn`, `CreateDriveFolder`,
  `MoveDriveItems`, `DeleteDriveItems`, `RestoreDriveItems`, `EmptyDriveTrash`, `publishDriveChanged`
- Modify: `server/channels/api4/drive.go:128-131` (create uses `DriveCanCreateIn`)
- Test: `server/channels/app/drive_test.go`, `server/channels/api4/drive_test.go`

**Interfaces:**
- Consumes: Task 3's `driveViewerFor`, `access`, `driveFolderPath`.
- Produces:
  ```go
  // DriveCanCreateIn reports whether the session may add items to folderID ("" = root): DriveCan(DriveCreate), and
  // for non-managers the folder's own path is visible and its write is not denied (mirrors are always denied).
  func (a *App) DriveCanCreateIn(rctx request.CTX, session model.Session, channel *model.Channel, folderID string) bool
  // CreateDriveFolder gains rules (zero for the API; the episode seeder passes the template's).
  func (a *App) CreateDriveFolder(rctx request.CTX, userID string, channel *model.Channel, parentID, name string, rules model.DriveRules) (*model.DriveItem, *model.AppError)
  // driveCanModify is DriveModify's rule part, for loops that build v once.
  func (a *App) driveCanModify(rctx request.CTX, session model.Session, channel *model.Channel, v *driveViewer, item *model.DriveItem) bool
  ```
  `driveCanModify` for non-managers: false when the item or any descendant `HasRules()`; the parent path must be
  visible; write denied → false; allowed → true (any creator); default → today's own-items check. `DriveCan(DriveModify)`
  = today's channel checks + `driveCanModify` (build v inside). Move: each item passes `driveCanModify`, the destination
  passes `DriveCanCreateIn`; a move to a channel of another team clears `DriveRules` on the moved items and all their
  descendants. Restore: each item passes `driveCanModify` judged at the parent it returns to (root when that parent is
  gone, as today). `publishDriveChanged(channelID, ids...)` also names the live mirrors of those ids (`GetMirrors`; log
  and continue on error). Delete, Restore and Move add the ids of the folders they touch to the ids they publish.

- [ ] **Step 1: Write the failing tests** (fixture from Task 4; `BG/Layout` seeded with
  `DriveRules{ViewDepartments:{bg}, WriteDepartments:{bg}}`, `Anim/Ref` with `ReadOnly`; a third user3 in BG):
  - `TestDriveWriteRules`:
    - user1 creates a folder in `BG/Layout` → ok; user2 → `DriveCanCreateIn` false; anyone (non-manager) into the
      mirror → false; into `Anim/Ref` → false.
    - user3 deletes user1's file in `BG/Layout` → ok (decision 9); user2 cannot.
    - user3 renames, then deletes, a plain folder of user1's inside `BG/Layout` holding user1's files → ok.
    - user3 restores user1's trashed file back into `BG/Layout` → ok; user2 restoring it → forbidden.
    - In a rule-less folder, user2 cannot delete user1's file (own-items unchanged).
    - user1 cannot rename, move or delete `BG/Layout` itself or `BG` (subtree holds a rule folder); a channel admin can.
    - user1 moves a file from `BG/Layout` into the mirror → forbidden; into `Anim` (user1 cannot see it) → forbidden.
  - `TestDriveCrossTeamMoveDropsRules`: an admin moves `BG` to a drive channel of a second team → `BG/Layout` has zero
    rules there; a move within the team keeps them.
  - `TestDriveRestoreKeepsRules`: admin trashes and restores `BG/Layout` → rules unchanged.
  - `TestDriveChangedNamesMirrors`: subscribe to the websocket hub as the drive tests do (or call
    `publishDriveChanged` through a test hook), upload into `BG/Layout` → the event's `parent_ids` holds the
    `BG/Layout` id and the mirror id.
  - API: `POST /drive/items` into `BG/Layout` as user2 → 403.

- [ ] **Step 2: Run** `go test ./channels/app -run 'TestDrive' && go test ./channels/api4 -run TestDriveAPI`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** as described; update `CreateDriveFolder` callers (`driveFolder` helper passes
  `model.DriveRules{}`; tests that need rule folders pass them).

- [ ] **Step 4: Run** the same commands. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Apply folder rules to drive changes"`

---

### Task 6: Seeding endpoint

**Files:**
- Create: `server/public/model/episode.go`, `server/channels/app/episode.go`, `server/channels/app/episode_test.go`,
  `server/channels/api4/episode.go`, `server/channels/api4/episode_test.go`, `server/public/model/client4_episode.go`
- Modify: `server/channels/api4/api.go` (call `api.InitEpisode()` next to `InitDrive`)
- Modify: `server/public/model/audit_events.go` — `AuditEventCreateEpisode = "createEpisode"`

**Interfaces:**
- Consumes: `ParseEpisodeFolders`, `EpisodeFolder.Rules`, `CreateDriveFolder(..., rules)`, `CreateChannelWithUser`,
  `CreateTaskSection`, `CreateTask`, `PermanentDeleteChannel`, `EpisodeTemplateLines`.
- Produces:
  ```go
  type EpisodeCreate struct { Name string `json:"name"`; DisplayName string `json:"display_name"` }
  type EpisodeCreated struct {
      Channel *Channel     `json:"channel"`
      Section *TaskSection `json:"section"`
      Failed  []string     `json:"failed"` // template folder paths and task titles that could not be created
  }
  func (a *App) CreateEpisode(rctx request.CTX, userID, teamID string, in *model.EpisodeCreate) (*model.EpisodeCreated, *model.AppError)
  // POST /api/v4/teams/{team_id}/episodes → 201 EpisodeCreated
  func (c *Client4) CreateEpisode(ctx context.Context, teamID string, in *EpisodeCreate) (*EpisodeCreated, *Response, error)
  ```
  Order: open channel → task section (name = display name, channel id) — on failure `PermanentDeleteChannel` and
  return the error → folders → tasks (status `todo`, creator = caller). Folders: pass 1 creates every non-mirror entry
  in template order, creating missing intermediate folders without rules and reusing folders already made; pass 2
  creates mirrors with `MirrorOf` = the source's new id. A failed folder fails its subtree; a mirror whose source
  failed is not created. Every failed entry's path goes into `Failed`. A team without the drive reports every folder
  path. Handler permissions: `requireTaskTeamMember`, team permission `create_public_channel` and `manage_tasks`.

- [ ] **Step 1: Write the failing tests.**
  - `TestCreateEpisode`: team template
    `[{"path":"BG/Layout","view_departments":[bg]},{"path":"Anim/Layout","mirror_of":"BG/Layout","view_departments":[anim]},{"path":"Notes"}]`,
    tasks `"Storyboard\nAnimatic"` →
    channel exists; section's channel is it; drive root has `Anim, BG, Notes`; `BG` has zero rules; `BG/Layout` has
    view `[bg]`, write `[bg]`; `Anim/Layout.MirrorOf` = `BG/Layout` id; two `todo` tasks in the section; `Failed` empty.
  - `TestCreateEpisodeLegacyTemplate`: `"A\nA/B"` → folders `A/B` with no rules.
  - `TestCreateEpisodeSectionFailureRemovesChannel`: tasks disabled on the team → error, and
    `GetChannelByName(name)` is not found (deleted for good).
  - `TestCreateEpisodeDriveDisabled`: `FilesEnabled` false → succeeds, `Failed` = every folder path.
  - API `TestCreateEpisodeAPI`: 201 for a user with both permissions; 403 without `manage_tasks`.

- [ ] **Step 2: Run** `go test ./channels/app -run TestCreateEpisode && go test ./channels/api4 -run TestCreateEpisodeAPI`. Expected: FAIL (undefined).

- [ ] **Step 3: Implement** as described.

- [ ] **Step 4: Run** the same commands. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Seed episodes on the server with folder rules"`

---

### Task 7: Webapp creates episodes through the endpoint

**Files:**
- Modify: `webapp/platform/types/src/drive.ts` (rules fields on `DriveItem`; `access`, `source_missing` on
  `DriveListing`), new `EpisodeCreated` type in `webapp/platform/types/src/tasks.ts`
- Modify: `webapp/platform/client/src/client4.ts` — `createEpisode`
- Modify: `webapp/channels/src/actions/tasks.ts:131-173`; Test: `webapp/channels/src/actions/tasks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // DriveItem gains: view_departments?: string[]; write_departments?: string[]; read_only?: boolean; mirror_of?: string;
  // DriveListing gains: access: '' | 'write' | 'read'; source_missing?: boolean;
  export type EpisodeCreated = {channel: Channel; section: TaskSection; failed: string[]};
  createEpisode = (teamId: string, name: string, displayName: string) => Promise<EpisodeCreated>; // POST teams/{id}/episodes
  ```
  `createEpisodeChannel(teamId, displayName, video)` keeps its signature and result `{channel, failed}`: it calls
  `createEpisode(teamId, cleanUpUrlable(displayName) || generateId(), displayName)`, dispatches
  `getChannelAndMyMember(channel.id)` and `TASK_SECTION_RECEIVED`, then `setTaskSectionVideo` and `Client4.createCanvas`;
  if either fails it deletes the section and the channel as today and returns the error.

- [ ] **Step 1: Rewrite the failing tests** in `tasks.test.ts` `describe('createEpisodeChannel')`:
  - `calls the episode endpoint, then video and canvas` — `Client4.createEpisode` called with
    `('team1', 'episode-1', 'Episode 1')`; `setTaskSectionVideo` then `createCanvas` called; result
    `{channel, failed: ['Notes']}` when the endpoint returns `failed: ['Notes']`.
  - `removes section and channel when the video fails` — `deleteTaskSection` and `deleteChannel` called, `{error}` returned.
  - `returns the endpoint error without further calls`.
  - Drop the old per-folder/per-task tests.

- [ ] **Step 2: Run** `TZ=UTC npx jest src/actions/tasks.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** as described; remove the client-side folder and task loops.

- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npx eslint src/actions/tasks.ts`. Expected: PASS, clean.

- [ ] **Step 5: Commit** `git commit -m "Create episodes through the server seeding endpoint"`

---

### Task 8: Folder panel in Team Settings › Episodes

**Files:**
- Create: `.../team_episodes_tab/episode_folders.ts`, `episode_folders.test.ts`, `episode_folder_panel.tsx`,
  `episode_folder_panel.test.tsx`, `episode_folder_panel.scss`
- Modify: `.../team_episodes_tab/team_episodes_tab.tsx`, `team_episode_templates_section.tsx`, `team_episodes_tab.test.tsx`
- Modify: `webapp/channels/src/i18n/en.json`

**Interfaces:**
- Consumes: `useTeamDepartments(teamId): Department[]` from `components/profile_popover/use_custom_roles`.
- Produces:
  ```ts
  export type EpisodeFolder = {path: string; view_departments?: string[]; write_departments?: string[]; read_only?: boolean; mirror_of?: string};
  export function parseEpisodeFolders(text?: string): EpisodeFolder[];      // JSON, or old lines → rule-less entries
  export function serializeEpisodeFolders(folders: EpisodeFolder[]): string; // '' for none; omits empty fields
  export function addEpisodeFolder(folders: EpisodeFolder[], parentPath: string): {folders: EpisodeFolder[]; path: string}; // "New folder", "New folder (2)"…
  export function renameEpisodeFolder(folders: EpisodeFolder[], path: string, name: string): EpisodeFolder[]; // moves descendants and mirror_of refs
  export function removeEpisodeFolder(folders: EpisodeFolder[], path: string): EpisodeFolder[]; // removes subtree, clears mirror_of into it
  export function mirrorSources(folders: EpisodeFolder[], path: string): string[]; // not itself, not a mirror, not an ancestor/descendant
  // EpisodeFolderPanel props:
  type Props = {teamId: string; folders: EpisodeFolder[]; onChange: (folders: EpisodeFolder[]) => void};
  ```
  Panel: left, the tree (entries sorted by path, indented by depth, lock icon when `read_only`, mirror icon when
  `mirror_of`; per row "Add subfolder", "Rename" (inline input, `IsValidDriveItemName` rules: no `/\:*?"<>|`, not
  `.`/`..`), "Delete"); "Add folder" below. Right, for the selected entry: **Who sees it** (Everyone / chosen
  department chips), **Who may change it** (Everyone who sees it / chosen departments — only among viewers when
  viewers are restricted / Nobody → `read_only`), **Contents** (Own files / Mirror of: select from `mirrorSources`;
  choosing a mirror clears `write_departments`; a mirror cannot get subfolders). Ids not in the department list show
  as a "Deleted department" chip that can be removed. Tab: state is `EpisodeFolder[]` parsed from
  `team.episode_folders`; changed = `serializeEpisodeFolders(state) !== serializeEpisodeFolders(parseEpisodeFolders(team.episode_folders))`;
  save sends the serialized string; cancel re-parses. The tasks textarea stays as is.

- [ ] **Step 1: Write the failing tests.**
  - `episode_folders.test.ts`: `parseEpisodeFolders('A\nA/B')` → `[{path:'A'},{path:'A/B'}]`; round trip of a JSON
    template is identity; `serializeEpisodeFolders([])` → `''`; `addEpisodeFolder` twice under `A` → `A/New folder`,
    `A/New folder (2)`; `renameEpisodeFolder(..., 'BG', 'Background')` renames `BG/Layout` and a `mirror_of: 'BG/Layout'`;
    `removeEpisodeFolder(..., 'BG')` drops `BG/Layout` and clears that `mirror_of`; `mirrorSources` excludes self,
    ancestors, descendants and mirrors.
  - `episode_folder_panel.test.tsx` (departments mocked: BG, ANIM): selecting `BG/Layout`, choosing "Chosen
    departments" and BG under Who sees it calls `onChange` with `view_departments: [bg]`; "Nobody" sets `read_only: true`;
    picking "Mirror of" `BG/Layout` on `Anim/Layout` sets `mirror_of` and removes `write_departments`; an unknown id
    shows "Deleted department".
  - `team_episodes_tab.test.tsx`: an old text template opened and not touched shows no save panel; after adding a
    folder, Save calls `patchTeam` with `episode_folders` = the serialized JSON.

- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/team_settings/team_episodes_tab`. Expected: FAIL.

- [ ] **Step 3: Implement** as described; add the panel's strings to `en.json` (ids under `team_settings.episodeFolders.*`,
  each with a `description`).

- [ ] **Step 4: Run** the tests, `tsc`, `eslint` and `npx stylelint` on the new scss. Expected: PASS, clean.

- [ ] **Step 5: Commit** `git commit -m "Add the episode folder rules panel"`

---

### Task 9: Explorer shows rules

**Files:**
- Modify: `webapp/channels/src/components/file_explorer/use_explorer_data.ts:173-180,183-192`,
  `file_explorer.tsx:262-275,575-612`, `explorer_items.tsx:76-87`
- Test: `file_explorer.test.tsx`, `explorer_items.test.tsx`
- Modify: `webapp/channels/src/i18n/en.json`

**Interfaces:**
- Consumes: Task 7 types.
- Produces: `useExplorerData` returns `access` and `sourceMissing`. `canModify` for drive items =
  `canManage || (!hasRules(it) && (access === 'write' || (access === '' && it.creator_id === me)))`. In
  `file_explorer.tsx`, `const writable = inDrive && (canManage || access !== 'read')` gates `newFolder`, `paste`,
  upload and the drop overlay. Folder icons: `LockOutlineIcon` overlay/title for `read_only`, a mirror icon
  (compass `SyncIcon` or nearest available) for `mirror_of`. Empty mirror with `sourceMissing` shows
  "The folder this one shows was deleted."

- [ ] **Step 1: Write the failing tests.**
  - `explorer_items.test.tsx`: a folder with `read_only` renders the "Read-only folder" title; one with `mirror_of`
    renders "Shows another folder".
  - `file_explorer.test.tsx`: listing mocked with `access: 'read'` → New folder disabled and Delete disabled for the
    user's own file; `access: 'write'` → Delete enabled for someone else's file; `source_missing: true` with no items →
    the source-missing note.

- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/file_explorer`. Expected: FAIL.

- [ ] **Step 3: Implement** as described; strings under `file_explorer.*` with descriptions.

- [ ] **Step 4: Run** the explorer tests, `tsc`, `eslint`. Expected: PASS (pre-existing jsx-a11y warnings and the 8
  stylelint errors in `file_explorer.scss` unchanged).

- [ ] **Step 5: Commit** `git commit -m "Show folder rules in the file explorer"`

---

### Task 10: Live check on dopgun

- [ ] **Step 1:** Run the full touched suites: model, sqlstore `TestDriveItemStore`, app `TestDrive|TestCreateEpisode`,
  api4 `TestDriveAPI|TestCreateEpisodeAPI`, webapp `src/actions src/components/file_explorer src/components/team_settings src/components/tasks`.
  Expected: all PASS.
- [ ] **Step 2:** Build the server binary and the webapp (`npm run build` in `webapp/channels`), swap the binary into
  the dopgun-server container the way earlier server deploys did, restart, confirm `/api/v4/system/ping` and that
  migrations 258–259 ran.
- [ ] **Step 3:** In http://localhost:8066 at 1400x900: set the Background/Layout → Animasyon/Layout example in Team
  Settings › Episodes, create an episode, and check as a Background member (sees and writes BG/Layout), an Animation
  member (sees Anim/Layout with BG files, read-only, can download; cannot see BG), and a channel admin (everything).
  Ask the user before deleting the test episode and test users.
