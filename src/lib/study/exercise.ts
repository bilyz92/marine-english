// Kiểm bài tập theo đáp án trong dữ liệu. Chỉ để tự luyện: không ghi điểm, không coi là đạt bài.

type Text = { en?: string; vi?: string };
export type Exercise = {
  id: string;
  type: string;
  level_id?: string;
  prompt?: Text;
  answer?: Text;
  options?: { id: string; text?: Text }[];
  answer_option_id?: string;
  feedback?: Text;
};

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "").trim();

export function checkExercise(exercise: Exercise, input: string): { correct: boolean; feedback?: Text } {
  const correct = exercise.type === "single_choice"
    ? !!exercise.answer_option_id && input === exercise.answer_option_id
    : !!norm(input) && norm(input) === norm(exercise.answer?.en ?? "");
  return { correct, feedback: exercise.feedback };
}
