// ══════════════════════════════════════════════════════
// analyzer.js  —  발주서 파일 업로드 · AI 자동 분석
// ══════════════════════════════════════════════════════

let pendingOrders = [];
const PDF_MAX_PAGES = 5;

// ── 드래그 앤 드롭 ──
function onDrag(e, on) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.toggle('drag', on);
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag');
  handleFiles(e.dataTransfer.files);
}

// ── 파일 처리 진입점 ──
async function handleFiles(files) {
  if (!files.length) return;
  pendingOrders = [];
  document.getElementById('prev-section').style.display  = 'none';
  document.getElementById('prev-cards').innerHTML        = '';
  document.getElementById('progWrap').style.display      = 'block';
  setStatus('파일 분석 중...');

  const all = [];
  for (const f of files) {
    if (f.name.endsWith('.zip')) {
      setStatus('ZIP 압축 해제 중...');
      const zip = await JSZip.loadAsync(f);
      for (const [n, e] of Object.entries(zip.files)) {
        if (!e.dir && (n.endsWith('.pdf') || /\.(jpg|jpeg|png|webp)$/i.test(n))) {
          const blob = await e.async('blob');
          all.push(new File([blob], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }));
        }
      }
    } else {
      all.push(f);
    }
  }

  for (let i = 0; i < all.length; i++) {
    setProgress(Math.round(((i + 0.5) / all.length) * 100));
    setStatus(`분석 중 ${i + 1}/${all.length}: ${all[i].name}`);
    try { await analyzeFile(all[i]); }
    catch(e) { setProgress(100); return; }
  }

  setProgress(100);
  if (pendingOrders.length > 0) {
    renderPreview();
    document.getElementById('prev-section').style.display = 'block';
    setStatus(`✅ ${pendingOrders.length}건 분석 완료. 확인 후 저장하세요.`);
  } else {
    setStatus('❌ 발주서 데이터를 찾지 못했습니다. API 키와 파일 형식을 확인하세요.');
  }
}

// ── AI 분석 (단일 파일) ──
async function analyzeFile(file) {
  const apiKey = (document.getElementById('geminiKey').value || '').trim();
  if (!apiKey) { setStatus('⚠️ OpenRouter API Key를 입력해주세요.'); throw new Error('no key'); }

  try {
    const isPdf  = file.type === 'application/pdf';
    const prompt = `이 발주서 문서를 분석해 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만:
{"docNo":"","date":"YYYY-MM-DD","delivery":"YYYY-MM-DD","ship":"","poNo":"","category":"cruise or cargo","items":[{"desc":"","code":"","qty":0,"unit":"","price":0,"amount":0}],"total":0}
규칙: date/delivery는 YYYY-MM-DD, category는 크루즈면 cruise 화물이면 cargo, 모르면 빈값`;

    const content = [{ type: 'text', text: prompt }];
    if (isPdf) {
      const pages = await pdfToImages(file);
      pages.forEach(dataUrl => { content.push({ type: 'image_url', image_url: { url: dataUrl } }); });
    } else {
      const b64 = await toB64(file);
      content.push({ type: 'image_url', image_url: { url: `data:${file.type || 'image/jpeg'};base64,${b64}` } });
    }

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash:free', messages: [{ role: 'user', content }], temperature: 0, max_tokens: 1000 })
    });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(`[${resp.status}] ${err?.error?.message || resp.statusText}`); }
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'API 오류');

    let txt = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    if (!txt) throw new Error('AI 응답 없음');
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);

    const parsed = JSON.parse(txt);
    parsed.id             = parsed.docNo || ('UP-' + Date.now());
    parsed.source         = 'upload';
    parsed.fileName       = file.name;
    parsed.category       = parsed.category || 'cargo';
    parsed.deliveryStatus = 'pending';
    parsed.returnAmount   = 0;
    parsed.updatedAt      = Date.now();   // 최신 데이터 판별용 타임스탬프
    pendingOrders.push(parsed);
  } catch(e) {
    console.error('[analyzer] 분석 오류:', e);
    setStatus('❌ ' + (e.message || '분석 실패'));
    throw e;
  }
}

// ── 파일 → Base64 ──
function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('read fail'));
    r.readAsDataURL(file);
  });
}

// ── PDF → 이미지 배열 ──
async function pdfToImages(file) {
  if (!window.pdfjsLib) throw new Error('PDF 렌더링 라이브러리 로드 실패');
  const buf    = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buf }).promise;
  const n      = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const images = [];
  for (let i = 1; i <= n; i++) {
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return images;
}

// ── 분석 결과 미리보기 ──
function renderPreview() {
  // 중복 여부 미리 표시
  document.getElementById('prev-cards').innerHTML = pendingOrders.map(o => {
    const existing = orders.find(x => x.docNo && x.docNo === o.docNo);
    const dupBadge = existing
      ? `<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:4px;">⚠️ 중복</span>`
      : `<span class="badge" style="background:#dcfce7;color:#15803d;margin-left:4px;">신규</span>`;
    return `
    <div class="prev-card">
      <div class="prev-head">
        <div class="prev-ship">${o.ship || '선명 미확인'}</div>
        ${badge(o.category)}${dupBadge}
      </div>
      <div class="prev-meta">
        <div><span class="pm-label">서류번호</span>${o.docNo || '-'}</div>
        <div><span class="pm-label">발주일자</span>${o.date || '-'}</div>
        <div><span class="pm-label">납기일자</span>${o.delivery || '-'}</div>
        <div><span class="pm-label">총액</span><strong>${fmt(o.total)}</strong></div>
        ${existing ? `<div style="font-size:11px;color:#92400e;grid-column:1/-1;">기존 데이터를 최신 내용으로 업데이트합니다</div>` : ''}
      </div>
      <table class="prev-table">
        <thead><tr><th>품목</th><th>수량</th><th>박스</th><th>단가</th><th>금액</th></tr></thead>
        <tbody>
          ${(o.items || []).map(i => `<tr>
            <td>${i.desc || '-'}</td>
            <td style="font-family:monospace;">${fmtQ(i)}</td>
            <td style="font-family:monospace;">${formatBoxCount(calcItemBoxCount(i))}</td>
            <td style="font-family:monospace;">${i.price ? '₩' + Number(i.price).toLocaleString() : '-'}</td>
            <td style="font-family:monospace;font-weight:700;">${i.amount ? '₩' + Number(i.amount).toLocaleString() : '-'}</td>
          </tr>`).join('')}
          <tr class="total-row">
            <td colspan="2">TOTAL</td>
            <td>${formatBoxCount(calcOrderBoxes(o))}</td>
            <td colspan="2">${fmt(o.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }).join('');
}

// ── 저장 (서류번호 기준 중복 처리: 최신 우선 업데이트) ──
function saveAll() {
  let added = 0, updated = 0;

  pendingOrders.forEach(newOrder => {
    const docNo = (newOrder.docNo || '').trim();

    if (docNo) {
      // 서류번호가 있으면 기존 항목 탐색
      const idx = orders.findIndex(x => (x.docNo || '').trim() === docNo);
      if (idx !== -1) {
        // 기존 납품 상태 보존, 나머지는 최신 데이터로 업데이트
        const prevStatus = orders[idx].deliveryStatus;
        const prevNote   = orders[idx].deliveryNote;
        const prevReturn = orders[idx].returnAmount;
        const prevPartial= orders[idx].partialAmount;
        orders[idx] = {
          ...newOrder,
          deliveryStatus: prevStatus,
          deliveryNote:   prevNote,
          returnAmount:   prevReturn,
          partialAmount:  prevPartial,
          updatedAt:      Date.now()
        };
        updated++;
        return;
      }
    }

    // 서류번호 없거나 신규 — id 기준 중복 체크 후 추가
    if (!orders.find(x => x.id === newOrder.id)) {
      orders.push({ ...newOrder, updatedAt: Date.now() });
      added++;
    }
  });

  save();
  clearPrev();

  const msg = [
    added   ? `✅ ${added}건 신규 추가` : '',
    updated ? `🔄 ${updated}건 업데이트` : ''
  ].filter(Boolean).join(' · ');
  toast(msg || '저장 완료');
  setTimeout(() => goTo(1), 700);
}

function clearPrev() {
  pendingOrders = [];
  document.getElementById('prev-section').style.display = 'none';
  document.getElementById('progWrap').style.display     = 'none';
  setStatus('');
}

function setProgress(p) { document.getElementById('progBar').style.width = p + '%'; }
function setStatus(m)   { document.getElementById('upStatus').textContent = m; }

// ── API Key 관리 ──
function saveApiKey() {
  const val = (document.getElementById('geminiKey').value || '').trim();
  if (!val) { toast('⚠️ 키를 입력해주세요'); return; }
  try { localStorage.setItem('openrouterApiKey', val); } catch(e) {}
  toast('✅ API 키 저장 완료');
}

function loadApiKey() {
  try {
    let k = localStorage.getItem('openrouterApiKey');
    if (!k) {
      const old = localStorage.getItem('geminiApiKey');
      if (old) { k = old; localStorage.setItem('openrouterApiKey', old); }
    }
    if (k) document.getElementById('geminiKey').value = k;
  } catch(e) {}
}

function toggleKeyVisibility() {
  const el = document.getElementById('geminiKey');
  el.type  = el.type === 'password' ? 'text' : 'password';
}

function resetApiKey() {
  if (!confirm('등록된 API 키를 삭제할까요?')) return;
  try {
    localStorage.removeItem('openrouterApiKey');
    localStorage.removeItem('geminiApiKey');
  } catch(e) {}
  const el = document.getElementById('geminiKey');
  el.value = '';
  el.type  = 'password';
  toast('🗑️ API 키 초기화 완료');
}
