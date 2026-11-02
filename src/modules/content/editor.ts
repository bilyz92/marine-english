import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, sqlState, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { canonical, contentHash } from "@/worker/content-import";
import { ContentConflict } from "./authoring";

// Chủ sửa và thêm bài trên web (docs/superpowers/plans/2026-11-02-content-authoring.md, bước 5).
// Phiên bản bất biến: sửa = phiên bản bài mới + phiên bản khóa mới thay bài đó tại chỗ; chỉ đổi khóa đang mở.

const FREE_TRIAL_LESSONS = 3;
const EDIT_TX = { lockTimeoutMs: 3_000, retries: 0 };

const text = z.string().trim().max(4000);
const pair = z.object({ en: text, vi: text.optional().default("") });
export const LessonFields = z.object({
  questionEn: text.min(1),
  questionVi: text.optional().default(""),
  keyPoints: z.array(pair).max(10).default([]),
  vocabulary: z.array(pair).max(40).default([]),
  modelAnswerEn: text.optional().default(""),
  modelAnswerVi: text.optional().default(""),
  followUps: z.array(pair).max(20).default([]),
});
export const SaveLesson = LessonFields.extend({ expectedVersionId: z.uuid().nullable(), confirmLive: z.boolean().optional().default(false) });
export type SaveLessonInput = z.infer<typeof SaveLesson>;

export const CreateCourse = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_]{2,59}$/, "Mã khóa chỉ gồm chữ thường không dấu, số, gạch dưới (3–60 ký tự)"),
  titleVi: z.string().trim().min(1).max(200),
  titleEn: z.string().trim().min(1).max(200),
});

type Json = Record<string, unknown>;
type Member = { position: number; isFreeTrial: boolean; lessonVersionId: string; externalId: string; hash: string; content: Json };
type CourseRow = { id: string; slug: string; title_vi: string; title_en: string; status: string; current_version_id: string | null };

const bilingual = (en: string, vi: string) => (vi ? { en, vi } : { en });

async function members(db: Tx | ReturnType<typeof prisma>, versionId: string | null): Promise<Member[]> {
  if (!versionId) return [];
  const rows = await db.$queryRaw<{ position: number; is_free_trial: boolean; lesson_version_id: string; external_id: string; content_hash: string; content: Json }[]>`
    SELECT cvl.position, cvl.is_free_trial, lv.id::text AS lesson_version_id, l.external_id, lv.content_hash, lv.content
    FROM course_version_lessons cvl JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
    WHERE cvl.course_version_id = ${versionId}::uuid ORDER BY cvl.position`;
  return rows.map((r) => ({ position: r.position, isFreeTrial: r.is_free_trial, lessonVersionId: r.lesson_version_id, externalId: r.external_id, hash: r.content_hash, content: r.content }));
}

async function courseBySlug(db: Tx | ReturnType<typeof prisma>, slug: string, lock = false): Promise<CourseRow> {
  const rows = lock
    ? await db.$queryRaw<CourseRow[]>`SELECT id::text AS id, slug, title_vi, title_en, status, current_version_id::text AS current_version_id FROM courses WHERE slug = ${slug} FOR UPDATE`
    : await db.$queryRaw<CourseRow[]>`SELECT id::text AS id, slug, title_vi, title_en, status, current_version_id::text AS current_version_id FROM courses WHERE slug = ${slug}`;
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

const questionOf = (c: Json) => (c.question as { text?: { en?: string; vi?: string } } | undefined)?.text ?? {};

export async function courseLessons(ctx: AdminCtx, slug: string) {
  await authorize(ctx, "orders.view", { action: "content_view", resource: { type: "course", id: slug } });
  const course = await courseBySlug(prisma(), slug);
  const list = await members(prisma(), course.current_version_id);
  return {
    course: { slug: course.slug, titleVi: course.title_vi, titleEn: course.title_en, status: course.status, currentVersionId: course.current_version_id },
    lessons: list.map((m) => ({ position: m.position, externalId: m.externalId, questionEn: questionOf(m.content).en ?? "", questionVi: questionOf(m.content).vi ?? "", isFreeTrial: m.isFreeTrial, hasAnswer: !!(m.content.model_answer as Json | undefined) })),
  };
}

export async function lessonInCourse(ctx: AdminCtx, slug: string, externalId: string) {
  await authorize(ctx, "orders.view", { action: "content_view", resource: { type: "course", id: slug } });
  const course = await courseBySlug(prisma(), slug);
  const m = (await members(prisma(), course.current_version_id)).find((x) => x.externalId === externalId);
  if (!m) throw new HttpError(404, "not_found");
  return { externalId, content: m.content, currentVersionId: course.current_version_id, status: course.status };
}

/** Ghép trường soạn được vào nội dung cũ; giữ nguyên mọi trường khác (học liệu ba mức, hoạt động, nguồn…). */
export function applyFields(base: Json, id: string, f: z.infer<typeof LessonFields>): Json {
  const old = (key: string) => ((base[key] as Json[] | undefined) ?? []);
  const next: Json = {
    ...base,
    id,
    question: { ...(base.question as Json | undefined), id: (base.question as Json | undefined)?.id ?? `${id}.question`, text: bilingual(f.questionEn, f.questionVi) },
    key_points: f.keyPoints.filter((k) => k.en).map((k, i) => ({ ...old("key_points")[i], id: old("key_points")[i]?.id ?? `${id}.kp.${i + 1}`, order: i + 1, text: bilingual(k.en, k.vi) })),
    vocabulary: f.vocabulary.filter((v) => v.en).map((v, i) => ({ id: `${id}.vocab.${i + 1}`, text: bilingual(v.en, v.vi) })),
    follow_up_questions: f.followUps.filter((q) => q.en).map((q, i) => ({ ...old("follow_up_questions")[i], id: old("follow_up_questions")[i]?.id ?? `${id}.probe.${i + 1}`, prompt: bilingual(q.en, q.vi) })),
  };
  if (f.modelAnswerEn) next.model_answer = { ...(base.model_answer as Json | undefined), id: (base.model_answer as Json | undefined)?.id ?? `${id}.answer`, text: bilingual(f.modelAnswerEn, f.modelAnswerVi) };
  else delete next.model_answer;
  return next;
}

async function lessonVersionFor(tx: Tx, externalId: string, content: Json): Promise<{ id: string; hash: string }> {
  const hash = contentHash(content);
  await tx.$executeRaw`INSERT INTO lessons (external_id) VALUES (${externalId}) ON CONFLICT (external_id) DO NOTHING`;
  const [lesson] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM lessons WHERE external_id = ${externalId}`;
  const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM lesson_versions WHERE lesson_id = ${lesson!.id}::uuid AND content_hash = ${hash}`;
  if (existing) return { id: existing.id, hash };
  const [created] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO lesson_versions (lesson_id, version, content, content_hash)
    VALUES (${lesson!.id}::uuid, (SELECT coalesce(max(version), 0) + 1 FROM lesson_versions WHERE lesson_id = ${lesson!.id}::uuid), ${canonical(content as never)}::jsonb, ${hash})
    RETURNING id::text AS id`;
  return { id: created!.id, hash };
}

/** Sửa bài (externalId có sẵn) hoặc thêm bài cuối khóa (externalId null). */
export async function saveLesson(ctx: AdminCtx, slug: string, externalId: string | null, input: SaveLessonInput) {
  await authorize(ctx, "content.edit", { action: externalId ? "lesson_edit" : "lesson_add", resource: { type: "course", id: slug } });
  try {
    return await withTx(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('content-import'))`;
      const course = await courseBySlug(tx, slug, true);
      if (course.current_version_id !== input.expectedVersionId) throw new ContentConflict("stale");
      if (course.status === "published" && !input.confirmLive) throw new ContentConflict("needs_confirm", [slug]);
      const list = await members(tx, course.current_version_id);
      let id = externalId;
      let base: Json = {};
      if (id) {
        const m = list.find((x) => x.externalId === id);
        if (!m) throw new HttpError(404, "not_found");
        base = m.content;
      } else {
        const used = new Set((await tx.$queryRaw<{ external_id: string }[]>`SELECT external_id FROM lessons WHERE external_id LIKE ${`${slug}-b%`}`).map((r) => r.external_id));
        let n = list.length + 1;
        while (used.has(`${slug}-b${n}`)) n++;
        id = `${slug}-b${n}`;
        base = { source_kind: "web_editor" };
      }
      const content = applyFields(base, id, input);
      const lv = await lessonVersionFor(tx, id, content);
      const next = externalId
        ? list.map((m) => (m.externalId === id ? { ...m, lessonVersionId: lv.id, hash: lv.hash } : m))
        : [...list, { position: list.length + 1, isFreeTrial: list.length < FREE_TRIAL_LESSONS, lessonVersionId: lv.id, externalId: id, hash: lv.hash, content }];
      const sourceHash = createHash("sha256").update(JSON.stringify(next.map((m) => [m.externalId, m.hash]))).digest("hex");
      const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM course_versions WHERE course_id = ${course.id}::uuid AND source_hash = ${sourceHash}`;
      let versionId = existing?.id;
      if (!versionId) {
        const [created] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO course_versions (course_id, version, content_version, source_hash)
          VALUES (${course.id}::uuid, (SELECT coalesce(max(version), 0) + 1 FROM course_versions WHERE course_id = ${course.id}::uuid), 'web', ${sourceHash})
          RETURNING id::text AS id`;
        versionId = created!.id;
        for (const m of next) {
          await tx.$executeRaw`INSERT INTO course_version_lessons (course_version_id, lesson_version_id, position, is_free_trial)
            VALUES (${versionId}::uuid, ${m.lessonVersionId}::uuid, ${m.position}, ${m.isFreeTrial})`;
        }
      }
      if (versionId !== course.current_version_id) {
        await tx.$executeRaw`UPDATE courses SET current_version_id = ${versionId}::uuid, updated_at = now() WHERE id = ${course.id}::uuid`;
        await audit(tx, {
          adminId: ctx.adminId,
          action: externalId ? "lesson_edit" : "lesson_add",
          targetType: "lesson",
          targetId: `${slug}/${id}`,
          before: { courseVersion: course.current_version_id },
          after: { courseVersion: versionId, lessonVersion: lv.id, live: course.status === "published" },
          result: "ok",
          ip: ctx.ip,
        });
      }
      return { externalId: id, currentVersionId: versionId };
    }, EDIT_TX);
  } catch (error) {
    if (sqlState(error) === "55P03") throw new ContentConflict("busy");
    throw error;
  }
}

export async function createCourse(ctx: AdminCtx, input: z.infer<typeof CreateCourse>) {
  await authorize(ctx, "content.edit", { action: "course_create", resource: { type: "course", id: input.slug } });
  return withTx(async (tx) => {
    const [created] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO courses (slug, title_vi, title_en) VALUES (${input.slug}, ${input.titleVi}, ${input.titleEn})
      ON CONFLICT (slug) DO NOTHING RETURNING id::text AS id`;
    if (!created) throw new HttpError(409, "slug_taken");
    await audit(tx, { adminId: ctx.adminId, action: "course_create", targetType: "course", targetId: created.id, after: input, result: "ok", ip: ctx.ip });
    return { slug: input.slug };
  });
}
