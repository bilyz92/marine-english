import { describe, expect, it } from "vitest";
import { GET as listCourses } from "@/app/api/public/courses/route";
import { GET as getCourse } from "@/app/api/public/courses/[slug]/route";
import { GET as getTrial } from "@/app/api/public/courses/[slug]/trial/[position]/route";
import { PATCH as patchCourse } from "@/app/api/quan-tri/courses/[id]/route";
import { withTx } from "@/lib/db";
import { createSession } from "@/modules/sessions/sessions";
import { auditRows, insertAdmin } from "../helpers/admin";
import { publish, seedContent } from "../helpers/content";

const ORIGIN = process.env.APP_ORIGIN!;
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function admin(role: "owner" | "support", authAt = new Date()) {
  const adminId = await insertAdmin(`${role}${Math.random()}@x.vn`, role);
  return withTx((tx) => createSession(tx, { realm: "admin", adminId, authAt }));
}

function patch(id: string, s: { token: string; csrf: string }, body: unknown) {
  return patchCourse(
    new Request(`${ORIGIN}/api/quan-tri/courses/${id}`, {
      method: "PATCH",
      headers: { cookie: `__Host-me_admin=${s.token}`, origin: ORIGIN, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params({ id }),
  );
}

describe("danh mục công khai", () => {
  it("khóa draft không lộ; publish rồi mới thấy, kèm 3 bài học thử có tiêu đề tiếng Việt", async () => {
    await seedContent();
    expect(await (await listCourses(get("/api/public/courses"))).json()).toEqual({ courses: [] });
    expect((await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).status).toBe(404);
    expect((await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position: "1" }))).status).toBe(404);
    await publish("engine_cadet_tanker");
    const { courses } = (await (await listCourses(get("/api/public/courses"))).json()) as { courses: { slug: string; priceVnd: number; lessonCount: number; trialLessons: { position: number; externalId: string; title: string }[] }[] };
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ slug: "engine_cadet_tanker", priceVnd: 199_000, lessonCount: 4 });
    expect(courses[0]!.trialLessons.map((l) => l.externalId)).toEqual(["A001", "A002", "A003-1"]);
    expect(courses[0]!.trialLessons[0]!.title).toMatch(/^Hãy giới thiệu/);
    const detail = (await (await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).json()) as { lessons: { isFreeTrial: boolean }[] };
    expect(detail.lessons.map((l) => l.isFreeTrial)).toEqual([true, true, true, false]);
    // Giao diện v2: trang khóa chia bài theo chủ đề như trong app học.
    const topical = detail as unknown as { topics: { id: string; titleVi: string }[]; lessons: { topic: string | null }[] };
    expect(topical.topics).toEqual([{ id: "A1", titleVi: "Học vấn và mục tiêu nghề nghiệp" }, { id: "B1", titleVi: "Tàu dầu và hóa chất" }]);
    expect(topical.lessons.map((l) => l.topic)).toEqual(["A1", "A1", "A1", "B1"]);
  });

  it("bài học thử: vị trí 1–3 có nội dung; vị trí 4, 0, abc → 404", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const ok = await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position: "3" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { externalId: string }).externalId).toBe("A003-1");
    for (const position of ["4", "0", "abc", "-1"]) {
      expect((await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position }))).status, position).toBe(404);
    }
  });
});

describe("quản trị sửa giá và trạng thái", () => {
  it("publish chưa có giá → 409; owner đặt giá + publish → ok, audit có trước/sau", async () => {
    const ids = await seedContent();
    const owner = await admin("owner");
    const id = ids.engine_cadet_tanker!;
    const early = await patch(id, owner, { status: "published" });
    expect([early.status, await early.json()]).toEqual([409, { error: "needs_price" }]);
    expect((await patch(id, owner, { priceVnd: 249_000, status: "published" })).status).toBe(200);
    const [row] = await auditRows("course_update");
    expect(row).toMatchObject({ result: "ok", target_id: id });
    expect((await patch(crypto.randomUUID(), owner, { priceVnd: 1000 })).status).toBe(404);
    expect((await patch(id, owner, { priceVnd: 0 })).status).toBe(400);
  });

  it("support → 403 role; owner lâu chưa xác thực → 403 reauth_required", async () => {
    const ids = await seedContent();
    const support = await admin("support");
    const res = await patch(ids.engine_cadet_tanker!, support, { priceVnd: 1000 });
    expect([res.status, await res.json()]).toEqual([403, { error: "role" }]);
    const stale = await admin("owner", new Date(Date.now() - 11 * 60_000));
    expect((await patch(ids.engine_cadet_tanker!, stale, { priceVnd: 1000 })).status).toBe(403);
  });
});
