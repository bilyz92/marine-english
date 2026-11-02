import { CourseLessons } from "./course-lessons";

// Trang quản trị chỉ hiển thị sau đăng nhập, theo mã khóa trong đường dẫn: không dựng sẵn.
export const instant = false;

export default function CourseLessonsPage({ params }: PageProps<"/admin/khoa-hoc/[slug]">) {
  return <CourseLessons params={params} />;
}
