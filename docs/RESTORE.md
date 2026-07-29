# Database restore runbook

The production database is a single SQLite file inside LiteFS on one Fly
machine. LiteFS replicates to nobody, so nothing here protects against a bad
migration or a wrong `DELETE` except the copies below.

## What exists

| Copy                | Where                                                  | Taken                              | Kept                                         |
| ------------------- | ------------------------------------------------------ | ---------------------------------- | -------------------------------------------- |
| Daily offsite       | Tigris bucket, `backups/<app>/daily/`                  | `.github/workflows/backup.yml`     | 30 days, never fewer than 7                  |
| Pre-migration       | `/data/backups/pre-migration/` on the machine's volume | `other/litefs.yml`, before migrate | 3 most recent                                |
| Fly volume snapshot | Fly, per volume                                        | daily by Fly                       | 14 days (`snapshot_retention` in `fly.toml`) |

Offsite backups are `VACUUM INTO` snapshots — a consistent copy taken under a
read transaction — gzipped, integrity-checked with `PRAGMA quick_check`, and
size-verified after upload. The cache database is not backed up; it rebuilds
itself.

Everything below assumes `fly ssh console --app quartermaster-94e5`, and an
org-scoped Fly token (a deploy token cannot open an SSH session).

## Check the backups are real

```sh
# From the machine (it has the bucket credentials):
bun /myapp/scripts/backup-db.ts --list
```

Each line is `<timestamp> <bytes> <key>`. The newest `daily/` entry should be
less than a day old and roughly the size of the previous ones. A sudden shrink
is the interesting failure: it means the database, not the backup, changed.

To take one right now, outside the schedule:

```sh
bun /myapp/scripts/backup-db.ts
```

## Restore the production database

Work through this in order. Steps 1–3 are safe to do while deciding.

**1. Stop writes.** Anything written after the restore point is lost anyway, and
writes during the import muddy the picture.

```sh
fly status --app quartermaster-94e5          # note the machine ID
fly machine stop <id> --app quartermaster-94e5
```

Stop the machine — do **not** `fly scale count 0`. That destroys the machine,
and scaling back up can create one with a fresh empty volume rather than the one
holding the database you're restoring.

**2. Fetch and verify the backup.** Start the machine again
(`fly machine start <id>`) — LiteFS has to be mounted for the import in step 3 —
and, from an SSH session:

```sh
bun /myapp/scripts/restore-db.ts --latest
# or a specific one:
bun /myapp/scripts/restore-db.ts --key backups/quartermaster-94e5/daily/2026-07-28T04-23-01-000Z.db.gz
```

It downloads, unpacks to `/data/restore/restored.db`, runs `PRAGMA quick_check`,
and prints the user count. **Read that count.** If it doesn't look like
production, you have the wrong backup — stop and pick another.

To restore the state from just before a bad migration instead, skip the download
and use the local dump:

```sh
ls -l /data/backups/pre-migration/
mkdir -p /data/restore
gunzip -c /data/backups/pre-migration/<timestamp>.db.gz > /data/restore/restored.db
sqlite3 /data/restore/restored.db 'PRAGMA quick_check'
```

**3. Import it into LiteFS.** This is the destructive step — it replaces the
live database.

```sh
litefs import -name sqlite.db /data/restore/restored.db
```

`litefs import` is safe on a live database but does not check integrity, which
is why step 2 does. It must run against the primary; with one machine, that's
this one.

**4. Restart and check.**

```sh
fly machine restart <id>
fly logs --app quartermaster-94e5
```

Migrations run at boot, so a database restored from before a migration is
brought forward automatically — and gets its own pre-migration dump on the way.
Then load the app, sign in, and confirm the data is what you expect.

**5. Confirm the machine is running**: `fly status --app quartermaster-94e5`.

**6. Take a fresh backup** so the next restore point reflects the restored
state: `bun /myapp/scripts/backup-db.ts`.

## Inspect a backup without touching production

The scripts run anywhere the bucket credentials are set, so a backup can be
opened locally:

```sh
# The dev .env points at a mock bucket (images come from MSW locally), so the
# real values have to be supplied here. Fly secrets can't be read back out —
# take them from the Tigris dashboard, or run this on the machine instead.
BUCKET_NAME=... AWS_ENDPOINT_URL_S3=https://fly.storage.tigris.dev \
  AWS_REGION=auto AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  BACKUP_PREFIX=backups/quartermaster-94e5 \
  bun scripts/restore-db.ts --latest --out /tmp/prod-restore.db
sqlite3 /tmp/prod-restore.db 'SELECT COUNT(*) FROM Recipe'
```

That copy is real user data. Delete it when you're done.

## Restoring from a Fly volume snapshot

Last resort, if the bucket is unreachable or every backup is bad:

```sh
fly volumes list --app quartermaster-94e5
fly volumes snapshots list <volume-id>
fly volumes create data --snapshot-id <snapshot-id> --region fra --app quartermaster-94e5
```

Then attach a machine to the new volume. The snapshot is a raw copy of a live
volume, so the database inside it may need `PRAGMA quick_check` and, in the
worst case, WAL recovery — treat it as less trustworthy than an offsite backup.

## When the boot-time dump blocks a deploy

The pre-migration step fails the boot if it can't produce a verified snapshot,
which on a full volume means a machine that won't start. To get moving:

```sh
fly ssh console -C 'ls -l /data/backups/pre-migration'   # usually: prune these
fly secrets set SKIP_DB_BACKUP=true --app quartermaster-94e5
# deploy, confirm boot, then immediately:
fly secrets unset SKIP_DB_BACKUP --app quartermaster-94e5
```

Leaving it set migrates the database with no way back, which is the situation
the step exists to prevent. It only disables the boot-time dump — manual
backups and `--list` keep working while it's set.

## Exercise log

Restore is only real if it's been done. Add a line each time.

- **2026-07-29** — Round trip exercised by `server/backup.test.ts` against a
  local S3 stand-in: snapshot a WAL database → gzip → signed upload → download →
  unpack → `quick_check` → row count. Covers everything except Tigris itself and
  the `litefs import` step.
- **2026-07-29** — Attempted the same round trip against real Tigris from a dev
  box and stopped at the upload: the local `.env` carries mock credentials
  (`mock-bucket`) because dev serves images from MSW, and Fly secrets can't be
  read back out. Tigris did answer, and rejected the request as
  `InvalidAccessKeyId` rather than a signature error. **Still to do: run
  `backup-db.ts` on the production machine and restore that backup into a
  scratch database.**
