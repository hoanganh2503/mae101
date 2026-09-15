# MAE101 — Web thi thử trắc nghiệm (tĩnh, chỉ HTML/JS)

Trang web luyện đề trắc nghiệm từ kho đề **FE / PT / RE**. Không cần server: chạy được bằng
GitHub Pages hoặc mở local. Mỗi đề là một thư mục ảnh câu hỏi (`01.jpg, 02.jpg, …`).

## Cấu trúc

```
index.html          Trang chủ học viên: danh sách đề, đánh dấu đã/chưa làm, điểm gần nhất
exam.html           Làm bài: hiện ảnh câu hỏi, chọn A–E, bấm giờ, nộp & chấm điểm
results.html        Lịch sử kết quả của học viên + tải CSV/JSON
admin.html          Admin: đăng nhập, đặt/sửa đáp án từng câu, nhập/xuất answers.json
assets/style.css    Giao diện
assets/app.js       Logic dùng chung (cấu hình ở đầu file)
build-manifest.js   Script Node quét FE/PT/RE -> data/manifest.json
data/manifest.json  Danh sách đề + ảnh (TỰ SINH, đừng sửa tay)
data/answers.json   Đáp án đúng (admin quản lý, commit vào đây)
FE/ PT/ RE/         Kho đề (mỗi đề 1 folder ảnh)
```

## Dữ liệu lưu ở đâu

| Dữ liệu | Nơi lưu | Ghi chú |
|---|---|---|
| Đáp án đúng | `data/answers.json` (trong repo) | Admin tạo, dùng chung mọi người |
| Đề nào đã/chưa làm | localStorage trình duyệt HV | Theo từng máy |
| Kết quả + thời gian | localStorage + tải CSV/JSON | Theo từng máy; muốn nộp thì tải file gửi đi |

> Web tĩnh **không thể** tự ghi kết quả ngược lên GitHub. Muốn gom kết quả tập trung
> cho admin thì cần gắn thêm dịch vụ ngoài (Google Form/Sheet, Firebase…). Chỗ lưu kết quả
> nằm gọn trong hàm `saveResult()` ở `assets/app.js` để dễ nâng cấp sau.

## Cách dùng

### 1. Sinh lại danh sách đề (khi thêm/bớt đề)
```bash
node build-manifest.js
```
Script tự bỏ qua file `.jpg` thực chất là HTML (trang "exit" rác từ site gốc).

### 2. Chạy local
Phải chạy qua một web server (vì dùng `fetch` JSON — mở trực tiếp `file://` sẽ bị chặn):
```bash
# Cách 1: Python
python -m http.server 8000
# Cách 2: Node
npx serve .
```
Rồi mở http://localhost:8000

### 3. Admin nhập đáp án
1. Mở `admin.html` → đăng nhập (mật khẩu mặc định **`mae101`**, đổi trong `assets/app.js`).
2. Chọn Bộ đề → Đề → xem ảnh từng câu, chọn A–E (hoặc dùng "Nhập nhanh").
3. Bấm **Tải answers.json** → chép file vào thư mục `data/` (đè file cũ) → commit/push.
4. Lần sau sửa tiếp: bấm **Nhập answers.json** để nạp lại file đã commit rồi sửa.

> Sửa đổi chưa tải về được giữ tạm trong trình duyệt (bản nháp) nên không sợ mất khi F5.

### 4. Deploy GitHub Pages
- Push toàn bộ thư mục lên GitHub.
- Repo → Settings → Pages → Source: nhánh `main`, thư mục `/ (root)`.
- Vài phút sau truy cập `https://<user>.github.io/<repo>/`.

## Gom kết quả học viên về Google Sheet (tuỳ chọn)

Mặc định kết quả chỉ lưu trên máy từng học viên. Muốn **tự gom hết về một Google Sheet
cho admin xem** (học viên không cần đăng nhập), làm 1 lần:

1. Tạo 1 Google Sheet trống.
2. Trong Sheet: **Extensions → Apps Script**, dán toàn bộ nội dung `google-apps-script.gs`.
3. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone** → Deploy → Authorize.
4. Copy **Web app URL** (dạng `https://script.google.com/macros/s/..../exec`).
5. Mở `assets/app.js`, dán URL vào biến `RESULTS_ENDPOINT = '...'`, rồi commit/push.

Xong: mỗi lần học viên nộp bài, web tự gửi **Họ tên, MSSV, đề, điểm, số câu đúng,
thời gian, thời điểm nộp** thành một dòng trong sheet `KetQua`. Admin chỉ việc mở Sheet để xem.

> Trước khi làm bài, học viên được hỏi **Họ tên + MSSV** (lưu lại cho các lần sau trên cùng máy).
> Link Sheet chỉ admin biết; học viên không thấy. Lưu ý đây vẫn là gửi 1 chiều — đáp án
> trong `data/answers.json` vẫn công khai như mục trên.

## Ghi chú
- Đăng nhập admin chỉ là cổng chặn nhầm phía giao diện, **không phải bảo mật thật**
  (web tĩnh ai cũng xem được source). Đừng coi đáp án là bí mật tuyệt đối.
- Mặc định mỗi câu hiển thị 5 lựa chọn A–E. Câu nào ít hơn thì chỉ cần chọn trong số có thật.
