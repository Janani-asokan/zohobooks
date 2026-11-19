import { query, tx } from '../db';
import { hashPassword, randomToken } from '../auth';
import { deletedEmail, SHOP_RESTORE_DAYS } from '../../../shared/accountDeletion';

/**
 * Hourly: shops closed by their owner more than SHOP_RESTORE_DAYS ago lose the personal details of their logins and
 * owner. A login that also belongs to another shop that is still open keeps its details (it is someone else's staff
 * too). Bills, customers and accounts stay until records_until, as GST law requires.
 */
export async function runAccountDeletions(): Promise<number> {
  const due = await query<{ id: string }>(
    `SELECT id FROM shops WHERE deletion_requested_at < now() - make_interval(days => $1)
       AND personal_data_erased_at IS NULL AND active = false`, [SHOP_RESTORE_DAYS]);
  for (const { id } of due) {
    await tx(async (db) => {
      const users = (await db.query<{ id: string }>(
        `SELECT u.id FROM users u WHERE u.shop_id = $1 AND u.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM user_shops us JOIN shops s ON s.id = us.shop_id
                            WHERE us.user_id = u.id AND us.shop_id <> $1 AND s.active)`, [id])).rows;
      for (const u of users) {
        await db.query(`UPDATE users SET name = 'Deleted user', email = $2, password_hash = $3, active = false, deleted_at = now() WHERE id = $1`,
          [u.id, deletedEmail(u.id), await hashPassword(randomToken())]);
      }
      await db.query(`UPDATE shops SET owner_name = 'Deleted', email = '', phone = '', personal_data_erased_at = now() WHERE id = $1`, [id]);
    });
  }
  return due.length;
}
