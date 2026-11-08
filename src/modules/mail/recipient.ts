import { prisma } from "@/lib/db";

// Địa chỉ nhận thư của học viên: dùng chung cho gửi thư (outbox) và bước 3 của trang mua (hiện email sẽ nhận thư), để hai chỗ luôn khớp.

/**
 * Email của học viên; tài khoản đã gộp thì định danh nằm ở tài khoản đích nên tra ngược lên theo merged_into_id. Không có email đã
 * xác minh thì dùng email liên hệ khách nhập ở trang mua (chưa xác minh, chỉ để gửi thư).
 */
export async function learnerEmail(userId: string): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ email: string }[]>`
    WITH RECURSIVE up(id, merged_into_id) AS (
      SELECT id, merged_into_id FROM users WHERE id = ${userId}::uuid
      UNION
      SELECT u.id, u.merged_into_id FROM users u JOIN up ON u.id = up.merged_into_id
    )
    SELECT i.value_canonical AS email FROM up JOIN user_identities i ON i.user_id = up.id
    WHERE i.kind = 'email' ORDER BY i.verified_at DESC LIMIT 1`;
  if (rows[0]) return rows[0].email;
  // Email liên hệ trong cả nhóm gộp (tài khoản gốc của nhóm và mọi tài khoản đã gộp vào nó), ưu tiên của chính tài khoản này.
  const [contact] = await prisma().$queryRaw<{ email: string }[]>`
    WITH RECURSIVE up(id, merged_into_id) AS (
      SELECT id, merged_into_id FROM users WHERE id = ${userId}::uuid
      UNION
      SELECT u.id, u.merged_into_id FROM users u JOIN up ON u.id = up.merged_into_id
    ), root AS (SELECT id FROM up WHERE merged_into_id IS NULL),
    grp(id) AS (
      SELECT id FROM root
      UNION
      SELECT u.id FROM users u JOIN grp ON u.merged_into_id = grp.id
    )
    SELECT c.email FROM learner_contact_emails c JOIN grp ON grp.id = c.user_id
    ORDER BY (c.user_id = ${userId}::uuid) DESC, c.created_at DESC LIMIT 1`;
  return contact?.email ?? null;
}
