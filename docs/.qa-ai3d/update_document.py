from pathlib import Path
from copy import deepcopy
import hashlib
import json
import shutil
from docx import Document
from docx.shared import Pt, RGBColor

root = Path(__file__).resolve().parents[2]
qa = Path(__file__).parent
target = root / 'Quy_trinh_xay_dung_app_tieng_Anh_cho_thuyen_vien_may_bo_sung_ho_so_hoc_vien.docx'
backup = qa / 'original.docx'
if backup.exists():
    raise RuntimeError('Backup exists; inspect before editing again')
shutil.copy2(target, backup)
doc = Document(target)
before = [p.text for p in doc.paragraphs]
before_tables = [[ [c.text for c in r.cells] for r in t.rows] for t in doc.tables]
changes = {}

def replace_prefix(prefix, text):
    matches = [p for p in doc.paragraphs if p.text.startswith(prefix)]
    assert len(matches) == 1, (prefix, len(matches))
    p = matches[0]
    old = p.text
    props = deepcopy(p.runs[0]._r.rPr) if p.runs and p.runs[0]._r.rPr is not None else None
    p.text = text
    if props is not None:
        p.runs[0]._r.insert(0, props)
    changes[old] = text

replace_prefix('Thu âm: dùng giọng đọc AI', 'Thu âm: tạo audio tiếng Anh theo ba giọng Philippines, Ấn Độ và Mỹ; anh duyệt cách đọc thuật ngữ, số liệu và đơn vị. Phần giải thích có tiếng Việt. Dùng Azure Speech theo định hướng dự án; thử giọng trước khi chọn. Tạo trước audio cố định để dùng lại và tải về học ngoại tuyến; cấu hình giọng theo mục 7A.')
replace_prefix('Marine English Teacher là gương mặt', 'Marine English Teacher là trợ lý AI mang hình dáng nhân vật 3D, dùng chung trên website và app PWA. Trợ lý hướng dẫn website, tư vấn khóa phù hợp và tham gia dạy theo giáo án anh duyệt. Khả năng hội thoại và thao tác được cấp theo vai trò, quyền học và giai đoạn triển khai tại mục 7A; ảnh hoặc video thu sẵn có thể dùng trong giai đoạn đầu.')
replace_prefix('Giọng nữ tiếng Anh ấm', 'Ba lựa chọn giọng tiếng Anh: Philippines, Ấn Độ và Mỹ; cho phép chỉnh tốc độ và nghe thử. Giọng tiếng Việt dùng để hướng dẫn và giải thích. Giới tính, âm sắc và cách động viên do anh duyệt; không mặc định mọi giọng có cùng khả năng biểu cảm.')
replace_prefix('Bản đầu: ảnh nhân vật', 'Bản đầu: ảnh nhân vật, audio đã duyệt và bài luyện theo kịch bản. Nội dung, audio đã tải chạy được khi mất mạng; chấm phát âm qua Azure và hội thoại AI cần mạng. Có thể ghi âm cục bộ để học viên tự nghe hoặc gửi đánh giá khi kết nối lại.')
replace_prefix('Bản 1.5: nhân vật 3D', 'Bản 1.5: thử nhân vật 3D khớp miệng với một bài học và ba mẫu giọng; sau khi duyệt mới mở rộng. Tải mô hình khi cần và có chế độ nhẹ cho điện thoại; quy trình dựng hình từ ảnh ở mục 7A.')
replace_prefix('Bản 2: hội thoại tự do', 'Bản 2: mở hội thoại AI trên web và app theo phạm vi đã duyệt, gồm tư vấn khách và luyện nói cho học viên có quyền. Chốt hạn mức dùng thử, số phút theo gói và chi phí vận hành trước khi bán. Thiết kế dữ liệu và quyền từ đầu, phát hành từng phần theo mục 7A.')
replace_prefix('Toàn bộ dự án có thể ra mắt', 'Ước tính ban đầu cho sản phẩm học cơ bản là khoảng 3–4 tháng. Phạm vi trợ lý AI 3D ở mục 7A cần được ước lượng riêng sau bản thử; chưa chốt tổng thời gian và ngân sách mới. Chi phí vận hành phải gồm máy chủ, dữ liệu, giọng nói, chấm phát âm và hội thoại AI theo mức sử dụng thực tế.')
replace_prefix('Tuần 3–9: Soạn nội dung', 'Tuần 3–9 theo lộ trình cơ bản: soạn nội dung 3 khóa đầu, thiết kế cơ sở dữ liệu và bổ sung giáo án trợ lý, quyền truy cập, hạn mức theo mục 7A. Hoàn thành dữ liệu mẫu trước khi tích hợp website và app.')
replace_prefix('Tuần 4–8: Làm website', 'Tuần 4–8 theo lộ trình cơ bản: làm website, nối thanh toán và thiết kế luồng hướng dẫn, tư vấn bằng trợ lý. Lịch phát hành hội thoại trực tiếp phụ thuộc kết quả bản thử ở mục 7A.')
replace_prefix('Tuần 4–10: Làm app học', 'Tuần 4–10 theo lộ trình cơ bản: làm app học, bài ngoại tuyến và tiến độ; thử một bài có nhân vật 3D và ba giọng. Chốt lại lịch mở rộng sau khi đo hiệu năng, chất lượng dạy và chi phí.')
replace_prefix('Tuần 10–12: Học thử', 'Tuần 10–12 theo lộ trình cơ bản: học thử với 5–10 người, sửa lỗi; bổ sung kiểm thử giáo án trợ lý, quyền học, mất mạng và hạn mức. Chỉ phát hành phần đạt tiêu chí nghiệm thu.')

anchor = next(p for p in doc.paragraphs if p.text.startswith('8. Kết nối thanh toán'))
inserted = []
def add(text, style='Normal'):
    p = anchor.insert_paragraph_before(text, style)
    if style.startswith('Heading'):
        p.paragraph_format.keep_with_next = True
        for r in p.runs:
            r.font.color.rgb = RGBColor(0, 0, 0)
    p.paragraph_format.widow_control = True
    inserted.append(text)
    return p

add('7A Xây dựng và tích hợp trợ lý AI 3D', 'Heading 2')
add('Mục tiêu: dùng một trợ lý Marine English Teacher để hướng dẫn khách trên website, tư vấn mua khóa phù hợp và đồng hành với học viên trên web/app. Anh kiểm soát nội dung dạy, phong cách giao tiếp và quyền truy cập. Đây là quy trình cần triển khai, chưa phải chức năng đã hoạt động.')
add('Phạm vi gồm nhân vật 3D dựng từ ảnh anh cung cấp, hội thoại bằng chữ và giọng nói, ba giọng tiếng Anh Philippines, Ấn Độ, Mỹ, cùng tiếng Việt để giải thích. Các luồng dưới đây bổ sung cho mục 5, 5A, 6, 7, 8 và 8A; chi tiết thiết kế dữ liệu và nghiệp vụ cập nhật vào đặc tả hệ thống và BA hiện có.')

add('Kiến trúc dùng chung cho website và app', 'Heading 3')
add('Theo định hướng hiện tại, Next.js phục vụ website, PWA và API máy chủ; Auth.js xác minh tài khoản; PostgreSQL trên Neon lưu dữ liệu; Cloudflare R2 lưu mô hình, audio và media. Lớp trợ lý dùng chung cho hai giao diện, có thể cung cấp API cho app riêng về sau. Tách phần hiển thị 3D, dịch vụ giọng nói, hội thoại và công cụ thao tác để thay nhà cung cấp mà không phải viết lại toàn bộ.')
add('Luồng xử lý: người dùng nói hoặc gõ → máy chủ xác minh phiên, vai trò, quyền học và hạn mức → chuyển giọng nói thành chữ nếu cần → cung cấp nội dung đã duyệt thuộc phạm vi được phép → AI tạo câu trả lời hoặc yêu cầu công cụ → máy chủ kiểm tra và thực hiện thao tác được cấp → phát chữ, audio và chuyển động nhân vật. Dùng Azure Speech cho giọng nói và chấm phát âm; Claude API là hướng đã dự kiến cho hội thoại, cần thử nghiệm trước khi chốt triển khai.')

add('Luồng A1 Dựng nhân vật 3D từ ảnh', 'Heading 3')
add('Anh cung cấp ảnh tham chiếu và yêu cầu hình dáng, trang phục, tên nhân vật. Xác nhận quyền sử dụng hình ảnh trước khi sản xuất. Nếu có, bổ sung góc chính diện và nghiêng để kiểm soát hình dáng; chưa có ảnh mới thì không coi hình mẫu trong tài liệu là bản đã chốt.')
add('Người thực hiện dựng mô hình từ ảnh → anh duyệt hình dáng → chỉnh lưới và chất liệu → gắn bộ xương cho cử chỉ và bộ điều khiển khuôn mặt, miệng → tạo trạng thái chờ, nghe, suy nghĩ, nói và động viên → xuất GLB/VRM phù hợp. Mô hình tạo tự động có thể cần chỉnh thủ công trước khi dùng làm nhân vật hội thoại.')
add('Chạy thử khẩu hình với cả ba giọng, kiểm tra khuôn mặt, tay, tốc độ tải và độ mượt trên điện thoại. Đề xuất bắt đầu bằng nhân vật nửa người. Lưu bản đã duyệt, phiên bản, nguồn ảnh và thông tin quyền sử dụng; lưu mô hình tại R2. Có ảnh thay thế khi thiết bị không chạy được 3D.')

add('Luồng A2 Anh soạn và duyệt cách trợ lý dạy', 'Heading 3')
add('Trong công cụ soạn bài, anh nhập mục tiêu, trình tự giảng, từ vựng, mẫu câu, tình huống đóng vai, câu hỏi, đáp án chấp nhận và cách sửa lỗi. Quy định lúc giải thích bằng tiếng Việt, lúc dùng tiếng Anh, gợi ý được phép và điều kiện hoàn thành từng bước.')
add('Lưu nháp giáo án cùng phiên bản bài → kiểm tra trường thiếu và tài liệu liên quan → cho trợ lý dạy thử → anh sửa thuật ngữ, cách phản hồi và tiêu chí đánh giá → duyệt xuất bản. Chỉ phiên bản đã duyệt mới được dùng với học viên. Tài liệu tham khảo cung cấp kiến thức, không được thay đổi quy tắc hoặc quyền của hệ thống.')
add('Phần mềm quản lý bước học, số lượt thử và điều kiện hoàn thành; AI diễn đạt trong phạm vi đó. Khi thiếu căn cứ hoặc câu hỏi ngoài phạm vi, trợ lý nói rõ giới hạn và hướng dẫn xem nguồn hoặc gửi yêu cầu hỗ trợ. Các câu trả lời chuyên môn phải phục vụ bài học và bám nội dung anh đã duyệt.')

add('Luồng A3 Khách vào website và tìm hiểu bằng trợ lý', 'Heading 3')
add('Khách mở trang → hiển thị nhân vật và lời chào bằng chữ, có nút thu gọn hoặc tắt → khách chọn nói chuyện hoặc nhập chữ. Khi dùng giọng nói, xin quyền micro và bắt đầu nghe sau thao tác của khách; không tự bật micro. Phát âm thanh sau tương tác phù hợp với chính sách trình duyệt.')
add('Trợ lý nhận biết trang hiện tại và chỉ dùng danh mục, thông tin giới thiệu, chính sách và bài học thử đã công khai. Khách hỏi → trợ lý trả lời ngắn, đưa nút mở đúng trang hoặc bài học thử → khách chọn tiếp tục. Không yêu cầu đăng nhập chỉ để đọc thông tin công khai; khi cần xem dữ liệu cá nhân thì chuyển sang đăng nhập.')
add('Trạng thái trên giao diện phải rõ: đang nghe, đang xử lý, đang nói, đã tắt micro. Cho phép dừng lời nói, kết thúc phiên, chuyển sang nhập chữ và ẩn nhân vật mà vẫn dùng được website.')

add('Luồng A4 Tư vấn khóa và giới thiệu gói phù hợp', 'Heading 3')
add('Trợ lý hỏi ngắn về chức danh, mục tiêu và khó khăn tiếng Anh; khách có thể bỏ qua. Dựa trên câu trả lời và danh mục đang mở bán, giới thiệu khóa phù hợp, giải thích nội dung, quyền lợi, thời hạn học và mời học thử. Dùng hồ sơ đã lưu chỉ trong phạm vi khách đã cho phép và hệ thống cấp quyền.')
add('Giá, ưu đãi và chính sách phải lấy từ dữ liệu hiện hành trên máy chủ. Tư vấn nhẹ nhàng, tôn trọng khi khách từ chối; không bịa khuyến mãi, thành tích học viên hoặc cam kết kết quả. Nếu khách muốn mua, đưa nút vào luồng thanh toán mục 8; nếu muốn được hỗ trợ, hướng dẫn tới kênh liên hệ chính thức.')

add('Luồng A5 Chuyển từ tư vấn sang mua và nhận quyền học', 'Heading 3')
add('Khách chọn khóa → đăng nhập → máy chủ lấy giá và tạo đơn → hiển thị QR theo mục 8. Trợ lý chỉ giải thích các bước và đọc trạng thái đơn của đúng tài khoản; không yêu cầu mật khẩu ngân hàng hoặc thông tin xác thực thanh toán.')
add('Webhook hợp lệ hoặc quản trị viên được phép cấp khóa → hệ thống cập nhật enrollments → trợ lý hướng dẫn mở khóa đã cấp và bắt đầu bài đầu. Đơn chờ, hết hạn hoặc cần xử lý tay phải được thông báo đúng trạng thái. Lời nói của khách và AI, cũng như trang báo thanh toán thành công, không được tự mở khóa.')

add('Luồng A6 Dạy học theo giáo án và tiến độ', 'Heading 3')
add('Học viên mở bài → máy chủ kiểm tra enrollments và phiên bản đã xuất bản → lấy giáo án, tiến độ và lựa chọn giọng → trợ lý giới thiệu mục tiêu, dạy từng bước, nghe hoặc đọc câu trả lời và phản hồi theo tiêu chí đã duyệt. Bài học thử chỉ truy cập nội dung được đánh dấu miễn phí.')
add('Ví dụ bài bàn giao ca máy: trợ lý đóng vai sĩ quan nhận ca, hỏi tình trạng thiết bị theo giáo án; học viên trả lời; trợ lý sửa cách diễn đạt, giải thích điểm cần sửa và cho thử lại. Hệ thống quyết định chuyển bước theo điều kiện hoàn thành, lưu câu trả lời và kết quả theo tài khoản, khóa, bài, phiên bản và mã sự kiện.')
add('Khi học viên quay lại, trợ lý đề nghị tiếp tục bước còn dở hoặc ôn phần yếu từ dữ liệu đã lưu. Học viên chọn tiếp tục hoặc học lại; không suy diễn trình độ khi chưa có kết quả. Giới thiệu khóa tiếp theo dựa trên nhu cầu và kết quả, tránh làm gián đoạn bài học.')

add('Luồng A7 Chọn ba giọng và luyện phát âm', 'Heading 3')
add('Học viên nghe thử và chọn tiếng Anh giọng Philippines, Ấn Độ hoặc Mỹ, chỉnh tốc độ rồi lưu lựa chọn. Cho phép đổi giọng trong bài để luyện nghe. Có giọng tiếng Việt riêng cho phần giải thích; anh duyệt mẫu đọc thuật ngữ buồng máy, số đo và đơn vị trước khi phát hành.')
add('Luyện nói: phát câu mẫu → học viên chủ động ghi âm → hệ thống nhận âm thanh và kiểm tra chất lượng → dịch vụ chấm phát âm theo tiêu chí đã cấu hình → trợ lý giải thích lỗi và đọc mẫu để học viên thử lại. Giọng đọc mẫu và chuẩn chấm là hai cấu hình riêng; việc có giọng TTS không đồng nghĩa có đủ tính năng chấm phát âm cho cùng biến thể.')
add('Âm thanh ồn, không nghe rõ hoặc không có lời nói phải báo ghi lại; không biến lỗi micro hay lỗi dịch vụ thành điểm thấp. Khẩu hình và biểu cảm được đồng bộ theo audio; kiểm tra mức hỗ trợ thực tế của từng giọng. Tạo trước audio cố định để dùng lại và tải ngoại tuyến.')

add('Luồng A8 Hội thoại tự do trong phạm vi được cấp', 'Heading 3')
add('Học viên chọn luyện hội thoại → máy chủ kiểm tra quyền dùng AI, khóa được học và số phút còn lại → chọn tình huống, vai trò và giọng → trợ lý trao đổi trong phạm vi bài hoặc chủ đề đã duyệt. Người dùng có thể ngắt lời, hỏi lại, xin giải thích hoặc kết thúc.')
add('Kết thúc phiên, lưu nhận xét và gợi ý ôn tập theo dữ liệu thực tế. Chỉ đánh dấu hoàn thành khi đạt quy tắc bài học; nhận xét của AI không tự thay thế điểm kiểm tra chính thức. Hiển thị hạn mức còn lại; hết hạn mức thì hướng dẫn dùng bài có sẵn hoặc lựa chọn gói đã công bố, không tự mua thêm.')

add('Luồng A9 Học khi mất mạng và đồng bộ trở lại', 'Heading 3')
add('Khi có mạng và có quyền học, học viên tải gói bài gồm nội dung, mô hình hoặc ảnh nhẹ, audio đã duyệt và phiên bản. Trước khi tải, hiển thị dung lượng và khả năng học ngoại tuyến. Mất mạng: dùng bài có kịch bản, nghe mẫu, ôn từ, làm bài đã tải và tự nghe bản ghi âm trên thiết bị.')
add('Hội thoại AI tự do và chấm phát âm qua dịch vụ đám mây cần kết nối. Khi mất mạng, giao diện chuyển trạng thái rõ ràng, giữ phần trả lời chưa gửi và cho học tiếp nội dung có sẵn. Không giả lập câu trả lời AI hoặc điểm chấm; việc gửi bản ghi sau cần tuân theo lựa chọn lưu và gửi của học viên.')
add('Tiến độ ngoại tuyến đi vào hàng đợi có mã sự kiện. Có mạng lại → xác minh phiên và quyền học hiện tại → đồng bộ chống trùng theo mục 5A → nhận xác nhận rồi dọn hàng đợi đã gửi. Chốt thời hạn quyền học ngoại tuyến và xử lý thu hồi quyền trước ra mắt; không hứa thu hồi tức thì nội dung đã tải khi thiết bị chưa có mạng.')

add('Luồng A10 Cấu hình chức năng và thay đổi quyền truy cập', 'Heading 3')
add('Anh vào trang quản trị trợ lý để chọn nhân vật, giọng, cách chào, phong cách tư vấn, giáo án, nguồn kiến thức, nơi hiển thị, hạn mức và công cụ được phép dùng. Có bản nháp, xem trước, xuất bản và quay về phiên bản đã duyệt trước đó. Người hỗ trợ chỉ chỉnh phần được anh giao.')
add('Ma trận quyền tối thiểu: khách chỉ xem nội dung công khai và học thử; học viên xem hồ sơ, đơn và tiến độ của mình, nội dung khóa có quyền; trợ lý chỉ được dùng các công cụ thuộc phiên hiện tại; người hỗ trợ truy cập phần việc được giao; quản trị viên thay đổi cấu hình theo quyền quản trị. Mặc định từ chối thao tác chưa được cấp.')
add('Mỗi lần đọc dữ liệu hoặc gọi công cụ, máy chủ kiểm tra lại người dùng, đối tượng, quyền học và quyền thao tác; không tin mã tài khoản hay quyền do trình duyệt hoặc AI tự đưa vào. Kiểm tra quyền trước khi lấy tài liệu cho AI. Không cung cấp dữ liệu khác học viên, khóa chưa mua, ghi chú CRM nội bộ hoặc bí mật hệ thống.')
add('Chỉ công bố công cụ có đầu vào giới hạn như mở trang hợp lệ, lấy bài được học, lưu kết quả hoặc tạo đơn theo mục 8. Trợ lý không tự cấp quyền học, sửa giá, hoàn tiền hay đổi vai trò. Thao tác quản trị theo luồng riêng và ghi admin_audit_log. Khi thu hồi quyền, hiệu lực áp dụng từ lần truy cập máy chủ tiếp theo; quy tắc ngoại tuyến theo A9.')

add('Luồng A11 Xử lý lỗi và hỗ trợ người học', 'Heading 3')
add('Micro bị từ chối: chuyển sang nhập chữ. Không tải được 3D: dùng ảnh hoặc giao diện chữ. Audio lỗi: hiển thị câu trả lời và nút nghe lại. Dịch vụ AI chậm hoặc lỗi: giữ câu hỏi, báo trạng thái và cho thử lại; không ghi nhận bài hoàn thành khi chưa có kết quả hợp lệ.')
add('Mỗi lượt có mã yêu cầu để tránh trả lời, lưu tiến độ hoặc trừ hạn mức trùng khi gửi lại. Chốt cách tính hạn mức và xử lý lượt lỗi theo số liệu dịch vụ; không tự thu thêm phí. Có nút báo câu trả lời sai, gắn mã bài và phiên bản để anh kiểm tra; chỉ gửi lịch sử hội thoại cho người hỗ trợ khi học viên chủ động đồng ý.')

add('Dữ liệu cần bổ sung và thời hạn lưu', 'Heading 3')
add('Bổ sung cấu hình trợ lý có phiên bản, tài sản nhân vật, danh sách giọng, giáo án trợ lý theo bài, nguồn kiến thức công khai hoặc thuộc khóa, danh sách công cụ và chính sách quyền. Mỗi nguồn phải có chủ sở hữu, trạng thái duyệt, phạm vi công khai/khóa học và phiên bản; quyền lọc áp dụng trước khi đưa nội dung vào hội thoại.')
add('Lưu phiên và lượt hội thoại ở mức cần thiết, bước học, kết quả đánh giá, lựa chọn giọng, số liệu sử dụng và hạn mức. Liên kết với users, courses, lessons và enrollments thay vì tạo tài khoản hoặc quyền học riêng. Bản ghi âm và mô hình lưu ở kho tệp có kiểm soát; cơ sở dữ liệu giữ mã tham chiếu và thông tin thời hạn lưu.')
add('Tách quyền micro của trình duyệt với lựa chọn lưu bản ghi âm và lịch sử. Công bố mục đích sử dụng, nhà cung cấp xử lý, thời gian giữ và cách yêu cầu xóa trước khi thu thập. Anh chốt thời hạn cụ thể trước ra mắt; chỉ gửi dữ liệu cần thiết tới dịch vụ. Có tác vụ xóa dữ liệu hết hạn, quy trình yêu cầu xóa theo mục 8A và nhật ký truy cập quản trị cần thiết; không ghi khóa bí mật vào hội thoại hoặc nhật ký.')

add('Các màn hình cần bổ sung vào thiết kế', 'Heading 3')
add('Website: khung trợ lý thu gọn/mở rộng, lời chào, nút nói chuyện, nhập chữ, trạng thái micro, thẻ gợi ý khóa, mở học thử và chuyển thanh toán. App: trợ lý trong bài, chọn giọng/tốc độ, ghi âm, phản hồi phát âm, tiếp tục bài, hạn mức và trạng thái ngoại tuyến. Trang quản trị: nhân vật/giọng, giáo án, nguồn kiến thức, quyền/công cụ, hạn mức, phiên bản và phản hồi cần xử lý.')
add('Thiết kế cả máy tính và điện thoại; phụ đề hoặc chữ luôn đọc được, thao tác chính không bị nhân vật che, có điều khiển âm thanh và tắt chuyển động. Thông tin kỹ thuật không đưa vào luồng học trừ khi giúp học viên quyết định tải bài, dùng mạng hoặc quản lý dữ liệu của mình.')

add('Trình tự triển khai và kiểm soát chi phí', 'Heading 3')
add('Bước 1 Chốt luồng và dữ liệu: bổ sung đặc tả, giáo án mẫu, ma trận quyền, chính sách dữ liệu, danh sách màn hình và tiêu chí nghiệm thu trước khi lập trình. Giữ kiến trúc dùng chung, kiểm tra lại mã nguồn thực tế khi bắt đầu triển khai.')
add('Bước 2 Làm bản thử giới hạn: một nhân vật, một bài học buồng máy, ba mẫu giọng và một tình huống hướng dẫn website; chạy trên điện thoại và máy tính. Đo độ trễ, chất lượng tiếng nói/khẩu hình, tính đúng giáo án, tải dữ liệu, pin và chi phí theo phiên. Anh duyệt rồi mới quyết định phạm vi phát hành.')
add('Bước 3 Kết nối thật: tài khoản, nội dung, quyền học, thanh toán, lưu tiến độ, giọng nói và hội thoại. Thử với nhóm học viên nhỏ; sửa lỗi và đo lại trước khi mở rộng. Bước 4 Mở thêm giáo án, tư vấn và công cụ theo quyền; duy trì kiểm tra chất lượng sau mỗi lần thay mô hình AI, giọng hoặc tài liệu.')
add('Tách chi phí dựng nhân vật và chỉnh sửa ban đầu khỏi chi phí vận hành: chuyển giọng nói thành chữ, tạo giọng, chấm phát âm, hội thoại AI, lưu trữ và truyền dữ liệu. Tạo trước audio cố định; chốt hạn mức khách, phút theo gói, giới hạn mỗi phiên và ngưỡng cảnh báo ngân sách. Các con số phải được đo hoặc báo giá trước khi bán, không coi ước tính cũ ở mục 10 là tổng chi phí cho trợ lý 3D.')

add('Kiểm thử và kết quả cần bàn giao', 'Heading 3')
add('☐ Khách tìm trang, nghe tư vấn, mở học thử và chuyển thanh toán; AI dùng đúng giá, chính sách, không tự mở khóa. Kiểm tra từ chối micro, tắt âm thanh, thu gọn nhân vật và giao diện điện thoại.')
add('☐ Học viên học đúng giáo án và đúng phiên bản; chọn đủ ba giọng; thuật ngữ, số liệu, khẩu hình và phản hồi được anh duyệt. Kiểm tra tiếng ồn, im lặng, câu trả lời sai và câu hỏi ngoài phạm vi; không chấm điểm khi bản ghi không hợp lệ.')
add('☐ Chặn truy cập khác tài khoản, khóa chưa mua và thao tác vượt quyền kể cả khi người dùng yêu cầu AI bỏ qua quy tắc. Kiểm tra hoàn tiền, thu hồi quyền giữa phiên, hết hạn mức và gửi lại cùng yêu cầu.')
add('☐ Tải bài, học mất mạng, kết nối lại, đồng bộ chống trùng và tiếp tục trên thiết bị thứ hai đúng quy tắc. Kiểm tra lỗi AI/audio/3D, giữ dữ liệu chưa gửi và chế độ nhẹ; không làm mất bài học cơ bản khi trợ lý lỗi.')
add('☐ Bàn giao mô hình và nguồn tài sản, mẫu giọng, giáo án và nguồn kiến thức có phiên bản, thiết kế giao diện, ma trận quyền, cấu trúc dữ liệu có phiên bản, cấu hình hạn mức, báo cáo chi phí, hướng dẫn vận hành và xử lý/xóa dữ liệu. Cập nhật trạng thái thiết kế hay chạy thật trong docs/data-flows.md và docs/session-handoff.md.')
add('Tài liệu kỹ thuật tham khảo: Microsoft Azure Speech language support https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts ; dữ liệu khẩu hình https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme ; MDN quyền micro https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia và phát âm thanh https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay ; Tripo tạo mô hình từ ảnh https://docs.tripo3d.ai/ . Kiểm tra lại khả năng hỗ trợ và giá khi triển khai.')

# Connect the new scope to the existing preparation and decisions.
for prefix, text in [
    ('Mẹo: làm trước 3 bài', '☐ Soạn kèm giáo án trợ lý, mẫu phản hồi và tiêu chí hoàn thành cho bài thử theo mục 7A; anh duyệt trước khi đưa vào AI.'),
    ('Công nghệ đề xuất (chi phí thấp', '☐ Bổ sung khung trợ lý hướng dẫn, tư vấn và học thử trên website theo mục 7A; hiển thị quyền micro, âm thanh, hạn mức và cách tắt trợ lý.'),
    ('Để sau (phiên bản 2):', '☐ Bổ sung màn trợ lý trong bài, lựa chọn ba giọng, tiếp tục bài, phản hồi phát âm và chế độ ngoại tuyến theo mục 7A; triển khai từng phần sau bản thử.'),
]:
    p = next(p for p in doc.paragraphs if p.text.startswith(prefix))
    p.insert_paragraph_before(text, 'List Paragraph')
    inserted.append(text)

decisions = [
    '☐ Duyệt ảnh, hình dáng và tên nhân vật; chốt người thực hiện mô hình và quyền sử dụng tài sản.',
    '☐ Duyệt ba mẫu giọng Philippines, Ấn Độ, Mỹ, giọng tiếng Việt và tiêu chí chấm phát âm.',
    '☐ Chốt một bài học và tình huống tư vấn cho bản thử; chọn chức năng trợ lý mở ở lần ra mắt đầu.',
    '☐ Chốt hạn mức dùng thử, số phút theo gói, ngân sách và cách xử lý lượt AI lỗi.',
    '☐ Chốt ma trận quyền, thời hạn lưu hội thoại/bản ghi âm và thời hạn quyền học ngoại tuyến.',
]
for t in decisions:
    doc.add_paragraph(t, 'List Paragraph')
    inserted.append(t)

# Update only the existing rows directly related to the assistant.
doc.tables[4].cell(2, 2).text = 'Ba giọng tiếng Anh Philippines, Ấn Độ, Mỹ; giọng tiếng Việt giải thích; thử mức hỗ trợ khẩu hình của từng giọng'
doc.tables[4].cell(3, 2).text = 'Cần mạng khi chấm qua dịch vụ; kiểm tra khả năng hỗ trợ và tiêu chí chấm trước khi phát hành'
doc.tables[4].cell(4, 2).text = 'Cần mạng; dùng chung trên web/app, kiểm tra quyền học, nguồn kiến thức và hạn mức theo mục 7A'
doc.tables[10].cell(3, 1).text = 'Theo lượng tạo giọng, nhận dạng và chấm phát âm'
doc.tables[10].cell(3, 2).text = 'Audio cố định tạo trước; hội thoại trực tiếp phát sinh phí khi sử dụng; đo và chốt hạn mức theo mục 7A'
for row in [
    ['Dựng nhân vật 3D', 'Theo báo giá và chất lượng yêu cầu', 'Gồm chỉnh mô hình, khuôn mặt, cử chỉ và tối ưu điện thoại; duyệt bản thử trước'],
    ['Hội thoại AI và media trợ lý', 'Theo số phiên, thời lượng và dung lượng', 'Tách chi phí vận hành khỏi gói hỗ trợ soạn bài; có cảnh báo ngân sách'],
]:
    cells = doc.tables[10].add_row().cells
    for i, value in enumerate(row):
        cells[i].text = value

doc.core_properties.modified = __import__('datetime').datetime(2026, 10, 28, 15, 0, 0)
doc.save(target)
check = Document(target)
after = [p.text for p in check.paragraphs]
# All original paragraphs remain in order, allowing only declared replacements.
cursor = 0
for old in before:
    expected = changes.get(old, old)
    while cursor < len(after) and after[cursor] != expected:
        cursor += 1
    assert cursor < len(after), ('Lost original paragraph', old)
    cursor += 1
assert len(check.inline_shapes) == len(Document(backup).inline_shapes)
assert len(check.tables) == len(before_tables)
for i, old_table in enumerate(before_tables):
    if i not in (4, 10):
        assert old_table == [[c.text for c in r.cells] for r in check.tables[i].rows], ('Table changed', i)
for t in inserted:
    assert t in after, ('Missing new paragraph', t)
assert all(any(f'Luồng A{i} ' in t for t in after) for i in range(1, 12))
report = {'output':str(target), 'original_paragraphs':len(before), 'updated_paragraphs':len(after), 'replaced_paragraphs':len(changes), 'inserted_paragraphs':len(inserted), 'tables':len(check.tables), 'inline_images':len(check.inline_shapes), 'backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest(), 'sha256':hashlib.sha256(target.read_bytes()).hexdigest(), 'content_checks':'passed'}
(qa/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
