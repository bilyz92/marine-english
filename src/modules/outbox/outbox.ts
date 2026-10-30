import type { Tx } from "@/lib/db";

export type OutboxEvent = { dedupKey: string; kind: string; channel: "email" | "telegram"; payload: Record<string, unknown> };

/** Ghi sự kiện thông báo trong transaction của thao tác; trùng dedup_key thì bỏ qua. P4 gửi sau commit. */
export async function enqueueOutbox(tx: Tx, event: OutboxEvent): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO outbox_events (dedup_key, kind, channel, payload)
    VALUES (${event.dedupKey}, ${event.kind}, ${event.channel}, ${JSON.stringify(event.payload)}::jsonb)
    ON CONFLICT (dedup_key) DO NOTHING`;
}
