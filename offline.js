/* 離線 MC 對卷：純字元比對，不連網、不需要任何 API key */

const $ = (s) => document.querySelector(s);
const HKEY = 'dsecg_mc_hist_v1';
let LAST = null;

/* 解析：「1C 2B」「1 C」「1.C」「1:A」「1C2B3D」全部認 */
function parse(text) {
  const out = new Map();
  const re = /(\d{1,3})\s*[.):：\-]?\s*([A-Da-d])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const q = parseInt(m[1], 10);
    if (!out.has(q)) out.set(q, m[2].toUpperCase());
  }
  return out;
}

function run() {
  const key = parse($('#key').value);
  const mine = parse($('#mine').value);
  if (!key.size) return setStatus('請先填標準答案');

  const total = key.size;
  let correct = 0;
  const wrong = [];
  key.forEach((ans, q) => {
    const got = mine.get(q);
    if (got === ans) correct++;
    else wrong.push({ q, got: got || '（未答）', ans });
  });

  const pct = +(correct / total * 100).toFixed(1);
  LAST = { total, correct, pct, wrong, paper: $('#paper').value.trim() || '未命名試卷' };

  render(LAST);
  setStatus('');
}

function render(r) {
  $('#result').classList.remove('hidden');
  $('#total').textContent = `${r.correct} / ${r.total}`;
  $('#percent').textContent = r.pct + '%';
  $('#bar').style.width = Math.min(100, r.pct) + '%';

  const w = parseFloat($('#weight').value);
  const extra = (isFinite(w) && w > 0)
    ? `　若 MC 佔全卷 ${w}%，你在這部分取得約 ${(w * r.pct / 100).toFixed(1)} / ${w} 分。` : '';
  const level = r.pct >= 85 ? 'MC 功夫扎實，可以集中在 LQ。'
    : r.pct >= 70 ? '基本盤穩，錯的題多數是細節或審題。'
    : r.pct >= 55 ? '概念一半掌握，建議按課題重讀再練。'
    : '基礎未穩，先回課本逐課題清概念。';
  $('#verdict').textContent = `答對 ${r.correct} 題，錯 ${r.wrong.length} 題。${level}${extra}`;

  $('#wrong').innerHTML = r.wrong.map((x) =>
    `<li>第 <b>${x.q}</b> 題：你答 <b>${x.got}</b>，正解 <b>${x.ans}</b></li>`).join('');
  $('#none').style.display = r.wrong.length ? 'none' : 'block';
  $('#wrong').style.display = r.wrong.length ? 'block' : 'none';
}

/* 紀錄 */
function loadHist() {
  try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; }
}
function saveHist(list) { localStorage.setItem(HKEY, JSON.stringify(list.slice(-40))); }

function renderHist() {
  const list = loadHist();
  $('#cnt').textContent = list.length + ' 次';
  $('#hist').innerHTML = list.slice().reverse().map((h) =>
    `<tr><td>${h.date}</td><td>${esc(h.paper)}</td><td>${h.correct}/${h.total}</td><td>${h.pct}%</td></tr>`).join('')
    || '<tr><td colspan="4" style="color:#5b6b74">尚無紀錄</td></tr>';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function setStatus(t) { $('#status').textContent = t; }

/* 匯出 */
function exportMd() {
  if (!LAST) return setStatus('請先對卷');
  const lines = [
    `# MC 對卷報告 — ${LAST.paper}`, '',
    `- 得分：${LAST.correct} / ${LAST.total}`,
    `- 準確率：${LAST.pct}%`,
    `- 錯題數：${LAST.wrong.length}`, '',
    '| 題號 | 你的答案 | 正解 |', '|---|---|---|',
    ...LAST.wrong.map((x) => `| ${x.q} | ${x.got} | ${x.ans} |`)
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mc-report.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 綁定 */
$('#run').addEventListener('click', run);
$('#export').addEventListener('click', exportMd);
$('#clear').addEventListener('click', () => {
  $('#key').value = ''; $('#mine').value = '';
  $('#result').classList.add('hidden'); LAST = null; setStatus('');
});
$('#demo').addEventListener('click', () => {
  $('#key').value = '1C 2B 3D 4A 5A 6C 7D 8C 9D 10B 11A 12C 13A 14B 15D 16C 17B 18D 19A 20D 21B 22A 23C 24C 25B 26A 27B 28A 29D 30B 31D 32B 33C 34B 35D 36A';
  $('#mine').value = '1C 2B 3D 4A 5A 6C 7D 8A 9D 10B 11A 12A 13A 14D 15D 16C 17B 18D 19A 20C 21B 22A 23C 24C 25B 26A 27D 28A 29D 30A 31A 32B 33C 34B 35D 36A';
  $('#paper').value = 'SUPER MOCK Set 1（示範）';
  setStatus('已載入示範，按「對卷」');
});
$('#save').addEventListener('click', () => {
  if (!LAST) return setStatus('請先對卷');
  const list = loadHist();
  list.push({ date: new Date().toLocaleDateString('zh-HK'), paper: LAST.paper, correct: LAST.correct, total: LAST.total, pct: LAST.pct });
  saveHist(list); renderHist(); setStatus('已存入紀錄');
});
$('#wipe').addEventListener('click', () => {
  if (!confirm('確定清除全部紀錄？')) return;
  localStorage.removeItem(HKEY); renderHist(); setStatus('已清除');
});

renderHist();
