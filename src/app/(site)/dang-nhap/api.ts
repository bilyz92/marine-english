/** Gửi JSON. Mất mạng (trên tàu hay gặp) không ném lỗi: trả status 0 để form báo và cho thử lại. */
export async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { status: 0, data: {} as T };
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export type Device = { id: string; label: string; lastSeenAt: string | null };
export type VerifyResult = { next: "done" | "invalid" | "choose_device"; devices?: Device[]; error?: string };

export const DEVICES_KEY = "me-choose-devices";

/** Nơi về sau khi đăng nhập, giữ qua bước chọn máy. */
export const NEXT_KEY = "me.login.next";
