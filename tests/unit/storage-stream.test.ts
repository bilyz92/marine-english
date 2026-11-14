import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIME_BY_EXT, putFileAt, putStreamAt, StreamRejected, StreamTooLarge } from "@/modules/storage/files";
import { sniffVideo } from "@/modules/content/video-format";

// Tải video lên theo luồng (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 1): ghi thẳng xuống đĩa, băm trong lúc ghi.

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12)]);

function streamOf(...chunks: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
      c.close();
    },
  });
}
const tmpFiles = (root: string) => readdirSync(path.join(root, "protected")).filter((f) => f.startsWith(".tmp-"));

describe("ghi tệp theo luồng", () => {
  it("nhiều khúc → một tệp <sha256>.mp4 đúng nội dung; ghi lại cùng nội dung → cùng khóa", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    const parts = [MP4_HEAD, Buffer.alloc(5000, 7), Buffer.from("cuối tệp")];
    const all = Buffer.concat(parts);
    const r = await putStreamAt(root, { stream: streamOf(...parts), visibility: "protected", maxBytes: 1_000_000, sniff: sniffVideo });
    expect(r).toEqual({ storageKey: `${sha(all)}.mp4`, sha256: sha(all), bytes: all.length, mime: "video/mp4" });
    expect(readFileSync(path.join(root, "protected", r.storageKey)).equals(all)).toBe(true);
    const again = await putStreamAt(root, { stream: streamOf(all), visibility: "protected", maxBytes: 1_000_000, sniff: sniffVideo });
    expect(again.storageKey).toBe(r.storageKey);
    expect(tmpFiles(root)).toEqual([]);
  });

  it("phần đầu nhỏ hơn headBytes vẫn được nhận diện khi luồng hết", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    const r = await putStreamAt(root, { stream: streamOf(MP4_HEAD), visibility: "protected", maxBytes: 1000, sniff: sniffVideo });
    expect(r.mime).toBe("video/mp4");
  });

  it("vượt giới hạn giữa chừng → StreamTooLarge, không còn tệp tạm", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    await expect(putStreamAt(root, { stream: streamOf(MP4_HEAD, Buffer.alloc(2000)), visibility: "protected", maxBytes: 1000, sniff: sniffVideo }))
      .rejects.toBeInstanceOf(StreamTooLarge);
    expect(tmpFiles(root)).toEqual([]);
    expect(readdirSync(path.join(root, "protected"))).toEqual([]);
  });

  it("không phải video hoặc rỗng → StreamRejected, không còn tệp tạm", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    await expect(putStreamAt(root, { stream: streamOf(Buffer.from("ID3 không phải video".padEnd(5000, "x"))), visibility: "protected", maxBytes: 100_000, sniff: sniffVideo }))
      .rejects.toBeInstanceOf(StreamRejected);
    await expect(putStreamAt(root, { stream: streamOf(), visibility: "protected", maxBytes: 100_000, sniff: sniffVideo }))
      .rejects.toBeInstanceOf(StreamRejected);
    expect(readdirSync(path.join(root, "protected"))).toEqual([]);
  });

  it("luồng lỗi giữa chừng → ném lỗi, không còn tệp tạm", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(MP4_HEAD));
        c.error(new Error("đứt mạng"));
      },
    });
    await expect(putStreamAt(root, { stream: broken, visibility: "protected", maxBytes: 100_000, sniff: sniffVideo })).rejects.toThrow();
    expect(tmpFiles(root)).toEqual([]);
  });

  it("bảng MIME chung không có video: putFileAt (CLI media:add) không ghi được tệp video", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    expect(MIME_BY_EXT.mp4).toBeUndefined();
    expect(MIME_BY_EXT.webm).toBeUndefined();
    await expect(putFileAt(root, { bytes: MP4_HEAD, mime: "video/mp4", visibility: "public" })).rejects.toThrow();
  });

  it("một khúc lớn: sniff chỉ nhận đúng headBytes byte đầu, không chép cả khúc", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    const big = Buffer.concat([MP4_HEAD, Buffer.alloc(3_000_000, 1)]);
    const seen: number[] = [];
    const r = await putStreamAt(root, {
      stream: streamOf(big), visibility: "protected", maxBytes: 10_000_000, headBytes: 64,
      sniff: (head) => { seen.push(head.length); return sniffVideo(head); },
    });
    expect(seen).toEqual([64]);
    expect(r.bytes).toBe(big.length);
    expect(readFileSync(path.join(root, "protected", r.storageKey)).equals(big)).toBe(true);
  });

  it("sniff trả MIME không phải video → StreamRejected", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "me-stream-"));
    await expect(putStreamAt(root, { stream: streamOf(MP4_HEAD), visibility: "protected", maxBytes: 1000, sniff: () => "audio/mpeg" }))
      .rejects.toBeInstanceOf(StreamRejected);
  });
});
