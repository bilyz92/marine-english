import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { POST as upload } from "@/app/api/quan-tri/content/import/route";
import { importContent } from "@/worker/content-import";
import { adminSess, type AdminSess } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { publish } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";
import { makeZip } from "../helpers/zip";

// Bước 3 của docs/superpowers/plans/2026-11-02-content-authoring.md: chủ tải gói lên, xem trước, nhập.

const failAudit = vi.hoisted(() => ({ on: false }));
vi.mock("@/modules/audit/audit", async (original) => {
  const real = await original<typeof import("@/modules/audit/audit")>();
  return {
    ...real,
    audit: async (...args: Parameters<typeof real.audit>) => {
      if (failAudit.on && args[1].action === "content_import") throw new Error("audit hỏng");
      return real.audit(...args);
    },
  };
});

const fixtureText = () => readFileSync("tests/fixtures/content-mini.json", "utf8");
const fixtureBytes = () => Buffer.from(fixtureText());

function send(s: AdminSess, bytes: Buffer, file: string, query: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const qs = new URLSearchParams({ file, ...query }).toString();
  return upload(
    new Request(`${process.env.APP_ORIGIN}/api/quan-tri/content/import?${qs}`, {
      method: "POST",
      headers: {
        cookie: `__Host-me_admin=${s.token}`,
        origin: process.env.APP_ORIGIN!,
        "x-csrf-token": s.csrf,
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length),
        ...headers,
      },
      body: new Uint8Array(bytes),
    }),
  );
}

type Preview = { receipt: string; courses: { slug: string; existed: boolean; status: string; newVersion: boolean; live: boolean }[]; newLessonVersions: number; needsConfirm: string[] };

async function preview(s: AdminSess, bytes: Buffer, file: string) {
  const res = await send(s, bytes, file);
  expect(res.status).toBe(200);
  return (await res.json()) as Preview;
}

const apply = (s: AdminSess, bytes: Buffer, file: string, receipt: string, extra: Record<string, string> = {}) =>
  send(s, bytes, file, { apply: "1", ...extra }, { "x-preview-receipt": receipt });

const count = async (table: string) => (await sqlAsMigrator(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

describe("nhập gói nội dung trên web", () => {
  it("hỗ trợ bị 403; chủ đăng nhập quá 10 phút bị 403 reauth_required", async () => {
    const support = await adminSess("support");
    expect((await send(support, fixtureBytes(), "a.json")).status).toBe(403);
    const owner = await adminSess("owner");
    await sqlAsMigrator(`UPDATE admin_sessions SET auth_at = now() - interval '11 minutes' WHERE admin_user_id = $1`, [owner.adminId]);
    const res = await send(owner, fixtureBytes(), "a.json");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "reauth_required" });
  });

  it("xem trước không ghi gì; nhập thật cần biên nhận đúng; nhập lại không tạo phiên bản mới; audit", async () => {
    const owner = await adminSess("owner");
    const p = await preview(owner, fixtureBytes(), "content-mini.json");
    expect(p.courses.map((c) => [c.slug, c.existed, c.newVersion])).toEqual([["engine_cadet_tanker", false, true], ["engine_cadet_dry_cargo", false, true]]);
    expect(p.newLessonVersions).toBe(5);
    expect(await count("lessons")).toBe(0);

    expect((await send(owner, fixtureBytes(), "content-mini.json", { apply: "1" })).status).toBe(409);
    expect((await apply(owner, fixtureBytes(), "content-mini.json", `${p.receipt}x`)).status).toBe(409);
    const other = Buffer.from(fixtureText().replace("engine_cadet_tanker", "engine_cadet_tanker_2"));
    expect((await apply(owner, other, "content-mini.json", p.receipt)).status).toBe(409);
    const someoneElse = await adminSess("owner");
    expect((await apply(someoneElse, fixtureBytes(), "content-mini.json", p.receipt)).status).toBe(409);
    expect(await count("lessons")).toBe(0);

    const ok = await apply(owner, fixtureBytes(), "content-mini.json", p.receipt);
    expect(ok.status).toBe(200);
    expect(await count("course_versions")).toBe(2);
    const [row] = await auditRows("content_import");
    expect(row).toMatchObject({ admin_user_id: owner.adminId, result: "ok" });
    expect(row!.target_id).toMatch(/^[0-9a-f]{64}$/);

    const again = await preview(owner, fixtureBytes(), "content-mini.json");
    expect(again.newLessonVersions).toBe(0);
    expect(again.courses.every((c) => c.existed && !c.newVersion)).toBe(true);
    expect((await apply(owner, fixtureBytes(), "content-mini.json", again.receipt)).status).toBe(200);
    expect(await count("course_versions")).toBe(2);
  });

  it("khóa đổi sau lúc xem trước → 409 stale_preview", async () => {
    const owner = await adminSess("owner");
    const p = await preview(owner, fixtureBytes(), "content-mini.json");
    const migrator = await pgAs("migrator");
    try {
      const changed = JSON.parse(fixtureText());
      changed.lessons[0].question.text.vi = "Đã đổi ở chỗ khác";
      await importContent(migrator, changed);
    } finally {
      await migrator.end();
    }
    const res = await apply(owner, fixtureBytes(), "content-mini.json", p.receipt);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale_preview" });
  });

  it("tên khóa bị đổi chen giữa lúc xem trước và lúc nhập → 409 stale_preview", async () => {
    const owner = await adminSess("owner");
    const first = await preview(owner, fixtureBytes(), "content-mini.json");
    await apply(owner, fixtureBytes(), "content-mini.json", first.receipt);
    const p = await preview(owner, fixtureBytes(), "content-mini.json");
    await sqlAsMigrator(`UPDATE courses SET title_vi = 'Tên đổi chen giữa' WHERE slug = 'engine_cadet_tanker'`);
    const res = await apply(owner, fixtureBytes(), "content-mini.json", p.receipt);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale_preview" });
  });

  it("khóa đang bán: xem trước báo, nhập thật cần confirmLive", async () => {
    const owner = await adminSess("owner");
    const first = await preview(owner, fixtureBytes(), "content-mini.json");
    await apply(owner, fixtureBytes(), "content-mini.json", first.receipt);
    await publish("engine_cadet_tanker");
    const changed = JSON.parse(fixtureText());
    changed.lessons[0].question.text.vi = "Bản mới";
    const bytes = Buffer.from(JSON.stringify(changed));
    const p = await preview(owner, bytes, "content-mini.json");
    expect(p.needsConfirm).toEqual(["engine_cadet_tanker"]);
    const blocked = await apply(owner, bytes, "content-mini.json", p.receipt);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "needs_confirm", courses: ["engine_cadet_tanker"] });
    expect((await apply(owner, bytes, "content-mini.json", p.receipt, { confirmLive: "1" })).status).toBe(200);

    // Chỉ đổi tên khóa đang bán cũng cần xác nhận.
    changed.courses[0].title.vi = "Tên mới của khóa";
    const renamed = Buffer.from(JSON.stringify(changed));
    const r = await preview(owner, renamed, "content-mini.json");
    expect(r.courses.find((c) => c.slug === "engine_cadet_tanker")).toMatchObject({ newVersion: false, live: true });
    expect((await apply(owner, renamed, "content-mini.json", r.receipt)).status).toBe(409);
  });

  it("gói hai bộ mà bộ sau lỗi → không ghi gì; lỗi ghi audit → không ghi gì", async () => {
    const owner = await adminSess("owner");
    const bad = JSON.parse(fixtureText());
    bad.dataset_id = "bad";
    bad.courses[0].id = "khoa_loi";
    bad.courses[0].lesson_ids.push("KHONG-CO");
    const zip = makeZip([{ name: "a.json", data: fixtureText() }, { name: "b.json", data: JSON.stringify(bad) }]);
    const res = await send(owner, zip, "goi.zip");
    expect(res.status).toBe(400);
    expect(await count("lessons")).toBe(0);

    const p = await preview(owner, fixtureBytes(), "content-mini.json");
    failAudit.on = true;
    try {
      await expect(apply(owner, fixtureBytes(), "content-mini.json", p.receipt)).rejects.toThrow("audit hỏng");
    } finally {
      failAudit.on = false;
    }
    expect(await count("lessons")).toBe(0);
  });

  it("tệp quá lớn → 413; tệp sai → 400; hai lần nhập cùng lúc → một lần 429", async () => {
    const owner = await adminSess("owner");
    const big = await send(owner, Buffer.alloc(10), "a.json", {}, { "content-length": String(17 * 1024 * 1024) });
    expect(big.status).toBe(413);
    expect((await send(owner, Buffer.from("{x"), "a.json")).status).toBe(400);
    const oiler = readFileSync("docs/Oiler_Bilingual_Three_Levels_v1/Oiler_Learning_Data_v1.json");
    const [a, b] = await Promise.all([send(owner, oiler, "oiler.json"), send(owner, oiler, "oiler.json")]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
  });

  it("gói thật cỡ lớn (Oiler 120 bài) nhập được trong thời gian cho phép", async () => {
    const owner = await adminSess("owner");
    const oiler = readFileSync("docs/Oiler_Bilingual_Three_Levels_v1/Oiler_Learning_Data_v1.json");
    const p = await preview(owner, oiler, "oiler.json");
    expect(p.courses.map((c) => c.slug)).toEqual(["oiler_tanker", "oiler_dry_cargo", "oiler_container"]);
    const started = Date.now();
    const res = await apply(owner, oiler, "oiler.json", p.receipt);
    expect(res.status).toBe(200);
    console.log(`nhập Oiler qua web: ${Date.now() - started} ms`);
    expect(await count("lessons")).toBe(120);
  }, 120_000);

  it("tệp Word: một khóa nháp, câu hỏi tiếng Anh", async () => {
    const owner = await adminSess("owner");
    const docx = readFileSync("docs/Engine_Cadet_Three_Levels_v6/nguon/Engine_Cadet_03_Container_EN.docx");
    const p = await preview(owner, docx, "Engine_Cadet_03_Container_EN.docx");
    expect(p.courses).toEqual([expect.objectContaining({ slug: "engine_cadet_03_container_en", existed: false })]);
    expect((await apply(owner, docx, "Engine_Cadet_03_Container_EN.docx", p.receipt)).status).toBe(200);
    const { rows } = await sqlAsMigrator(`SELECT status FROM courses WHERE slug = 'engine_cadet_03_container_en'`);
    expect(rows[0].status).toBe("draft");
  });
});
