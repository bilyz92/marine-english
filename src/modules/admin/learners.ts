import { prisma } from "@/lib/db";
import { authorize, permissionsFor } from "@/modules/auth-admin/authorize";
import { canonicalizeVnPhone } from "@/modules/identity/phone";
import type { AdminCtx } from "@/modules/sessions/guards";

const MIN_QUERY = 2;
const LIMIT = 20;

function maskPhone(value: string): string {
  return `${value.slice(0, 3)}•••••${value.slice(-3)}`;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Tìm học viên theo email, số điện thoại, mã đơn (chính xác) hoặc tên (chứa). Số điện thoại che bớt nếu thiếu quyền xem. */
export async function searchLearners(ctx: AdminCtx, query: string) {
  await authorize(ctx, "orders.view", { action: "learners_search" });
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  const phone = canonicalizeVnPhone(q);
  const email = q.toLowerCase();
  const code = q.toUpperCase();
  const name = `%${escapeLike(q)}%`;
  const users = await prisma().$queryRaw<{ id: string; display_name: string; rank: string | null; status: string; created_at: Date; merged_into_id: string | null }[]>`
    SELECT u.id, u.display_name, u.rank, u.status, u.created_at, u.merged_into_id FROM users u
    WHERE u.display_name ILIKE ${name}
       OR EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.value_canonical IN (${email}, ${phone ?? email}))
       OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.code = ${code})
    ORDER BY u.created_at DESC LIMIT ${LIMIT}`;
  if (users.length === 0) return [];
  const ids = users.map((u) => u.id);
  const identities = await prisma().userIdentity.findMany({ where: { userId: { in: ids } }, select: { userId: true, kind: true, valueCanonical: true } });
  const courses = await prisma().$queryRaw<{ user_id: string; enrollment_id: string; source: string; title_vi: string; course_id: string }[]>`
    SELECT e.user_id, e.id AS enrollment_id, e.source, c.title_vi, e.course_id FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ANY(${ids}::uuid[]) AND e.revoked_at IS NULL`;
  const canSeePhone = permissionsFor(ctx).includes("learner.phone.view");
  return users.map((u) => ({
    id: u.id, displayName: u.display_name, rank: u.rank, status: u.status, createdAt: u.created_at, mergedIntoId: u.merged_into_id,
    identities: identities.filter((i) => i.userId === u.id).map((i) => ({
      kind: i.kind,
      // Mã Google không có ích cho người vận hành.
      value: i.kind === "google" ? "Đã liên kết" : i.kind === "phone" && !canSeePhone ? maskPhone(i.valueCanonical) : i.valueCanonical,
    })),
    courses: courses.filter((c) => c.user_id === u.id).map((c) => ({ enrollmentId: c.enrollment_id, courseId: c.course_id, title: c.title_vi, source: c.source })),
  }));
}
