import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { sqlState, withTx, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import type { AdminCtx } from "@/modules/sessions/guards";
import { ContentImportError, importDatasets, type CourseReport, type Sql } from "@/worker/content-import";
import { PackageError, readPackage } from "./package";

// Chủ nhập gói nội dung trên web (docs/superpowers/plans/2026-11-02-content-authoring.md, bước 3).
// Xem trước = chạy đúng đường nhập trong giao dịch rồi ROLLBACK; nhập thật cần biên nhận của lần xem trước.

export class ContentConflict extends Error {
  constructor(readonly code: "stale_preview" | "stale" | "needs_confirm" | "busy", readonly courses: string[] = []) {
    super(code);
  }
}

export type CourseLine = CourseReport & { live: boolean };
export type ImportView = { file: string; sha256: string; sources: string[]; skipped: number; courses: CourseLine[]; newLessonVersions: number; newCourseVersions: number; needsConfirm: string[] };

const RECEIPT_TTL_MS = 15 * 60_000;
const IMPORT_TX = { txTimeoutMs: 60_000, statementTimeoutMs: 20_000, lockTimeoutMs: 5_000, retries: 0 };

/** Giao dịch Prisma theo giao diện Sql của bộ nhập. */
export const prismaSql = (tx: Tx): Sql => ({
  query: <T>(text: string, params: unknown[] = []) => tx.$queryRawUnsafe<T[]>(text, ...params),
});

type Receipt = { a: string; h: string; c: [string, string | null, string, boolean, string | null, string | null][]; x: number };

const receiptKey = () => Buffer.from(hkdfSync("sha256", Buffer.from(env().SESSION_KEY_ADMIN, "base64"), "", "me:content-import-receipt", 32));
const sign = (body: string) => createHmac("sha256", receiptKey()).update(body).digest("base64url");
const courseState = (c: CourseReport): Receipt["c"][number] => [c.slug, c.versionBefore, c.status, c.existed, c.titleBefore?.vi ?? null, c.titleBefore?.en ?? null];

function issueReceipt(adminId: string, sha256: string, courses: CourseReport[]): string {
  const body = Buffer.from(JSON.stringify({ a: adminId, h: sha256, c: courses.map(courseState), x: Date.now() + RECEIPT_TTL_MS } satisfies Receipt)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function readReceipt(token: string | null, adminId: string, sha256: string): Receipt {
  const [body, mac] = (token ?? "").split(".");
  const expected = body ? sign(body) : "";
  if (!body || !mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new ContentConflict("stale_preview");
  const r = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Receipt;
  if (r.a !== adminId || r.h !== sha256 || Date.now() > r.x) throw new ContentConflict("stale_preview");
  return r;
}

class DryRun extends Error {
  constructor(readonly view: ImportView) {
    super("dry run");
  }
}

let busy = false;

/** Xem trước (apply=false) hoặc nhập thật một tệp chủ tải lên. Mỗi lúc chỉ một lần (máy chủ ít RAM). */
export async function importUpload(
  ctx: AdminCtx,
  bytes: Buffer,
  fileName: string,
  opts: { apply: boolean; confirmLive: boolean; receipt: string | null },
): Promise<ImportView & { receipt?: string }> {
  if (busy) throw new HttpError(429, "busy");
  busy = true;
  try {
    let pkg;
    try {
      pkg = readPackage(bytes, fileName);
    } catch (error) {
      if (error instanceof PackageError) throw new HttpError(400, error.message);
      throw error;
    }
    const receipt = opts.apply ? readReceipt(opts.receipt, ctx.adminId, pkg.sha256) : null;
    try {
      const view = await withTx(async (tx) => {
        let report;
        try {
          report = await importDatasets(prismaSql(tx), pkg.datasets);
        } catch (error) {
          if (error instanceof ContentImportError) throw new HttpError(400, error.message);
          throw error;
        }
        // Khóa đang bán đổi nội dung hoặc đổi tên đều cần chủ xác nhận.
        const courses = report.courses.map((c) => ({ ...c, live: c.existed && c.status === "published" && (c.newVersion || c.titleChanged) }));
        const result: ImportView = {
          file: fileName,
          sha256: pkg.sha256,
          sources: pkg.sources,
          skipped: pkg.skipped.length,
          courses,
          newLessonVersions: report.newLessonVersions,
          newCourseVersions: report.newCourseVersions,
          needsConfirm: courses.filter((c) => c.live).map((c) => c.slug),
        };
        if (!receipt) throw new DryRun(result);
        // Trạng thái các khóa (đã khóa FOR UPDATE trong bộ nhập) phải đúng như lúc xem trước.
        if (JSON.stringify(receipt.c) !== JSON.stringify(report.courses.map(courseState))) throw new ContentConflict("stale_preview");
        if (result.needsConfirm.length && !opts.confirmLive) throw new ContentConflict("needs_confirm", result.needsConfirm);
        await audit(tx, {
          adminId: ctx.adminId,
          action: "content_import",
          targetType: "content_package",
          targetId: pkg.sha256,
          after: { file: fileName, sources: pkg.sources, newLessonVersions: report.newLessonVersions, courses: courses.map((c) => ({ slug: c.slug, from: c.versionBefore, to: c.versionAfter, live: c.live })) },
          result: "ok",
          ip: ctx.ip,
        });
        return result;
      }, IMPORT_TX);
      return view;
    } catch (error) {
      if (error instanceof DryRun) return { ...error.view, receipt: issueReceipt(ctx.adminId, pkg.sha256, error.view.courses) };
      if (sqlState(error) === "55P03") throw new ContentConflict("busy");
      // Giao dịch quá 60 s (Prisma P2028): đã rollback, không ghi gì.
      if ((error as { code?: unknown })?.code === "P2028") throw new HttpError(503, "timeout");
      throw error;
    }
  } finally {
    busy = false;
  }
}
