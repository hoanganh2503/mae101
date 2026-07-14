/**
 * MAD101 — Nhận kết quả thi và ghi vào Google Sheet + Chấm lại theo đáp án mới.
 *
 * CÁCH DÙNG (làm 1 lần):
 *  1. Tạo 1 Google Sheet trống (sheets.new).
 *  2. Trong Sheet: menu Extensions (Tiện ích mở rộng) → Apps Script.
 *  3. Xoá code mẫu, dán TOÀN BỘ file này vào, bấm Save.
 *  4. Bấm Deploy (Triển khai) → New deployment → chọn type "Web app".
 *       - Description: tuỳ ý
 *       - Execute as:  Me (chính bạn)
 *       - Who has access:  Anyone  (Bất kỳ ai)  ← bắt buộc để web gửi được
 *     Bấm Deploy, cấp quyền (Authorize) khi được hỏi.
 *  5. Copy "Web app URL" (dạng https://script.google.com/macros/s/..../exec).
 *  6. Dán URL đó vào biến RESULTS_ENDPOINT trong assets/app.js, rồi commit/push.
 *
 * Mỗi lần học viên nộp bài, một dòng mới sẽ tự thêm vào sheet "KetQua".
 *
 * CHẤM LẠI: Khi admin sửa đáp án (đã commit data/answers.json), vào trang admin.html
 * bấm "Chấm lại & cập nhật Sheet". Web gửi đáp án mới lên đây; script tính lại điểm cho
 * TẤT CẢ bài đã nộp (dựa trên lựa chọn từng câu đã lưu) và cập nhật ngay trên Sheet.
 *
 * Khi bạn sửa code này, nhớ Deploy → Manage deployments → Edit → Version: New version.
 */

var SHEET_NAME = 'KetQua';
var HEADERS = ['Thời điểm nhận', 'Họ tên', 'MSSV', 'Bộ', 'Tên đề', 'Mã đề',
               'Điểm (%)', 'Đúng', 'Tổng', 'Thời gian (giây)', 'Thời gian (mm:ss)', 'Nộp lúc',
               'HV chọn', 'Đáp án đúng', 'Đúng/Sai', 'Câu sai', 'Chế độ', 'Ảnh (JSON)', 'Chấm lại lúc'];

// Chỉ số cột (0-based) khớp HEADERS ở trên
var COL = { SCORE: 6, CORRECT: 7, TOTAL: 8, PICKS: 12, KEY: 13, RESULT: 14, WRONG: 15,
            EXAMID: 5, MODE: 16, IMAGES: 17, REGRADED: 18 };

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'JSON không hợp lệ' }); }
  if (data && data.action === 'regrade') return handleRegrade_(data);
  return handleSubmit_(data);
}

// Mở URL bằng trình duyệt để kiểm tra đã deploy đúng chưa + trả tóm tắt chấm lại (JSONP).
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'summary') {
    var s = PropertiesService.getScriptProperties().getProperty('LAST_REGRADE') || '{}';
    return jsonp_(p.callback, s);
  }
  return ContentService.createTextOutput('MAD101 results endpoint OK');
}

// ---------------- Ghi 1 bài mới nộp ----------------
function handleSubmit_(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // tránh ghi đè khi nhiều bài nộp cùng lúc
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sh);

    // 3 cột chi tiết: ưu tiên chuỗi đã định dạng từ web, nếu không thì tự dựng từ details
    var picksStr = d.picksStr, keyStr = d.keyStr, resultStr = d.resultStr, wrongStr = d.wrongStr;
    if ((!picksStr || !keyStr || !resultStr) && d.details && d.details.length) {
      picksStr  = d.details.map(function (x) { return x.n + '.' + (x.pick || '-'); }).join(' ');
      keyStr    = d.details.map(function (x) { return x.n + '.' + (x.ans || '-'); }).join(' ');
      resultStr = d.details.map(function (x) { return x.n + '.' + (x.ok ? 'Đ' : 'S'); }).join(' ');
    }
    if (wrongStr == null && d.details && d.details.length) {
      wrongStr = d.details.filter(function (x) { return x.ans && !x.ok; })
                          .map(function (x) { return x.n; }).join(', ');
    }

    // Lưu bộ câu (ảnh) của lượt làm này để sau có thể chấm lại chính xác (kể cả random)
    var imagesJson = (d.images && d.images.length) ? JSON.stringify(d.images) : '';

    sh.appendRow([
      new Date(),
      d.name || '', d.mssv || '',
      d.section || '', d.examName || '', d.examId || '',
      d.score, d.correct, d.total,
      Math.round(d.timeSec || 0), d.timeMMSS || '', d.finishedAt || '',
      picksStr || '', keyStr || '', resultStr || '', wrongStr || '',
      d.mode || '', imagesJson, ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Chấm lại toàn bộ theo đáp án mới ----------------
// data = { action:'regrade', requestId, answers:{examId:{img:letter}}, order:{examId:[img,...]} }
function handleRegrade_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var answers = data.answers || {};
    var order = data.order || {};
    var summary = { ok: true, requestId: data.requestId || '', at: new Date().toISOString(),
                    rows: 0, regraded: 0, changed: 0, skippedNoKey: 0, skippedNoMap: 0 };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) { saveSummary_(summary); return json_(summary); }
    ensureHeaders_(sh);

    var width = HEADERS.length;
    var rng = sh.getRange(2, 1, sh.getLastRow() - 1, width);
    var vals = rng.getValues();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      summary.rows++;

      var examId = String(row[COL.EXAMID] || '');
      var total = parseInt(row[COL.TOTAL], 10) || 0;
      if (!examId || !total) continue;

      var key = answers[examId];
      if (!key) { summary.skippedNoKey++; continue; }

      // Xác định bộ câu (ảnh) theo từng số câu:
      // 1) ưu tiên cột "Ảnh (JSON)" đã lưu khi nộp (đúng cho cả full lẫn random)
      // 2) fallback cho bài cũ chưa lưu ảnh: dùng thứ tự manifest nếu là bài full (đủ số câu)
      var images = null;
      var imagesJson = String(row[COL.IMAGES] || '');
      if (imagesJson) { try { images = JSON.parse(imagesJson); } catch (e) { images = null; } }
      if ((!images || !images.length) && order[examId] && order[examId].length === total) {
        images = order[examId];
      }
      if (!images || images.length < total) { summary.skippedNoMap++; continue; }

      var picks = parsePicks_(String(row[COL.PICKS] || ''));
      var correct = 0, keyParts = [], resParts = [], wrong = [];
      for (var n = 1; n <= total; n++) {
        var img = images[n - 1];
        var ans = (img && key[img]) ? key[img] : '';
        var pick = picks[n] || '';
        var ok = ans && pick === ans;
        if (ok) correct++;
        keyParts.push(n + '.' + (ans || '-'));
        resParts.push(n + '.' + (ok ? 'Đ' : 'S'));
        if (ans && !ok) wrong.push(n);
      }
      var score = total ? Math.round((correct / total) * 1000) / 10 : 0;

      summary.regraded++;
      var changed = (Number(row[COL.SCORE]) !== score) || (Number(row[COL.CORRECT]) !== correct);
      row[COL.SCORE] = score;
      row[COL.CORRECT] = correct;
      row[COL.KEY] = keyParts.join(' ');
      row[COL.RESULT] = resParts.join(' ');
      row[COL.WRONG] = wrong.join(', ');
      row[COL.REGRADED] = stamp;
      if (changed) summary.changed++;
    }

    rng.setValues(vals);
    saveSummary_(summary);
    return json_(summary);
  } catch (err) {
    var errObj = { ok: false, error: String(err), requestId: (data && data.requestId) || '' };
    saveSummary_(errObj);
    return json_(errObj);
  } finally {
    lock.releaseLock();
  }
}

// ---------------- helpers ----------------
// "1.A 2.- 3.C" -> { 1:'A', 2:'', 3:'C' }
function parsePicks_(str) {
  var out = {};
  (str || '').split(/\s+/).forEach(function (tok) {
    if (!tok) return;
    var dot = tok.indexOf('.');
    if (dot < 0) return;
    var n = parseInt(tok.slice(0, dot), 10);
    var v = tok.slice(dot + 1);
    if (n) out[n] = (v === '-' ? '' : v);
  });
  return out;
}

function ensureHeaders_(sh) {
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); return; }
  var head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head[HEADERS.length - 1] !== HEADERS[HEADERS.length - 1]) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

function saveSummary_(summary) {
  PropertiesService.getScriptProperties().setProperty('LAST_REGRADE', JSON.stringify(summary));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(cb, jsonStr) {
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}
