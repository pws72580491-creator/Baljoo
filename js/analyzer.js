// ══════════════════════════════════════════════════════
// analyzer.js  —  발주서 파일 업로드 · AI 자동 분석
// ══════════════════════════════════════════════════════

let pendingOrders = [];
const PDF_MAX_PAGES = 5;
const IMAGE_MAX_PX  = 1024;   // 리사이즈 한계 (px) — 발주서는 1024로 충분
const IMAGE_QUALITY = 0.75;   // JPEG 품질 — 속도 우선

function onDrag(e, on) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.toggle('drag', on);
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag');
  handleFiles(e.dataTransfer.files);
}

async function handleFiles(files) {
  if (!files.length) return;
  if (!getGeminiKey()) { setStatus('⚠️ API 키를 먼저 입력해주세요.'); return; }
  pendingOrders = [];
  document.getElementById('prev-section').style.display = 'none';
  document.getElementById('prev-cards').innerHTML       = '';
  document.getElementById('progWrap').style.display     = 'block';
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

  // 백그라운드 처리 유지 시작 (화면 꺼짐·앱 전환 대응)
  await BG.start();

  const failedFiles = [];
  for (let i = 0; i < all.length; i++) {
    setProgress(Math.round(((i + 0.5) / all.length) * 100));
    setStatus(`분석 중 ${i + 1}/${all.length}: ${all[i].name} (백그라운드 처리 중)`);
    try { await analyzeFile(all[i]); }
    catch(e) {
      console.warn('[handleFiles] 파일 실패, 다음 파일로 계속:', all[i].name, e.message);
      failedFiles.push(all[i].name);
    }
  }

  await BG.end();

  setProgress(100);
  if (pendingOrders.length > 0) {
    renderPreview();
    document.getElementById('prev-section').style.display = 'block';
    const failMsg = failedFiles.length ? ` (실패 ${failedFiles.length}건: ${failedFiles.join(', ')})` : '';
    setStatus(`✅ ${pendingOrders.length}건 분석 완료. 확인 후 저장하세요.${failMsg}`);
  } else {
    setStatus('❌ 발주서 데이터를 찾지 못했습니다. API 키와 파일 형식을 확인하세요.');
  }
}

async function analyzeFile(file) {
  try {
    const prompt = `이 발주서를 분석해 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만 출력:
{"docNo":"","date":"YYYY-MM-DD","delivery":"YYYY-MM-DD","ship":"","poNo":"","category":"cruise","items":[{"desc":"","code":"","qty":0,"unit":"pcs","price":0,"amount":0}],"total":0}
규칙: date/delivery=YYYY-MM-DD, category=cruise또는cargo
unit 선택 기준(중요):
- 수량 단위가 DOZ·DOZEN·다스 → unit="doz" (절대 cs/ctn으로 쓰지 말것)
- 수량 단위가 CS·CTN·BOX·CASE·박스 → unit="ctn"
- 수량 단위가 PCS·EA·낱개 → unit="pcs"
- 그 외: kg/l/btl 중 해당하는 것`;

    const parts = [textPart(prompt)];
    if (file.type === 'application/pdf') {
      const pages = await pdfToImages(file);
      pages.forEach(dataUrl => parts.push(imagePart(dataUrl)));
    } else {
      // 이미지 리사이즈 후 전송 (대용량 오류 방지)
      const dataUrl = await resizeImage(file, IMAGE_MAX_PX, IMAGE_QUALITY);
      parts.push(imagePart(dataUrl));
    }

    let txt = await callGemini(parts, 4000);

    // 코드블록 제거 후 { } 범위만 추출
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);

    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (parseErr) {
      // JSON이 잘린 경우 복구 시도
      try {
        let fixed = txt;
        // 열린 배열/객체 닫기
        const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
        const openb = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
        // 마지막 불완전한 항목 제거 (쉼표로 끝나는 경우)
        fixed = fixed.replace(/,\s*$/, '');
        for (let i = 0; i < opens; i++) fixed += ']';
        for (let i = 0; i < openb; i++) fixed += '}';
        parsed = JSON.parse(fixed);
        console.warn('[analyzer] JSON 복구 성공');
      } catch (e2) {
        console.warn('[analyzer] JSON 파싱 실패:', parseErr.message, '\n원본:', txt);
        throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요. (' + parseErr.message + ')');
      }
    }
    parsed.id           = parsed.docNo || ('UP-' + Date.now());
    parsed.source       = 'upload';
    parsed.fileName     = file.name;
    parsed.category     = parsed.category || 'cargo';
    parsed.deliveryStatus = 'pending';
    parsed.returnAmount = 0;
    parsed.deliveredDate = '';
    parsed.updatedAt    = Date.now();
    pendingOrders.push(parsed);

  } catch(e) {
    console.error('[analyzer] 분석 오류:', e);
    const msg = e.message === 'API_KEY_MISSING' ? '⚠️ API 키를 먼저 입력해주세요.' : '❌ ' + (e.message || '분석 실패');
    setStatus(msg);
    throw e;
  }
}

function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('read fail'));
    r.readAsDataURL(file);
  });
}

// ── 이미지 리사이즈 (Canvas 활용, 대용량 이미지 → API 오류 방지) ──
function resizeImage(file, maxPx, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w <= maxPx && h <= maxPx) {
        // 리사이즈 불필요 → 원본 base64 그대로
        const r = new FileReader();
        r.onload  = () => res(r.result);
        r.onerror = () => rej(new Error('read fail'));
        r.readAsDataURL(file);
        return;
      }
      const ratio = Math.min(maxPx / w, maxPx / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      res(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

async function pdfToImages(file) {
  if (!window.pdfjsLib) throw new Error('PDF 렌더링 라이브러리 로드 실패');
  const buf    = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buf }).promise;
  const n      = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const images = [];
  for (let i = 1; i <= n; i++) {
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.8 });
    // 최대 크기 제한 (API 오류 방지)
    const scale    = Math.min(1.2, IMAGE_MAX_PX / Math.max(viewport.width, viewport.height));
    const vp2      = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = vp2.width;
    canvas.height  = vp2.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp2 }).promise;
    images.push(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
  }
  return images;
}

function renderPreview() {
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

function saveAll() {
  let added = 0, updated = 0;
  pendingOrders.forEach(newOrder => {
    const docNo = (newOrder.docNo || '').trim();
    if (docNo) {
      const idx = orders.findIndex(x => (x.docNo || '').trim() === docNo);
      if (idx !== -1) {
        const prev = orders[idx];
        orders[idx] = { ...newOrder, deliveryStatus: prev.deliveryStatus, deliveryNote: prev.deliveryNote, returnAmount: prev.returnAmount, partialAmount: prev.partialAmount, updatedAt: Date.now() };
        updated++; return;
      }
    }
    if (!orders.find(x => x.id === newOrder.id)) { orders.push({ ...newOrder, updatedAt: Date.now() }); added++; }
  });
  save();
  clearPrev();
  const msg = [added ? `✅ ${added}건 신규 추가` : '', updated ? `🔄 ${updated}건 업데이트` : ''].filter(Boolean).join(' · ');
  toast(msg || '저장 완료');
  renderAll();
  setStatus('✅ 저장 완료. 다음 발주서를 등록해주세요.');
}

function clearPrev() {
  pendingOrders = [];
  document.getElementById('prev-section').style.display = 'none';
  document.getElementById('progWrap').style.display     = 'none';
  setStatus('');
  const input = document.getElementById('fileInput');
  if (input) input.value = '';  // 같은 파일 재선택 가능하도록 초기화
}

function setProgress(p) { document.getElementById('progBar').style.width = p + '%'; }
function setStatus(m)   { document.getElementById('upStatus').textContent = m; }
