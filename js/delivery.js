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
function setDelProgress(p) { document.getElementById('delProgBar').style.width = p + '%'; }

async function handleDeliveryFiles(files) {
  if (!files.length) return;
  if (!getGeminiKey()) { toast('⚠️ API 키를 먼저 입력해주세요'); return; }
  if (!orders.length)  { toast('⚠️ 등록된 발주 내역이 없습니다'); return; }

  document.getElementById('delProgWrap').style.display        = 'block';
  document.getElementById('del-result-section').style.display = 'none';
  setDelStatus('납품 리스트 분석 중...');
  setDelProgress(20);

  // 백그라운드 처리 유지 시작
  await BG.start();

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
      .filter(o => !['delivered', 'cancelled', 'returned'].includes(o.deliveryStatus))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))  // 최근 날짜 우선
      .slice(0, 60)  // 40 → 60건으로 확대
      .map(o => `${o.id}|${o.ship}|${o.docNo||''}|${o.poNo||''}|${o.date||''}`)
      .join('\n');

    const prompt = `납품 확인서/리스트 이미지입니다. "이른아침" 업체 항목만 추출하세요.

발주목록(ID|선명|서류번호|발주번호|날짜):
${orderSummary}

이미지에서 "이른아침" 항목(선명/척수)을 모두 세고, 위 발주목록과 매칭해 아래 JSON만 출력(코드블록 없이):
{"totalCount":이미지속이른아침전체항목수(숫자),"matched":[{"id":"발주ID","ship":"선명","reason":"근거"}],"summary":"요약"}
이른아침 항목 없으면: {"totalCount":0,"matched":[],"summary":"이른아침 항목 없음"}`;

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
    const totalCnt = result.totalCount ?? result.matched?.length ?? 0;
    const matchedCnt = result.matched?.length || 0;
    setDelStatus(`✅ 분석 완료 — 전체 ${totalCnt}척 중 ${matchedCnt}척 매칭됨`);
    const delInput = document.getElementById('deliveryInput');
    if (delInput) delInput.value = '';  // 같은 파일 재선택 가능하도록 초기화
    await BG.end();

  } catch(err) {
    await BG.end();
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

  // v3.3.14: analyzer.js의 전역 pendingOrders(업로드 미리보기 큐)와 이름이 겹쳐 헷갈리기 쉬웠던
  // 지역변수 이름을 정리 (동작에는 영향 없던 단순 네이밍 충돌).
  const undeliveredMatches = matchedOrders.filter(m => !['delivered', 'cancelled', 'returned'].includes(m.order.deliveryStatus));
  const totalCnt = result.totalCount ?? matched.length;
  const todayVal = todayStr();

  sec.innerHTML = `
    <!-- 매칭 요약 배너 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:10px 12px;
                background:${matched.length < totalCnt ? '#fffbeb' : '#f0fdf4'};border-radius:8px;">
      <span style="font-size:13px;font-weight:700;color:${matched.length < totalCnt ? '#b45309' : 'var(--success)'};">
        📦 전체 ${totalCnt}척 중 ${matched.length}척 매칭
      </span>
      ${matched.length < totalCnt ? `<span style="font-size:11px;color:#b45309;">미매칭 ${totalCnt - matched.length}척</span>` : ''}
    </div>
    ${result.summary ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;padding:8px 10px;background:var(--bg);border-radius:8px;">📋 ${escapeHtml(result.summary)}</div>` : ''}

    ${matchedOrders.length ? `
      <div class="sdiv" style="margin-top:0;">이른아침 매칭된 발주 (${matchedOrders.length}건)</div>

      <!-- 전체선택 + 선택 카운트 -->
      ${undeliveredMatches.length ? `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;
                  padding:8px 12px;background:#f8fafc;border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--navy);">
          <input type="checkbox" id="del-select-all" onchange="delToggleAll(this.checked)"
                 style="width:18px;height:18px;accent-color:var(--navy);">
          전체 선택
        </label>
        <span id="del-selected-count" style="font-size:12px;color:var(--muted);">0건 선택</span>
      </div>` : ''}

      <!-- 매칭된 발주 목록 (체크박스) -->
      ${matchedOrders.map(m => `
        <div class="prev-card" style="border-left:3px solid ${m.order.deliveryStatus === 'delivered' ? '#86efac' : 'var(--success)'};">
          <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;">
            ${!['delivered', 'cancelled', 'returned'].includes(m.order.deliveryStatus) ? `
            <input type="checkbox" data-del-id="${escapeHtml(m.order.id)}" onchange="delUpdateCount()"
                   style="width:20px;height:20px;margin-top:2px;flex-shrink:0;accent-color:var(--navy);">
            ` : `<span style="font-size:18px;flex-shrink:0;">${
              m.order.deliveryStatus === 'delivered' ? '✅' : m.order.deliveryStatus === 'cancelled' ? '🚫' : '↩️'
            }</span>`}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:13px;font-weight:800;color:var(--navy);">${escapeHtml(m.order.ship)}</span>
                <span style="font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:4px;padding:1px 6px;">
                  ${m.order.deliveryStatus === 'delivered' ? '이미 납품완료'
                    : m.order.deliveryStatus === 'cancelled' ? '🚫 발주취소됨'
                    : m.order.deliveryStatus === 'returned'  ? '↩️ 반품처리됨'
                    : '미납품'}
                </span>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(m.reason)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:1px;">${escapeHtml(m.order.docNo||'-')} · ${m.order.date} · ${fmt(m.order.total)}</div>
            </div>
          </div>
        </div>
      `).join('')}

      <!-- 납품 날짜 선택 + 처리 버튼 -->
      ${undeliveredMatches.length ? `
      <div style="margin-top:14px;padding:14px;background:#f8fafc;border-radius:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <span style="font-size:13px;font-weight:700;color:var(--navy);white-space:nowrap;">📅 납품 날짜</span>
          <input id="del-confirm-date" type="date" value="${todayVal}"
                 style="flex:1;font-size:14px;font-weight:700;border:2px solid var(--border);
                        border-radius:8px;padding:6px 10px;color:var(--navy);background:#fff;">
        </div>
        <button class="btn btn-success btn-block" onclick="confirmSelectedDelivery()">
          ✅ 선택한 발주 납품완료 처리
        </button>
      </div>
      ` : ''}
    ` : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px 0;">이른아침 항목이 없거나 발주 목록과 일치하는 항목을 찾지 못했습니다</div>'}

    ${result.skipped_other_vendors ? `<div style="font-size:11px;color:var(--muted);padding:4px 0;">ℹ️ 타 업체 항목은 자동으로 제외되었습니다</div>` : ''}
    ${unmatched.length ? `
      <div class="sdiv">목록 미매칭 항목</div>
      ${unmatched.map(u => `<div style="font-size:12px;color:var(--muted);padding:4px 0;">• ${escapeHtml(u)}</div>`).join('')}
    ` : ''}
  `;
}

// ── 체크박스 헬퍼 ──
function delToggleAll(checked) {
  document.querySelectorAll('#del-result-section input[data-del-id]').forEach(cb => { cb.checked = checked; });
  delUpdateCount();
}

function delUpdateCount() {
  const total    = document.querySelectorAll('#del-result-section input[data-del-id]').length;
  const selected = document.querySelectorAll('#del-result-section input[data-del-id]:checked').length;
  const countEl  = document.getElementById('del-selected-count');
  if (countEl) countEl.textContent = `${selected}건 선택`;
  const allCb = document.getElementById('del-select-all');
  if (allCb) allCb.checked = selected > 0 && selected === total;
}

// ── 선택된 발주 납품완료 처리 ──
function confirmSelectedDelivery() {
  const dateVal = document.getElementById('del-confirm-date')?.value;
  if (!dateVal) { toast('⚠️ 납품 날짜를 선택해주세요'); return; }

  const checked = [...document.querySelectorAll('#del-result-section input[data-del-id]:checked')];
  if (!checked.length) { toast('⚠️ 납품완료 처리할 발주를 선택해주세요'); return; }

  let cnt = 0;
  checked.forEach(cb => {
    const o = orders.find(x => x.id === cb.dataset.delId);
    if (!o || ['delivered', 'cancelled', 'returned'].includes(o.deliveryStatus)) return;
    o.deliveryStatus = 'delivered';
    o.deliveredDate  = dateVal;
    o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
    cnt++;
  });

  if (cnt > 0) {
    save(); renderAll();
    toast(`✅ ${cnt}건 납품완료 처리됨 (${dateVal})`);
    resetDeliveryZone();
  }
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
