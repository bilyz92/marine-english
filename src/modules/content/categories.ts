import { prisma, sqlState, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { publicMediaUrl, putFile } from "@/modules/storage/storage";

// Danh mục khóa học hai cấp (chủ 14/11/2026, docs/superpowers/plans/2026-11-14-course-categories.md): parent_id null = danh mục
// (hiện là chức danh), có parent_id = danh mục con, không có cấp 3. Mọi ghi đi qua SQL thô (Prisma không ghi được cột sinh
// parent_key, name_key). Mọi thao tác đổi anh em (tạo, dời, xóa) lấy cùng một khóa giao dịch theo cha.

export const CATEGORY_TITLE_MAX = 80;
export const MAX_CATEGORY_IMAGE_BYTES = 2 * 1024 * 1024;
const ROOT_KEY = "00000000-0000-0000-0000-000000000000";

export type AdminCategory = {
  id: string; parentId: string | null; seedKey: string | null; titleVi: string; titleEn: string | null;
  imageUrl: string | null; position: number; courseCount: number;
};

type CategoryRow = { id: string; parent_id: string | null; parent_key: string; title_vi: string; title_en: string | null; position: number; image_asset_id: string | null };

function cleanTitle(title: string): string {
  const t = title.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!t || t.length > CATEGORY_TITLE_MAX) throw new HttpError(400, "Tên danh mục cần 1–80 ký tự");
  return t;
}

/** Tên tiếng Anh: chuỗi rỗng hoặc null = xóa. */
function cleanTitleEn(title: string | null): string | null {
  if (title === null) return null;
  const t = title.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > CATEGORY_TITLE_MAX) throw new HttpError(400, "Tên tiếng Anh cần tối đa 80 ký tự");
  return t;
}

/** Nhận diện theo byte đầu tệp, không tin tên tệp hay content-type. */
export function sniffImage(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const lockSiblings = (tx: Tx, parentKey: string) =>
  tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('course-category:' || ${parentKey}))`;

async function categoryRow(tx: Tx, id: string, mode: "update" | "share" | "none" = "none"): Promise<CategoryRow> {
  const rows =
    mode === "update"
      ? await tx.$queryRaw<CategoryRow[]>`
          SELECT id::text AS id, parent_id::text AS parent_id, parent_key::text AS parent_key, title_vi, title_en, position, image_asset_id::text AS image_asset_id
          FROM course_categories WHERE id = ${id}::uuid FOR UPDATE`
      : mode === "share"
        ? await tx.$queryRaw<CategoryRow[]>`
            SELECT id::text AS id, parent_id::text AS parent_id, parent_key::text AS parent_key, title_vi, title_en, position, image_asset_id::text AS image_asset_id
            FROM course_categories WHERE id = ${id}::uuid FOR SHARE`
        : await tx.$queryRaw<CategoryRow[]>`
            SELECT id::text AS id, parent_id::text AS parent_id, parent_key::text AS parent_key, title_vi, title_en, position, image_asset_id::text AS image_asset_id
            FROM course_categories WHERE id = ${id}::uuid`;
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

/**
 * Lỗi ràng buộc DB → mã lỗi nghiệp vụ. Bắt ngoài withTx (lỗi trong giao dịch tương tác làm hỏng cả giao dịch).
 * `fk` là mã cho lỗi khóa ngoại còn sót do chạy đua (xóa còn tham chiếu → 409, gắn vào danh mục vừa mất → 404).
 */
async function mapDbErrors<T>(run: () => Promise<T>, fk: () => HttpError = () => new HttpError(404, "not_found")): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // Prisma bọc lỗi SQL thô thành P2010; vi phạm ràng buộc chỉ mang mã gốc ở cause.originalCode.
    const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } })?.meta?.driverAdapterError?.cause;
    const code = typeof cause?.originalCode === "string" ? cause.originalCode : sqlState(error);
    const text = `${(error as Error)?.message ?? ""} ${JSON.stringify((error as { meta?: unknown })?.meta ?? null)}`;
    if (code === "23505" && text.includes("course_categories_name_key")) throw new HttpError(409, "category_name_taken");
    if (code === "23514" && text.includes("category_depth")) throw new HttpError(400, "category_depth");
    if (code === "23503") throw fk();
    throw error;
  }
}

export async function listCategories(ctx: AdminCtx): Promise<{ categories: AdminCategory[] }> {
  await authorize(ctx, "orders.view", { action: "category_list" });
  const rows = await prisma().$queryRaw<{
    id: string; parent_id: string | null; seed_key: string | null; title_vi: string; title_en: string | null;
    position: number; storage_key: string | null; course_count: number;
  }[]>`
    SELECT c.id::text AS id, c.parent_id::text AS parent_id, c.seed_key, c.title_vi, c.title_en, c.position, ma.storage_key,
           (SELECT count(*) FROM courses co WHERE co.category_id = c.id)::int AS course_count
    FROM course_categories c
    LEFT JOIN course_categories p ON p.id = c.parent_id
    LEFT JOIN media_assets ma ON ma.id = c.image_asset_id
    ORDER BY coalesce(p.position, c.position), c.parent_id IS NOT NULL, c.position`;
  return {
    categories: rows.map((r) => ({
      id: r.id, parentId: r.parent_id, seedKey: r.seed_key, titleVi: r.title_vi, titleEn: r.title_en,
      imageUrl: r.storage_key ? publicMediaUrl(r.storage_key) : null, position: r.position, courseCount: r.course_count,
    })),
  };
}

/** Tạo ở cuối nhóm anh em (cấp 1, hoặc danh mục con khi có parentId). Danh mục con không được có con. */
export async function createCategory(ctx: AdminCtx, input: { titleVi: string; titleEn?: string | null; parentId?: string | null }): Promise<{ id: string }> {
  await authorize(ctx, "content.edit", { action: "category_create" });
  const titleVi = cleanTitle(input.titleVi);
  const titleEn = cleanTitleEn(input.titleEn ?? null);
  return mapDbErrors(() =>
    withTx(async (tx) => {
      const parentId = input.parentId ?? null;
      if (parentId) {
        // FOR SHARE: xóa danh mục cha cùng lúc phải chờ (rồi thấy danh mục con này), hoặc mình thấy cha đã mất (404).
        const parent = await categoryRow(tx, parentId, "share");
        if (parent.parent_id !== null) throw new HttpError(400, "category_depth");
      }
      await lockSiblings(tx, parentId ?? ROOT_KEY);
      const [{ next }] = (await tx.$queryRaw<{ next: number }[]>`
        SELECT coalesce(max(position), 0)::int + 1 AS next FROM course_categories WHERE parent_key = ${parentId ?? ROOT_KEY}::uuid`) as [{ next: number }];
      const [created] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO course_categories (parent_id, title_vi, title_en, position)
        VALUES (${parentId}::uuid, ${titleVi}, ${titleEn}, ${next}) RETURNING id::text AS id`;
      await audit(tx, {
        adminId: ctx.adminId, action: "category_create", targetType: "course_category", targetId: created!.id,
        after: { parentId, titleVi, titleEn, position: next }, result: "ok", ip: ctx.ip,
      });
      return { id: created!.id };
    }),
  );
}

/** Đổi tên Việt và/hoặc tên Anh (titleEn null = xóa). */
export async function updateCategory(ctx: AdminCtx, id: string, change: { titleVi?: string; titleEn?: string | null }): Promise<void> {
  await authorize(ctx, "content.edit", { action: "category_update", resource: { type: "course_category", id } });
  const titleVi = change.titleVi === undefined ? undefined : cleanTitle(change.titleVi);
  const titleEn = change.titleEn === undefined ? undefined : cleanTitleEn(change.titleEn);
  await mapDbErrors(() =>
    withTx(async (tx) => {
      const before = await categoryRow(tx, id, "update");
      const after = { titleVi: titleVi ?? before.title_vi, titleEn: titleEn === undefined ? before.title_en : titleEn };
      if (after.titleVi === before.title_vi && after.titleEn === before.title_en) return;
      await tx.$executeRaw`UPDATE course_categories SET title_vi = ${after.titleVi}, title_en = ${after.titleEn} WHERE id = ${id}::uuid`;
      await audit(tx, {
        adminId: ctx.adminId, action: "category_update", targetType: "course_category", targetId: id,
        before: { titleVi: before.title_vi, titleEn: before.title_en }, after, result: "ok", ip: ctx.ip,
      });
    }),
  );
}

/** Đổi chỗ với anh em kề; ở đầu (lên) hay cuối (xuống) thì không làm gì. */
export async function moveCategory(ctx: AdminCtx, id: string, direction: "up" | "down"): Promise<void> {
  await authorize(ctx, "content.edit", { action: "category_move", resource: { type: "course_category", id } });
  await withTx(async (tx) => {
    const { parent_key } = await categoryRow(tx, id);
    await lockSiblings(tx, parent_key);
    const me = await categoryRow(tx, id, "update");
    const target = direction === "up" ? me.position - 1 : me.position + 1;
    const [other] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM course_categories WHERE parent_key = ${me.parent_key}::uuid AND position = ${target} FOR UPDATE`;
    if (!other) return;
    await tx.$executeRaw`SET CONSTRAINTS course_categories_position_key DEFERRED`;
    await tx.$executeRaw`UPDATE course_categories SET position = ${me.position} WHERE id = ${other.id}::uuid`;
    await tx.$executeRaw`UPDATE course_categories SET position = ${target} WHERE id = ${id}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "category_move", targetType: "course_category", targetId: id,
      before: { position: me.position }, after: { position: target }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Chỉ xóa khi không còn danh mục con và không còn khóa nào (kể cả nháp, ngừng bán); anh em phía sau dồn lên. */
export async function deleteCategory(ctx: AdminCtx, id: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "category_delete", resource: { type: "course_category", id } });
  await mapDbErrors(
    () =>
      withTx(async (tx) => {
        const { parent_key } = await categoryRow(tx, id);
        await lockSiblings(tx, parent_key);
        const me = await categoryRow(tx, id, "update");
        const [{ children, courses }] = (await tx.$queryRaw<{ children: number; courses: number }[]>`
          SELECT (SELECT count(*) FROM course_categories WHERE parent_id = ${id}::uuid)::int AS children,
                 (SELECT count(*) FROM courses WHERE category_id = ${id}::uuid)::int AS courses`) as [{ children: number; courses: number }];
        if (children > 0 || courses > 0) throw new HttpError(409, "category_not_empty");
        await tx.$executeRaw`DELETE FROM course_categories WHERE id = ${id}::uuid`;
        await tx.$executeRaw`
          UPDATE course_categories SET position = position - 1 WHERE parent_key = ${me.parent_key}::uuid AND position > ${me.position}`;
        await audit(tx, {
          adminId: ctx.adminId, action: "category_delete", targetType: "course_category", targetId: id,
          before: { parentId: me.parent_id, titleVi: me.title_vi, titleEn: me.title_en, position: me.position }, result: "ok", ip: ctx.ip,
        });
      }),
    () => new HttpError(409, "category_not_empty"),
  );
}

/** Gắn khóa (mọi trạng thái) vào danh mục hoặc danh mục con; null = bỏ gắn ("Khóa khác"). */
export async function setCourseCategory(ctx: AdminCtx, courseId: string, categoryId: string | null): Promise<void> {
  await authorize(ctx, "content.edit", { action: "course_category_set", resource: { type: "course", id: courseId } });
  await mapDbErrors(() =>
    withTx(async (tx) => {
      if (categoryId) await categoryRow(tx, categoryId, "share");
      const [course] = await tx.$queryRaw<{ slug: string; category_id: string | null }[]>`
        SELECT slug, category_id::text AS category_id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`;
      if (!course) throw new HttpError(404, "not_found");
      if (course.category_id === categoryId) return;
      await tx.$executeRaw`UPDATE courses SET category_id = ${categoryId}::uuid WHERE id = ${courseId}::uuid`;
      await audit(tx, {
        adminId: ctx.adminId, action: "course_category_set", targetType: "course", targetId: courseId,
        before: { slug: course.slug, categoryId: course.category_id }, after: { categoryId }, result: "ok", ip: ctx.ip,
      });
    }),
  );
}

/** Lưu ảnh công khai (theo nội dung) và ghi dòng media_assets; me_app chỉ có SELECT/INSERT nên không bao giờ UPDATE. */
async function storePublicImage(bytes: Buffer): Promise<{ storageKey: string; sha256: string; bytes: number; mime: string }> {
  if (bytes.length > MAX_CATEGORY_IMAGE_BYTES) throw new HttpError(413, "image_too_large");
  const mime = sniffImage(bytes);
  if (!mime) throw new HttpError(400, "image_format");
  const stored = await putFile({ bytes, mime, visibility: "public" });
  return { ...stored, mime };
}

async function assetIdFor(tx: Tx, stored: { storageKey: string; sha256: string; bytes: number; mime: string }): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key)
    VALUES (${stored.sha256}, ${stored.mime}, ${stored.bytes}, 'public', ${stored.storageKey}) ON CONFLICT (visibility, storage_key) DO NOTHING`;
  const [asset] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM media_assets WHERE visibility = 'public' AND storage_key = ${stored.storageKey}`;
  return asset!.id;
}

/** jpg/png/webp ≤ 2 MB. Thay ảnh chỉ gắn ảnh mới; tệp cũ giữ trong media_assets (không xóa đĩa). */
export async function setCategoryImage(ctx: AdminCtx, id: string, bytes: Buffer): Promise<{ imageUrl: string }> {
  await authorize(ctx, "content.edit", { action: "category_image_set", resource: { type: "course_category", id } });
  // Danh mục không tồn tại thì không ghi tệp. Ghi tệp trước giao dịch (bất biến, theo nội dung): lỗi DB chỉ để lại tệp mồ côi.
  const [exists] = await prisma().$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM course_categories WHERE id = ${id}::uuid`;
  if (!exists) throw new HttpError(404, "not_found");
  const stored = await storePublicImage(bytes);
  return withTx(async (tx) => {
    const before = await categoryRow(tx, id, "update");
    const assetId = await assetIdFor(tx, stored);
    await tx.$executeRaw`UPDATE course_categories SET image_asset_id = ${assetId}::uuid WHERE id = ${id}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "category_image_set", targetType: "course_category", targetId: id,
      before: { asset: before.image_asset_id }, after: { asset: assetId, sha256: stored.sha256, mime: stored.mime, bytes: stored.bytes },
      result: "ok", ip: ctx.ip,
    });
    return { imageUrl: publicMediaUrl(stored.storageKey) };
  });
}

export async function removeCategoryImage(ctx: AdminCtx, id: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "category_image_remove", resource: { type: "course_category", id } });
  await withTx(async (tx) => {
    const before = await categoryRow(tx, id, "update");
    if (!before.image_asset_id) return;
    await tx.$executeRaw`UPDATE course_categories SET image_asset_id = NULL WHERE id = ${id}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "category_image_remove", targetType: "course_category", targetId: id,
      before: { asset: before.image_asset_id }, result: "ok", ip: ctx.ip,
    });
  });
}

export type CategoryLayoutEntry = {
  seedKey: string; titleVi: string; titleEn: string;
  /** Đường dẫn tệp ảnh trên máy chạy script; `imageSha16` = 16 ký tự đầu sha256 phải khớp. */
  imageFile?: string; imageSha16?: string;
  courses: string[];
};

/**
 * Gieo danh mục ban đầu (Task 4, chỉ tạo, không bao giờ ghi đè): mã `seed_key` đã từng gieo thì bỏ qua (giữ tên, thứ tự, ảnh chủ đã
 * chỉnh; danh mục chủ đã xóa không bị tạo lại); danh mục mới tạo ở cuối và chỉ gắn khóa đang chưa có danh mục. Khóa không gắn vì chủ đã quyết (khóa đã có danh mục khác,
 * hoặc danh mục của nó đã có từ trước) nằm trong `keptAssignment`. Slug không tồn tại → ném lỗi, không ghi gì.
 */
export async function applyCategoryLayout(ctx: AdminCtx, layout: CategoryLayoutEntry[]): Promise<{
  created: string[]; skipped: string[]; assigned: string[]; keptAssignment: string[]; uncategorizedPublished: string[];
}> {
  await authorize(ctx, "content.edit", { action: "category_layout_apply" });
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  // Mã đã từng gieo (kể cả danh mục chủ đã xóa sau đó): không bao giờ tạo lại.
  const seededKeys = async (db: Tx | ReturnType<typeof prisma>) => new Set((await db.$queryRaw<{ key: string }[]>`
    SELECT seed_key AS key FROM course_categories WHERE seed_key IS NOT NULL
    UNION SELECT jsonb_array_elements_text(after -> 'created') FROM admin_audit_log WHERE action = 'category_layout_apply' AND result = 'ok'`).map((r) => r.key));
  const alreadySeeded = await seededKeys(prisma());
  // Đọc, kiểm và lưu ảnh của danh mục sẽ tạo, trước giao dịch (theo nội dung, ghi lại an toàn).
  const stored = new Map<string, Awaited<ReturnType<typeof storePublicImage>>>();
  for (const entry of layout) {
    if (!entry.imageFile || alreadySeeded.has(entry.seedKey)) continue;
    const bytes = await readFile(entry.imageFile);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (entry.imageSha16 && !sha.startsWith(entry.imageSha16)) throw new Error(`Ảnh ${entry.imageFile}: sha256 ${sha.slice(0, 16)} không khớp ${entry.imageSha16}`);
    stored.set(entry.seedKey, await storePublicImage(bytes));
  }
  const result = await mapDbErrors(() => withTx(async (tx) => {
    await lockSiblings(tx, ROOT_KEY);
    const seeded = await seededKeys(tx);
    const slugs = [...new Set(layout.flatMap((e) => e.courses))];
    const found = await tx.$queryRaw<{ slug: string; category_id: string | null }[]>`
      SELECT slug, category_id::text AS category_id FROM courses WHERE slug = ANY(${slugs}::text[]) FOR UPDATE`;
    const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
    if (missing.length) throw new Error(`Không có khóa: ${missing.join(", ")}`);
    const courseCategory = new Map(found.map((f) => [f.slug, f.category_id]));
    const out = { created: [] as string[], skipped: [] as string[], assigned: [] as string[], keptAssignment: [] as string[] };
    for (const entry of layout) {
      if (seeded.has(entry.seedKey)) {
        const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM course_categories WHERE seed_key = ${entry.seedKey}`;
        out.skipped.push(entry.seedKey);
        out.keptAssignment.push(...entry.courses.filter((s) => courseCategory.get(s) !== existing?.id));
        continue;
      }
      if (entry.imageFile && !stored.has(entry.seedKey)) throw new Error(`Ảnh của ${entry.seedKey} chưa được kiểm, chạy lại`);
      const image = stored.get(entry.seedKey);
      const assetId = image ? await assetIdFor(tx, image) : null;
      const [{ next }] = (await tx.$queryRaw<{ next: number }[]>`
        SELECT coalesce(max(position), 0)::int + 1 AS next FROM course_categories WHERE parent_key = ${ROOT_KEY}::uuid`) as [{ next: number }];
      const [created] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO course_categories (seed_key, title_vi, title_en, position, image_asset_id)
        VALUES (${entry.seedKey}, ${cleanTitle(entry.titleVi)}, ${cleanTitleEn(entry.titleEn)}, ${next}, ${assetId}::uuid) RETURNING id::text AS id`;
      out.created.push(entry.seedKey);
      for (const slug of entry.courses) {
        if (courseCategory.get(slug) !== null) {
          out.keptAssignment.push(slug);
          continue;
        }
        await tx.$executeRaw`UPDATE courses SET category_id = ${created!.id}::uuid WHERE slug = ${slug}`;
        courseCategory.set(slug, created!.id);
        out.assigned.push(slug);
      }
    }
    await audit(tx, {
      adminId: ctx.adminId, action: "category_layout_apply", targetType: "course_category", targetId: null,
      after: out, result: "ok", ip: ctx.ip,
    });
    return out;
  }));
  const uncategorized = await prisma().$queryRaw<{ slug: string }[]>`
    SELECT slug FROM courses WHERE status = 'published' AND category_id IS NULL ORDER BY slug`;
  return { ...result, uncategorizedPublished: uncategorized.map((r) => r.slug) };
}
