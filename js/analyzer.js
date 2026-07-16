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
    const prompt = `이 문서를 분석해 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만 출력:
{"docNo":"","date":"YYYY-MM-DD","delivery":"YYYY-MM-DD","ship":"","poNo":"","category":"cruise","isReturn":false,"items":[{"desc":"","code":"","qty":0,"unit":"pcs","price":0,"amount":0}],"total":0}
규칙:
- date/delivery=YYYY-MM-DD, category=cruise또는cargo
- isReturn: 문서가 반품서(RETURN, CREDIT NOTE, 반품, 수량/금액이 음수)이면 true, 일반 발주서이면 false
- 반품서인 경우 qty와 amount, total은 반드시 음수(-)로 표기
unit 선택 기준(중요):
- 수량 단위가 DOZ·DOZEN·다스 → unit="doz" (절대 cs/ctn으로 쓰지 말것)
- 수량 단위가 CS·CTN·BOX·CASE·박스 → unit="ctn"
- 수량 단위가 PCS·EA·낱개 → unit="pcs"
- 수량 단위가 PKT·PKG·BAG·SACHET·POUCH·봉지·봉·팩 → unit="pkt"
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
    // 반품서 판별: AI가 isReturn 반환 OR total이 음수 OR 모든 items qty가 음수
    const aiIsReturn  = !!parsed.isReturn;
    const totalNeg    = (parsed.total || 0) < 0;
    const allQtyNeg   = (parsed.items || []).length > 0 && (parsed.items || []).every(i => (i.qty || 0) < 0);
    const isReturnDoc = aiIsReturn || totalNeg || allQtyNeg;

    if (isReturnDoc) {
      // 반품서: 고유 id 부여 (원본 발주서와 분리), deliveryStatus='returned'로 저장
      parsed.id             = 'RET-' + (sanitizeId(parsed.docNo) || Date.now()) + '-' + Date.now();
      parsed.isReturn       = true;
      parsed.deliveryStatus = 'returned';
      parsed._retMig        = true;  // 생성 시점에 이미 올바른 상태이므로 이후 자동 보정 대상에서 제외
      // total/amount 음수 보정 (AI가 양수로 반환한 경우 강제 음수화)
      if ((parsed.total || 0) > 0) parsed.total = -Math.abs(parsed.total);
      (parsed.items || []).forEach(i => {
        if ((i.qty    || 0) > 0) i.qty    = -Math.abs(i.qty);
        if ((i.amount || 0) > 0) i.amount = -Math.abs(i.amount);
      });
      parsed.returnAmount = Math.abs(parsed.total);
    } else {
      parsed.id             = sanitizeId(parsed.docNo) || ('UP-' + Date.now());
      parsed.isReturn       = false;
      parsed.deliveryStatus = 'pending';
      parsed.returnAmount   = 0;
    }
    parsed.source        = 'upload';
    parsed.fileName      = file.name;
    parsed.category      = parsed.category || 'cargo';
    parsed.deliveredDate = '';
    parsed.updatedAt     = Date.now();
    // 선명 누락 플래그
    parsed._shipMissing  = !parsed.ship || !parsed.ship.trim();
    pendingOrders.push(parsed);

  } catch(e) {
    console.error('[analyzer] 분석 오류:', e);
    const msg = e.message === 'API_KEY_MISSING' ? '⚠️ API 키를 먼저 입력해주세요.' : '❌ ' + (e.message || '분석 실패');
    setStatus(msg);
    throw e;
  }
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
  document.getElementById('prev-cards').innerHTML = pendingOrders.map((o, idx) => {
    // 반품서는 중복 판별 대상에서 완전히 제외
    const isReturnDoc  = !!o.isReturn;
    const shipMissing  = !!o._shipMissing;
    const existing = isReturnDoc ? null : orders.find(x =>
      (o.docNo && x.docNo && x.docNo === o.docNo) ||
      (o.poNo  && x.poNo  && x.poNo  === o.poNo)  ||
      (!o.docNo && !o.poNo && x.ship === o.ship && x.date === o.date)
    );
    const isDup = !!existing;

    // 뱃지: 반품서 / 선명누락 / 중복 / 신규
    const statusBadgeHtml = isReturnDoc
      ? `<span class="badge b-returned" style="margin-left:4px;">↩️ 반품서</span>`
      : shipMissing
        ? `<span class="badge" style="background:#fee2e2;color:#991b1b;margin-left:4px;">⚠️ 선명 누락</span>`
        : isDup
          ? `<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:4px;">⚠️ 중복</span>`
          : `<span class="badge" style="background:#dcfce7;color:#15803d;margin-left:4px;">신규</span>`;

    // 카드 테두리: 반품서=빨강, 선명누락=주황-빨강, 중복=노랑, 신규=기본
    const cardStyle = isReturnDoc
      ? 'border:2px solid #dc2626;background:#fff5f5;'
      : shipMissing
        ? 'border:2px solid #f97316;background:#fff7ed;'
        : isDup
          ? 'border:2px solid #f59e0b;background:#fffbeb;'
          : '';

    // 안내 메시지
    const infoMsg = isReturnDoc
      ? `<div style="font-size:11px;color:#991b1b;background:#fee2e2;border-radius:6px;padding:5px 8px;grid-column:1/-1;">↩️ 반품서로 인식되었습니다. 기존 발주서는 유지되고 반품 내역으로 별도 추가됩니다.</div>`
      : shipMissing
        ? `<div style="font-size:11px;color:#9a3412;background:#ffedd5;border-radius:6px;padding:5px 8px;grid-column:1/-1;">⚠️ AI가 선명을 인식하지 못했습니다. 저장 전 선명을 직접 확인하거나 수정 후 저장하세요.</div>`
        : isDup
          ? `<div style="font-size:11px;color:#92400e;background:#fde68a;border-radius:6px;padding:5px 8px;grid-column:1/-1;">⚠️ 이미 등록된 발주서입니다. 제거하거나 저장 시 기존 데이터를 덮어씁니다.</div>`
          : '';

    const totalStyle = isReturnDoc ? 'color:#dc2626;font-weight:700;' : '';
    // 선명 입력창 — 선명 누락/오인식 시 이 자리에서 바로 수정 후 전체 저장 가능
    const shipInputHtml = `<input type="text" class="prev-ship" id="pship-${idx}"
      value="${escapeHtml(o.ship || '')}" placeholder="선명 입력" enterkeyhint="done"
      onchange="updatePendingShip(${idx}, this.value)"
      style="border:${shipMissing ? '1.5px solid #f97316' : '1px solid transparent'};
             border-radius:6px;padding:2px 6px;margin:-2px -6px;min-width:0;
             background:${shipMissing ? '#fff7ed' : 'transparent'};
             color:${shipMissing ? '#f97316' : 'inherit'};
             font-family:inherit;
             font-style:${shipMissing ? 'italic' : 'normal'};">`;

    return `
    <div class="prev-card" id="pcard-${idx}" style="${cardStyle}">
      <div class="prev-head">
        ${shipInputHtml}
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${badge(o.category)}${statusBadgeHtml}
          <button onclick="removePending(${idx})" style="background:#fee2e2;border:none;border-radius:6px;color:#dc2626;font-size:12px;font-weight:700;padding:3px 8px;cursor:pointer;flex-shrink:0;">✕ 제거</button>
        </div>
      </div>
      <div class="prev-meta">
        <div><span class="pm-label">서류번호</span>${escapeHtml(o.docNo) || '-'}</div>
        <div><span class="pm-label">발주일자</span>${escapeHtml(o.date) || '-'}</div>
        <div><span class="pm-label">납기일자</span>${escapeHtml(o.delivery) || '-'}</div>
        <div><span class="pm-label">총액</span><strong style="${totalStyle}">${fmt(o.total)}</strong></div>
        ${infoMsg}
      </div>
      <table class="prev-table">
        <thead><tr><th>품목</th><th>수량</th><th>박스</th><th>단가</th><th>금액</th></tr></thead>
        <tbody>
          ${(o.items || []).map(i => {
            const boxWarn = _boxRatioWarning(i);
            return `<tr>
            <td>${escapeHtml(i.desc) || '-'}</td>
            <td style="font-family:monospace;${(i.qty||0)<0?'color:#dc2626;':''}">${fmtQ(i)}</td>
            <td style="font-family:monospace;${(i.qty||0)<0?'color:#dc2626;':''}${boxWarn ? 'color:#c2410c;font-weight:700;background:#fff7ed;' : ''}"${boxWarn ? ` title="${escapeHtml(boxWarn)}"` : ''}>${formatBoxCount(calcItemBoxCount(i))}${boxWarn ? ' ⚠️' : ''}</td>
            <td style="font-family:monospace;">${i.price ? '\u20a9' + Number(i.price).toLocaleString() : '-'}</td>
            <td style="font-family:monospace;font-weight:700;${(i.amount||0)<0?'color:#dc2626;':''}">${i.amount ? '\u20a9' + Number(i.amount).toLocaleString() : '-'}</td>
          </tr>${boxWarn ? `<tr><td colspan="5" style="font-size:10px;color:#9a3412;background:#ffedd5;padding:5px 8px;">${escapeHtml(boxWarn)}</td></tr>` : ''}`;
          }).join('')}
          <tr class="total-row">
            <td colspan="3">TOTAL</td>
            <td colspan="2" style="${isReturnDoc?'color:#dc2626;':''}">${fmt(o.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }).join('');

  // 상태 메시지 — 선명누락 / 중복 / 반품서 건수 표시
  const shipMissingCnt = pendingOrders.filter(o => o._shipMissing).length;
  const dupCnt = pendingOrders.filter(o =>
    !o.isReturn &&
    orders.find(x =>
      (o.docNo && x.docNo && x.docNo === o.docNo) ||
      (o.poNo  && x.poNo  && x.poNo  === o.poNo)  ||
      (!o.docNo && !o.poNo && x.ship === o.ship && x.date === o.date)
    )
  ).length;
  const retCnt = pendingOrders.filter(o => o.isReturn).length;
  const parts  = [];
  if (shipMissingCnt > 0) parts.push(`🚢 선명 누락 ${shipMissingCnt}건`);
  if (dupCnt > 0)         parts.push(`⚠️ 중복 ${dupCnt}건`);
  if (retCnt > 0)         parts.push(`↩️ 반품서 ${retCnt}건`);
  if (parts.length > 0) {
    setStatus(`📋 ${pendingOrders.length}건 확인 중 — ${parts.join(' · ')}. 확인 후 저장하세요.`);
  } else {
    setStatus(`✅ ${pendingOrders.length}건 분석 완료. 확인 후 저장하세요.`);
  }
}

// 미리보기 카드에서 선명을 직접 입력/수정했을 때 반영 (AI가 선명을 인식 못한 경우 등)
function updatePendingShip(idx, val) {
  if (!pendingOrders[idx]) return;
  const trimmed = String(val || '').trim();
  pendingOrders[idx].ship = trimmed;
  pendingOrders[idx]._shipMissing = !trimmed;
  renderPreview();
}

function removePending(idx) {
  pendingOrders.splice(idx, 1);
  if (pendingOrders.length === 0) {
    document.getElementById('prev-section').style.display = 'none';
    setStatus('분석 결과가 없습니다. 파일을 다시 업로드해주세요.');
  } else {
    renderPreview();
    setStatus(`📋 ${pendingOrders.length}건 확인 중. 확인 후 저장하세요.`);
  }
}

function saveAll() {
  let added = 0, updated = 0, returnAdded = 0;
  pendingOrders.forEach(newOrder => {
    // 반품서: 항상 신규 추가 (기존 발주서 덮어쓰기 금지)
    if (newOrder.isReturn) {
      orders.push({ ...newOrder, updatedAt: Date.now() });
      returnAdded++;
      return;
    }
    // 일반 발주서: docNo 일치 시 업데이트
    const docNo = (newOrder.docNo || '').trim();
    if (docNo) {
      const idx = orders.findIndex(x => !x.isReturn && (x.docNo || '').trim() === docNo);
      if (idx !== -1) {
        const prev = orders[idx];
        orders[idx] = {
          ...newOrder,
          deliveryStatus: prev.deliveryStatus,
          deliveryNote:   prev.deliveryNote,
          returnAmount:   prev.returnAmount,
          partialAmount:  prev.partialAmount,
          deliveredDate:  prev.deliveredDate,   // 재분석으로 납품일자가 초기화되는 것 방지
          archived:       prev.archived,        // 재분석으로 보관 상태가 풀리는 것 방지
          updatedAt:      Date.now()
        };
        updated++; return;
      }
    }
    if (!orders.find(x => x.id === newOrder.id)) { orders.push({ ...newOrder, updatedAt: Date.now() }); added++; }
  });
  save();
  clearPrev();
  const msg = [
    added       ? `✅ ${added}건 신규 추가`    : '',
    updated     ? `🔄 ${updated}건 업데이트`   : '',
    returnAdded ? `↩️ ${returnAdded}건 반품 등록` : '',
  ].filter(Boolean).join(' · ');
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
