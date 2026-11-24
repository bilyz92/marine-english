// Workbook nhỏ theo đúng tiêu đề các trang của tệp chủ (25/11/2026): 2 câu EC-001, EC-002, 2 chủ đề.
const BANK_HEAD = ["Mã câu", "Khả năng hỏi", "Chủ đề", "Thứ tự", "Câu hỏi tiếng Anh", "Câu hỏi tiếng Việt", "Đáp án cơ bản (tiếng Anh)", "Bản dịch tiếng Việt (đáp án cơ bản)", "Đáp án nâng cao (tiếng Anh)", "Bản dịch tiếng Việt (đáp án nâng cao)", "Đáp án mẫu tiếng Việt", "Tiêu chí đánh giá câu trả lời"];
export type Sheets = Record<string, string[][]>;

export function workbook(): Sheets {
  return {
    "Ngân hàng": [
      ["Ngân hàng"], ["Mô tả"], BANK_HEAD,
      ["EC-002", "Hay hỏi", "Động lực", "2", "1. Why did you choose marine engineering?\n2. Why the engine department?", "1. Tại sao…", "Because I like machinery. I also want to work at sea.", "Bởi vì tôi thích máy móc. Tôi cũng muốn đi biển.", "I want to join.\nI am willing to learn.", "Tôi muốn vào.\nTôi sẵn sàng học.", "Mẫu VI [lý do]", "1. Tiêu chí"],
      ["EC-001", "Luôn hỏi", "Giới thiệu", "1", "Please introduce yourself?", "Hãy giới thiệu bản thân bạn?", "My name is Hùng.", "Tôi tên là Hùng.", "My name is Hung. I have used [tools actually used].", "Tôi tên là Hùng. Tôi đã dùng [ghi các dụng cụ thực tế đã dùng].", "", ""],
    ],
    "Cách hỏi": [
      ["Cách hỏi"], [""], ["Mã câu", "Mã cách hỏi", "Thứ tự", "Câu hỏi tiếng Anh", "Nghĩa tiếng Việt"],
      ["EC-001", "EC-001-Q1", "1", "Please introduce yourself?", "Hãy giới thiệu bản thân bạn?"],
      ["EC-002", "EC-002-Q2", "2", "Why did you choose the engine department?", "Vì sao bạn chọn bộ phận máy?"],
      ["EC-002", "EC-002-Q1", "1", "Why did you choose marine engineering?", "Tại sao bạn chọn ngành máy tàu thủy?"],
    ],
    "Tập từ đầu": [
      ["Tập từ đầu"], ["Mã câu", "Lời dẫn tiếng Việt", "Lựa chọn đúng", "Lựa chọn nhiễu", "Cụm nghe tiếng Anh", "Nghĩa của cụm", "Câu đầu để đọc theo", "Nghĩa của câu đầu", "Hướng dẫn cho học viên", "Từ nghe thêm (tùy chọn)", "Nghĩa của từ thêm"],
      ["EC-001", "Người phỏng vấn muốn làm quen.", "Tên và quá trình học", "Lý do chọn ngành máy", "introduce yourself", "giới thiệu bản thân", "My name is {name}.", "Tôi tên là {name}.", "Giới thiệu bản thân", "", ""],
      ["EC-002", "Vì sao chọn ngành máy.", "Lý do chọn ngành máy", "Nhiệm vụ khi trực ca", "Why did you choose", "Vì sao bạn chọn", "I like machinery.", "Tôi thích máy móc.", "Nêu lý do", "machinery", "máy móc"],
    ],
    "Luyện từng ý": [
      ["Luyện từng ý"], ["Mã câu", "Mã đoạn", "Thứ tự", "Đoạn tiếng Anh", "Nghĩa của đoạn", "Từ khóa gợi nhớ"],
      ["EC-001", "EC-001-B1", "1", "My name is Hùng.", "Tôi tên là Hùng.", "name"],
      ["EC-002", "EC-002-B2", "2", "I also want to work at sea.", "Tôi cũng muốn đi biển.", "sea"],
      ["EC-002", "EC-002-B1", "1", "Because I like machinery.", "Bởi vì tôi thích máy móc.", "machinery"],
    ],
    "Mẫu nâng cao": [
      ["Mẫu nâng cao"], ["Mã câu", "Đáp án nâng cao tiếng Anh", "Bản dịch tiếng Việt", "Hướng dẫn khi cần"],
      ["EC-001", "My name is Hung. I have used [tools actually used].", "Tôi tên là Hùng. Tôi đã dùng [ghi các dụng cụ thực tế đã dùng].", "Nói chậm"],
      ["EC-002", "I want to join.\nI am willing to learn.", "Tôi muốn vào.\nTôi sẵn sàng học.", ""],
    ],
  };
}

