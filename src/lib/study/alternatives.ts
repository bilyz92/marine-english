import type { Profile } from "./personalize";

// Đáp án thay thế theo hoàn cảnh thật của học viên (02_YEU_CAU_TICH_HOP: condition profile_field/equals, all, selection).
// Trường đã điền và khớp → dùng câu đó. Chưa điền → giữ câu gốc, liệt kê các câu theo điều kiện để học viên tự đối chiếu,
// không suy ra gì từ ô trống. Câu cần học viên tự xác nhận (selection) luôn để học viên chọn.

type Text = { en?: string; vi?: string };
type Condition = { profile_field?: string; equals?: string; all?: Condition[]; selection?: string };
export type Alternative = { when_vi?: string; condition?: Condition; text?: Text };

type Verdict = "yes" | "no" | "unset" | "selection";

function evaluate(c: Condition | undefined, profile: Profile, unset: Set<string>): Verdict {
  if (!c) return "selection";
  if (c.selection) return "selection";
  if (c.all) {
    // Trường thiếu của điều kiện ghép chỉ đáng hỏi khi chưa có phần nào đã sai.
    const local = new Set<string>();
    const parts = c.all.map((x) => evaluate(x, profile, local));
    if (parts.includes("no")) return "no";
    for (const f of local) unset.add(f);
    if (parts.includes("selection")) return "selection";
    return parts.includes("unset") ? "unset" : "yes";
  }
  if (c.profile_field) {
    const v = profile[c.profile_field];
    if (typeof v !== "string" || !v.trim()) {
      unset.add(c.profile_field);
      return "unset";
    }
    return v === c.equals ? "yes" : "no";
  }
  return "selection";
}

export function pickAlternative(base: Text | undefined, alternatives: Alternative[] | undefined, profile: Profile): { text?: Text; choices: Alternative[]; unsetFields: string[] } {
  const unset = new Set<string>();
  const verdicts = (alternatives ?? []).map((a) => ({ a, v: evaluate(a.condition, profile, unset) }));
  // Nhiều câu cùng khớp: chọn câu có điều kiện cụ thể nhất (nhiều điều kiện hơn).
  const weight = (c?: Condition): number => (c?.all ? c.all.reduce((n, x) => n + weight(x), 0) : 1);
  const chosen = verdicts.filter((x) => x.v === "yes").sort((a, b) => weight(b.a.condition) - weight(a.a.condition))[0]?.a;
  return {
    text: chosen?.text ?? base,
    choices: verdicts.filter((x) => x.a !== chosen && (x.v === "selection" || x.v === "unset")).map((x) => x.a),
    unsetFields: [...unset],
  };
}

/** Nhãn tiếng Việt cho mã lựa chọn trong hồ sơ (dữ liệu chỉ có mã). */
export const ENUM_LABEL_VI: Record<string, string> = {
  studying: "Đang học",
  graduated: "Đã tốt nghiệp",
  completed_practical_training: "Đã thực hành",
  no_practical_training_yet: "Chưa thực hành",
  assisted_under_supervision: "Đã phụ làm dưới giám sát",
  observed_only: "Chỉ quan sát",
  none: "Chưa đi biển",
  has_sea_service: "Đã đi biển",
};
