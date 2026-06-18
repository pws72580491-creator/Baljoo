// ══════════════════════════════════════════════════════
// delivery.js  —  납품 리스트 사진 AI 자동 매칭
// ══════════════════════════════════════════════════════

function onDragDelivery(e, on) {
  e.preventDefault();
  document.getElementById('deliveryZone').classList.toggle('drag', on);
}
function onDropDelivery(e) {
  e.preventDefault();
  document.getElementById('deliveryZone').classList.remove('drag');
  handleDeliveryFiles(e.dataTransfer.files);
}

function setDelStatus(m)   { document.getElementById('delStatus').textContent = m; }
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function setDelProgress(p) { document.getElementById('delProgBar').style.width = p + '%'; }

async function handleDeliveryFiles(files) {
  if (!files.length) return;
  if (!getGeminiKey()) { toast('⚠️ API 키를 먼저 입력해주세요'); return; }
  if (!orders.length)  { toast('⚠️ 등록된 발주 내역이 없습니다'); return; }

  document.getElementById('delProgWrap').style.display        = 'block';
  document.getElementById('del-result-section').style.display = 'none';
  setDelStatus('납품 리스트 분석 중...');
  setDelProgress(20);

  try {
    const parts = [];
    for (const f of files) {
      if (f.type === 'application/pdf') {
        const pages = await pdfToImages(f);
        pages.forEach(dataUrl => parts.push(imagePart(dataUrl)));
      } else {
        // 리사이즈 적용
        const dataUrl = await resizeImage(f, IMAGE_MAX_PX, IMAGE_QUALITY);
        parts.push(imagePart(dataUrl));
      }
    }
    setDelProgress(50);

    const orderSummary = orders
      .filter(o => o.deliveryStatus !== 'delivered')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))  // 최근 날짜 우선
      .slice(0, 60)  // 40 → 60건으로 확대
      .map(o => `${o.id}|${o.ship}|${o.docNo||''}|${o.poNo||''}|${o.date||''}`)
      .join('\n');

    const prompt = `납품 확인서/리스트 이미지입니다. "이른아침" 업체 항목만 추출하세요.

발주목록(ID|선명|서류번호|발주번호|날짜):
${orderSummary}

이미지의 이른아침 항목과 위 발주목록을 매칭해 아래 JSON만 출력(코드블록 없이):
{"matched":[{"id":"발주ID","ship":"선명","reason":"근거"}],"summary":"요약"}
이른아침 항목 없으면: {"matched":[],"summary":"이른아침 항목 없음"}`;

    parts.unshift(textPart(prompt));
    setDelProgress(70);

    let txt = await callGemini(parts, 4000);

    // 1단계: 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // 2단계: { } 범위만 추출
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);

    console.log('[delivery] Gemini 원본 응답:', txt); // 디버그용

    let result;
    try {
      result = JSON.parse(txt);
    } catch (parseErr) {
      console.warn('[delivery] JSON 파싱 실패, 복구 시도:', parseErr.message, '\n원본:', txt);
      // JSON 잘린 경우 복구 시도
      try {
        let fixed = txt.replace(/,\s*$/, '');  // 끝 쉼표 제거
        const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
        const openb = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
        // 마지막 불완전한 객체 제거 (쉼표+불완전 객체로 끝나는 경우)
        fixed = fixed.replace(/,\s*\{[^}]*$/, '');
        for (let i = 0; i < opens; i++) fixed += ']';
        for (let i = 0; i < openb; i++) fixed += '}';
        result = JSON.parse(fixed);
        console.warn('[delivery] JSON 복구 성공, matched:', result.matched?.length);
      } catch (e2) {
        console.warn('[delivery] JSON 복구도 실패:', e2.message);
        result = { matched: [], summary: `AI 응답 파싱 오류 — 다시 시도해주세요. (${parseErr.message})` };
      }
    }

    setDelProgress(90);
    renderDeliveryResult(result);
    setDelProgress(100);
    setDelStatus(`✅ 분석 완료 — ${result.matched?.length || 0}건 매칭됨`);
    const delInput = document.getElementById('deliveryInput');
    if (delInput) delInput.value = '';  // 같은 파일 재선택 가능하도록 초기화

  } catch(err) {
    console.error('[delivery] 오류:', err);
    const msg = err.message === 'API_KEY_MISSING' ? '⚠️ API 키를 먼저 입력해주세요.' : '❌ ' + (err.message || '분석 실패');
    setDelStatus(msg);
    setDelProgress(0);
    document.getElementById('delProgWrap').style.display = 'none';
  }
}

let _lastMatchedIds = [];  // onclick 속성 따옴표 충돌 방지용 보관소

function renderDeliveryResult(result) {
  const matched   = result.matched   || [];
  const unmatched = result.unmatched || [];
  const sec       = document.getElementById('del-result-section');
  sec.style.display = 'block';
  _lastMatchedIds = matched.map(m => m.id);

  const matchedOrders = matched.map(m => {
    const order = orders.find(o => o.id === m.id);
    return order ? { ...m, order } : null;
  }).filter(Boolean);

  sec.innerHTML = `
    ${result.summary ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;padding:8px 10px;background:var(--bg);border-radius:8px;">📋 ${result.summary}</div>` : ''}
    ${matchedOrders.length ? `
      <div class="sdiv" style="margin-top:0;">이른아침 매칭된 발주 (${matchedOrders.length}건)</div>
      ${matchedOrders.map(m => `
        <div class="prev-card" style="border-left:3px solid var(--success);">
          <div class="prev-head" style="gap:6px;">
            <div style="flex:1;">
              <div class="prev-ship" style="font-size:13px;">${m.order.ship}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:2px;">${m.reason}</div>
            </div>
            <span class="badge" style="background:#dcfce7;color:#15803d;">${m.order.deliveryStatus === 'delivered' ? '✅ 이미 납품완료' : '미납품'}</span>
          </div>
          <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:12px;color:var(--muted);">${m.order.docNo || '-'} · ${m.order.date} · ${fmt(m.order.total)}</div>
            ${m.order.deliveryStatus !== 'delivered' ? `
              <button class="btn btn-success btn-sm" data-confirm-id="${escAttr(m.order.id)}" onclick="confirmDeliveryFromPhoto(this.dataset.confirmId)">✅ 납품완료 처리</button>
            ` : `<span style="font-size:11px;color:var(--success);font-weight:700;">납품완료</span>`}
          </div>
        </div>
      `).join('')}
      ${matchedOrders.some(m => m.order.deliveryStatus !== 'delivered') ? `
        <button class="btn btn-success btn-block" style="margin-top:4px;"
          onclick="confirmAllDelivery(_lastMatchedIds)">
          ✅ 매칭된 전체 납품완료 처리
        </button>
      ` : ''}
    ` : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px 0;">이른아침 항목이 없거나 발주 목록과 일치하는 항목을 찾지 못했습니다</div>'}
    ${result.skipped_other_vendors ? `<div style="font-size:11px;color:var(--muted);padding:4px 0;">ℹ️ 타 업체 항목은 자동으로 제외되었습니다</div>` : ''}
    ${unmatched.length ? `
      <div class="sdiv">목록 미매칭 항목</div>
      ${unmatched.map(u => `<div style="font-size:12px;color:var(--muted);padding:4px 0;">• ${u}</div>`).join('')}
    ` : ''}
  `;
}

function confirmDeliveryFromPhoto(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  o.deliveryStatus = 'delivered';
  o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
  save(); renderAll();
  document.querySelectorAll(`button[data-confirm-id="${CSS.escape(id)}"]`).forEach(btn => {
    btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
  });
  toast(`✅ ${o.ship} 납품완료 처리됨`);
  maybeResetDeliveryResult();
}

function confirmAllDelivery(ids) {
  let cnt = 0;
  ids.forEach(id => {
    const o = orders.find(x => x.id === id);
    if (o && o.deliveryStatus !== 'delivered') {
      o.deliveryStatus = 'delivered';
      o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
      cnt++;
    }
  });
  save(); renderAll();
  document.getElementById('del-result-section')?.querySelectorAll('.btn-success').forEach(btn => {
    btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
  });
  toast(`✅ ${cnt}건 납품완료 처리됨`);
  resetDeliveryZone();
}

// 매칭된 항목이 모두 처리되면 자동으로 업로드 준비 상태로 초기화
function maybeResetDeliveryResult() {
  const remaining = document.querySelectorAll('#del-result-section .btn-success:not([disabled])');
  if (remaining.length === 0) resetDeliveryZone();
}

// 납품 매칭 영역을 다음 사진 업로드를 위한 초기 상태로 리셋
function resetDeliveryZone() {
  setTimeout(() => {
    document.getElementById('del-result-section').style.display = 'none';
    document.getElementById('del-result-section').innerHTML     = '';
    document.getElementById('delProgWrap').style.display        = 'none';
    setDelStatus('');
    setDelProgress(0);
    const delInput = document.getElementById('deliveryInput');
    if (delInput) delInput.value = '';
  }, 900);
}
