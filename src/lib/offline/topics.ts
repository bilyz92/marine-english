// Giao diện v2 (06/11/2026): danh sách bài chia theo chủ đề của học liệu (A1…B1), gập mở được.

type Lesson = { topic?: string | null; status: "in_progress" | "completed" | null };
export type TopicGroup<L> = { id: string | null; titleVi: string; lessons: L[]; done: number; open: boolean };

/**
 * Nhóm bài theo chủ đề, giữ thứ tự chủ đề. Mở sẵn đúng một nhóm: có bài đang học, nếu không thì nhóm đầu còn bài chưa xong.
 * Khóa không có chủ đề (bộ câu hỏi Word, bản manifest cũ đã lưu trên máy) trả null: hiện danh sách phẳng như trước.
 */
export function groupByTopic<L extends Lesson>(topics: { id: string; titleVi: string }[] | undefined, lessons: L[]): TopicGroup<L>[] | null {
  if (!topics?.length) return null;
  const known = new Set(topics.map((t) => t.id));
  const groups: TopicGroup<L>[] = topics.map((t) => ({ id: t.id, titleVi: t.titleVi, lessons: [], done: 0, open: false }));
  const other: TopicGroup<L> = { id: null, titleVi: "Bài khác", lessons: [], done: 0, open: false };
  for (const l of lessons) (l.topic && known.has(l.topic) ? groups.find((g) => g.id === l.topic)! : other).lessons.push(l);
  const shown = [...groups, other].filter((g) => g.lessons.length > 0);
  for (const g of shown) g.done = g.lessons.filter((l) => l.status === "completed").length;
  const current = shown.find((g) => g.lessons.some((l) => l.status === "in_progress")) ?? shown.find((g) => g.done < g.lessons.length) ?? shown[0];
  if (current) current.open = true;
  return shown;
}

type ModuleLesson = Lesson & { moduleId?: string | null };
export type ModuleGroup<L> = { id: string | null; titleVi: string; done: number; total: number; open: boolean; topics: TopicGroup<L>[] | null; lessons: L[] };

/**
 * Module → Chủ đề → Bài (docs/superpowers/plans/2026-11-08-course-modules.md, Task 3). Khóa chưa chia module (hoặc manifest cũ) → null,
 * hiện theo chủ đề như trước. Bài chưa xếp module vào nhóm "Bài khác" ở cuối; module không có bài thì bỏ. Trong mỗi module, bài chia theo
 * chủ đề; module không có bài nào thuộc chủ đề (bài soạn trên web) → `topics: null`, hiện bài phẳng. Mở sẵn module có bài đang học,
 * nếu không thì module đầu còn bài chưa xong.
 */
export function groupByModule<L extends ModuleLesson>(
  modules: { id: string; titleVi: string }[] | undefined,
  topics: { id: string; titleVi: string }[] | undefined,
  lessons: L[],
): ModuleGroup<L>[] | null {
  if (!modules?.length) return null;
  const known = new Set(modules.map((m) => m.id));
  const topicIds = new Set((topics ?? []).map((t) => t.id));
  const buckets = new Map<string | null, L[]>([...modules.map((m) => [m.id, []] as [string, L[]]), [null, []]]);
  for (const l of lessons) buckets.get(l.moduleId && known.has(l.moduleId) ? l.moduleId : null)!.push(l);
  const shown = [...modules, { id: null, titleVi: "Bài khác" }]
    .map((m) => {
      const own = buckets.get(m.id)!;
      const hasTopic = own.some((l) => l.topic && topicIds.has(l.topic));
      return {
        id: m.id, titleVi: m.titleVi, lessons: own, total: own.length, open: false,
        done: own.filter((l) => l.status === "completed").length,
        topics: hasTopic ? groupByTopic(topics, own) : null,
      };
    })
    .filter((g) => g.total > 0);
  const current = shown.find((g) => g.lessons.some((l) => l.status === "in_progress")) ?? shown.find((g) => g.done < g.total) ?? shown[0];
  if (current) current.open = true;
  return shown;
}
