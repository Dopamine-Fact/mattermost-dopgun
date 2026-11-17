# Backups

**System Console → Environment → Backups** can write a full backup to Amazon S3, or to S3-compatible storage, every day at a set time. **Back up now** runs one immediately. It works even while the daily schedule is off, as long as a bucket is set.

The time is server time. With `docker-compose.yml`, set `TZ` (for example `TZ=Europe/Istanbul`), otherwise it defaults to `Europe/Istanbul`.

## What a backup contains

Each run writes one folder: `<path prefix>/<YYYYMMDD-HHMMSS>/`. The timestamp is in UTC.

| File | Contents |
|---|---|
| `database.dump` | `pg_dump --format=custom --no-owner` of the whole database |
| `data.tar.gz` | The local file store (`FileSettings.Directory`): attachments, plugins, and other files. It is skipped when file storage is already S3. |
| `config.json` | The active server config. **It contains secrets** (database password, keys), so keep the bucket private. |
| `manifest.json` | Written last, only when everything else succeeded |

**A folder without `manifest.json` is incomplete. Do not restore from it.**

Folders older than the retention period are deleted after each successful run, except the newest complete backup, which is always kept. A failed run never deletes anything except its own partial folder.

## Restore

1. Download the newest folder that contains `manifest.json`:

   ```bash
   aws s3 cp --recursive s3://<bucket>/<prefix>/<YYYYMMDD-HHMMSS>/ ./restore/
   ```

2. Start a fresh stack. This creates an empty database and the host folders:

   ```bash
   POSTGRES_PASSWORD=... docker compose up -d
   ```

3. Stop Mattermost and leave Postgres running:

   ```bash
   docker compose stop mattermost
   ```

4. Restore the database:

   ```bash
   docker compose exec -T postgres pg_restore --clean --if-exists --no-owner -U mmuser -d mattermost < restore/database.dump
   ```

5. Restore the files into the data folder (`${MM_ROOT:-/mnt/data/mattermost}/data`). Skip this step if the backup has no `data.tar.gz`.

   ```bash
   MM_ROOT=${MM_ROOT:-/mnt/data/mattermost}
   sudo tar -xzf restore/data.tar.gz -C "$MM_ROOT/data" && sudo chown -R 2000:2000 "$MM_ROOT/data"
   ```

6. Compare `restore/config.json` with the new install's config and copy over the settings you need. Database and S3 settings usually come from the environment and the new install. Don't overwrite those blindly.

7. Start the server again:

   ```bash
   docker compose start mattermost
   ```

## S3 permissions

The server needs to write, list and delete under its prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/<prefix>/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>",
      "Condition": {"StringLike": {"s3:prefix": ["<prefix>", "<prefix>/*"]}}
    }
  ]
}
```

Restoring also needs `s3:GetObject`. Use a separate admin credential for restores rather than the server's key.

Turn on **S3 versioning** or **Object Lock** on the bucket. The server's key can delete objects, because retention needs that. Versioning means a leaked key, or a bug, cannot permanently destroy your backups.
