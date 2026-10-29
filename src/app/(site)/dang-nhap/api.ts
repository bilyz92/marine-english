export async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export type Device = { id: string; label: string; lastSeenAt: string | null };
export type VerifyResult = { next: "done" | "invalid" | "choose_device"; devices?: Device[]; error?: string };

export const DEVICES_KEY = "me-choose-devices";
