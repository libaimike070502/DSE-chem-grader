/* DSE Chem Grader — 前端批改引擎
   設計原則：不在倉庫內存放任何考評局試卷或評卷參考；
   評分規則庫為自行撰寫，試卷內容由使用者即時提供。 */

const $ = (s) => document.querySelector(s);
const CFG = 'dsecg_cfg_v1';
let KB = { rubric: null, notAccept: null, topics: null };
let PAGES = [];   // {name, dataUrl}
let LAST = null;  // 最近一次批改結果

/* ---------- 設定 ---------- */
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG) || '{}');
    if (c.endpoint) $('#endpoint').value = c.endpoint;
    if (c.model) $('#model').value = c.model;
    if (c.key) $('#apikey').value = c.key;
  } catch (e) {}
}
function saveCfg() {
  localStorage.setItem(CFG, JSON.stringify({
    endpoint: $('#endpoint').value.trim(),
    model: $('#model').value.trim(),
    key: $('#apikey').value.trim()
  }));
}

/* ---------- 知識庫 ---------- */
async function loadKB() {
  const get = async (p) => (await fetch(p, { cache: 'no-store' })).json();
  [KB.rubric, KB.notAccept, KB.topics] = await Promise.all([
    get('./data/rubric.json'), get('./data/not-accept.json'), get('./data/topics.json')
  ]).catch(() => [null, null, null]);
}

/* ---------- 檔案處理 ---------- */
const MAXW = 1400;

function shrink(dataUrl) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAXW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

async function pdfToImages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  const cap = Math.min(pdf.numPages, 40);
  for (let i = 1; i <= cap; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push({ name: `${file.name} p${i}`, dataUrl: await shrink(c.toDataURL('image/jpeg', 0.9)) });
  }
  return out;
}

async function addFiles(files) {
  for (const f of files) {
    if (f.type === 'application/pdf') {
      setStatus('轉換 PDF…');
      try { PAGES = PAGES.concat(await pdfToImages(f)); }
      catch (e) { setStatus('PDF 讀取失敗：' + e.message); }
    } else if (f.type.startsWith('image/')) {
      const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      PAGES.push({ name: f.name, dataUrl: await shrink(url) });
    }
  }
  renderThumbs();
  setStatus(PAGES.length ? `已載入 ${PAGES.length} 張` : '');
}

function renderThumbs() {
  $('#thumbs').innerHTML = PAGES.map((p, i) =>
    `<figure><img src="${p.dataUrl}" alt=""/><figcaption>${i + 1}</figcaption></figure>`).join('');
}

/* ---------- 提示詞 ---------- */
function systemPrompt() {
  const mode = $('#strict').value;
  const lang = $('#lang').value === 'en' ? 'English' : 'Traditional Chinese (Hong Kong)';
  const r = KB.rubric || { principles: [], markTypes: [], ecRules: [] };
  const na = (KB.notAccept?.items || []).slice(0, 18)
    .map((x) => `- ${x.reject} → ${x.accept}（${x.why}）`).join('\n');
  const tp = (KB.topics?.topics || []).map((t) => `${t.code} ${t.name}: ${t.sub.join('、')}`).join('\n');

  return `你是香港中學文憑（HKDSE）化學科的資深評卷員，按考評局評卷參考（marking scheme）的慣例批改。

【批改原則】
${r.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')}

【給分點類型】
${r.markTypes.map((m) => `- ${m.code}｜${m.name}：${m.desc}`).join('\n')}

【有效溝通分（EC）】
${r.ecRules.map((x) => '- ' + x).join('\n')}

【嚴格度：${mode}】${r.strictness?.[mode] || ''}

【措辭紅線（遇到即視為不達標）】
${na}

【課題樹（用於弱項歸類）】
${tp}

【輸出要求】
只輸出一個 JSON 物件，不要任何解釋文字、不要 markdown 圍欄。語言用 ${lang}。結構：
{
 "items": [
   {"q":"1(a)","max":2,"awarded":1,
    "hit":["已取分的給分點"],
    "lost":[{"point":"失分點名稱","reason":"為何不給分（引用學生原話或指出缺漏）"}]}
 ],
 "total_awarded": 85,
 "total_max": 120,
 "percent": 70.8,
 "verdict": "一句總評（得分結構、最主要失分原因）",
 "weak_topics": [{"topic":"課題名稱","code":"T12","evidence":"佐證的題號"}],
 "advice": ["可執行建議，最多 4 條，每條具體到動作"]
}
規則：所有 max 加總必須等於題卷總分；awarded 不得超過 max；空白題 awarded=0 並在 lost 寫「空白」。
若我沒有提供評卷參考，你按 DSE 慣例與課題知識推斷給分點，並在 verdict 註明「未提供官方 MS，屬推算」。`;
}

function userPrompt() {
  const mc = $('#mc').value.trim();
  const ms = $('#ms').value.trim();
  const note = $('#note').value.trim();
  return [
    '以下是我的答卷頁面（依序）。請逐題批改。',
    mc ? `MC 答案：${mc}` : 'MC 部分：請以圖中圈選的字母為答案。',
    ms ? `本次試卷的評卷參考（僅本次使用）：\n${ms}` : '（未提供評卷參考）',
    note ? `其他說明：${note}` : ''
  ].filter(Boolean).join('\n\n');
}

/* ---------- 呼叫模型 ---------- */
async function grade() {
  const key = $('#apikey').value.trim();
  const endpoint = $('#endpoint').value.trim();
  const model = $('#model').value.trim();
  if (!key) return setStatus('請先填 API Key');
  if (!PAGES.length) return setStatus('請先上載答卷');
  saveCfg();

  $('#go').disabled = true;
  setStatus('批改中…（頁數較多時需 1–3 分鐘）');

  const content = [{ type: 'text', text: userPrompt() }];
  PAGES.forEach((p) => content.push({ type: 'image_url', image_url: { url: p.dataUrl } }));

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content }
        ]
      })
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    LAST = parseJSON(raw);
    render(LAST);
    setStatus('完成');
  } catch (e) {
    setStatus('批改失敗：' + e.message);
  } finally {
    $('#go').disabled = false;
  }
}

function parseJSON(raw) {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch (e) { return { error: '模型輸出不是合法 JSON', raw }; }
}

/* ---------- 呈現 ---------- */
function render(r) {
  $('#result').classList.remove('hidden');
  if (r.error) {
    $('#total').textContent = '—';
    $('#verdict').textContent = r.error + '：' + (r.raw || '').slice(0, 400);
    return;
  }
  const max = r.total_max || 0, got = r.total_awarded || 0;
  const pct = r.percent || (max ? +(got / max * 100).toFixed(1) : 0);
  $('#total').textContent = `${got} / ${max}`;
  $('#percent').textContent = pct + '%';
  $('#bar').style.width = Math.min(100, pct) + '%';
  $('#verdict').textContent = r.verdict || '';

  $('#tbl tbody').innerHTML = (r.items || []).map((it) => {
    const lost = (it.lost || []).map((l) => `<div>• <b>${esc(l.point)}</b>：${esc(l.reason)}</div>`).join('') || '—';
    const full = it.awarded === it.max;
    return `<tr><td class="q">${esc(it.q)}</td>
      <td class="m ${full ? '' : 'lost'}">${it.awarded} / ${it.max}</td>
      <td>${lost}</td></tr>`;
  }).join('');

  $('#weak').innerHTML = (r.weak_topics || []).map((w) =>
    `<li><b>${esc(w.topic)}</b>${w.code ? `（${esc(w.code)}）` : ''} — ${esc(w.evidence || '')}</li>`).join('') || '<li>—</li>';
  $('#advice').innerHTML = (r.advice || []).map((a) => `<li>${esc(a)}</li>`).join('') || '<li>—</li>';
  window.scrollTo({ top: $('#result').offsetTop - 20, behavior: 'smooth' });
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function setStatus(t) { $('#status').textContent = t; }

/* ---------- 匯出 ---------- */
function exportMd() {
  if (!LAST || LAST.error) return setStatus('沒有可匯出的結果');
  const lines = [
    '# DSE 化學批改報告', '',
    `- 總分：${LAST.total_awarded} / ${LAST.total_max}`,
    `- 準確率：${LAST.percent}%`,
    `- 總評：${LAST.verdict || ''}`, '',
    '| 題 | 得分 | 失分點 |', '|---|---|---|',
    ...(LAST.items || []).map((i) =>
      `| ${i.q} | ${i.awarded}/${i.max} | ${(i.lost || []).map((l) => `${l.point}：${l.reason}`).join('；') || '—'} |`),
    '', '## 弱項', ...(LAST.weak_topics || []).map((w) => `- ${w.topic}${w.code ? `（${w.code}）` : ''}：${w.evidence || ''}`),
    '', '## 下一步', ...(LAST.advice || []).map((a) => `- ${a}`)
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dse-chem-report.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 綁定 ---------- */
loadCfg();
loadKB();

$('#file').addEventListener('change', (e) => addFiles(e.target.files));
$('#drop').addEventListener('click', () => $('#file').click());
$('#drop').addEventListener('dragover', (e) => { e.preventDefault(); $('#drop').classList.add('over'); });
$('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('over'));
$('#drop').addEventListener('drop', (e) => {
  e.preventDefault(); $('#drop').classList.remove('over');
  addFiles(e.dataTransfer.files);
});
$('#go').addEventListener('click', grade);
$('#export').addEventListener('click', exportMd);
$('#reset').addEventListener('click', () => {
  PAGES = []; LAST = null; renderThumbs();
  $('#result').classList.add('hidden'); setStatus('');
});
['endpoint', 'model', 'apikey'].forEach((id) => $('#' + id).addEventListener('change', saveCfg));
