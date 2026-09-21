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

// ── v3.3.67: 납품 리스트 분석 결과 집계 (전체 / 매칭 / 납품 대기 / 이미 납품완료 / 미매칭) ──
// 최근 며칠 이내에 납품완료 처리된 발주까지 AI 매칭 후보에 포함할지("이미 처리된 척"을 인식하기 위함)
const DELIVERY_RECENT_DAYS = 30;
const DELIVERY_RECENT_MAX  = 40;

function _delIsPending(st) { return !['delivered', 'cancelled', 'returned'].includes(st); }
function _delShipKey(ship) { return (ship || '').trim().toLowerCase(); }
function _delDaysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// AI가 돌려준 matched를 정리: 존재하지 않는 ID·중복 제거 + "이미 납품완료" 발주를 골랐는데
// 같은 선명의 미납품/부분납품 발주가 남아 있으면 그쪽(오래된 순)으로 교체 — 프롬프트 지시에만
// 의존하지 않고 코드에서도 한 번 더 보장한다.
function normalizeDeliveryMatches(result) {
  const byId = id => orders.find(o => o.id === id);
  const raw = (result.matched || []).filter(m => m && m.id && byId(m.id));
  const claimed = new Set(raw.filter(m => _delIsPending(byId(m.id).deliveryStatus)).map(m => m.id));
  const emitted = new Set();
  const out = [];
  for (const m of raw) {
    let id = m.id;
    let order = byId(id);
    let reason = m.reason;
    if (order.deliveryStatus === 'delivered') {
      const key = _delShipKey(order.ship);
      const alt = orders
        .filter(o => _delShipKey(o.ship) === key && _delIsPending(o.deliveryStatus) && !claimed.has(o.id))
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
      if (alt) {
        claimed.add(alt.id);
        id = alt.id;
        reason = (reason ? reason + ' ' : '') + '(같은 선명 미납품 발주로 자동 교체)';
      }
    }
    if (emitted.has(id)) continue;
    emitted.add(id);
    out.push({ ...m, id, reason });
  }
  return out;
}

function getDeliveryCounts(result) {
  const matchedOrders = (result.matched || [])
    .map(m => orders.find(o => o.id === m.id))
    .filter(Boolean);
  const matchedCnt = matchedOrders.length;
  const pending    = matchedOrders.filter(o => _delIsPending(o.deliveryStatus)).length;
  const delivered  = matchedOrders.filter(o => o.deliveryStatus === 'delivered').length;
  const other      = matchedCnt - pending - delivered;  // 취소·반품
  const aiTotal    = Number(result.totalCount);
  const total      = Math.max(Number.isFinite(aiTotal) ? aiTotal : 0, matchedCnt);
  return { total, matchedCnt, pending, delivered, other, unmatched: total - matchedCnt };
}

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
    // v3.3.66: 납품 리스트는 발주서 사진(보통 품목 1~3줄)과 달리 여러 척이
    // 한 화면에 줄줄이 나열된 "긴 목록" 문서라, 발주서용 해상도(IMAGE_MAX_PX=1024)로
    // 줄이면 아래쪽 줄일수록 글자가 작아져 인식이 끊기기 쉽다(예: 위쪽 몇 척만
    // 인식되고 나머지가 누락 — 반복 업로드가 필요해지는 원인). 이 업로드에서만
    // 더 높은 해상도를 쓴다.
    const DELIVERY_LIST_MAX_PX = 1600;
    const parts = [];
    for (const f of files) {
      if (f.type === 'application/pdf') {
        const pages = await pdfToImages(f, DELIVERY_LIST_MAX_PX);
        pages.forEach(dataUrl => parts.push(imagePart(dataUrl)));
      } else {
        // 리사이즈 적용
        const dataUrl = await resizeImage(f, DELIVERY_LIST_MAX_PX, IMAGE_QUALITY);
        parts.push(imagePart(dataUrl));
      }
    }
    setDelProgress(50);

    // v3.3.67: 미납품/부분납품 발주(60건) + 최근 N일 내 납품완료된 발주(참고용)를 함께 전달.
    // 이전엔 납품완료 건을 아예 빼서, 이미 처리한 척이 다시 리스트에 나오면 "미매칭"으로만
    // 보였다 — 이제 "이미 납품완료"로 인식해 전체 척수 대비 처리 현황을 구분해 보여준다.
    const _row = (o, st) => `${o.id}|${o.ship}|${o.docNo||''}|${o.poNo||''}|${o.date||''}|${st}`;
    const pendingSummary = orders
      .filter(o => _delIsPending(o.deliveryStatus))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))  // 최근 날짜 우선
      .slice(0, 60)
      .map(o => _row(o, o.deliveryStatus === 'partial' ? '부분납품' : '미납품'))
      .join('\n');
    const recentCutoff = _delDaysAgoStr(DELIVERY_RECENT_DAYS);
    const deliveredSummary = orders
      .filter(o => o.deliveryStatus === 'delivered' && !o.isReturn
                && (o.deliveredDate || o.date || '') >= recentCutoff)
      .sort((a, b) => (b.deliveredDate || b.date || '').localeCompare(a.deliveredDate || a.date || ''))
      .slice(0, DELIVERY_RECENT_MAX)
      .map(o => _row(o, '납품완료'))
      .join('\n');

    const prompt = `납품 확인서/리스트 이미지입니다. "이른아침" 업체 항목만 추출하세요.

발주목록(ID|선명|서류번호|발주번호|날짜|상태):
${pendingSummary}
${deliveredSummary ? `
최근 ${DELIVERY_RECENT_DAYS}일 내 이미 납품완료 처리된 발주(이미 처리된 척인지 확인용):
${deliveredSummary}
` : ''}
이미지에서 "이른아침" 항목(선명/척수)을 모두 세고, 위 발주목록과 매칭해 아래 JSON만 출력(코드블록 없이):
{"totalCount":이미지속이른아침전체항목수(숫자),"matched":[{"id":"발주ID","ship":"선명","reason":"근거"}],"summary":"요약"}
이른아침 항목 없으면: {"totalCount":0,"matched":[],"summary":"이른아침 항목 없음"}
동일한 선명으로 발주목록에 여러 건이 있으면, 그 중 날짜가 가장 오래된 건의 ID를 우선 선택하세요.
같은 선명에 상태가 미납품/부분납품인 발주가 있으면 반드시 그쪽을 선택하고, 상태가 납품완료인 발주는 그 선명의 미납품/부분납품 발주가 하나도 없을 때만 매칭하세요.
이미지 위쪽부터 아래쪽까지, 목록 전체를 끝까지 빠짐없이 확인하세요 — 일부만 세고 멈추지 마세요.`;

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
    result.matched = normalizeDeliveryMatches(result);
    renderDeliveryResult(result);
    setDelProgress(100);
    const c = getDeliveryCounts(result);
    setDelStatus(`✅ 분석 완료 — 전체 ${c.total}척 중 ${c.matchedCnt}척 매칭 (납품 대기 ${c.pending} · 이미 납품완료 ${c.delivered}${c.unmatched > 0 ? ` · 미매칭 ${c.unmatched}` : ''})`);
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

  // v3.3.64: 같은 선명으로 발주가 여러 건(미납품/부분납품 등 아직 처리 안 된 것만) 걸려있으면
  // AI가 어떤 걸 골랐든 사용자가 직접 확인·변경할 수 있도록 후보 목록을 함께 보여준다.
  // 후보는 발주일자 오래된 순으로 정렬해 기본 선택값도 "가장 오래된 건"이 되게 한다.
  const shipCandidatesCache = {};
  function getShipCandidates(ship) {
    const key = (ship || '').trim().toLowerCase();
    if (!key) return [];
    if (shipCandidatesCache[key]) return shipCandidatesCache[key];
    const list = orders
      .filter(o => (o.ship || '').trim().toLowerCase() === key
                && !['delivered', 'cancelled', 'returned'].includes(o.deliveryStatus))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')); // 오래된 순
    shipCandidatesCache[key] = list;
    return list;
  }

  // v3.3.14: analyzer.js의 전역 pendingOrders(업로드 미리보기 큐)와 이름이 겹쳐 헷갈리기 쉬웠던
  // 지역변수 이름을 정리 (동작에는 영향 없던 단순 네이밍 충돌).
  const undeliveredMatches = matchedOrders.filter(m => !['delivered', 'cancelled', 'returned'].includes(m.order.deliveryStatus));
  const cnt = getDeliveryCounts({ ...result, matched });  // v3.3.67: 전체/매칭/납품 대기/이미 납품완료/미매칭
  const todayVal = todayStr();
  const chip = (txt, bg, fg) => `<span style="font-size:11px;font-weight:700;color:${fg};background:${bg};border-radius:6px;padding:3px 8px;">${txt}</span>`;

  sec.innerHTML = `
    <!-- 매칭 요약 배너 (v3.3.67: 납품 대기 / 이미 납품완료 / 미매칭 구분) -->
    <div style="margin-bottom:10px;padding:10px 12px;background:${cnt.unmatched > 0 ? '#fffbeb' : '#f0fdf4'};border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:${cnt.unmatched > 0 ? '#b45309' : 'var(--success)'};">
        📦 전체 ${cnt.total}척 중 ${cnt.matchedCnt}척 매칭
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${chip(`🆕 납품 대기 ${cnt.pending}척`, '#dbeafe', '#1d4ed8')}
        ${chip(`✅ 이미 납품완료 ${cnt.delivered}척`, '#dcfce7', '#15803d')}
        ${cnt.unmatched > 0 ? chip(`❓ 미매칭 ${cnt.unmatched}척`, '#fef3c7', '#b45309') : ''}
        ${cnt.other > 0 ? chip(`🚫 취소·반품 ${cnt.other}척`, '#f1f5f9', '#64748b') : ''}
      </div>
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
      ${matchedOrders.map(m => {
        const isPending = !['delivered', 'cancelled', 'returned'].includes(m.order.deliveryStatus);
        const candidates = isPending ? getShipCandidates(m.order.ship) : [];
        const isAmbiguous = candidates.length > 1;
        // 기본 선택값: 후보가 여러 건이면 그중 가장 오래된 것 — AI가 무엇을 골랐든
        // 여기서 한 번 더 "오래된 건 우선"으로 통일한다.
        const defaultId = isAmbiguous ? candidates[0].id : m.order.id;
        return `
        <div class="prev-card" style="border-left:3px solid ${m.order.deliveryStatus === 'delivered' ? '#86efac' : isAmbiguous ? '#f59e0b' : 'var(--success)'};">
          <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;">
            ${isPending ? `
            <input type="checkbox" data-del-id="${escapeHtml(defaultId)}" onchange="delUpdateCount()"
                   style="width:20px;height:20px;margin-top:2px;flex-shrink:0;accent-color:var(--navy);">
            ` : `<span style="font-size:18px;flex-shrink:0;">${
              m.order.deliveryStatus === 'delivered' ? '✅' : m.order.deliveryStatus === 'cancelled' ? '🚫' : '↩️'
            }</span>`}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:13px;font-weight:800;color:var(--navy);">${escapeHtml(m.order.ship)}</span>
                <span style="font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:4px;padding:1px 6px;">
                  ${m.order.deliveryStatus === 'delivered' ? '이미 납품완료' + (m.order.deliveredDate ? ' · ' + m.order.deliveredDate.slice(5).replace('-', '/') : '')
                    : m.order.deliveryStatus === 'partial'   ? '🚚 부분납품 중'
                    : m.order.deliveryStatus === 'cancelled' ? '🚫 발주취소됨'
                    : m.order.deliveryStatus === 'returned'  ? '↩️ 반품처리됨'
                    : '미납품'}
                </span>
                ${isAmbiguous ? `<span style="font-size:10px;font-weight:700;color:#b45309;background:#fef3c7;border-radius:4px;padding:1px 6px;">⚠️ 동일 선명 ${candidates.length}건</span>` : ''}
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(m.reason)}</div>
              ${isAmbiguous ? `
              <select onchange="delSwitchCandidate(this)" data-for="${escapeHtml(m.order.id)}"
                      style="margin-top:6px;width:100%;font-size:12px;font-weight:700;color:var(--navy);
                             border:1px solid #f59e0b;border-radius:6px;padding:6px 8px;background:#fffbeb;">
                ${candidates.map((c, idx) => `<option value="${escapeHtml(c.id)}" ${c.id === defaultId ? 'selected' : ''}>${escapeHtml(c.docNo||'-')} · ${c.date} · ${fmt(c.total)}${idx===0?' (가장 오래됨)':''}</option>`).join('')}
              </select>
              ` : `
              <div style="font-size:11px;color:var(--muted);margin-top:1px;">${escapeHtml(m.order.docNo||'-')} · ${m.order.date} · ${fmt(m.order.total)}</div>
              `}
            </div>
          </div>
        </div>
      `;
      }).join('')}

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

// v3.3.64: 동일 선명 후보 드롭다운에서 다른 발주를 고르면, 바로 위(같은 카드) 체크박스가
// 가리키는 발주 id를 그 선택으로 바꿔준다 — 체크박스 자체는 그대로 두고 data-del-id만 교체.
function delSwitchCandidate(selectEl) {
  const card = selectEl.closest('.prev-card');
  const cb = card?.querySelector('input[type="checkbox"][data-del-id]');
  if (cb) cb.dataset.delId = selectEl.value;
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
    // v3.3.33: 부분납품 중이었다면 "이번에 새로 채워진 만큼"을 선택한 날짜로 이력 기록
    const prevBoxes = (o.items || []).map(i => calcItemDeliveredBoxes(i));
    const nextBoxes = (o.items || []).map(i => calcItemBoxCount(i));
    o.deliveryStatus = 'delivered';
    o.deliveredDate  = dateVal;
    o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
    (o.items || []).forEach((i, idx) => { i.deliveredBoxes = nextBoxes[idx]; }); // v3.3.28: 부분납품 중이었어도 전량 완료로 처리
    _recordDeliveryDelta(o, dateVal, prevBoxes, nextBoxes);
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
