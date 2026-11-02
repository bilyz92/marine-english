// Điền nhãn ngoặc [..] bằng thông tin hồ sơ thật của học viên (docs/superpowers/plans/2026-11-03-three-level-study.md).
// Thiếu thông tin thì giữ nguyên nhãn và báo trường thiếu: không đoán, không suy ra "chưa có kinh nghiệm" từ ô trống.

export type Binding = { scope?: string; placeholder: string; field: string };
export type FieldDef = { key: string; label: { vi: string; en?: string }; type?: string; values?: string[]; min?: number; max?: number };
export type Personalization = { bindings: Binding[]; fields: FieldDef[] };
export type Profile = Record<string, string>;

/** Binding cho một nhãn: đúng phạm vi bài trước, rồi binding chung, rồi binding có phạm vi duy nhất (câu phụ liên kết từ bài khác). */
function bindingFor(bindings: Binding[], placeholder: string, scope: string): Binding | undefined {
  const same = bindings.filter((b) => b.placeholder === placeholder);
  const scoped = same.filter((b) => b.scope);
  return same.find((b) => b.scope === scope) ?? same.find((b) => !b.scope) ?? (scoped.length === 1 ? scoped[0] : undefined);
}

/** Giá trị của trường cho đúng ngôn ngữ: trường song ngữ lưu "khóa.en" / "khóa.vi"; không lấy chéo ngôn ngữ. */
function valueOf(profile: Profile, field: string, lang?: "en" | "vi"): string {
  const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (lang) {
    const localized = pick(profile[`${field}.${lang}`]);
    if (localized) return localized;
    const other = lang === "en" ? "vi" : "en";
    if (pick(profile[`${field}.${other}`])) return "";
  }
  return pick(profile[field]);
}

/** lang: ngôn ngữ của đoạn chữ (đoạn tiếng Anh chỉ nhận giá trị tiếng Anh). */
export function personalize(text: string, ctx: { bindings: Binding[]; scope: string; profile: Profile; lang?: "en" | "vi" }): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\[([^\]]+)\]/g, (whole, placeholder: string) => {
    const b = bindingFor(ctx.bindings, placeholder, ctx.scope);
    if (!b) return whole;
    const value = valueOf(ctx.profile, b.field, ctx.lang);
    if (value) return value;
    if (!missing.includes(b.field)) missing.push(b.field);
    return whole;
  });
  return { text: out, missing };
}
