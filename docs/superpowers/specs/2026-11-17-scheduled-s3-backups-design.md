# Scheduled S3 backups — design

## Intent
The admin picks a time of day in the System Console. Every day at that time the server takes a full, restorable backup and uploads it to Amazon S3. The goal is disaster recovery: if the host or its volumes are lost, a fresh install can be brought back to the state of the last backup. Today this fork has no backups at all. It runs under `docker-compose.yml` with Postgres 17, and its files and config live on local volumes.

## Goals
- A System Console page for backups: on/off, daily time, S3 target, retention, a "Back up now" button, and a table of recent runs.
- Each backup is self-contained: database dump, uploaded files (when stored locally) and config.
- Backups older than the retention period are deleted automatically.
- A short restore runbook.

## Non-goals
- Restoring from the UI. Restore is manual and follows the runbook.
- Targets other than S3 or S3-compatible storage (Azure, local disk).
- More than one run per day, or cron expressions.
- Email or chat notification on failure. Failures appear in the runs table.
- MySQL. Upstream dropped it, and the job fails with a clear error on any driver other than Postgres.

## Anti-goals
- A failed run must never delete older backups.
- Secrets (DB password, S3 secret key) must not appear in logs, job data, or process arguments.
- The backup must not lock the database or take the server offline. `pg_dump` uses a consistent snapshot and needs no locks that block writes.
- The upload must not buffer whole files in memory or on disk.

## Approaches
1. **`pg_dump` + `data/` archive + config, run as a Mattermost scheduled job (picked).** This gives a byte-for-byte restorable state. It costs a `postgresql-client-17` package in the image.
2. **Mattermost bulk export on a schedule:** rejected. It is not a full backup: it misses permissions, plugin data, sessions and some settings, and restoring it means importing into a blank server.
3. **Docker sidecar container with cron, configured through `.env`:** rejected by the user, who wants the time to be set in the System Console.

## Design

### Config — new `BackupSettings` section (`server/public/model/config.go`)

| Field | Default | Notes |
|---|---|---|
| `Enable` | `false` | |
| `DailyRunTime` | `"03:00"` | `HH:MM` in server time (`time.Local`, so it follows the container's `TZ`) |
| `RetentionDays` | `14` | `>= 1` |
| `AmazonS3Bucket` | `""` | required when enabled |
| `AmazonS3PathPrefix` | `"mattermost-backups"` | |
| `AmazonS3Region` | `""` | |
| `AmazonS3Endpoint` | `"s3.amazonaws.com"` | |
| `AmazonS3AccessKeyId` | `""` | empty means use the IAM role |
| `AmazonS3SecretAccessKey` | `""` | masked like the other S3 secrets (`FakeSetting`) |
| `AmazonS3SSL` | `true` | |
| `AmazonS3SSE` | `false` | server-side encryption |

- Validation runs only when `Enable` is on: `DailyRunTime` must parse as `15:04`, the bucket must be non-empty, and `RetentionDays` must be at least 1.
- Access tag: `environment_file_storage` (the same permission that guards the file-storage settings).

### Job `backup` (`server/channels/jobs/backup/`)
- **Scheduler:** `jobs.NewDailyScheduler`, enabled when `BackupSettings.Enable` is on, at `DailyRunTime`.
- **Worker:** a `SimpleWorker` that calls the app layer. It is enabled whenever `AmazonS3Bucket` is set, even if `Enable` is off, so that "Back up now" works for manual-only backups (for example, right before an upgrade). Save-time validation is skipped while `Enable` is off, so the worker checks the S3 settings again at run time and fails with a clear error. The console button is disabled while the bucket is empty. *(Builder's call.)*
- **Upload part size:** set explicitly to 64 MiB. With an unknown object size, minio's 10,000-part limit and the default 5 MB parts would cap an object at about 50 GB. With 64 MiB parts the cap is about 640 GB, at the cost of one 64 MiB buffer per upload. *(Builder's call.)*
- **Registration:** in `app/server.go`. The job type is added to the `PermissionManageJobs` cases in `app/job.go` (create, read and cancel), so the console button can create a job through the existing jobs API.

The app method `a.RunBackup(rctx, job)` does the following:
1. Fails unless `SqlSettings.DriverName == postgres`.
2. Builds an S3 backend from `BackupSettings` through `filestore.NewFileBackend`. All uploads use `WriteFileContext` with the job's context, because `WriteFile` has a 30-second request timeout that a large dump would hit.
3. Writes to the folder `<prefix>/<YYYYMMDD-HHMMSS>/`:
   - `database.dump`: the stdout of `pg_dump --format=custom --no-owner`, streamed into the S3 upload. Connection details come from `SqlSettings.DataSource`. Host, port, user, database, `sslmode` and `connect_timeout` are passed as arguments, and the password is passed as `PGPASSWORD` in the child environment, never in argv. If `pg_dump` exits non-zero, its stderr goes into the job error after redacting the password.
   - `data.tar.gz`: only when `FileSettings.DriverName == local`. It is a streamed tar+gzip of `FileSettings.Directory`. When file storage is already S3 this file is skipped, and the job data records `files: "skipped (s3 file store)"`.
   - `config.json`: the active config marshalled as JSON. It contains secrets, so the bucket must be private, and the runbook says so.
   - `manifest.json`: written last, only after the three uploads above succeed. It holds `{created_at, server_version, db_bytes, files_bytes, files_skipped}`. A folder without a manifest is incomplete and must not be restored. On failure the worker also tries to delete its own folder, but the manifest is what counts, because a crashed process cannot clean up.
4. After the manifest is written, it lists the folders under `<prefix>/` and parses each name as a timestamp. It deletes folders older than `RetentionDays`, whether complete or not. It never deletes the newest folder that has a manifest. Folders whose names don't match the pattern are never touched. Any failure earlier in the run skips this step.
5. It stores `{folder, db_bytes, files_bytes, duration_ms}` in `job.Data` for the runs table.

### Image (`Dockerfile`)
- Add the PGDG apt repository and install `postgresql-client-17` in the runtime stage. Ubuntu noble ships client 16, and `pg_dump` 16 refuses to dump a 17 server.
- `docker-compose.yml`: add `TZ: ${TZ:-UTC}` to the `mattermost` service so the admin can set Istanbul time with `TZ=Europe/Istanbul`.

### System Console
- A new page **Environment → Backups** in `admin_definition.tsx` with the fields above, help text stating that the time is server time, the existing `jobstable` widget for job type `backup`, and its "Back up now" button.
- Strings go into both the server and webapp `en.json`, then run `make i18n-extract` (server) and the webapp i18n extract, and fill in the descriptions.

### Restore runbook (`docs/backups.md`)
1. Download the newest folder that contains `manifest.json`. A folder without the manifest is incomplete.
2. Start a fresh stack.
3. Stop `mattermost`.
4. Run `pg_restore --clean --if-exists --no-owner -d mattermost database.dump`.
5. Extract `data.tar.gz` into the `mm-data` volume.
6. Compare and copy `config.json`.
7. Start the server.

The runbook also gives the minimal IAM policy for the server (`s3:PutObject`, `s3:ListBucket`, `s3:DeleteObject` on the prefix) and notes that restoring needs `s3:GetObject`. It recommends turning on S3 versioning or Object Lock on the bucket, so that a stolen server key cannot wipe the backups.

### Tests
- **Config validation:** enabled with a missing bucket, a bad time, or a retention of 0.
- **Building `pg_dump` arguments and environment from a DSN:** the password is never in args, and `sslmode` is kept.
- **Retention selection:** given folder names, which of them have a manifest, and a current time, it returns only the expired ones. It ignores names that don't match the pattern, never returns the newest folder that has a manifest, and never runs after a failure.
- **Tar streaming** of a temporary directory round-trips.

## Left to the builder
- Exact console layout and wording within the page.
- Whether the tar includes empty directories.
- Log fields and levels, following the request-scoped logger guidance in `server/AGENTS.md`.
