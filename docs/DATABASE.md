# Database rules

Corpus360 keeps shops' accounts, GST records, stock and loans. Losing or corrupting that data is the worst
thing the software can do, so every change to the database follows these rules. The checks in
`server/test/schema.test.ts` enforce them: a change that breaks a rule fails the tests before it can ship.

## 1. Migrations only add

- A change to the database is a new file in `server/migrations/`, numbered after the last one
  (`016_….sql`, `017_….sql`). Numbers have no gaps or duplicates.
- **Never edit, rename or delete a migration that has run.** The runner stores a checksum of every applied file.
  An edited file stops the server outside production, and logs a warning in production. Put the fix in a new file.
- New migrations never `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `RENAME`, `DELETE FROM` or add `ON DELETE CASCADE`.
  - To retire a column, stop using it in the code and leave it in place. It can be removed much later, after a
    backup, in a migration that has been reviewed.
  - When one of these is truly needed, the line must carry `-- data-safety: reviewed (why)` so a reviewer sees it.
- Every migration runs inside one transaction. If any statement fails, the whole file rolls back and nothing changes.
- An advisory lock lets only one server migrate at a time, so two instances starting together cannot both migrate.
- When backups are on (`BACKUPS_ENABLED=1`, which needs `pg_dump` on the server), the server takes a backup
  before applying new migrations to a database that has data. If that backup fails, the database is not changed.
  The host's own daily backups are still needed. Render's free database has none.

## Backups and restore

- Tables use forced row-level security, which also stops `pg_dump`. Every such table therefore has a read-only
  `backup_read` policy. Only a session that sets `app.backup_read = on` can use it; the backup job sets it through
  `PGOPTIONS`, and the app never does.
- A backup is refused when any table lacks that policy. Without this check it would silently save only a few rows.
  Before migration 015 that is exactly what happened: a "successful" backup held 63 of 868 rows.
- Restoring:
  1. Create an empty database owned by the app's user.
  2. Run `pg_restore --no-owner --exit-on-error -d <new database url> <file>.dump`.
  3. Point `DATABASE_URL` at the new database.

  `server/test/schema.test.ts` restores a fresh backup this way on every test run and checks every row of every shop.
- The very first upgrade to migration 015 cannot take its own backup, because the policy arrives in that migration.
  Set `MIGRATE_WITHOUT_BACKUP=1` for that one start, or rely on the host's backup.

## 2. Keys

- Every table has a primary key: a `uuid` with `DEFAULT gen_random_uuid()`, or a natural key when one exists.
- Every column that points at another row (`…_id uuid`) has a foreign key and an index.
  - The only exceptions are polymorphic columns, whose target depends on a type column, such as `attachments.entity_id`
    with `entity_type`. They are listed in the test with the reason.
- Foreign keys **refuse** deletes (`RESTRICT` / `NO ACTION`). They never cascade, so deleting a parent cannot
  silently wipe its history.
  - Three owned children still cascade, because the app deletes their parent on purpose:
    - the public links and reminder log of a draft invoice;
    - the activity notes of a customer with no invoices or orders.
- A blocked delete returns a clear "referenced by other records" message (HTTP 409), not a crash.

## 3. Deleting things

- Records with history are **archived or cancelled, never deleted**:
  - Items and accounts are archived.
  - Customers are archived: hidden from pickers, all invoices kept, restorable.
  - Issued invoices are cancelled or credited.
  - Loan payments are reversed.
- Only rows that nothing else refers to can be deleted, such as a draft, an unused customer or a note. Every delete
  is written to the audit log.

## 4. Each shop's data is separate

- Every table with `shop_id` uses forced row-level security, so each query sees only the current shop's rows.
  - Five tables are read before the shop is known (sign-in and public links), so they cannot use it. They are listed
    in the test, and their queries always filter by `shop_id` in code.

## 5. Each module's data is separate

- A module (for example Microfinance) keeps its data in its own tables (`lending_*`). It writes to shared
  tables only through the shared services (ledger, audit).
- Switching a module off hides it. **Nothing is deleted**, and switching it back on shows everything again.
- Removing a module from the code leaves its tables in place, so no shop loses data.

## Adding a feature: checklist

1. Put new tables and columns in a new migration file. Give each new table `shop_id`, forced row-level security
   with the `backup_read` policy, a primary key, foreign keys with indexes, and no cascades.
2. Give new columns on existing tables a default (`NOT NULL DEFAULT …`), so old rows stay valid.
3. Run `npx vitest run`. The schema checks must pass.
4. Rehearse the upgrade on a copy of the live database before deploying.
