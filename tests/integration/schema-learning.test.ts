import { describe, expect, it } from "vitest";
import { errCode, pgAs } from "../helpers/pg";
import { sqlAsMigrator } from "../helpers/otp";
import { seedContent } from "../helpers/content";

async function fixture() {
  await seedContent();
  const { rows: [user] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('HV') RETURNING id`);
  const { rows: [device] } = await sqlAsMigrator(`INSERT INTO devices (user_id, device_key_hash, label) VALUES ($1, 'k', 'đt') RETURNING id`, [user.id]);
  const { rows: [lesson] } = await sqlAsMigrator(`SELECT l.id AS lesson_id, lv.id AS lv_id FROM lessons l JOIN lesson_versions lv ON lv.lesson_id = l.id WHERE l.external_id = 'A001'`);
  return { userId: user.id as string, deviceId: device.id as string, lessonId: lesson.lesson_id as string, lvId: lesson.lv_id as string };
}

async function app<T>(run: (c: import("pg").Client) => Promise<T>) {
  const c = await pgAs("app");
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

describe("bảng học tập", () => {
  it("learning_progress chỉ tăng: trạng thái, điểm, hoạt động", async () => {
    const f = await fixture();
    await app(async (c) => {
      expect(await errCode(c, `INSERT INTO learning_progress (user_id, lesson_id, status, completed_activities, best_score_pct) VALUES ($1, $2, 'completed', '{a1,a2}', 80)`, [f.userId, f.lessonId])).toBeNull();
      expect(await errCode(c, `UPDATE learning_progress SET status = 'in_progress'`)).toBe("P0001");
      expect(await errCode(c, `UPDATE learning_progress SET best_score_pct = 70`)).toBe("P0001");
      expect(await errCode(c, `UPDATE learning_progress SET completed_activities = '{a1}'`)).toBe("P0001");
      expect(await errCode(c, `UPDATE learning_progress SET completed_activities = '{a1,a2,a3}', best_score_pct = 90`)).toBeNull();
      expect(await errCode(c, `UPDATE learning_progress SET best_score_pct = 101`)).toBe("23514");
    });
  });

  it("learning_events: duy nhất event_id và (device_id, seq); không sửa; me_app không xóa", async () => {
    const f = await fixture();
    const ins = (eventId: string, seq: number) =>
      `INSERT INTO learning_events (event_id, user_id, device_id, seq, lesson_version_id, type, payload, payload_hash, entitlement_ok)
       VALUES ('${eventId}', '${f.userId}', '${f.deviceId}', ${seq}, '${f.lvId}', 'lesson_opened', '{}', 'h', true)`;
    await app(async (c) => {
      expect(await errCode(c, ins("00000000-0000-4000-8000-000000000001", 1))).toBeNull();
      expect(await errCode(c, ins("00000000-0000-4000-8000-000000000001", 2))).toBe("23505");
      expect(await errCode(c, ins("00000000-0000-4000-8000-000000000002", 1))).toBe("23505");
      expect(await errCode(c, `UPDATE learning_events SET seq = 9`)).not.toBeNull();
      expect(await errCode(c, `DELETE FROM learning_events`)).toBe("42501");
      expect(await errCode(c, ins("00000000-0000-4000-8000-000000000003", 0))).toBe("23514");
    });
  });

  it("media_assets: kích thước, hash, bất biến; gắn vào phiên bản bài", async () => {
    const f = await fixture();
    const sha = "a".repeat(64);
    await app(async (c) => {
      expect(await errCode(c, `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'audio/mpeg', 0, 'protected', 'k0')`, [sha])).toBe("23514");
      expect(await errCode(c, `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ('xyz', 'audio/mpeg', 10, 'protected', 'k1')`)).toBe("23514");
      expect(await errCode(c, `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'audio/mpeg', 10, 'protected', $2)`, [sha, `${sha}.mp3`])).toBeNull();
      expect(await errCode(c, `INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role) SELECT $1, id, 'audio' FROM media_assets`, [f.lvId])).toBeNull();
      expect(await errCode(c, `UPDATE media_assets SET bytes = 11`)).not.toBeNull();
      expect(await errCode(c, `DELETE FROM lesson_version_assets`)).toBe("42501");
    });
  });
});
