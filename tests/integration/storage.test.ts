import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Đặt MEDIA_ROOT trước khi env() được đọc; thư mục được tạo sau phần import.
const root = vi.hoisted(() => {
  const dir = `/tmp/me-media-${process.pid}-${Date.now()}`;
  process.env.MEDIA_ROOT = dir;
  return dir;
});

import { openProtected, putFile } from "@/modules/storage/storage";
import { addMedia } from "@/worker/media-import";
import { pgAs } from "../helpers/pg";
import { seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

mkdirSync(path.join(root, "protected"), { recursive: true });

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("kho tệp", () => {
  it("ghi rồi đọc lại đúng nội dung; ghi trùng không tạo tệp mới", async () => {
    const bytes = Buffer.from("âm thanh giả " + Math.random());
    const a = await putFile({ bytes, mime: "audio/mpeg", visibility: "protected" });
    expect(a).toEqual({ storageKey: `${sha(bytes)}.mp3`, sha256: sha(bytes), bytes: bytes.length });
    const again = await putFile({ bytes, mime: "audio/mpeg", visibility: "protected" });
    expect(again.storageKey).toBe(a.storageKey);
    expect(readdirSync(path.join(root, "protected")).filter((f) => !f.startsWith("."))).toContain(a.storageKey);
    const opened = await openProtected(a.storageKey);
    expect(opened!.size).toBe(bytes.length);
    const buf = Buffer.alloc(bytes.length);
    await opened!.handle.read(buf, 0, bytes.length, 0);
    await opened!.handle.close();
    expect(buf.equals(bytes)).toBe(true);
  });

  it("mime không hỗ trợ → lỗi", async () => {
    await expect(putFile({ bytes: Buffer.from("x"), mime: "application/x-sh", visibility: "protected" })).rejects.toThrow();
  });

  it("storageKey độc hại hoặc symlink → null", async () => {
    for (const key of ["../x", "a/b", `${"A".repeat(64)}.mp3`, "", `${"a".repeat(64)}.mp3/../../etc`]) {
      expect(await openProtected(key), key).toBeNull();
    }
    const outside = mkdtempSync(path.join(tmpdir(), "me-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "bí mật");
    const key = `${"b".repeat(64)}.mp3`;
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "protected", key));
    expect(await openProtected(key)).toBeNull();
    expect(await openProtected(`${"c".repeat(64)}.mp3`)).toBeNull();
  });

  it("lỗi trước khi đổi tên → không còn tệp đích, không để lại tệp tạm", async () => {
    const bytes = Buffer.from("ngắt giữa chừng " + Math.random());
    await expect(putFile({ bytes, mime: "audio/mpeg", visibility: "protected" }, { beforeRename: () => { throw new Error("mất điện"); } })).rejects.toThrow("mất điện");
    expect(existsSync(path.join(root, "protected", `${sha(bytes)}.mp3`))).toBe(false);
    expect(readdirSync(path.join(root, "protected")).some((f) => f.startsWith(".tmp"))).toBe(false);
  });
});

describe("lệnh media:add", () => {
  it("gắn audio vào phiên bản hiện hành của bài trong mọi khóa; chạy lại không trùng", async () => {
    await seedContent();
    const file = path.join(mkdtempSync(path.join(tmpdir(), "me-src-")), "A001.mp3");
    writeFileSync(file, Buffer.from("mp3 giả cho A001"));
    const client = await pgAs("migrator");
    try {
      expect(await addMedia(client, { externalLessonId: "A001", filePath: file, role: "audio", visibility: "protected", root })).toEqual({ attached: 1 });
      expect(await addMedia(client, { externalLessonId: "A001", filePath: file, role: "audio", visibility: "protected", root })).toEqual({ attached: 0 });
      await expect(addMedia(client, { externalLessonId: "KHONG", filePath: file, role: "audio", visibility: "protected", root })).rejects.toThrow();
    } finally {
      await client.end();
    }
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM lesson_version_assets`);
    expect(rows[0].n).toBe(1);
  });
});


describe("sửa sau Codex vòng 1 (tệp)", () => {
  it("#7: tệp đích đã có nhưng hỏng → putFile báo lỗi, không tin tệp cũ", async () => {
    const bytes = Buffer.from("nội dung thật " + Math.random());
    writeFileSync(path.join(root, "protected", `${sha(bytes)}.mp3`), "tệp hỏng");
    await expect(putFile({ bytes, mime: "audio/mpeg", visibility: "protected" })).rejects.toThrow();
  });

  it("#6: cùng nội dung ở public và protected là hai tài sản riêng", async () => {
    await seedContent();
    const file = path.join(mkdtempSync(path.join(tmpdir(), "me-src-")), "A002.mp3");
    writeFileSync(file, Buffer.from("cùng nội dung hai nơi"));
    const client = await pgAs("migrator");
    try {
      await addMedia(client, { externalLessonId: "A002", filePath: file, role: "audio", visibility: "protected", root });
      await addMedia(client, { externalLessonId: "A002", filePath: file, role: "image", visibility: "public", root });
    } finally {
      await client.end();
    }
    const { rows } = await sqlAsMigrator(`SELECT visibility FROM media_assets ORDER BY visibility`);
    expect(rows.map((r) => r.visibility)).toEqual(["protected", "public"]);
  });
});
