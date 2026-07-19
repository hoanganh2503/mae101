var SHEET_NAME = 'KetQua';
var HEADERS = ['Thời điểm nhận', 'Họ tên', 'MSSV', 'Bộ', 'Tên đề', 'Mã đề',
               'Điểm (%)', 'Đúng', 'Tổng', 'Thời gian (giây)', 'Thời gian (mm:ss)', 'Nộp lúc',
               'HV chọn', 'Đáp án đúng', 'Đúng/Sai', 'Câu sai', 'Chế độ', 'Ảnh (JSON)', 'Chấm lại lúc'];

var COL = { SCORE: 6, CORRECT: 7, TOTAL: 8, PICKS: 12, KEY: 13, RESULT: 14, WRONG: 15,
            EXAMID: 5, MODE: 16, IMAGES: 17, REGRADED: 18 };

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'JSON không hợp lệ' }); }
  if (data && data.action === 'regrade') return handleRegrade_(data);
  return handleSubmit_(data);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'summary') {
    var s = PropertiesService.getScriptProperties().getProperty('LAST_REGRADE') || '{}';
    return jsonp_(p.callback, s);
  }
  return ContentService.createTextOutput('MAD101 results endpoint OK');
}

function handleSubmit_(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sh);

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
