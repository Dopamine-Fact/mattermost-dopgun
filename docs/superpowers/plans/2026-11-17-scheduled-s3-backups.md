# Scheduled S3 Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every day at a time the admin sets in the System Console, the server writes a restorable backup to S3: the Postgres dump, the local files archive, the config, and a manifest that marks the backup complete. Backups older than the retention period are pruned.

**Architecture:** A new `backup` job type under `server/channels/jobs/backup/`. It has a `DailyScheduler` and a `SimpleWorker`. All of its logic lives in that package, because it needs only the config and a `filestore.FileBackend`, so no app-layer method is required. *(This departs from the spec's `a.RunBackup`, because nothing in the app layer is needed.)* It is configured through a new `BackupSettings` config section and a new System Console page with a jobs table.

**Tech Stack:** Go (`os/exec`, `archive/tar`, `compress/gzip`, `io.Pipe`), the existing `filestore` S3 backend, React admin console schema (`admin_definition.tsx`), Docker (PGDG apt repo).

**Spec:** `docs/superpowers/specs/2026-11-17-scheduled-s3-backups-design.md`

## Global Constraints

- Postgres only. Any other `SqlSettings.DriverName` fails the job with `backup supports only postgres`.
- Object layout is `<AmazonS3PathPrefix>/<YYYYMMDD-HHMMSS>/{database.dump, data.tar.gz, config.json, manifest.json}`. The folder name uses UTC with the format `20060102-150405`.
- `manifest.json` is written last, and only after every other upload has succeeded.
- Secrets never go into argv, logs or `job.Data`. The DB password reaches `pg_dump` only through `PGPASSWORD`.
- Retention runs only after the manifest has been written. It never deletes the newest folder that has a manifest, and never touches folder names that don't match the pattern.
- Uploads use `WriteFileContext` when the backend has it. The S3 part size is `64 << 20`.
- The image needs `postgresql-client-17`, from the PGDG repo.
- Defaults are `Enable=false`, `DailyRunTime="03:00"`, `RetentionDays=14`, `AmazonS3PathPrefix="mattermost-backups"`, `AmazonS3Endpoint="s3.amazonaws.com"`, `AmazonS3SSL=true` and `AmazonS3SSE=false`.
- Every config field uses the access tag `environment_file_storage`. The secret field adds `write_restrictable`, as `ExportAmazonS3SecretAccessKey` does.
- After editing `server/i18n/en.json`, run `make i18n-extract` and fill in each `description`. After editing webapp strings, run `npm run i18n-extract` in `webapp/channels`.
- Never run `go mod tidy`. No new Go modules are needed.

## Review Focus

1. **A file disappears or changes during the tar walk** (a user deletes an attachment at 03:00). The expected result is that the file is skipped, not that the whole backup fails. Test: `TestWriteTarGzSkipsVanishedAndSpecialFiles` (Task 2).
2. **`pg_dump` is not on PATH** (a dev machine, or an image built without the client). Expect a job error that names `pg_dump`, no manifest, and the run's own folder removed. Test: `TestRunBackupDumpFailure` (Task 3).
3. **A keyword-form or unusual DSN** (`host=... user=...`, or extra params such as `binary_parameters=yes`). Expect a clear error for the keyword form, and unknown params dropped rather than passed through to `pg_dump`. Test: `TestPgDumpCommand` cases (Task 2).
4. **A secret appears in `pg_dump` stderr** (for example, an auth error message that echoes the DSN). Expect the job error to contain `****` instead of the password. Test: `TestRedact` (Task 3). `execPgDump` must pass stderr through `redact` before wrapping it.
5. **File storage is already S3** (`FileSettings.DriverName == amazons3`). Expect `data.tar.gz` to be skipped and the manifest to record `files_skipped: true`, with the job still succeeding. Test: `TestRunBackupSkipsFilesForS3Store` (Task 3).

---

### Task 1: `BackupSettings` config section

**Files:**
- Modify: `server/public/model/config.go`: add the struct next to `ExportSettings`; add the field to `Config` (around line 4412); call `SetDefaults` (around 4534) and `isValid` (around 4685); mask the secret in `Sanitize` (around 5736).
- Modify: `server/config/utils.go:39`: restore `BackupSettings.AmazonS3SecretAccessKey` from `actual` when the target holds `FakeSetting`.
- Modify: `server/i18n/en.json`: add 3 error ids.
- Modify: `webapp/platform/types/src/config.ts`: add `BackupSettings` type, and add the `BackupSettings: BackupSettings;` field to `AdminConfig` next to `ExportSettings`.
- Test: `server/public/model/config_test.go`

**Interfaces:**
- Produces: `model.BackupSettings{Enable *bool; DailyRunTime *string; RetentionDays *int; AmazonS3Bucket, AmazonS3PathPrefix, AmazonS3Region, AmazonS3Endpoint, AmazonS3AccessKeyId, AmazonS3SecretAccessKey *string; AmazonS3SSL, AmazonS3SSE *bool}`. Also `Config.BackupSettings BackupSettings`.

- [ ] **Step 1: Write the failing test** `TestBackupSettingsIsValid` (table-driven, starting from `SetDefaults()`):
  - The defaults pass, because `Enable=false` skips all checks.
  - `Enable=true` with an empty bucket fails with id `model.config.is_valid.backup.bucket.app_error`.
  - `Enable=true`, bucket `"b"`, `DailyRunTime="25:00"` fails with `model.config.is_valid.backup.run_time.app_error`.
  - `Enable=true`, bucket `"b"`, `RetentionDays=0` fails with `model.config.is_valid.backup.retention_days.app_error`.
  - `Enable=true`, bucket `"b"` with the default time and retention passes.
  - `TestConfigSanitize` gains an assertion: a non-empty `BackupSettings.AmazonS3SecretAccessKey` becomes `FakeSetting`.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd server && go test ./public/model/ -run 'TestBackupSettingsIsValid|TestConfigSanitize'`. Expected: a compile error (`BackupSettings` is undefined).
- [ ] **Step 3: Implement `(s *BackupSettings) SetDefaults()` and `(s *BackupSettings) isValid() *AppError`** using the Global Constraints defaults. Return `http.StatusBadRequest` errors, and parse the time with `time.Parse("15:04", ...)`. Wire both into `Config`. Mask the secret in `Sanitize`, desanitize it in `config/utils.go`, and add the TS type.
- [ ] **Step 4: Add the three ids to `server/i18n/en.json`.** The translations are "Backup S3 bucket is required when backups are enabled.", "Backup time must be in HH:MM format." and "Backup retention must be at least 1 day.". Run `make i18n-extract` and fill in the descriptions.
- [ ] **Step 5: Run the tests and see them pass.** Run `go test ./public/model/ -run 'TestBackupSettingsIsValid|TestConfigSanitize'` and `go test ./config/`. Expected: PASS.
- [ ] **Step 6: Commit** with `git commit -m "Add BackupSettings config section"`.

### Task 2: Pure backup helpers

**Files:**
- Create: `server/channels/jobs/backup/helpers.go`
- Test: `server/channels/jobs/backup/helpers_test.go`

**Interfaces:**
- Produces:
  - `const folderLayout = "20060102-150405"`
  - `func folderName(t time.Time) string`: `t.UTC().Format(folderLayout)`.
  - `func pgDumpCommand(dsn string) (args []string, env []string, err error)`: `args` is `["--format=custom", "--no-owner", "--dbname=<url without password, filtered query>"]`, and `env` is `["PGPASSWORD=<pw>"]`, or empty when there is no password.
  - `func selectExpired(folders []string, complete map[string]bool, now time.Time, retentionDays int) []string`: `folders` are base names.
  - `func writeTarGz(w io.Writer, dir string) error`

- [ ] **Step 1: Write the failing tests:**
  - `TestFolderName`: `folderName(time.Date(2026,11,17,3,0,5,0,time.FixedZone("TR",3*3600)))` returns `"20261117-000005"`.
  - `TestPgDumpCommand` cases:
    - `postgres://mmuser:s3cr%21t@postgres:5432/mattermost?sslmode=disable&connect_timeout=10&binary_parameters=yes` gives args with `--dbname=postgres://mmuser@postgres:5432/mattermost?connect_timeout=10&sslmode=disable` and env `["PGPASSWORD=s3cr!t"]`. No arg contains `s3cr`.
    - `postgresql://u@h/db` gives empty env and no error.
    - `host=h user=u dbname=d` returns an error containing `URL form`.
  - Query params are kept only if they are in the allow-list: `sslmode`, `connect_timeout`, `sslrootcert`, `sslcert`, `sslkey`, `application_name`, `target_session_attrs`.
  - `TestSelectExpired`: with `now = 2026-11-17 03:00 UTC` and retention 14:
    - Input `["20261020-030000"(complete), "20261101-030000"(incomplete), "20261110-030000"(complete), "notes", "20261116-030000"(incomplete)]` gives `["20261020-030000","20261101-030000"]`.
    - When the only complete folder is older than retention, as in `["20261001-030000"(complete)]`, the result is empty.
  - `TestWriteTarGzRoundTrip`: a temp dir holds `a.txt` and `sub/b.txt`. Reading the result back with `archive/tar` gives exactly those two files, with their content and relative paths using `/`.
  - `TestWriteTarGzSkipsVanishedAndSpecialFiles`: the temp dir holds a symlink (skip the test on Windows with `t.Skip` if creating the symlink fails) and a regular file. Only the regular file appears in the output. A file removed between the walk and the open is skipped, not treated as an error. To test this, call the internal `addFile` on a path that does not exist and assert it returns nil.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd server && go test ./channels/jobs/backup/`. Expected: a compile error (the package is empty).
- [ ] **Step 3: Implement the four functions.**
  - `pgDumpCommand` uses `net/url`. It rejects any scheme other than `postgres` or `postgresql`, reads `u.User.Password()`, sets `u.User = url.User(username)`, and rebuilds the query from the allow-list with `url.Values.Encode()`, which sorts the keys.
  - `selectExpired`: the cutoff is `now.AddDate(0,0,-retentionDays)`. Folders that fail `time.Parse(folderLayout, …)` are skipped. Find the newest complete folder and exclude it. Return the folders older than the cutoff, in input order.
  - `writeTarGz`: walk `dir` with `filepath.WalkDir`. Write only regular files (`d.Type().IsRegular()`). Header names come from `filepath.ToSlash(rel)`. A file the walk saw but that fails to open with `os.IsNotExist` is skipped.
- [ ] **Step 4: Run the tests and see them pass.** Run `go test ./channels/jobs/backup/`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "Add backup helpers: pg_dump args, retention, tar"`.

### Task 3: Backup run, worker, scheduler and registration

**Files:**
- Create: `server/channels/jobs/backup/backup.go` (the run logic)
- Create: `server/channels/jobs/backup/worker.go`
- Create: `server/channels/jobs/backup/scheduler.go`
- Modify: `server/public/model/job.go`: add `JobTypeBackup = "backup"`.
- Modify: `server/channels/app/server.go` (next to the `JobTypeExportDelete` registration, around line 1790): `s.Jobs.RegisterJobType(model.JobTypeBackup, backup.MakeWorker(s.Jobs), backup.MakeScheduler(s.Jobs))`.
- Modify: `server/channels/app/job.go` (the three `PermissionManageJobs` / read switches, around lines 256, 341 and 390) and `server/channels/jobs/jobs.go:155`: add `model.JobTypeBackup` next to `model.JobTypeExportDelete`.
- Test: `server/channels/jobs/backup/backup_test.go`

**Interfaces:**
- Consumes: Task 1 `model.BackupSettings`; Task 2 `folderName`, `pgDumpCommand`, `selectExpired`, `writeTarGz`.
- Produces:
  - `type dumpFunc func(ctx context.Context, dsn string, w io.Writer) error`
  - `func execPgDump(ctx context.Context, dsn string, w io.Writer) error`: the real implementation. It uses `exec.CommandContext(ctx, "pg_dump", args...)` with `cmd.Env = append(os.Environ(), env...)`, `Stdout=w`, and stderr captured, with the password replaced by `****` before it is wrapped into the error. If `exec.LookPath("pg_dump")` fails, the error is `pg_dump not found on PATH: install postgresql-client-17`.
  - `func redact(s, secret string) string`: replaces every occurrence of `secret` with `****`, and returns `s` unchanged when `secret` is empty.
  - `func runBackup(ctx context.Context, cfg *model.Config, store filestore.FileBackend, dump dumpFunc, now time.Time) (model.StringMap, error)`
  - `func newBackupStore(s *model.BackupSettings) (filestore.FileBackend, error)`: calls `filestore.NewFileBackend` with `DriverName: model.ImageDriverS3`, the fields copied over, and `AmazonS3UploadPartSizeBytes: 64 << 20`.
  - `func MakeWorker(jobServer *jobs.JobServer) *jobs.SimpleWorker`: enabled when `*cfg.BackupSettings.AmazonS3Bucket != ""`.
  - `func MakeScheduler(jobServer *jobs.JobServer) *jobs.DailyScheduler`: enabled when `*cfg.BackupSettings.Enable` is set, with the start time from `DailyRunTime` and the same shape as `refresh_materialized_views/scheduler.go`.

- [ ] **Step 1: Write the failing tests.** All of them use `filestore.NewFileBackend(FileBackendSettings{DriverName: model.ImageDriverLocal, Directory: t.TempDir()})` as the store, a config from `SetDefaults()` with `SqlSettings.DataSource` set to `postgres://u:pw@h/db`, `FileSettings.Directory` set to a temp dir holding `x.txt`, and `now = 2026-11-17 03:00 UTC`.
  - `TestRunBackupSuccess`: the dump fake writes `"DUMP"`. Expect these files under `mattermost-backups/20261117-030000/`:
    - `database.dump` with the content `"DUMP"`,
    - `data.tar.gz` containing `x.txt`,
    - `config.json` that unmarshals into a `model.Config` whose `BackupSettings.AmazonS3PathPrefix == "mattermost-backups"`,
    - `manifest.json` with `server_version == model.CurrentVersion` and `files_skipped == false`.
    The returned map has the keys `folder`, `db_bytes`, `files_bytes` and `duration_ms`. A pre-seeded complete folder `20261001-030000` (with a manifest) is deleted.
  - `TestRunBackupDumpFailure`: the dump fake returns `errors.New("pg_dump: password authentication failed for pw")`. Expect:
    - an error that contains `pg_dump`,
    - no `manifest.json` under the new folder, and the new folder removed,
    - the pre-seeded `20261001-030000` folder still present, because retention did not run.

    A second case uses the real `execPgDump` with `PATH` set to an empty temp dir (`t.Setenv("PATH", t.TempDir())`). Its error contains `pg_dump not found`.
  - `TestRedact`: `redact("auth failed for s3cr!t", "s3cr!t")` returns `"auth failed for ****"`.
  - `TestRunBackupSkipsFilesForS3Store`: with `FileSettings.DriverName = model.ImageDriverS3`, there is no `data.tar.gz` and the manifest has `files_skipped == true`.
  - `TestRunBackupRejectsNonPostgres`: with `SqlSettings.DriverName = "mysql"`, the error contains `only postgres`.
  - `TestSchedulerEnabled`: `MakeScheduler(nil).Enabled(cfg)` is false by default and true when `Enable=true`. Next, `MakeWorker`'s enabled check returns true when the bucket is set, even with `Enable=false`. Expose it as the package-level function `workerEnabled(cfg *model.Config) bool` so it can be tested without a JobServer.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd server && go test ./channels/jobs/backup/`. Expected: a compile error.
- [ ] **Step 3: Implement `runBackup`.** Use `io.Pipe` for both the dump and the tar: one goroutine writes into the pipe writer and closes it with `CloseWithError`, while the main goroutine uploads from the reader. Add a small helper `upload(ctx, store, r io.Reader, path string) (int64, error)`. It type-asserts `interface{ WriteFileContext(context.Context, io.Reader, string) (int64, error) }` and falls back to `WriteFile`. Follow the step order in the spec. On any error, call `store.RemoveDirectory(folder)` (best effort, ignoring its error) and return the original error, wrapped with the step name.
- [ ] **Step 4: Implement the worker.** Its execute function: `defer jobServer.HandleJobPanic(logger, job)`. Re-check that the bucket is non-empty at run time. Build the store with `newBackupStore`, call `runBackup(context.Background(), jobServer.Config(), store, execPgDump, time.Now())`, and copy the returned map into `job.Data`. Log `folder` and the byte counts at Info level, and never log the config.
- [ ] **Step 5: Implement the scheduler, the job type constant, the registration and the permission cases.**
- [ ] **Step 6: Run the tests and see them pass.** Run `go test ./channels/jobs/backup/` (expected: PASS) and `go build ./channels/...` (expected: no errors). Then run `go vet ./channels/jobs/backup/`, which must be clean.
- [ ] **Step 7: Commit** with `git commit -m "Add scheduled backup job writing pg_dump, files and config to S3"`.

### Task 4: Image, compose and restore runbook

**Files:**
- Modify: `Dockerfile` (runtime stage `apt-get` block): add the PGDG repo (`https://apt.postgresql.org/pub/repos/apt noble-pgdg main`, with the key `https://www.postgresql.org/media/keys/ACCC4CF8.asc` installed into `/usr/share/keyrings/postgresql.gpg`, using `curl`+`gpg` or `gnupg` in that same `RUN`, then purged), then install `postgresql-client-17`. Keep `--no-install-recommends` and the `rm -rf /var/lib/apt/lists/*`.
- Modify: `docker-compose.yml`: add `TZ: ${TZ:-UTC}` to the `mattermost` environment, with a comment noting that `TZ` sets the backup clock.
- Create: `docs/backups.md`: the restore runbook. Its content is fixed by the spec's "Restore runbook" section: steps 1 to 7, the IAM policy JSON (Put/List/Delete for the server, plus Get for restore, scoped to `arn:aws:s3:::<bucket>/<prefix>/*` and `ListBucket` on the bucket with a prefix condition), and the versioning/Object Lock advice. It also notes that `config.json` contains secrets.

- [ ] **Step 1: Build the image** with `docker build -t mattermost-dopgun .`, run in the background because it takes a long time. Expected: success.
- [ ] **Step 2: Verify the client** with `docker run --rm --entrypoint pg_dump mattermost-dopgun --version`. Expected: `pg_dump (PostgreSQL) 17.x`.
- [ ] **Step 3: Write `docs/backups.md`.**
- [ ] **Step 4: Commit** with `git commit -m "Install pg_dump 17 in image, add TZ and backup restore runbook"`.

### Task 5: System Console page

**Files:**
- Modify: `webapp/channels/src/utils/constants.tsx:856`: add `BACKUP: 'backup',` to `JobTypes`.
- Modify: `webapp/channels/src/components/admin_console/admin_definition.tsx`: add a `backups` section under `environment`, right after `file_storage`. It has `url: 'environment/backups'`, and its title comes from `admin.sidebar.backups` ("Backups"). `isHidden` and `isDisabled` mirror `file_storage`, using `RESOURCE_KEYS.ENVIRONMENT.FILE_STORAGE`. The schema id is `BackupSettings`.
- Modify: `webapp/channels/src/i18n/en.json`, regenerated by `npm run i18n-extract`.
- Test: `webapp/channels/src/components/admin_console/admin_definition.test.tsx` (extend it if it exists, otherwise create it)

**Interfaces:**
- Consumes: Task 1 config keys, and Task 3 job type `backup`.

Settings, in order:
- `bool` `BackupSettings.Enable`
- `text` `BackupSettings.DailyRunTime`, with the placeholder "03:00" and the help text "Time of day to run the backup, in server time (HH:MM). The server clock follows the container's TZ setting; UTC by default."
- `number` `BackupSettings.RetentionDays`
- `text` `AmazonS3Bucket`
- `text` `AmazonS3PathPrefix`
- `text` `AmazonS3Region`
- `text` `AmazonS3AccessKeyId`, with help text noting that it can be left empty to use the instance's IAM role
- `text` `AmazonS3SecretAccessKey`
- `text` `AmazonS3Endpoint`
- `bool` `AmazonS3SSL`
- `bool` `AmazonS3SSE`
- `jobstable` with `job_type: JobTypes.BACKUP`, `label` "Back up now", and `isDisabled` when `it.stateEquals('BackupSettings.AmazonS3Bucket', '')`. Its `render_job` shows `job.data.folder` when present.

Only `DailyRunTime` is disabled while `BackupSettings.Enable` is false. The S3 fields, the retention setting and the jobs table stay editable so that manual-only backups work.

- [ ] **Step 1: Write the failing test.** The definition exposes `AdminDefinition.environment.subsections.backups.schema.id === 'BackupSettings'`, and its settings include one with `type === 'jobstable'` and `job_type === 'backup'`.
- [ ] **Step 2: Run it and see it fail.** Run `cd webapp/channels && npx jest src/components/admin_console/admin_definition.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Add the constant and the section.**
- [ ] **Step 4: Run `npm run i18n-extract`, then `npm run check-types` and the jest test.** Expected: PASS, with no type errors.
- [ ] **Step 5: Manual check.** Run the server locally with a real or MinIO bucket, open System Console → Environment → Backups, save the settings and click "Back up now". The job should reach `success`, the folder should show four objects, and `pg_restore -l database.dump` should list the tables.
- [ ] **Step 6: Commit** with `git commit -m "Add Backups page to System Console"`.
