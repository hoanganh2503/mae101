const OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];

const SEC_PER_QUESTION = 60;

const LS_PROGRESS = 'mae101.progress.v1';
const LS_RESULTS  = 'mae101.results.v1';
const LS_ADMIN    = 'mae101.admin.v1';
const LS_STUDENT  = 'mae101.student.v1';
const LS_INPROG   = 'mae101.inprogress.v1';

const ADMIN_PASSWORD = 'mae101';

const RESULTS_ENDPOINT = 'https://script.google.com/macros/s/AKfycby5aGheQXzL_NAg-VbEebEYNYPhoCQ1Fg5cf1zByqYRFa9Zd01xHBLvyJQVX3p6Y06m/exec';

async function loadManifest() {
  const res = await fetch('data/manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Không tải được data/manifest.json');
  return res.json();
}
async function loadAnswers() {
  try {
    const res = await fetch('data/answers.json', { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

function imgUrl(examId, img) {
  return examId.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(img);
}

function findExam(manifest, examId) {
  for (const sec of Object.keys(manifest.sections)) {
    const e = manifest.sections[sec].find(x => x.id === examId);
    if (e) return { ...e, section: sec };
  }
  return null;
}

function getJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function setJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getProgress() { return getJSON(LS_PROGRESS, {}); }
function getResults() { return getJSON(LS_RESULTS, []); }

function saveResult(result) {

  const results = getResults();
  results.unshift(result);
  setJSON(LS_RESULTS, results);

  const prog = getProgress();
  const p = prog[result.examId] || { attempts: 0, bestScore: 0 };
  p.attempts = (p.attempts || 0) + 1;
  p.done = true;
  p.lastScore = result.score;
  p.lastTimeSec = result.timeSec;
  p.lastAt = result.finishedAt;
  p.bestScore = Math.max(p.bestScore || 0, result.score);
  prog[result.examId] = p;
  setJSON(LS_PROGRESS, prog);
}

function getStudent() { return getJSON(LS_STUDENT, { name: '', mssv: '' }); }
function setStudent(s) { setJSON(LS_STUDENT, s); }

function getInProgress(examId) { const all = getJSON(LS_INPROG, {}); return all[examId] || null; }
function setInProgress(examId, state) { const all = getJSON(LS_INPROG, {}); all[examId] = state; setJSON(LS_INPROG, all); }
function clearInProgress(examId) { const all = getJSON(LS_INPROG, {}); delete all[examId]; setJSON(LS_INPROG, all); }

function submitResultToSheet(payload) {
  if (!RESULTS_ENDPOINT) return Promise.resolve(false);
  return fetch(RESULTS_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }).then(() => true).catch(() => false);
}

function submitRegradeToSheet(payload) {
  if (!RESULTS_ENDPOINT) return Promise.resolve(false);
  return fetch(RESULTS_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: 'regrade' }, payload)),
  }).then(() => true).catch(() => false);
}

function jsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = '__jsonp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    let done = false;
    const cleanup = () => { done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); clearTimeout(t); };
    const t = setTimeout(() => { if (!done) { cleanup(); reject(new Error('timeout')); } }, timeoutMs || 8000);
    window[cb] = (data) => { if (!done) { cleanup(); resolve(data); } };
    s.onerror = () => { if (!done) { cleanup(); reject(new Error('không tải được')); } };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb + '&_=' + Date.now();
    document.body.appendChild(s);
  });
}

function fetchRegradeSummary() {
  if (!RESULTS_ENDPOINT) return Promise.resolve(null);
  return jsonp(RESULTS_ENDPOINT + '?action=summary').catch(() => null);
}

function pickDistributed(arr, per, block) {
  const out = [];
  for (let start = 0; start < arr.length; start += block) {
    const chunk = arr.slice(start, start + block);
    const idxs = chunk.map((_, i) => i);

    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    idxs.slice(0, Math.min(per, chunk.length)).sort((a, b) => a - b)
      .forEach(i => out.push(chunk[i]));
  }
  return out;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN');
}
function pct(correct, total) {
  return total ? Math.round((correct / total) * 1000) / 10 : 0;
}

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let _toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function isAdmin() { return localStorage.getItem(LS_ADMIN) === '1'; }
function loginAdmin(pw) {
  if (pw === ADMIN_PASSWORD) { localStorage.setItem(LS_ADMIN, '1'); return true; }
  return false;
}
function logoutAdmin() { localStorage.removeItem(LS_ADMIN); }

function renderTopbar(active) {
  const links = [
    ['index.html', 'Đề thi'],
    ['results.html', 'Kết quả của tôi'],
    ['admin.html', 'Admin'],
  ];
  return `
  <div class="topbar"><div class="inner">
    <div class="brand">MAE<span>101</span> · Thi thử</div>
    <div class="grow"></div>
    <nav class="nav">
      ${links.map(([h, t]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${t}</a>`).join('')}
    </nav>
  </div></div>`;
}
