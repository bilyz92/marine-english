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
