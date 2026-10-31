import { z } from "zod";

const key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "phải là 32 byte mã base64");

// Danh sách khóa có phiên bản: "k1:<base64>,k2:<base64>".
const keyring = z.string().transform((value, ctx) => {
  const entries = value.split(",").map((part) => part.trim()).filter(Boolean);
  const ring = new Map<string, Buffer>();
  for (const entry of entries) {
    const [id, b64] = entry.split(":");
    const buf = Buffer.from(b64 ?? "", "base64");
    if (!id || buf.length !== 32) {
      ctx.addIssue({ code: "custom", message: `khóa "${id ?? entry}" phải là 32 byte` });
      return z.NEVER;
    }
    ring.set(id, buf);
  }
  if (ring.size === 0) {
    ctx.addIssue({ code: "custom", message: "cần ít nhất một khóa" });
    return z.NEVER;
  }
  return ring;
});

const schema = z
  .object({
    DATABASE_URL: z.url(),
    // URL quyền cao (migrator, shadow) không thuộc cấu hình web: chỉ Prisma migrate và CLI đọc thẳng process.env.
    ME_OTHER_DATABASE_URL: z.url().optional(),
    APP_ORIGIN: z.url(),
    SESSION_KEY_LEARNER: key32,
    SESSION_KEY_ADMIN: key32,
    CSRF_KEY_LEARNER: key32,
    CSRF_KEY_ADMIN: key32,
    SESSION_ENC_KEYS: keyring,
    SESSION_ENC_KEY_CURRENT: z.string().min(1),
    OTP_PEPPERS: keyring,
    OTP_PEPPER_CURRENT: z.string().min(1),
    OIDC_STATE_KEY: key32,
    // Khóa ký giấy phép học offline (Ed25519, 32 byte, "kid:base64,…"); giữ khóa cũ trong lúc đổi khóa theo giai đoạn.
    LICENSE_SIGNING_KEYS: keyring,
    LICENSE_SIGNING_KID_CURRENT: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_ISSUER: z.url().default("https://accounts.google.com"),
    ZALO_LOGIN_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    ZNS_DAILY_BUDGET: z.coerce.number().int().nonnegative().default(500),
    MAX_DEVICES: z.coerce.number().int().positive().default(2),
    // Thư mục tệp media (public/ và protected/ bên trong); cùng ổ đĩa để đổi tên nguyên tử.
    MEDIA_ROOT: z.string().min(1).default("./media"),
    // Tài khoản nhận tiền SePay theo dõi [G4]. Thiếu thì mọi báo cáo SePay bị bỏ qua và webhook trả 503.
    SEPAY_BANK_CODE: z.string().regex(/^[A-Z0-9]{2,20}$/).optional(),
    SEPAY_ACCOUNT_NO: z.string().regex(/^[0-9]{4,30}$/).optional(),
    // Bí mật ký webhook "id:bí-mật,id:bí-mật" (khóa mới trước, khóa cũ giữ trong lúc đổi). Rỗng = chưa cấu hình.
    SEPAY_WEBHOOK_SECRETS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => part.slice(part.indexOf(":") + 1))
          .filter((secret) => secret.length > 0),
      ),
    // Thông tin nhận tiền hiện ở trang thanh toán và phiên bản điều khoản đã duyệt; thiếu mục nào thì chưa bán được.
    CHECKOUT_BANK_NAME: z.string().optional(),
    CHECKOUT_ACCOUNT_NAME: z.string().optional(),
    CHECKOUT_QR_IMAGE: z.string().regex(/^(\/(?![/\\]).*)?$/, "phải là đường dẫn trong site").optional(),
    CHECKOUT_TERMS_VERSION: z.string().optional(),
    // Telegram cho kinh doanh và nhóm lỗi; thiếu thì tin nằm chờ trong outbox, không mất.
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    TELEGRAM_BUSINESS_CHAT_ID: z.string().min(1).optional(),
    TELEGRAM_ERROR_CHAT_ID: z.string().min(1).optional(),
  })
  .refine((e) => e.SESSION_ENC_KEYS.has(e.SESSION_ENC_KEY_CURRENT), {
    path: ["SESSION_ENC_KEY_CURRENT"],
    message: "không có trong SESSION_ENC_KEYS",
  })
  .refine((e) => e.LICENSE_SIGNING_KEYS.has(e.LICENSE_SIGNING_KID_CURRENT), {
    path: ["LICENSE_SIGNING_KID_CURRENT"],
    message: "không có trong LICENSE_SIGNING_KEYS",
  })
  .refine((e) => e.OTP_PEPPERS.has(e.OTP_PEPPER_CURRENT), {
    path: ["OTP_PEPPER_CURRENT"],
    message: "không có trong OTP_PEPPERS",
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Đọc và kiểm biến môi trường một lần; thiếu hoặc sai thì ném lỗi nêu rõ biến nào. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ — ${detail}`);
  }
  cached = parsed.data;
  return cached;
}
