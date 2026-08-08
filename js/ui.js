// ══════════════════════════════════════════════════════
// ui.js  —  렌더링 전용 (대시보드 · 발주목록 · 통계)
// ══════════════════════════════════════════════════════

// ── 필터 상태 ──
let filterMode  = 'all';
let statusMode  = 'all';
let searchQ     = '';
let dupOnlyMode = false; // 서류번호·발주번호 중복 건만 보기 (다른 필터와 함께 AND로 적용)

// ── 일괄납품 상태 ──
let isBulkMode   = false;
let bulkSelected = new Set(); // 선택된 order id

// ══════════════════════════════════════════════════════
// 대시보드 월별 필터 상태
// ══════════════════════════════════════════════════════
let _dashMonth = _currentYM(); // 'YYYY-MM' — 대시보드는 항상 특정 월 기준 (전체보기 없음)

function _shiftYM(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dashPrevMonth() {
  _dashMonth = _shiftYM(_dashMonth, -1);
  renderAll();
}

function dashNextMonth() {
  _dashMonth = _shiftYM(_dashMonth, 1);
  renderAll();
}

function dashThisMonth() {
  _dashMonth = _currentYM();
  renderAll();
}

function _renderDashMonthNav() {
  const thisYM = _currentYM();
  const [y, mo] = _dashMonth.split('-');
  const titleEl   = document.getElementById('dash-month-title');
  const labelEl   = document.getElementById('dash-month-label');
  const todayBtn  = document.getElementById('dash-month-today-btn');
  const recentLbl = document.getElementById('dash-recent-title');
  const isThis    = _dashMonth === thisYM;
  if (titleEl)   titleEl.textContent  = `${Number(y)}년 ${Number(mo)}월`;
  if (labelEl)   labelEl.textContent  = isThis ? '이번 달 발주 현황' : `${Number(y)}년 ${Number(mo)}월 발주 현황`;
  if (todayBtn)  todayBtn.style.display = isThis ? 'none' : 'inline-block';
  if (recentLbl) recentLbl.textContent = `${Number(mo)}월 납품·반품 내역`;
}

// ── 전체 렌더 ──
function renderAll() {
  // 발주취소(cancelled) 건은 모든 집계에서 제외
  const total = orders.reduce((s, o) => s + (o.deliveryStatus === 'cancelled' ? 0 : (o.total || 0)), 0);

  // 대시보드 본문은 선택된 월(_dashMonth) 데이터만 사용
  _renderDashMonthNav();
  const monthOrders = _filterByMonth(orders, _dashMonth);
  const ships = new Set(monthOrders.map(o => o.ship)).size;

  // 납품 기준 통계 (해당 월) — 발주취소 건은 제외
  // v3.3.28: 박스 합계는 부분납품 건의 "지금까지 배송된 만큼"도 포함하되,
  // 건수(deliveredCnt)는 완전히 끝난 건만 카운트(부분납품은 별도로 세야 함)
  const deliveredOrders = monthOrders.filter(o => o.deliveryStatus === 'delivered');
  const partialOrders   = monthOrders.filter(o => o.deliveryStatus === 'partial');
  // v3.3.32: 반품(returned)도 포함해 calcOrderImpactBoxes 한 기준으로 집계 —
  // 기존엔 반품이 빠져 있어서 선명별 집계·납품현황 총박스·엑셀 월별 시트(모두 반품 차감 포함)와
  // 이 대시보드 카드의 "총 납품" 박스 수가 서로 다른 기준으로 계산되고 있었음.
  const returnedBoxOrders = monthOrders.filter(o => o.deliveryStatus === 'returned');
  const deliveredBoxes  = [...deliveredOrders, ...partialOrders, ...returnedBoxOrders]
                          .reduce((s, o) => s + calcOrderImpactBoxes(o), 0);
  const netTotal        = monthOrders.reduce((s, o) => s + calcNetDelivery(o), 0);
  const deliveredCnt    = deliveredOrders.length;

  // 납품 박스 품목별 집계: 계란 / 생메추리 / 깐메추리
  // v3.3.28: 부분납품 건은 "지금까지 배송된 만큼"만 포함 (deliveredBoxes 합계와 기준을 맞춤)
  // v3.3.32: 반품 건도 포함(위 deliveredBoxes와 기준 통일)
  let dashEggBoxes = 0, dashQuailRawBoxes = 0, dashQuailBrineBoxes = 0, dashQuailBrinePkts = 0;
  [...deliveredOrders, ...partialOrders, ...returnedBoxOrders].forEach(o => {
    const sign = _boxSign(o);
    (o.items || []).forEach(item => {
      const bc = _itemImpactBoxes(item, o);
      if (_isQuailBrine(item)) {
        if (_isPktUnit(item.unit)) dashQuailBrinePkts  += (o.deliveryStatus === 'partial' ? 0 : sign * (Number(item.qty) || 0)); // 봉지 단위 부분납품은 박스 진행률로만 표시(봉지 단위 부분 추적은 미지원)
        else                       dashQuailBrineBoxes += bc;
      } else if (_isQuailEgg(item)) {
        dashQuailRawBoxes += bc;
      } else {
        dashEggBoxes += bc;
      }
    });
  });
  const dashHasQuailRaw   = dashQuailRawBoxes > 0;
  const dashHasQuailBrine = dashQuailBrineBoxes > 0 || dashQuailBrinePkts > 0;

  // 상단바(topbar)는 전체 발주 기준 유지
  document.getElementById('h-cnt').textContent    = orders.filter(o => !o.archived && o.deliveryStatus !== 'cancelled').length;
  document.getElementById('h-tot').textContent    = fmt(total);
  // 대시보드 본문 카드는 선택된 월 기준
  document.getElementById('s-cnt').textContent    = deliveredCnt;
  document.getElementById('s-tot').textContent    = fmt(netTotal);
  document.getElementById('s-ships').textContent  = ships;
  document.getElementById('s-boxes').textContent  = formatBoxCount(deliveredBoxes);

  // 납품 박스 카드 하단: 품목별 세부 표시 (계란/메추리/깐메추리 구분 있을 때만)
  const boxesDetailEl = document.getElementById('s-boxes-detail');
  if (boxesDetailEl) {
    if (dashHasQuailRaw || dashHasQuailBrine) {
      const parts = [];
      parts.push(`🥚계란 ${formatBoxCount(dashEggBoxes)}`);
      if (dashHasQuailRaw)   parts.push(`🥚메추리 ${formatBoxCount(dashQuailRawBoxes)}`);
      if (dashHasQuailBrine) {
        const brineStr = (dashQuailBrineBoxes ? formatBoxCount(dashQuailBrineBoxes) : '')
                       + (dashQuailBrineBoxes && dashQuailBrinePkts ? ' ' : '')
                       + (dashQuailBrinePkts ? formatPktCount(dashQuailBrinePkts) : '');
        parts.push(`깐메추리 ${brineStr}`);
      }
      boxesDetailEl.innerHTML = parts.join('<br>');
    } else {
      boxesDetailEl.textContent = '납품완료 기준';
    }
  }

  // 납품 현황 요약 카드 (해당 월)
  const delivered   = monthOrders.filter(o => o.deliveryStatus === 'delivered');
  const returned    = monthOrders.filter(o => o.deliveryStatus === 'returned');
  // 미납품(pending)은 발주월과 무관하게 항상 "지금 처리 안 된 전체 건"을 보여줌 (예외: 월 필터 미적용)
  const pendingAll  = orders.filter(o => !o.archived && (!o.deliveryStatus || o.deliveryStatus === 'pending'));
  // v3.3.28: 부분납품도 미납품과 같은 방식(월 무관, 전체 기준)으로 별도 집계 —
  // "아직 처리 중"이라는 점에서 미납품과 같은 성격이라 같은 방식으로 보여줌
  const partialAll  = orders.filter(o => !o.archived && o.deliveryStatus === 'partial');

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  // 반품서(isReturn): total이 이미 음수이므로 Math.abs 사용; 수동반품: returnAmount는 양수
  const returnedAmt  = returned.reduce((s, o) => s + (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount ?? Math.abs(o.total) ?? 0)), 0);
  const pendingAllAmt = pendingAll.reduce((s, o) => s + (o.total || 0), 0);
  const netAmt       = deliveredAmt - returnedAmt;

  document.getElementById('ds-delivered-cnt').textContent = delivered.length;
  document.getElementById('ds-returned-cnt').textContent  = returned.length;
  document.getElementById('ds-pending-cnt').textContent   = pendingAll.length;
  document.getElementById('ds-delivered-amt').textContent = fmt(deliveredAmt);
  document.getElementById('ds-returned-amt').textContent  = returned.length ? '-' + fmt(returnedAmt) : fmt(0);
  document.getElementById('ds-returned-amt').style.color = returned.length ? '#f87171' : '';
  document.getElementById('ds-pending-amt').textContent   = fmt(pendingAllAmt);
  document.getElementById('ds-net-amt').textContent       = fmt(netAmt);
  const partialNoteEl = document.getElementById('ds-partial-note');
  if (partialNoteEl) {
    partialNoteEl.innerHTML = partialAll.length
      ? `🚚 부분납품 진행 중 <b>${partialAll.length}건</b> — <span style="text-decoration:underline;">발주목록에서 확인</span>`
      : '';
    partialNoteEl.style.display = partialAll.length ? '' : 'none';
  }

  // 대시보드 최근 목록 — 납품완료 + 부분납품 + 반품 + 발주취소 표시 (보관건 제외, 해당 월)
  const dupIdSet = _computeDupOrderIdSet(); // 서류번호·발주번호 중복 (양쪽 목록에서 공용)
  const recent = [...monthOrders]
    .filter(o => !o.archived && (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial' || o.deliveryStatus === 'cancelled' || o.deliveryStatus === 'returned'))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  document.getElementById('dash-list').innerHTML = recent.length
    ? recent.map(o => orderCard(o, false, dupIdSet)).join('')
    : '<div class="empty"><div class="empty-icon">📦</div><div class="empty-t">납품완료 내역 없음</div></div>';

  // 날짜별 기록 (펼쳐진 상태면 즉시 재렌더)
  const bydateEl = document.getElementById('dash-bydate');
  if (bydateEl && bydateEl.style.display !== 'none') renderDashByDate();

  // 납품현황 탭이 현재 보이는 상태면 즉시 갱신 (납품취소 등 상태 변경 즉시 반영)
  if (typeof curView !== 'undefined' && curView === 3) renderDeliveryStatus();

  // 발주 목록
  const list = filtered();
  const archivedCnt = orders.filter(o => !!o.archived).length;
  const dupCnt = dupIdSet.size;
  const subTxt = statusMode === 'archived'
    ? `보관함 ${list.length}건`
    : `${list.length}건${archivedCnt > 0 ? ` · 📦보관 ${archivedCnt}` : ''}${dupCnt > 0 ? ` · ⚠️중복 ${dupCnt}` : ''}`;
  document.getElementById('o-sub').textContent      = subTxt;
  document.getElementById('orders-list').innerHTML  = list.length
    ? list.map(o => orderCard(o, true, dupIdSet)).join('')
    : `<div class="empty"><div class="empty-icon">${statusMode === 'archived' ? '📦' : '📭'}</div><div class="empty-t">${statusMode === 'archived' ? '보관된 발주가 없습니다' : '결과 없음'}</div></div>`;
}

// ── 발주 카드 HTML ──
function orderCard(o, showDel, dupIdSet) {
  const item        = o.items?.[0] || {};
  const isReturnDoc = !!o.isReturn;
  const delBtn      = showDel
    ? `<button class="btn btn-d btn-sm" onclick="event.stopPropagation();delOrder('${o.id}')">삭제</button>`
    : '';
  const net       = calcNetDelivery(o);
  const isCancelledCard = o.deliveryStatus === 'cancelled';
  const isPartialCard   = o.deliveryStatus === 'partial';
  const netStr    = isCancelledCard
    ? `<span class="oc-net" style="color:#6d28d9;">🚫 발주취소 (집계 제외)</span>`
    : isPartialCard
      ? `<span class="oc-net" style="color:#b45309;">🚚 배송 진행: <b>${formatBoxCount(calcOrderDeliveredBoxes(o))} / ${formatBoxCount(calcOrderBoxes(o))}</b> (${fmt(net)})</span>`
      : (o.deliveryStatus && o.deliveryStatus !== 'pending'
          ? `<span class="oc-net">실납품: <b>${net < 0 ? '-' + fmt(-net) : fmt(net)}</b></span>`
          : '');
  const statusClass = o.deliveryStatus === 'delivered' ? 'status-delivered'
    : o.deliveryStatus === 'partial'   ? 'status-partial'
    : o.deliveryStatus === 'returned'  ? 'status-returned'
    : o.deliveryStatus === 'cancelled' ? 'status-cancelled'
    : '';
  // 반품서 뱃지 (업로드된 반품서만)
  const returnDocBadge = isReturnDoc
    ? `<span class="badge b-returned" style="font-size:10px;">↩️ 반품서</span>`
    : '';
  // 서류번호·발주번호 중복 뱃지 (dupIdSet이 전달된 경우에만 표시)
  const dupBadge = (dupIdSet && dupIdSet.has(o.id))
    ? `<span class="badge" style="background:#fef3c7;color:#92400e;" title="서류번호 또는 발주번호가 다른 발주와 동일합니다">⚠️ 중복</span>`
    : '';
  // 금액 색상: 반품서는 빨간색, 발주취소는 취소선
  const amtStyle = isReturnDoc ? 'color:#dc2626;font-weight:700;' : isCancelledCard ? 'text-decoration:line-through;color:var(--muted);' : '';

  // 보관 뱃지
  const archivedBadge = o.archived
    ? `<span class="badge b-archived">📦 보관중</span>`
    : '';

  // 일괄 모드 처리 (납품 or 보관)
  let canBulk, isDisabled, bulkClass, bulkChk, clickHandler;
  if (isBulkMode && showDel) {
    const isChecked = bulkSelected.has(o.id);
    if (isBulkMode === 'deliver') {
      // v3.3.32: 발주취소(cancelled) 건은 다른 납품 처리 로직과 동일하게 제외
      canBulk = !isReturnDoc && o.deliveryStatus !== 'delivered' && o.deliveryStatus !== 'returned'
              && o.deliveryStatus !== 'cancelled' && !o.archived;
    } else {
      canBulk = o.deliveryStatus === 'delivered' || !!o.archived;
    }
    isDisabled   = !canBulk;
    bulkClass    = isDisabled ? ' bulk-disabled' : (isChecked ? ' bulk-selected' : '');
    bulkChk      = `<span class="bulk-chk">${isChecked ? '✓' : ''}</span>`;
    clickHandler = isDisabled ? '' : `onclick="toggleBulkSelect('${o.id}')"`;
  } else {
    canBulk = false; isDisabled = false; bulkClass = ''; bulkChk = '';
    clickHandler = `onclick="openModal('${o.id}')"`;
  }

  // 반품 확인 체크 (발주목록에서만 표시 — 대시보드 최근내역과 id 중복 방지)
  // v3.3.41: 이 체크가 재고 반영 여부를 결정하게 됨(_boxSign 참고) — 더 이상 순수 장식용 아님.
  // v3.3.43: phantom 반품(납품 이력 없이 바로 반품 처리된 건)은 _boxSign이 확인 여부와
  // 무관하게 항상 0을 반환하므로, 체크박스를 눌러도 재고에 아무 효과가 없다. 그런 건은
  // 체크박스 자체를 숨겨서 "체크해도 안 바뀌는" 혼란을 없앤다.
  const isReturnedForChk = showDel && o.deliveryStatus === 'returned' && !_isPhantomReturn(o);
  const isReturnChecked  = isReturnedForChk && _isReturnChecked(o.id);
  const returnChkHtml    = isReturnedForChk
    ? `<label style="margin-left:auto;display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);cursor:pointer;" onclick="event.stopPropagation();">
         <input type="checkbox" id="retchk-${o.id}" ${isReturnChecked ? 'checked' : ''}
                onclick="toggleReturnChk('${o.id}', event)"
                title="체크해야 이 반품이 재고에 반영됩니다 (내 기기에만 저장)"
                style="width:16px;height:16px;cursor:pointer;accent-color:#dc2626;">
         ${isReturnChecked ? '재고반영됨' : '재고미반영'}
       </label>`
    : '';

  // 선명 옆 상태 처리일 (납품완료/부분납품/반품/발주취소 각각의 처리 날짜)
  const statusDateStr = (o.deliveryStatus === 'delivered' && o.deliveredDate)
    ? `<span class="oc-status-date sd-delivered">완료 ${escapeHtml(o.deliveredDate)}</span>`
    : (o.deliveryStatus === 'partial' && o.deliveredDate)
    ? `<span class="oc-status-date sd-partial">부분 ${escapeHtml(o.deliveredDate)}</span>`
    : (o.deliveryStatus === 'returned' && o.returnedDate)
    ? `<span class="oc-status-date sd-returned">반품 ${escapeHtml(o.returnedDate)}</span>`
    : (o.deliveryStatus === 'cancelled' && o.cancelledDate)
    ? `<span class="oc-status-date sd-cancelled">취소 ${escapeHtml(o.cancelledDate)}</span>`
    : '';

  return `
  <div id="ordercard-${o.id}" class="order-card ${statusClass}${isReturnDoc ? ' is-return-doc' : ''}${o.archived ? ' archived-card' : ''}${bulkClass}"${isReturnChecked ? ' style="opacity:.55;"' : ''} ${clickHandler}>
    ${bulkChk}
    <div class="oc-top">
      <div class="oc-ship">${escapeHtml(o.ship)}${statusDateStr}</div>
      <div class="oc-amount" style="${amtStyle}">${fmt(o.total)}</div>
    </div>
    <div class="oc-meta">
      <span class="oc-doc">${escapeHtml(o.docNo)}</span>
      ${badge(o.category)}
      ${returnDocBadge}
      ${archivedBadge}
      ${dupBadge}
      ${isReturnDoc ? '' : statusBadge(o.deliveryStatus || 'pending')}
      ${delBtn}
    </div>
    <div class="oc-bottom">
      <div class="oc-item">${escapeHtml(item.desc) || '-'}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-shrink:0;margin-left:8px;">
        <span class="oc-qty">${fmtQ(item)}${formatItemBoxStr(item) ? ` (${formatItemBoxStr(item)})` : ''}</span>
        <span class="oc-dates">${escapeHtml(o.date)}${o.delivery ? ' → ' + escapeHtml(o.delivery) : ''}</span>
      </div>
    </div>
    ${netStr ? `<div class="oc-status-row">${netStr}${returnChkHtml}</div>` : ''}
  </div>`;
}

// ── 필터 / 검색 ──
function filterOrders(m, btn) {
  filterMode = m;
  document.querySelectorAll('#cat-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

function filterStatus(m, btn) {
  statusMode = m;
  document.querySelectorAll('#status-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

// v3.3.28: 대시보드의 "부분납품 N건" 배너를 탭했을 때 — 발주목록 탭으로 이동 후
// '부분납품' 필터를 적용하고 해당 칩을 활성화 표시
function goToPartialList() {
  if (typeof goTo === 'function') goTo(1); // 발주목록 탭
  statusMode = 'partial';
  document.querySelectorAll('#status-chips .chip').forEach(c => c.classList.remove('active'));
  const chip = [...document.querySelectorAll('#status-chips .chip')].find(c => c.textContent.includes('부분납품'));
  if (chip) chip.classList.add('active');
  renderAll();
}

// 서류번호·발주번호 중복 건만 보기 토글 — 다른 필터(카테고리/상태/검색/기간)와 함께 AND로 적용됨
function toggleDupOnly(btn) {
  dupOnlyMode = !dupOnlyMode;
  btn.classList.toggle('active', dupOnlyMode);
  renderAll();
}

function searchOrders(q) { searchQ = q; renderAll(); }

// ── 정렬 모드 변경 ──
function setSortMode(mode) {
  sortMode = mode;
  // 버튼 active 상태 갱신
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  const active = document.getElementById('sort-' + mode);
  if (active) active.classList.add('active');
  renderAll();
}

function clearDateFilter() {
  document.getElementById('fDateFrom').value = '';
  document.getElementById('fDateTo').value   = '';
  renderAll();
}

// ══════════════════════════════════════════════════════
// 월별 결산 상태
// ══════════════════════════════════════════════════════
// 통계 탭 기본값: 항상 '이번달'로 시작 (달이 바뀌면 자동으로 새 달 기준)
function _currentYM() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
}
let _statMonth = _currentYM(); // 'all' | 'YYYY-MM'

function _getAvailableMonths() {
  const monthSet = new Set();
  orders.forEach(o => {
    const d = o.deliveredDate || o.date || '';
    if (d && d.length >= 7) monthSet.add(d.slice(0, 7));
  });
  return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
}

function _filterByMonth(arr, month) {
  if (month === 'all') return arr;
  return arr.filter(o => {
    const d = o.deliveredDate || o.date || '';
    return d.slice(0, 7) === month;
  });
}

function selectStatMonth(m) {
  _statMonth = m;
  renderStats();
}

// ── 선명별 납품 주기 계산 (전체 orders 기준, 발주취소 제외) ──
// 반환: { [정규화된 선명]: { count, avgDays, lastDate } }
//   count    : 서로 다른 납품일 수
//   avgDays  : 납품일 간 평균 간격(일) — 납품일이 2개 미만이면 null
//   lastDate : 가장 최근 납품일
//
// v3.3.23: 통계 집계 전용 선명 정규화. 발주목록·상세 등 원본 데이터는 그대로
// 두고, "선명별 매출·납품주기" 통계에서 그룹핑할 때만 괄호(와 그 안의 내용)·
// 중복 공백을 무시해서 같은 선박으로 합산한다.
// 예) "MSC BELLISSIMA (2019-02, CHANTIERS...)" 와 "MSC BELLISSIMA"는
//     서류상 부가정보 유무만 다를 뿐 같은 배이므로 통계에서는 하나로 묶는다.
function _normShipKey(ship) {
  return (ship || '')
    .replace(/\([^)]*\)/g, '')  // 짝이 맞는 괄호와 그 안의 내용 제거
    .replace(/\([^)]*$/, '')    // v3.3.26: 짝이 안 맞는 여는 괄호 이후 전부 제거(잘린 OCR 등 방어)
    .replace(/\s+/g, ' ')       // 연속 공백 → 하나로
    .trim()
    .toUpperCase();             // v3.3.26: 대소문자 차이만으로 같은 배가 갈라지는 것도 함께 방지
}

function _computeShipCycles() {
  const byShipDates = {};
  orders.forEach(o => {
    if (o.deliveryStatus !== 'delivered' && o.deliveryStatus !== 'partial') return; // v3.3.28: 부분납품도 "그 배가 그날 다녀간" 기록으로 포함
    const d = o.deliveredDate || o.date;
    if (!d || d === '미상') return;
    const key = _normShipKey(o.ship) || o.ship || '미상';
    if (!byShipDates[key]) byShipDates[key] = new Set();
    byShipDates[key].add(d);
  });
  const result = {};
  Object.entries(byShipDates).forEach(([key, dateSet]) => {
    const dates = Array.from(dateSet).sort();
    if (dates.length < 2) {
      result[key] = { count: dates.length, avgDays: null, lastDate: dates[dates.length - 1] || null };
      return;
    }
    const diffs = [];
    for (let i = 1; i < dates.length; i++) {
      const d1 = new Date(dates[i - 1] + 'T00:00:00');
      const d2 = new Date(dates[i]     + 'T00:00:00');
      diffs.push(Math.round((d2 - d1) / 86400000));
    }
    const avgDays = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    result[key] = { count: dates.length, avgDays, lastDate: dates[dates.length - 1] };
  });
  return result;
}

// ── 납품 통계 탭 렌더 ──
function renderStats() {
  // ── 월 선택 칩 생성 ──
  const availableMonths = _getAvailableMonths();
  const today   = new Date();
  const thisYM  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const lastDate = new Date(today.getFullYear(), today.getMonth()-1, 1);
  const lastYM  = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}`;

  // 기본값(이번달)으로 설정돼 있는데 이번달 데이터가 없으면 → 전체로 자동 폴백
  if (_statMonth === thisYM && !availableMonths.includes(thisYM)) {
    _statMonth = 'all';
  }

  const monthChipsHtml = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;padding:12px 0 4px;">
      ${availableMonths.includes(thisYM) ? `
      <button class="chip${_statMonth===thisYM?' active':''}" style="font-size:11px;"
              onclick="selectStatMonth('${thisYM}')">이번달</button>` : ''}
      ${availableMonths.includes(lastYM) ? `
      <button class="chip${_statMonth===lastYM?' active':''}" style="font-size:11px;"
              onclick="selectStatMonth('${lastYM}')">지난달</button>` : ''}
      ${(() => {
        const isCustomMonth = _statMonth !== thisYM && _statMonth !== lastYM && _statMonth !== 'all';
        const label = isCustomMonth
          ? (() => { const [y, mo] = _statMonth.split('-'); return `📅 ${Number(y)}년 ${Number(mo)}월`; })()
          : '📅 년월검색';
        return `
      <label class="chip${isCustomMonth ? ' active' : ''}" style="font-size:11px;position:relative;display:inline-flex;align-items:center;">
        ${label}
        <input type="month" value="${isCustomMonth ? _statMonth : ''}"
               style="position:absolute;inset:0;opacity:0;width:100%;height:100%;border:0;padding:0;margin:0;cursor:pointer;"
               onchange="if(this.value) selectStatMonth(this.value)">
      </label>`;
      })()}
      <button class="chip${_statMonth==='all'?' active':''}" style="font-size:11px;"
              onclick="selectStatMonth('all')">전체</button>
    </div>
  `;

  // ── 월별 결산 카드 + 막대 그래프 (월이 2개 이상 있으면 항상 표시) ──
  let monthlyGridHtml = '';
  if (availableMonths.length > 1) {
    // 그래프용 데이터 계산
    const monthData = availableMonths.map(m => {
      const [y, mo] = m.split('-');
      const mOrders = orders.filter(o => (o.deliveredDate || o.date || '').slice(0,7) === m);
      const mDel     = mOrders.filter(o => o.deliveryStatus === 'delivered');
      const mPartial = mOrders.filter(o => o.deliveryStatus === 'partial'); // v3.3.28
      const mRet     = mOrders.filter(o => o.deliveryStatus === 'returned');
      const mDelAmt  = mDel.reduce((s,o) => s+(o.total||0), 0)
                      + mPartial.reduce((s,o) => s+calcPartialDeliveredAmount(o), 0);
      const mRetAmt  = mRet.reduce((s,o) => s+(o.isReturn ? Math.abs(o.total||0) : (o.returnAmount??Math.abs(o.total)??0)), 0);
      const mNet     = mDelAmt - mRetAmt;
      const mBoxes   = mDel.reduce((s,o) => s + calcOrderBoxes(o), 0)
                      + mPartial.reduce((s,o) => s + calcOrderDeliveredBoxes(o), 0);
      const mCruise = mOrders.filter(o => o.category === 'cruise');
      const mCargo  = mOrders.filter(o => o.category === 'cargo' || !o.category);
      const mCruiseNet = mCruise.reduce((s,o) => s + calcNetDelivery(o), 0);
      const mCargoNet  = mCargo.reduce((s,o) => s + calcNetDelivery(o), 0);
      return { m, y, mo, net: mNet, boxes: mBoxes, cnt: mDel.length,
               delAmt: mDelAmt, retAmt: mRetAmt,
               cruiseNet: mCruiseNet, cargoNet: mCargoNet };
    });

    const maxNet = Math.max(...monthData.map(d => d.net), 1);

    // 막대 그래프
    const barHtml = `
      <div style="margin-bottom:16px;">
        <div class="sdiv" style="display:flex;align-items:center;justify-content:space-between;">
          <span>월별 실납품 추이</span>
          <span style="font-size:10px;color:var(--muted);font-weight:400;">${availableMonths.length}개월</span>
        </div>
        <div style="background:#fff;border-radius:10px;border:1px solid var(--border);padding:16px 12px 8px;">
          <div style="display:flex;align-items:stretch;gap:6px;height:130px;">
            ${[...monthData].reverse().map(d => {
              const pct = Math.max((d.net / maxNet) * 100, 2);
              const isThis = d.m === thisYM;
              const manwon = Math.round(d.net / 10000).toLocaleString();
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;height:100%;"
                     onclick="selectStatMonth('${d.m}')">
                  <div style="font-size:9px;color:var(--muted);white-space:nowrap;">
                    ${manwon}만
                  </div>
                  <div style="flex:1;width:100%;display:flex;align-items:flex-end;">
                    <div style="width:100%;background:${isThis ? 'var(--accent)' : 'var(--accent-light)'};
                                border-radius:4px 4px 0 0;height:${pct}%;min-height:4px;opacity:${isThis?1:0.7};
                                transition:opacity .15s;" title="${d.m} · ${fmt(d.net)}"></div>
                  </div>
                  <div style="font-size:9px;color:${isThis?'var(--navy)':'var(--muted)'};font-weight:${isThis?700:400};">
                    ${Number(d.mo)}월
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

    // 월별 결산 카드 그리드 (박스 수 + 크루즈/카고 구분 추가)
    const monthRows = monthData.map(d => `
      <div onclick="selectStatMonth('${d.m}')"
           style="border:${_statMonth===d.m?'2px solid var(--accent)':'1px solid var(--border)'};
                  border-radius:10px;padding:12px 14px;cursor:pointer;background:#fff;transition:.15s;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;color:var(--navy);">${Number(d.y)}년 ${Number(d.mo)}월</span>
          <span style="font-size:10px;color:var(--muted);">${d.cnt}건 · ${formatBoxCount(d.boxes)}</span>
        </div>
        <div style="font-size:15px;font-weight:800;color:var(--success);margin-bottom:6px;">${fmt(d.net)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:10px;">
          ${d.cruiseNet ? `<span style="color:#0ea5e9;">🚢 크루즈 ${fmt(d.cruiseNet)}</span>` : ''}
          ${d.cargoNet  ? `<span style="color:#f59e0b;">📦 카고 ${fmt(d.cargoNet)}</span>` : ''}
        </div>
        ${d.retAmt ? `<div style="font-size:10px;color:var(--danger);margin-top:3px;">반품차감 -${fmt(d.retAmt)}</div>` : ''}
      </div>`);

    monthlyGridHtml = barHtml + `
      <div style="margin-bottom:16px;">
        <div class="sdiv" style="display:flex;align-items:center;justify-content:space-between;">
          <span>월별 결산</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${monthRows.join('')}
        </div>
      </div>`;
  }

  // ── 월 제목 표시 + CSV 내보내기 버튼 (특정 월 선택 시) ──
  let monthTitleHtml = '';
  if (_statMonth !== 'all') {
    const [y, mo] = _statMonth.split('-');
    monthTitleHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;
                  padding:11px 14px;background:var(--navy);color:#fff;border-radius:10px;">
        <span style="font-size:16px;font-weight:800;">${Number(y)}년 ${Number(mo)}월 결산</span>
        <button onclick="exportMonthExcel('${_statMonth}')"
                style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;
                       border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">
          📥 엑셀 내보내기
        </button>
      </div>`;
  }

  // ── 데이터 필터 ──
  const scopeOrders = _filterByMonth(orders, _statMonth);

  const delivered = scopeOrders.filter(o => o.deliveryStatus === 'delivered');
  const partial   = scopeOrders.filter(o => o.deliveryStatus === 'partial'); // v3.3.28
  const returned  = scopeOrders.filter(o => o.deliveryStatus === 'returned');
  const cancelled = scopeOrders.filter(o => o.deliveryStatus === 'cancelled'); // 집계 제외, 건수만 참고

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  const returnedAmt  = returned.reduce((s, o) => s + (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount ?? Math.abs(o.total) ?? 0)), 0);
  const partialDeliveredAmt = partial.reduce((s, o) => s + calcPartialDeliveredAmount(o), 0);
  // v3.3.32: "납품완료+부분납품(배송분)+반품(차감)"을 calcNetDelivery 한 기준으로 합산.
  // 기존엔 deliveredAmt - returnedAmt만 써서 부분납품 배송분이 실 납품금액에서 통째로
  // 빠졌고, 바로 아래 총 박스 수(부분납품 포함)·크루즈/카고 소계와 기준이 달랐음.
  const doneOrders  = [...delivered, ...partial, ...returned];
  const netAmt       = doneOrders.reduce((s, o) => s + calcNetDelivery(o), 0);

  // 총 박스 수 (발주취소 제외, 부분납품은 배송된 만큼만, 반품은 차감)
  const totalBoxes = doneOrders.reduce((s,o) => s + calcOrderImpactBoxes(o), 0);

  // ── 크루즈 / 카고 구분 집계 (발주취소 제외, 부분납품은 배송된 만큼·반품은 차감 포함) ──
  const cruiseOrders = doneOrders.filter(o => o.category === 'cruise');
  const cargoOrders  = doneOrders.filter(o => o.category === 'cargo' || !o.category);
  const cruiseAmt = cruiseOrders.reduce((s,o) => s + calcNetDelivery(o), 0);
  const cargoAmt  = cargoOrders.reduce((s,o) => s + calcNetDelivery(o), 0);
  const cruiseBoxes = cruiseOrders.reduce((s,o) => s + calcOrderImpactBoxes(o), 0);
  const cargoBoxes  = cargoOrders.reduce((s,o) => s + calcOrderImpactBoxes(o), 0);

  const categoryHtml = (cruiseAmt || cargoAmt) ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:#eff8ff;border:1px solid #bae0fd;border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;color:#0ea5e9;font-weight:700;margin-bottom:6px;">🚢 크루즈</div>
        <div style="font-size:14px;font-weight:800;color:var(--navy);">${fmt(cruiseAmt)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">${cruiseOrders.length}건 · ${formatBoxCount(cruiseBoxes)}</div>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;color:#f59e0b;font-weight:700;margin-bottom:6px;">📦 카고</div>
        <div style="font-size:14px;font-weight:800;color:var(--navy);">${fmt(cargoAmt)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">${cargoOrders.length}건 · ${formatBoxCount(cargoBoxes)}</div>
      </div>
    </div>` : '';

  // ── 선명별 집계 (납품완료·부분납품·반품 건만 — 미납품/발주취소 제외, 선택된 월 기준) ──
  // 미납품 건은 실제 납품이 이뤄진 시점(deliveredDate)에 자동으로 통계에 반영됨
  // v3.3.23: _normShipKey()로 정규화한 키로 그룹핑해 괄호 부가정보 유무로
  // 같은 선박이 따로 집계되는 문제를 방지. 표시 이름은 그룹 내에서 가장 짧은
  // (=부가정보 없는) 원본 선명을 대표값으로 사용.
  // v3.3.28: 부분납품은 배송된 만큼만 boxes·net에 반영(calcNetDelivery·calcOrderImpactBoxes가 자동 처리)
  const byShip = {};
  scopeOrders.filter(o => o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial' || o.deliveryStatus === 'returned').forEach(o => {
    const key = _normShipKey(o.ship) || o.ship || '미상';
    if (!byShip[key]) byShip[key] = { ship: o.ship, key, cnt: 0, total: 0, net: 0, returned: 0, boxes: 0 };
    if ((o.ship || '').length < (byShip[key].ship || '').length) byShip[key].ship = o.ship;
    byShip[key].cnt++;
    byShip[key].total   += (o.total || 0);
    byShip[key].net     += calcNetDelivery(o);
    // 반품(수동)은 boxes도 차감되어야 함 — 그동안 부호 보정이 없어 반품 박스가
    // 오히려 더해져 선박별 박스 수가 부풀려지던 문제 수정
    byShip[key].boxes   += calcOrderImpactBoxes(o);
    if (o.deliveryStatus === 'returned')
      byShip[key].returned += (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount ?? Math.abs(o.total) ?? 0));
  });
  const ships = Object.values(byShip).sort((a, b) => b.net - a.net);

  // ── 선명별 납품 주기 (전체 기간 기준 — 월 필터와 무관하게 장기 패턴 산출) ──
  const shipCycles = _computeShipCycles();
  const maxShipNet = Math.max(...ships.map(s => s.net), 1);

  document.getElementById('stats-content').innerHTML = `

    <!-- 월 선택 칩 -->
    ${monthChipsHtml}

    <!-- 막대 그래프 + 월별 결산 그리드 (전체 모드) -->
    ${monthlyGridHtml}

    <!-- 선택 월 타이틀 + CSV 버튼 -->
    ${monthTitleHtml}

    <!-- 합산 요약 카드 -->
    <div class="delivery-summary" style="margin-bottom:12px;">
      <div class="ds-title">납품 금액 요약</div>
      <div class="ds-grid">
        <div class="ds-item">
          <div class="ds-val c-delivered">${fmt(deliveredAmt)}</div>
          <div class="ds-lbl">납품완료</div>
          <div class="ds-amount">${delivered.length}건</div>
        </div>
        <div class="ds-item">
          <div class="ds-val c-returned">-${fmt(returnedAmt)}</div>
          <div class="ds-lbl">반품차감</div>
          <div class="ds-amount">${returned.length}건</div>
        </div>
        <div class="ds-item">
          <div class="ds-val" style="color:#6d28d9;">🚫 ${cancelled.length}건</div>
          <div class="ds-lbl">발주취소</div>
          <div class="ds-amount">집계 제외</div>
        </div>
      </div>
      <div class="ds-net">
        <div class="ds-net-lbl">실 납품금액 합계</div>
        <div class="ds-net-val">${fmt(netAmt)}</div>
      </div>
      ${partial.length ? `
      <div style="text-align:center;font-size:11px;color:#0891b2;padding:4px 0 0;">
        🚚 부분납품 진행 중 ${partial.length}건의 배송분(${fmt(partialDeliveredAmt)}) 포함
      </div>` : ''}
      <!-- 총 박스 수 -->
      <div style="text-align:center;font-size:12px;color:var(--muted);padding:6px 0 2px;">
        총 납품 <strong style="color:var(--navy);">${formatBoxCount(totalBoxes)}</strong>
      </div>
    </div>

    <!-- 크루즈 / 카고 구분 -->
    ${categoryHtml}

    <!-- 선명별 매출 · 납품 주기 -->
    ${ships.length ? `
    <div class="sdiv" style="display:flex;align-items:center;justify-content:space-between;">
      <span>선명별 매출 · 납품 주기</span>
      <span style="font-size:10px;color:var(--muted);font-weight:400;">${ships.length}척</span>
    </div>
    ${ships.map((s, idx) => {
      const cyc = shipCycles[s.key] || {};
      const pct = Math.max((s.net / maxShipNet) * 100, 3);
      const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
      const cycleText = cyc.avgDays
        ? `🔄 평균 ${cyc.avgDays}일 주기`
        : (cyc.count === 1 ? '🔄 납품 1회 · 주기 산출 불가' : '🔄 주기 데이터 없음');
      const lastText = cyc.lastDate ? `최근 ${fmtDate(cyc.lastDate)}` : '';
      return `
      <div class="form-card" style="padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${rankIcon ? rankIcon + ' ' : ''}${escapeHtml(s.ship)}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:3px;">${s.cnt}건 · ${formatBoxCount(s.boxes)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:14px;font-weight:800;color:var(--success);">${fmt(s.net)}</div>
            ${s.returned ? `<div style="font-size:10px;color:var(--danger);margin-top:2px;">반품 -${fmt(s.returned)}</div>` : ''}
          </div>
        </div>
        <div style="margin-top:8px;background:var(--bg);border-radius:4px;height:5px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:4px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--muted);">
          <span>${cycleText}</span>
          <span>${lastText}</span>
        </div>
      </div>`;
    }).join('')}` : ''}

    <!-- 반품 내역 -->
    ${returned.length ? `
    <div class="sdiv">반품 내역 (${returned.length}건)</div>
    ${returned.map(o => `
      <div class="order-card status-returned" onclick="openModal('${o.id}')">
        <div class="oc-top"><div class="oc-ship">${escapeHtml(o.ship)}</div><div class="oc-amount" style="color:var(--danger);">-${fmt(o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount ?? Math.abs(o.total) ?? 0))}</div></div>
        <div class="oc-meta"><span class="oc-doc">${escapeHtml(o.docNo)}</span>${o.isReturn ? '<span class="badge b-returned">↩️ 반품서</span>' : statusBadge('returned')}</div>
        <div class="oc-bottom"><div class="oc-item">${escapeHtml(o.deliveryNote) || '-'}</div><div class="oc-dates">${escapeHtml(o.date)}</div></div>
      </div>
    `).join('')}` : ''}

  `;
}

// ── 날짜 포맷 헬퍼 (YYYY-MM-DD → M월 D일 (요일)) ──
function fmtDate(dateStr) {
  if (!dateStr || dateStr === '미상') return '미상';
  try {
    const d    = new Date(dateStr + 'T00:00:00');
    const days = ['일','월','화','수','목','금','토'];
    return `${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  } catch(e) { return dateStr; }
}

// ══════════════════════════════════════════════════════
// renderDeliveryStatus — 납품현황 탭 (날짜별 선명·박스·금액) + 월별 필터
// ══════════════════════════════════════════════════════
let _delivMonth = _currentYM(); // 'all' | 'YYYY-MM' — 기본값: 이번달

// v3.3.24: 품목 금액 합계 vs 발주총액(o.total) 차이를 "할인"으로 감지.
// 업로드 시 AI가 서류를 그대로 읽어오다 보니, 품목 단가×수량으로 계산된
// 금액(정가 합계)과 서류 하단 TOTAL(할인 등이 반영된 실제 청구액)이 다른
// 경우가 있음 — 그 차액만큼을 할인으로 보고 납품현황 카드에 표시한다.
// 반환: { amount, pct } — 할인이 없으면(1원 이하 오차 포함) amount는 0.
function _calcOrderDiscount(o) {
  const itemsSum = (o.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const total = Number(o.total) || 0;
  const diff = Math.abs(itemsSum) - Math.abs(total);
  // v3.3.26: 품목 수가 많고 단가에 소수점이 있는 발주서는 반올림 오차가 누적되어
  // 1~수 원 차이가 나는 경우가 있어, 문턱값을 5원으로 올려 오탐 여지를 줄임
  // (실제 할인은 보통 총액의 몇 % 단위라 5원보다 훨씬 크므로 놓칠 위험은 낮음)
  if (diff <= 5 || Math.abs(itemsSum) < 1) return { amount: 0, pct: 0 };
  return { amount: diff, pct: Math.round((diff / Math.abs(itemsSum)) * 1000) / 10 };
}

function selectDelivMonth(m) {
  _delivMonth = m;
  renderDeliveryStatus();
}

function renderDeliveryStatus() {
  const el = document.getElementById('delivery-status-content');
  if (!el) return;

  // 더블체크 세트는 렌더 1회당 한 번만 로드 (행마다 localStorage 재파싱 방지)
  const _dblSet = _loadDblCheckSet();

  // ── 월 선택 칩 ──
  const availableMonths = _getAvailableMonths();
  const today   = new Date();
  const thisYM  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const lastDate = new Date(today.getFullYear(), today.getMonth()-1, 1);
  const lastYM  = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}`;

  // 이번달 기본값인데 데이터 없으면 전체로 폴백
  if (_delivMonth === thisYM && !availableMonths.includes(thisYM)) {
    _delivMonth = 'all';
  }

  const chipsCss = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;padding:12px 0 4px;';
  const monthChipsHtml = `
    <div style="${chipsCss}">
      ${availableMonths.includes(thisYM) ? `
      <button class="chip${_delivMonth===thisYM?' active':''}" style="font-size:11px;"
              onclick="selectDelivMonth('${thisYM}')">이번달</button>` : ''}
      ${availableMonths.includes(lastYM) ? `
      <button class="chip${_delivMonth===lastYM?' active':''}" style="font-size:11px;"
              onclick="selectDelivMonth('${lastYM}')">지난달</button>` : ''}
      ${(() => {
        const isCustomMonth = _delivMonth !== thisYM && _delivMonth !== lastYM && _delivMonth !== 'all';
        const label = isCustomMonth
          ? (() => { const [y, mo] = _delivMonth.split('-'); return `📅 ${Number(y)}년 ${Number(mo)}월`; })()
          : '📅 년월검색';
        return `
      <label class="chip${isCustomMonth ? ' active' : ''}" style="font-size:11px;position:relative;display:inline-flex;align-items:center;">
        ${label}
        <input type="month" value="${isCustomMonth ? _delivMonth : ''}"
               style="position:absolute;inset:0;opacity:0;width:100%;height:100%;border:0;padding:0;margin:0;cursor:pointer;"
               onchange="if(this.value) selectDelivMonth(this.value)">
      </label>`;
      })()}
      <button class="chip${_delivMonth==='all'?' active':''}" style="font-size:11px;"
              onclick="selectDelivMonth('all')">전체</button>
    </div>
  `;

  // ── 월 필터 적용 ──
  // 납품완료 + 부분납품 + 반품(업로드 반품서 isReturn 및 상세모달 수동 반품처리 모두 포함)
  // → 납품현황에서 반품 차감 표시 (발주취소는 납품이 아니므로 제외)
  // 금액·박스 집계는 보관건 포함, 카드 목록에서만 보관건 제외
  // v3.3.28: 부분납품(partial)도 실제 박스가 움직인 기록이므로 포함 — 박스 수는
  // calcItemDeliveredBoxes 등으로 "지금까지 배송된 만큼"만 반영됨
  const allDone = orders.filter(o =>
    o.deliveryStatus === 'delivered' ||
    o.deliveryStatus === 'partial' ||
    o.deliveryStatus === 'returned'
  );
  const done = _delivMonth === 'all'
    ? allDone
    : allDone.filter(o => (o.deliveredDate || o.date || '').slice(0,7) === _delivMonth);

  // 선택 월 타이틀
  let monthTitleHtml = '';
  if (_delivMonth !== 'all') {
    const [y, mo] = _delivMonth.split('-');
    monthTitleHtml = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:11px 14px;
                  background:var(--navy);color:#fff;border-radius:10px;">
        <span style="font-size:16px;font-weight:800;">${Number(y)}년 ${Number(mo)}월 납품현황</span>
      </div>`;
  }

  if (!done.length) {
    el.innerHTML = monthChipsHtml + monthTitleHtml + `
      <div style="text-align:center;padding:60px 20px;color:var(--muted);">
        <div style="font-size:40px;margin-bottom:12px;">📦</div>
        <div style="font-size:14px;">${_delivMonth==='all' ? '납품 완료된 발주가 없습니다' : '해당 월 납품 내역이 없습니다'}</div>
      </div>`;
    return;
  }

  // ── 날짜별 집계 ──
  // v3.3.33: 부분납품이 여러 날짜에 걸쳐 이뤄진 경우(예: 토요일 50박스 + 월요일 50박스)
  // 배송 이력(deliveryEvents)이 있으면 발주 1건을 날짜별 레코드(record)로 나눠서 반영한다.
  // 이력이 없는(과거 데이터·반품·발주취소 등) 발주는 기존처럼 deliveredDate 하나로 전량 반영
  // (_deliveryRecordsFor가 두 경우 모두 처리 — 레코드 1개짜리 배열을 반환).
  const byDay = {};
  done.forEach(o => {
    const sign = _boxSign(o);
    _deliveryRecordsFor(o).forEach(r => {
      const d = r.date;
      if (!byDay[d]) byDay[d] = { date: d, records: [], totalAmt: 0, totalBoxes: 0, eggBoxes: 0, quailRawBoxes: 0, quailBrineBoxes: 0, quailBrinePkts: 0 };
      byDay[d].records.push(r);
      byDay[d].totalAmt += r.amt;
      (o.items || []).forEach((item, idx) => {
        const bc = Number(r.perItemBoxes[idx]) || 0;
        if (!bc) return;
        const isBrine = _isQuailBrine(item);
        const isRawQ  = _isQuailEgg(item);
        if (isBrine)      byDay[d].quailBrineBoxes += bc;
        else if (isRawQ)  byDay[d].quailRawBoxes   += bc;
        else              byDay[d].eggBoxes        += bc;
        byDay[d].totalBoxes += bc;
      });
      // 봉지(pkt) 원 수량은 부분납품 진행률을 날짜별로 추적하지 않으므로(기존과 동일 제약),
      // 완료된 날(deliveredDate)의 레코드 1곳에만 전체 수량을 반영해 중복 집계를 막는다.
      if (o.deliveryStatus !== 'partial' && r.date === (o.deliveredDate || o.date)) {
        (o.items || []).forEach(item => {
          if (_isQuailBrine(item) && _isPktUnit(item.unit)) {
            byDay[d].quailBrinePkts += sign * (Number(item.qty) || 0);
          }
        });
      }
    });
  });

  // 각 날짜 내 선명은 기본적으로 알파벳(가나다) 순 정렬
  Object.values(byDay).forEach(day => {
    day.records.sort((a, b) => (a.order.ship || '').localeCompare(b.order.ship || ''));
  });

  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  // ── 품목별 재고 이월 계산 (전체 이력 기준, 날짜 오름차순 누적) ──
  // 화면에 보이는 월(_delivMonth)과 무관하게 정확히 이월되도록,
  // 이번 달로 필터링된 done이 아니라 전체 이력(allDone) + 저장된 모든 입고(delivGoal_) 날짜를 합쳐 계산한다.
  // 단, "입고"를 한 번도 입력한 적 없는 과거 날짜까지 소급해서 재고부족으로 잡으면
  // 이번 업데이트 이전 데이터가 전부 마이너스로 보이게 되므로, 최초로 입고를 입력한 날짜부터만 이월을 시작한다.
  // 계란/메추리/깐메추리 모두 같은 방식(입고량)으로 취급하며, 품목별로 추적 시작일을 독립적으로 판정한다.
  // v3.3.21: 파손(회수) 수량을 재고 계산에 반영 — 재고 = 전일재고 + 오늘입고 - 오늘납품 - 오늘파손
  // v3.3.28: '오늘납품'에는 부분납품 건의 "지금까지 배송된 만큼"도 포함(_itemImpactBoxes가 자동 처리)
  // v3.3.33: 부분납품이 여러 날짜에 걸치면 배송 이력(deliveryEvents) 기준으로 그 날짜에
  // 실제로 나간 만큼만 반영 — 예전엔 완료 시점 날짜 하나에 전량이 몰려서, 중간에 걸친
  // 날짜의 재고가 실제보다 많게(납품 누락으로) 잡히는 문제가 있었음.
  function _stockByDateFor(goalField, itemFilterFn) {
    const dmgField = goalField + 'Dmg';  // 파손(회수) 수량 필드 — 예: 'egg' → 'eggDmg'
    const openField = goalField + 'Open'; // v3.3.44: 전일재고 직접 수정(override) 필드 — 예: 'egg' → 'eggOpen'
    const stockByDate = {};
    const byDateAll = {};    // 그 날짜의 "정상 납품" 박스 합계(반품 제외)
    const byDateReturn = {}; // 그 날짜에 "반품 확인"으로 재고에 되돌아온 박스 합계(항상 양수)
    // v3.3.42: 반품(확인됨)의 signed 기여분은 항상 음수이므로(_boxSign 참고), 부호만으로
    // 정상 납품과 반품을 구분해 따로 누적한다 — 미확인 반품은 여전히 양수로 정상 집계됨.
    // v3.3.45: 확인된 반품은 원래 납품일(r.date)이 아니라 "반품 확인 체크한 날짜"를
    // 재고 반영 기준일로 사용 — 날짜별 목록에 표시되는 위치(_deliveryRecordsFor의 date)는
    // 그대로 두고, 재고 집계에서만 반영 시점을 확인일로 옮긴다(사용자 요청). v3.3.41
    // 마이그레이션으로 날짜 없이 자동 확인된 기존 반품 건은 _returnCheckedDate가 빈 값을
    // 반환하므로 기존처럼 r.date(납품일) 그대로 사용된다.
    allDone.forEach(o => {
      _deliveryRecordsFor(o).forEach(r => {
        let sum = 0;
        (o.items || []).forEach((item, idx) => {
          if (!itemFilterFn(item)) return;
          sum += Number(r.perItemBoxes[idx]) || 0;
        });
        if (!sum) return;
        if (sum < 0) {
          const chkDate = _returnCheckedDate(o.id);
          const targetDate = chkDate || r.date;
          byDateReturn[targetDate] = (byDateReturn[targetDate] || 0) + Math.abs(sum);
        } else {
          byDateAll[r.date] = (byDateAll[r.date] || 0) + sum;
        }
      });
    });

    // 실제로 해당 품목 "입고" 값을 0보다 크게 입력해 둔 날짜만 수집 (그 시점부터가 "재고 추적 시작일")
    // 다른 품목만 입력한 날짜는 이 품목의 추적 시작으로 치지 않는다.
    const trackedGoalDates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('delivGoal_')) continue;
      let g = null;
      try { g = JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) {}
      if (g && Number(g[goalField]) > 0) trackedGoalDates.push(k.slice('delivGoal_'.length));
    }
    if (!trackedGoalDates.length) return stockByDate;

    const firstTrackedDate = trackedGoalDates.sort((a, b) => a.localeCompare(b))[0];

    const stockDates = new Set(trackedGoalDates);
    Object.keys(byDateAll)
      .filter(d => d >= firstTrackedDate) // 추적 시작일 이전 납품 실적은 이월 계산에서 제외
      .forEach(d => stockDates.add(d));
    Object.keys(byDateReturn)
      .filter(d => d >= firstTrackedDate)
      .forEach(d => stockDates.add(d));
    // 파손만 입력되고 해당 날짜에 입고·납품 실적이 없는 경우도(추적 시작일 이후라면)
    // 누락 없이 이월 계산에 포함되도록 delivGoal_ 전체를 훑어 파손 입력 날짜를 추가 수집
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('delivGoal_')) continue;
      const d = k.slice('delivGoal_'.length);
      if (d < firstTrackedDate) continue;
      let g = null;
      try { g = JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) {}
      if (g && Number(g[dmgField]) > 0) stockDates.add(d);
      // v3.3.44: 전일재고 직접 수정(override)만 입력되고 그 날짜에 다른 입고·납품·파손
      // 실적이 전혀 없는 경우도 이월 계산에서 누락되지 않도록 추가 수집
      if (g && g[openField] !== undefined && g[openField] !== null && g[openField] !== '') stockDates.add(d);
    }

    const ascDates = [...stockDates].sort((a, b) => a.localeCompare(b));
    let carry = 0;
    ascDates.forEach(d => {
      let g = null;
      try { g = JSON.parse(localStorage.getItem('delivGoal_' + d) || 'null'); } catch(e) {}
      const stockIn   = g ? (g[goalField] || 0) : 0;
      const damaged   = g ? (g[dmgField] || 0) : 0;
      // v3.3.44: "전일재고 직접 수정" 값이 입력돼 있으면 그 값을 그날의 opening으로 강제
      // 사용(실사 보정 등) — 없으면 기존처럼 전날 closing을 그대로 이어받는다(carry).
      const hasOverride = g && g[openField] !== undefined && g[openField] !== null && g[openField] !== '';
      const opening   = hasOverride ? Number(g[openField]) : carry;
      const delivered = byDateAll[d] || 0;
      const returned  = byDateReturn[d] || 0;
      const closing   = opening + stockIn - delivered - damaged + returned;
      stockByDate[d] = { stockIn, damaged, opening, delivered, returned, closing, openingOverridden: !!hasOverride };
      carry = closing;
    });
    return stockByDate;
  }

  const eggStockByDate   = _stockByDateFor('egg',   item => !_isQuailBrine(item) && !_isQuailEgg(item));
  const quailStockByDate = _stockByDateFor('quail', item => _isQuailEgg(item));
  const brineStockByDate = _stockByDateFor('brine', item => _isQuailBrine(item) && !_isPktUnit(item.unit));


  // ── 합계 (납품/반품 분리) ──
  const delivDone  = done.filter(o => o.deliveryStatus !== 'returned');
  const returnDone = done.filter(o => o.deliveryStatus === 'returned');
  const grandAmt   = done.reduce((s, o) => s + calcNetDelivery(o), 0);
  // v3.3.28: calcOrderImpactBoxes가 납품완료(전체)/부분납품(배송분만)/반품(부호 포함)을
  // 한 번에 올바르게 처리하므로 done 전체를 한 번에 합산하면 됨.
  const grandBoxes = done.reduce((s, o) => s + calcOrderImpactBoxes(o), 0);
  const returnAmt   = returnDone.reduce((s, o) => s + Math.abs(calcNetDelivery(o)), 0);
  const returnCount = returnDone.length;

  // 계란 / 생메추리 / 깐메추리 분리 집계
  // (반품 차감을 포함해 "총 박스"(grandBoxes)와 동일한 기준으로 계산 —
  //  delivDone만 집계하면 반품 건의 품목별 차감이 전혀 반영되지 않음)
  let grandEggBoxes = 0, grandQuailRawBoxes = 0, grandQuailBrineBoxes = 0, grandQuailBrinePkts = 0;
  done.forEach(o => {
    const sign = _boxSign(o);
    if (!sign) return; // phantom return(납품 이력 없이 바로 반품 처리)은 재고 영향 없음
    (o.items||[]).forEach(item => {
      const bc = _itemImpactBoxes(item, o); // v3.3.28: 부분납품이면 배송된 만큼만(부호 포함)
      if (_isQuailBrine(item)) {
        if (_isPktUnit(item.unit)) grandQuailBrinePkts  += (o.deliveryStatus === 'partial' ? 0 : sign * (Number(item.qty)||0));
        else                       grandQuailBrineBoxes += bc;
      } else if (_isQuailEgg(item)) {
        grandQuailRawBoxes += bc;
      } else {
        grandEggBoxes += bc;
      }
    });
  });
  const hasQuailRaw   = grandQuailRawBoxes > 0;
  const hasQuailBrine = grandQuailBrineBoxes > 0 || grandQuailBrinePkts > 0;

  el.innerHTML = monthChipsHtml + monthTitleHtml + `
    <!-- 요약 바 -->
    <div style="display:flex;gap:0;margin-bottom:${returnCount>0?'8px':'14px'};border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <div style="flex:1;background:var(--navy);color:#fff;padding:14px 16px;text-align:center;">
        <div style="font-size:18px;font-weight:800;">${delivDone.length}<span style="font-size:12px;font-weight:400;margin-left:2px;">건</span></div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">납품완료</div>
      </div>
      <div style="flex:1;background:#1a3a6e;color:#fff;padding:14px 16px;text-align:center;">
        ${(hasQuailRaw || hasQuailBrine) ? `
        <div style="font-size:12px;font-weight:700;opacity:.85;">계란 ${formatBoxCount(grandEggBoxes)}</div>
        ${hasQuailRaw   ? `<div style="font-size:12px;font-weight:700;opacity:.85;">🥚메추리 ${formatBoxCount(grandQuailRawBoxes)}</div>` : ''}
        ${hasQuailBrine ? `<div style="font-size:12px;font-weight:700;opacity:.85;">깐메추리 ${grandQuailBrineBoxes ? formatBoxCount(grandQuailBrineBoxes) : ''}${grandQuailBrineBoxes && grandQuailBrinePkts ? ' ' : ''}${grandQuailBrinePkts ? formatPktCount(grandQuailBrinePkts) : ''}</div>` : ''}
        ` : `
        <div style="font-size:18px;font-weight:800;">${formatBoxCount(grandBoxes)}</div>
        `}
        <div style="font-size:11px;opacity:.7;margin-top:2px;">총 박스</div>
      </div>
      <div style="flex:1;background:var(--success);color:#fff;padding:14px 16px;text-align:center;">
        <div style="font-size:15px;font-weight:800;">${fmt(grandAmt)}</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">납품금액</div>
      </div>
    </div>
    ${returnCount > 0 ? `
    <!-- 반품 요약 바 -->
    <div style="display:flex;gap:0;margin-bottom:14px;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);border:2px solid #fca5a5;">
      <div style="flex:1;background:#fff0f0;color:#dc2626;padding:10px 16px;text-align:center;">
        <div style="font-size:14px;font-weight:800;">↩️ 반품 ${returnCount}건</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">반품서·수동반품 포함</div>
      </div>
      <div style="flex:1;background:#fff0f0;color:#dc2626;padding:10px 16px;text-align:center;">
        <div style="font-size:14px;font-weight:800;">-${fmt(returnAmt)}</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">반품금액</div>
      </div>
    </div>` : ''}

    <!-- 날짜별 카드 -->
    ${dayList.map((day, idx) => {
      const dayId = `deliv-day-${idx}`;

      // ── 품목별 입고/재고 불러오기 (계란·메추리·깐메추리 모두 "입고량" 방식) ──
      let goal = null;
      try { goal = JSON.parse(localStorage.getItem('delivGoal_' + day.date) || 'null'); } catch(e) {}
      // goal = { egg: N, quail: N, brine: N } 또는 null — 세 품목 모두 "입고" 수량으로 사용

      // 품목별: 입고 + 전일 재고 이월 → 오늘 재고
      const eggStock   = eggStockByDate[day.date]   || { stockIn: 0, opening: 0, delivered: 0, returned: 0, closing: 0 };
      const quailStock = quailStockByDate[day.date] || { stockIn: 0, opening: 0, delivered: 0, returned: 0, closing: 0 };
      const brineStock = brineStockByDate[day.date] || { stockIn: 0, opening: 0, delivered: 0, returned: 0, closing: 0 };

      const hasEggFlow   = !!(goal && (goal.egg   || goal.eggDmg))   || eggStock.opening   !== 0 || eggStock.closing   !== 0 || eggStock.openingOverridden;
      const hasQuailFlow = !!(goal && (goal.quail || goal.quailDmg)) || quailStock.opening !== 0 || quailStock.closing !== 0 || quailStock.openingOverridden;
      const hasBrineFlow = !!(goal && (goal.brine || goal.brineDmg)) || brineStock.opening !== 0 || brineStock.closing !== 0 || brineStock.openingOverridden;

      // 입고/파손/재고 배지 텍스트 (계란·메추리·깐메추리 동일한 방식으로 표시)
      const goalBadgeHtml = (() => {
        const blocks = [];
        const addStockBlock = (label, stock) => {
          const color = stock.closing < 0 ? '#dc2626' : stock.closing === 0 ? '#22c55e' : '#f59e0b';
          // v3.3.44: 전일재고를 직접 수정(override)한 날은 "전일재고 30박스✏️"처럼 연필
          // 아이콘을 붙여, 자동 이월값이 아니라 사람이 직접 입력한 값임을 표시
          const openingText  = (stock.opening || stock.openingOverridden)
            ? ` + 전일재고 ${formatBoxCount(stock.opening)}${stock.openingOverridden ? '✏️' : ''}` : '';
          // v3.3.42: 반품 확인된 수량은 전일재고에 묻지 않고 "반품 N박스"로 바로 옆에 별도 표시
          const returnedText = stock.returned ? ` + 반품 ${formatBoxCount(stock.returned)}` : '';
          const dmgText = stock.damaged ? ` - 파손 ${formatBoxCount(stock.damaged)}` : '';
          const stockText = stock.closing < 0
            ? `⚠️ 재고부족 ${formatBoxCount(Math.abs(stock.closing))}`
            : `재고 ${label} ${formatBoxCount(stock.closing)}`;
          blocks.push(`
          <div style="font-size:10px;opacity:.75;margin-top:${blocks.length ? '6' : '2'}px;">입고 ${label} ${formatBoxCount(stock.stockIn)}${openingText}${returnedText}${dmgText}</div>
          <div style="font-size:11px;font-weight:700;color:${color};margin-top:3px;">${stockText}</div>`);
        };

        if (hasEggFlow)   addStockBlock('계란', eggStock);
        if (hasQuailFlow) addStockBlock('메추리', quailStock);
        if (hasBrineFlow) addStockBlock('깐메추리', brineStock);

        return blocks.join('');
      })();

      return `
      <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);">
        <!-- 날짜 헤더 (클릭 시 접기/펼치기) -->
        <div style="padding:11px 14px;background:var(--navy);color:#fff;cursor:pointer;user-select:none;"
             onclick="toggleDelivDay('${dayId}')">
          <!-- 상단 행: 날짜·척수(좌, 절대 줄바꿈 없음) / 목표버튼(우, 항상 고정폭) -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
              <span id="${dayId}-arrow" style="font-size:11px;opacity:.7;transition:transform .2s;flex-shrink:0;">▼</span>
              <span style="font-size:13px;font-weight:700;white-space:nowrap;">📅 ${fmtDate(day.date)}</span>
              <span style="font-size:11px;opacity:.65;white-space:nowrap;flex-shrink:0;">${day.records.length}척</span>
            </div>
            <!-- 목표 입력 버튼 (이벤트 전파 차단) -->
            <button onclick="event.stopPropagation();openDelivGoal('${day.date}', ${eggStock.opening}, ${quailStock.opening}, ${brineStock.opening})"
                    style="background:${goal ? '#f59e0b' : 'rgba(255,255,255,.18)'};color:#fff;border:none;
                           border-radius:8px;padding:6px 8px;font-size:16px;cursor:pointer;flex-shrink:0;line-height:1;">
              🎯
            </button>
          </div>
          <!-- 목표/재고 배지 (있을 때만, 자유롭게 줄바꿈되어도 상단 행에 영향 없음) -->
          ${goalBadgeHtml ? `<div style="margin-left:17px;">${goalBadgeHtml}</div>` : ''}
          <!-- 금액 + 박스 요약 (우측 정렬, 자유롭게 줄바꿈) -->
          <div style="display:flex;justify-content:flex-end;margin-top:6px;">
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;">${fmt(day.totalAmt)}</div>
              <div style="font-size:10px;opacity:.8;margin-top:2px;">
                ${day.eggBoxes       ? `계란 ${formatBoxCount(day.eggBoxes)}` : ''}
                ${day.quailRawBoxes   ? (day.eggBoxes ? ' · ' : '') + `🥚메추리 ${formatBoxCount(day.quailRawBoxes)}` : ''}
                ${day.quailBrineBoxes || day.quailBrinePkts ? ' · 깐메추리 ' + (day.quailBrineBoxes ? formatBoxCount(day.quailBrineBoxes) : '') + (day.quailBrineBoxes && day.quailBrinePkts ? ' ' : '') + (day.quailBrinePkts ? formatPktCount(day.quailBrinePkts) : '') : ''}
              </div>
            </div>
          </div>
        </div>
        <!-- 선명별 행 (접기/펼치기 대상) -->
        <div id="${dayId}">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:7px 14px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">선명</th>
              <th style="width:76px;padding:7px 8px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">박스</th>
              <th style="width:128px;padding:7px 14px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">금액</th>
            </tr>
          </thead>
          <tbody>
            ${day.records.filter(r => !r.order.archived).map(r => {
              const o = r.order;
              const isReturnDoc = !!o.isReturn;
              const isManualReturn = o.deliveryStatus === 'returned' && !o.isReturn;
              const isAnyReturn = isReturnDoc || isManualReturn;
              const rowBg  = isAnyReturn ? '#fff0f0' : '#fff';
              const rowBdl = isAnyReturn ? 'border-left:3px solid #dc2626;' : '';
              const amtCol = isAnyReturn ? '#dc2626' : (o.deliveryStatus === 'partial' ? '#b45309' : 'var(--success)');
              const isChecked = _dblSet.has(o.id);
              // v3.3.33: 부분납품이 여러 날짜에 걸쳐 있으면(이력 2건 이상) 이 카드가
              // "그 날 배송된 몫"만 보여준다는 걸 알 수 있게 표시
              const isSplitRecord = Array.isArray(o.deliveryEvents) && o.deliveryEvents.length > 1;
              return `
            <tr id="dblrow-${o.id}-${day.date}" data-dbl-id="${o.id}"
                style="border-top:1px solid var(--border);cursor:pointer;background:${rowBg};${rowBdl}opacity:${isChecked ? '.55' : '1'};"
                onclick="openModal('${o.id}')">
              <td style="padding:10px 14px;">
                <div style="display:flex;align-items:flex-start;gap:6px;">
                  <input type="checkbox" id="dblchk-${o.id}-${day.date}" data-dbl-id="${o.id}" ${isChecked ? 'checked' : ''}
                         onclick="toggleDblCheck('${o.id}', event)"
                         title="더블체크(확인 표시)"
                         style="margin-top:2px;width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--navy);">
                  <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:600;color:var(--navy);
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${escapeHtml(o.ship)}${isSplitRecord ? ' <span style="font-size:10px;font-weight:700;color:#b45309;">(분할)</span>' : ''}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo)}</div>
                    ${manualDeliveryNote(o.deliveryNote) ? `<div style="font-size:10px;font-weight:700;color:#dc2626;margin-top:3px;">📝 ${escapeHtml(manualDeliveryNote(o.deliveryNote).length > 22 ? manualDeliveryNote(o.deliveryNote).slice(0,22)+'…' : manualDeliveryNote(o.deliveryNote))}</div>` : ''}
                    ${(o.items||[]).map(item => {
                      const boxStr = formatItemBoxStr(item);
                      const rawDesc = item.desc || '';
                      const desc = escapeHtml(rawDesc.length > 18 ? rawDesc.slice(0,18)+'…' : rawDesc);
                      const qtyCol = ((item.qty||0) < 0 || isManualReturn) ? 'color:#dc2626;' : '';
                      return `<div style="font-size:10px;color:var(--muted);margin-top:3px;display:flex;gap:4px;align-items:center;">
                        <span style="color:var(--navy);font-weight:600;">${desc}</span>
                        <span style="${qtyCol}">${item.qty}${displayUnit(item.unit)}${boxStr ? ' · '+boxStr : ''}</span>
                      </div>`;
                    }).join('')}
                  </div>
                </div>
              </td>
              <td style="padding:10px;text-align:right;font-size:11px;font-weight:700;color:${isAnyReturn?'#dc2626':'#1a3a6e'};white-space:nowrap;vertical-align:top;">
                ${(o.items||[]).map((item, idx) => {
                  const isBrineItem = _isQuailBrine(item);
                  const isRawQItem  = _isQuailEgg(item);
                  const label = isBrineItem ? '깐메추리' : isRawQItem ? '🥚메추리' : '🥚계란';
                  if (_isPktUnit(item.unit)) {
                    // v3.3.32: 봉지 단위는 다른 화면과 동일하게 부분납품 진행률 미지원(0 처리)
                    // v3.3.33: 여러 날짜로 나뉜 경우 중복 집계를 막기 위해 완료일 레코드에만 표시
                    const q = (o.deliveryStatus === 'partial' || r.date !== (o.deliveredDate || o.date))
                      ? 0 : (Number(item.qty) || 0) * _boxSign(o);
                    if (!q) return '';
                    return `<div style="margin-bottom:2px;">🛍️봉지<br><span style="font-size:12px;">${formatPktCount(q)}</span></div>`;
                  }
                  // v3.3.33: 위 상단 합계(grandBoxes)와 기준을 맞춰, 이 카드는 "그 날짜에
                  // 배송된 몫"(r.perItemBoxes)만 표시 — 여러 날짜로 나뉘지 않은 일반 건은
                  // 기존과 동일하게 전체(또는 부분납품 진행분)가 그대로 나온다.
                  const bc = Number(r.perItemBoxes[idx]) || 0;
                  if (!bc) return '';
                  return `<div style="margin-bottom:2px;">${label}<br><span style="font-size:12px;">${formatBoxCount(bc)}</span></div>`;
                }).filter(Boolean).join('')}
              </td>
              <td style="padding:10px 14px;text-align:right;white-space:nowrap;">
                <div style="font-size:13px;font-weight:700;color:${amtCol};">${fmt(r.amt)}</div>
                ${(() => {
                  const disc = _calcOrderDiscount(o);
                  return disc.amount > 0
                    ? `<div style="font-size:9px;font-weight:700;color:#d97706;margin-top:2px;">🏷️ 할인 -${fmt(disc.amount)}${disc.pct ? ` (${disc.pct}%)` : ''}</div>`
                    : '';
                })()}
                <div style="font-size:10px;margin-top:2px;">${isReturnDoc ? '<span class="badge b-returned">↩️ 반품서</span>' : statusBadge(o.deliveryStatus)}</div>
              </td>
            </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f1f5f9;border-top:2px solid var(--border);">
              <td style="padding:9px 14px;font-size:12px;font-weight:700;color:var(--navy);">소계</td>
              <td style="padding:9px 10px;text-align:right;font-size:12px;font-weight:700;color:#1a3a6e;">
                ${formatBoxCount(day.totalBoxes)}
                ${(day.quailRawBoxes || day.quailBrineBoxes || day.quailBrinePkts) ? `
                <div style="font-size:10px;font-weight:500;color:var(--muted);margin-top:2px;line-height:1.5;">
                  🥚계란 ${formatBoxCount(day.eggBoxes)}
                  ${day.quailRawBoxes ? `<br>🥚메추리 ${formatBoxCount(day.quailRawBoxes)}` : ''}
                  ${(day.quailBrineBoxes || day.quailBrinePkts) ? `<br>깐메추리 ${day.quailBrineBoxes ? formatBoxCount(day.quailBrineBoxes) : ''}${day.quailBrineBoxes && day.quailBrinePkts ? ' ' : ''}${day.quailBrinePkts ? formatPktCount(day.quailBrinePkts) : ''}` : ''}
                </div>` : ''}
              </td>
              <td style="padding:9px 14px;text-align:right;font-size:12px;font-weight:700;color:var(--success);">${fmt(day.totalAmt)}</td>
            </tr>
          </tfoot>
        </table>
        </div><!-- /#dayId -->
      </div>
    `;}  ).join('')}
  `;
  // 최신 날짜만 펼치고 나머지 접기
  _initDelivDayCollapse(dayList.length);
}

// ══════════════════════════════════════════════════════
// 납품현황 날짜별 목표 박스 입력
// ══════════════════════════════════════════════════════
function openDelivGoal(dateStr, eggAutoOpen, quailAutoOpen, brineAutoOpen) {
  let goal = null;
  try { goal = JSON.parse(localStorage.getItem('delivGoal_' + dateStr) || 'null'); } catch(e) {}
  goal = goal || { egg: 0, quail: 0, brine: 0, eggDmg: 0, quailDmg: 0, brineDmg: 0 };
  // v3.3.44: 전일재고 직접 수정(override) 입력칸에 쓸 자동계산값 힌트 — 이미 override가
  // 저장돼 있으면 그 값이 곧 opening 계산에 쓰였을 것이므로 placeholder로도 자연스럽게 맞음.
  const autoOpen = { egg: eggAutoOpen || 0, quail: quailAutoOpen || 0, brine: brineAutoOpen || 0 };

  // 기존 모달이 있으면 제거
  const existing = document.getElementById('deliv-goal-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'deliv-goal-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;
    display:flex;align-items:flex-end;justify-content:center;`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 32px;width:100%;max-width:480px;
                box-sizing:border-box;box-shadow:0 -4px 24px rgba(0,0,0,.18);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--navy);">🎯 재고 입력</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${dateStr} · 입고는 더하고 파손(회수)은 차감되어 재고에 반영됩니다</div>
        </div>
        <button onclick="closeDelivGoal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);padding:4px 8px;">✕</button>
      </div>

      <!-- 품목별 입고 입력 -->
      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:18px;">
        ${[
          { id:'egg',   label:'🥚 계란(입고)' },
          { id:'quail', label:'🥚 메추리(입고)' },
          { id:'brine', label:'깐메추리(입고)' },
        ].map(({id, label}, i, arr) => {
          // egg→quail→brine 순으로 이동, 마지막(brine)은 파손 입력 그룹의 첫 칸(dmg-egg)으로 이동
          const nextId = i === arr.length - 1 ? 'dmg-egg' : 'goal-' + arr[i + 1].id;
          return `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:96px;font-size:12px;font-weight:700;color:var(--navy);flex-shrink:0;white-space:nowrap;">${label}</div>
          <button onclick="_adjustQty('goal-${id}',-1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);
                         background:#f8fafc;font-size:20px;cursor:pointer;line-height:1;">−</button>
          <input id="goal-${id}" type="number" min="0" inputmode="numeric"
                 enterkeyhint="next"
                 value="${id==='egg'?goal.egg||0:id==='quail'?goal.quail||0:goal.brine||0}"
                 onkeydown="_goalInputKeydown(event,'${nextId}')"
                 onfocus="this.select()"
                 style="width:64px;flex-shrink:0;text-align:center;font-size:18px;font-weight:800;
                        border:2px solid var(--border);border-radius:10px;padding:5px 4px;color:var(--navy);">
          <button onclick="_adjustQty('goal-${id}',1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);
                         background:#f8fafc;font-size:20px;cursor:pointer;line-height:1;">+</button>
          <span style="font-size:12px;color:var(--muted);flex-shrink:0;">박스</span>
        </div>`;}).join('')}
      </div>

      <!-- 품목별 파손(회수) 입력 -->
      <div style="font-size:12px;font-weight:800;color:#dc2626;margin-bottom:8px;">🔧 파손 회수 (전일재고에서 차감)</div>
      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:22px;">
        ${[
          { id:'egg',   label:'🥚 계란(파손)' },
          { id:'quail', label:'🥚 메추리(파손)' },
          { id:'brine', label:'깐메추리(파손)' },
        ].map(({id, label}, i, arr) => {
          const isLast = i === arr.length - 1;
          const nextId = isLast ? 'open-egg' : 'dmg-' + arr[i + 1].id;
          return `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:96px;font-size:12px;font-weight:700;color:#dc2626;flex-shrink:0;white-space:nowrap;">${label}</div>
          <button onclick="_adjustQty('dmg-${id}',-1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid #fca5a5;
                         background:#fff5f5;font-size:20px;cursor:pointer;line-height:1;color:#dc2626;">−</button>
          <input id="dmg-${id}" type="number" min="0" inputmode="numeric"
                 enterkeyhint="next"
                 value="${id==='egg'?goal.eggDmg||0:id==='quail'?goal.quailDmg||0:goal.brineDmg||0}"
                 onkeydown="_goalInputKeydown(event,'${nextId}')"
                 onfocus="this.select()"
                 style="width:64px;flex-shrink:0;text-align:center;font-size:18px;font-weight:800;
                        border:2px solid #fca5a5;border-radius:10px;padding:5px 4px;color:#dc2626;">
          <button onclick="_adjustQty('dmg-${id}',1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid #fca5a5;
                         background:#fff5f5;font-size:20px;cursor:pointer;line-height:1;color:#dc2626;">+</button>
          <span style="font-size:12px;color:var(--muted);flex-shrink:0;">박스</span>
        </div>`;}).join('')}
      </div>

      <!-- 전일재고 직접 수정 (선택 — 실사 결과와 다를 때 보정용) -->
      <div style="font-size:12px;font-weight:800;color:#4f46e5;margin-bottom:4px;">✏️ 전일재고 직접 수정 (선택)</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">비워두면 평소처럼 전날 재고를 자동으로 이어받습니다. 실사와 다를 때만 입력하세요.</div>
      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:22px;">
        ${[
          { id:'egg',   label:'🥚 계란(전일재고)' },
          { id:'quail', label:'🥚 메추리(전일재고)' },
          { id:'brine', label:'깐메추리(전일재고)' },
        ].map(({id, label}, i, arr) => {
          const isLast = i === arr.length - 1;
          const nextId = isLast ? '' : 'open-' + arr[i + 1].id;
          const curOverride = (goal[id + 'Open'] !== undefined && goal[id + 'Open'] !== null) ? goal[id + 'Open'] : '';
          return `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:96px;font-size:12px;font-weight:700;color:#4f46e5;flex-shrink:0;white-space:nowrap;">${label}</div>
          <input id="open-${id}" type="number" inputmode="numeric"
                 enterkeyhint="${isLast ? 'done' : 'next'}"
                 value="${curOverride}"
                 placeholder="자동:${autoOpen[id]}"
                 onkeydown="_goalInputKeydown(event,'${nextId}')"
                 onfocus="this.select()"
                 style="width:84px;flex-shrink:0;text-align:center;font-size:16px;font-weight:800;
                        border:2px solid #c7d2fe;border-radius:10px;padding:5px 4px;color:#4f46e5;">
          <span style="font-size:12px;color:var(--muted);flex-shrink:0;">박스</span>
        </div>`;}).join('')}
      </div>

      <!-- 버튼 -->
      <div style="display:flex;gap:10px;">
        <button onclick="clearDelivGoal('${dateStr}')"
                style="flex:1;padding:13px;border-radius:12px;border:1px solid #fca5a5;
                       background:#fff;color:#dc2626;font-size:14px;font-weight:700;cursor:pointer;">
          전체 삭제
        </button>
        <button onclick="saveDelivGoal('${dateStr}')"
                style="flex:2;padding:13px;border-radius:12px;border:none;
                       background:var(--navy);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">
          저장
        </button>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeDelivGoal(); });
  document.body.appendChild(overlay);
}

function closeDelivGoal() {
  const m = document.getElementById('deliv-goal-modal');
  if (m) m.remove();
}

// 모바일 키보드의 '다음/완료' 버튼(Enter) 처리 — 다음 입력칸으로 포커스 이동,
// 마지막 칸이면 키보드를 닫는다 (기존엔 아무 반응이 없어 다음 필드로 못 넘어가던 문제)
function _goalInputKeydown(e, nextId) {
  if (e.key !== 'Enter' && e.keyCode !== 13) return;
  e.preventDefault();
  const nextEl = nextId && document.getElementById(nextId);
  if (nextEl) {
    nextEl.focus();
    nextEl.select();
  } else {
    e.target.blur();
  }
}

// 입고(goal-*)·파손(dmg-*) 입력칸 공용 +/- 처리 (전달받은 id로 직접 조작)
function _adjustQty(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const newVal = Math.max(0, (parseInt(input.value) || 0) + delta);
  input.value = newVal;
}

function saveDelivGoal(dateStr) {
  const goal = {
    egg:   Math.max(0, parseInt(document.getElementById('goal-egg')?.value)   || 0),
    quail: Math.max(0, parseInt(document.getElementById('goal-quail')?.value) || 0),
    brine: Math.max(0, parseInt(document.getElementById('goal-brine')?.value) || 0),
    eggDmg:   Math.max(0, parseInt(document.getElementById('dmg-egg')?.value)   || 0),
    quailDmg: Math.max(0, parseInt(document.getElementById('dmg-quail')?.value) || 0),
    brineDmg: Math.max(0, parseInt(document.getElementById('dmg-brine')?.value) || 0),
  };
  // v3.3.44: 전일재고 직접 수정(override) — 빈칸이면 저장하지 않음(=자동 계산 유지),
  // 숫자를 입력한 경우에만 그 값을 opening으로 강제 사용하도록 필드를 추가.
  ['egg', 'quail', 'brine'].forEach(id => {
    const raw = document.getElementById('open-' + id)?.value;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) goal[id + 'Open'] = n;
    }
  });
  const hasOverride = goal.eggOpen !== undefined || goal.quailOpen !== undefined || goal.brineOpen !== undefined;
  const allZero = !hasOverride
               && goal.egg === 0 && goal.quail === 0 && goal.brine === 0
               && goal.eggDmg === 0 && goal.quailDmg === 0 && goal.brineDmg === 0;
  if (allZero) {
    localStorage.removeItem('delivGoal_' + dateStr);
  } else {
    localStorage.setItem('delivGoal_' + dateStr, JSON.stringify(goal));
  }
  closeDelivGoal();
  // 현재 열려있는 날짜 인덱스 기억 후 재렌더
  _reRenderDelivKeepOpen();
  // v3.3.25: 재고 이력도 Firebase에 자동 백업 (기존엔 이 기기 localStorage에만 남아
  // 캐시 삭제 시 함께 사라졌음)
  if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
  toast('🎯 저장되었습니다.');
}

function clearDelivGoal(dateStr) {
  localStorage.removeItem('delivGoal_' + dateStr);
  closeDelivGoal();
  _reRenderDelivKeepOpen();
  if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
  toast('입고·파손·전일재고 수정이 모두 삭제되었습니다.');
}

// 현재 열려있는 날짜 인덱스를 보존하며 납품현황 재렌더
function _reRenderDelivKeepOpen() {
  // 열린 날짜 인덱스 수집
  const openIdxs = new Set();
  document.querySelectorAll('[id^="deliv-day-"]').forEach(el => {
    if (!el.id.includes('-arrow') && el.style.display !== 'none') {
      const idx = parseInt(el.id.replace('deliv-day-', ''));
      if (!isNaN(idx)) openIdxs.add(idx);
    }
  });
  renderDeliveryStatus();
  // _initDelivDayCollapse가 이미 실행됐으므로 열렸던 것만 다시 열기
  openIdxs.forEach(idx => {
    const body  = document.getElementById(`deliv-day-${idx}`);
    const arrow = document.getElementById(`deliv-day-${idx}-arrow`);
    if (body)  body.style.display = 'block';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  });
}

// ── 납품현황 행 더블체크(수기 확인) ──
// 납품상태와는 별개로, 사람이 눈으로 한 번 더 확인했다는 표시를 남기고 싶을 때 사용.
// localStorage에 확인된 발주 id 목록만 저장한다 (금액/재고 집계에는 전혀 영향 없음).
const DBL_CHECK_KEY = 'deliveryDblCheck';

function _loadDblCheckSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DBL_CHECK_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _saveDblCheckSet(set) {
  try { localStorage.setItem(DBL_CHECK_KEY, JSON.stringify([...set])); } catch(e) {}
}
function _isDblChecked(id) {
  return _loadDblCheckSet().has(id);
}

function toggleDblCheck(id, ev) {
  if (ev) ev.stopPropagation(); // 체크박스 클릭이 행 전체의 openModal로 번지지 않도록 차단
  const set = _loadDblCheckSet();
  const willCheck = !set.has(id);
  if (willCheck) set.add(id); else set.delete(id);
  _saveDblCheckSet(set);
  // 전체 재렌더 없이 해당 행만 즉시 반영 (스크롤 위치 유지)
  // v3.3.33: 부분납품이 여러 날짜로 나뉘면 같은 발주가 여러 행(날짜별)에 나타날 수 있어
  // id 하나가 아니라 data-dbl-id로 전부 찾아서 동일하게 반영한다.
  document.querySelectorAll(`[data-dbl-id="${id}"]`).forEach(el => {
    if (el.tagName === 'INPUT') el.checked = willCheck;
    else el.style.opacity = willCheck ? '.55' : '1';
  });
}

// ── 발주목록 반품 확인 체크 (기기별 저장, 더블체크와 동일한 방식·다른 기기와는 공유되지 않음) ──
const RETURN_CHK_KEY = 'orderReturnCheck';
// v3.3.45: id별로 "언제 확인 체크했는지" 날짜도 함께 저장 — 반품의 재고 반영을 원래
// 납품일이 아니라 "실제로 확인한 날"에 기록하기 위한 용도(사용자 요청).
const RETURN_CHK_DATE_KEY = 'orderReturnCheckDate';
function _loadReturnChkSet() {
  try { return new Set(JSON.parse(localStorage.getItem(RETURN_CHK_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _saveReturnChkSet(set) {
  try { localStorage.setItem(RETURN_CHK_KEY, JSON.stringify([...set])); } catch(e) {}
}
function _loadReturnChkDateMap() {
  try { return JSON.parse(localStorage.getItem(RETURN_CHK_DATE_KEY) || '{}'); }
  catch(e) { return {}; }
}
function _saveReturnChkDateMap(map) {
  try { localStorage.setItem(RETURN_CHK_DATE_KEY, JSON.stringify(map)); } catch(e) {}
}
function _isReturnChecked(id) {
  return _loadReturnChkSet().has(id);
}
// 확인 체크한 날짜(없으면 빈 문자열 — v3.3.41 마이그레이션으로 자동 확인된 기존 반품
// 건들은 날짜가 없고, 이 경우 helpers.js에서 기존처럼 원래 납품일을 그대로 사용한다).
function _returnCheckedDate(id) {
  return _loadReturnChkDateMap()[id] || '';
}
// v3.3.43: 반품 확인 체크만 지우는 헬퍼(더블체크는 그대로 둠) — 반품 상태에서 다른 상태로
// 전환될 때(미납품/납품완료/발주취소로 되돌리기) 호출해, 나중에 이 발주가 다시 반품
// 처리되더라도 예전 체크가 남아 자동으로 "재고반영됨"이 되지 않도록 한다.
function _pruneReturnChk(id) {
  const ret = _loadReturnChkSet();
  if (ret.delete(id)) _saveReturnChkSet(ret);
  const dateMap = _loadReturnChkDateMap();
  if (dateMap[id] !== undefined) { delete dateMap[id]; _saveReturnChkDateMap(dateMap); }
}
function toggleReturnChk(id, ev) {
  if (ev) ev.stopPropagation(); // 체크박스 클릭이 카드 전체의 openModal로 번지지 않도록 차단
  const set = _loadReturnChkSet();
  const willCheck = !set.has(id);
  if (willCheck) set.add(id); else set.delete(id);
  _saveReturnChkSet(set);
  // v3.3.45: 체크(확인)하는 순간의 날짜를 함께 저장 — 재고 반영 시점을 이 날짜로 쓴다.
  // 체크 해제 시에는 날짜도 함께 지워, 나중에 다시 체크하면 그때의 새 날짜로 기록된다.
  const dateMap = _loadReturnChkDateMap();
  if (willCheck) dateMap[id] = todayStr();
  else delete dateMap[id];
  _saveReturnChkDateMap(dateMap);
  // v3.3.41: 이 체크가 재고 반영 여부(_boxSign 참고)를 좌우하게 되면서, 체크박스 하나만
  // 로컬로 토글하던 예전 방식으론 대시보드·발주목록의 집계 숫자가 갱신되지 않는다.
  // renderAll()로 전체를 다시 그려 총 박스·재고 관련 숫자가 즉시 반영되도록 한다.
  renderAll();
}

// v3.3.14 fix: 발주 삭제(개별/전체초기화) 시 더블체크·반품확인 표시도 함께 정리.
// 그동안 orders에서 발주를 지워도 deliveryDblCheck·orderReturnCheck localStorage
// Set에는 그 id가 계속 남아 데이터가 커질수록 조금씩 쌓이기만 했음.
function _pruneOrderChecks(id) {
  const dbl = _loadDblCheckSet();
  if (dbl.delete(id)) _saveDblCheckSet(dbl);
  _pruneReturnChk(id);
}

// ── 납품현황 날짜 그룹 접기/펼치기 ──
function toggleDelivDay(dayId) {
  const body  = document.getElementById(dayId);
  const arrow = document.getElementById(dayId + '-arrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display  = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}

// 납품현황 렌더 후 최신 날짜 1개만 펼치고 나머지 접기
function _initDelivDayCollapse(count) {
  for (let i = 0; i < count; i++) {
    const dayId = `deliv-day-${i}`;
    const body  = document.getElementById(dayId);
    const arrow = document.getElementById(dayId + '-arrow');
    if (!body) continue;
    if (i === 0) {
      // 최신 날짜: 펼침 (기본)
      body.style.display = 'block';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    } else {
      // 나머지: 접힘
      body.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(-90deg)';
    }
  }
}

// ── 대시보드 날짜별 기록 ──
function toggleDashByDate() {
  const el  = document.getElementById('dash-bydate');
  const btn = document.getElementById('dash-bydate-btn');
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  btn.textContent  = open ? '접기 ▴' : '펼치기 ▾';
  if (open) renderDashByDate();
}

function renderDashByDate() {
  const el = document.getElementById('dash-bydate');
  if (!el) return;

  // 날짜별 그룹핑 (선택된 월의 납품완료 + 부분납품 + 반품 전체, 발주취소는 제외)
  const monthOrders = _filterByMonth(orders, _dashMonth);
  const target = monthOrders.filter(o =>
    o.deliveryStatus === 'delivered' ||
    o.deliveryStatus === 'partial' ||
    o.deliveryStatus === 'returned'
  );

  // v3.3.33: 부분납품이 여러 날짜에 걸치면 배송 이력(deliveryEvents) 기준으로 날짜별
  // 레코드(record)로 나눠서 반영 — 납품현황 탭과 동일한 기준으로 통일
  const byDay = {};
  target.forEach(o => {
    _deliveryRecordsFor(o).forEach(r => {
      const d = r.date;
      if (!byDay[d]) byDay[d] = { date: d, records: [], amt: 0, boxes: 0 };
      byDay[d].records.push(r);
      byDay[d].amt   += r.amt;
      byDay[d].boxes += r.boxes;
    });
  });

  // 각 날짜 내 선명은 기본적으로 알파벳(가나다) 순 정렬
  Object.values(byDay).forEach(day => {
    day.records.sort((a, b) => (a.order.ship || '').localeCompare(b.order.ship || ''));
  });

  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  if (!dayList.length) {
    el.innerHTML = '<div class="empty" style="padding:20px;"><div class="empty-icon">📅</div><div class="empty-t">기록 없음</div></div>';
    return;
  }

  el.innerHTML = dayList.map(day => {
    const dateObj = new Date(day.date);
    const weekDay = ['일','월','화','수','목','금','토'][dateObj.getDay()];
    const dateStr = `${dateObj.getMonth()+1}월 ${dateObj.getDate()}일 (${weekDay})`;

    return `
    <div style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="background:var(--navy);color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;"
           onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <span style="font-size:13px;font-weight:700;">📅 ${dateStr} · ${day.records.length}건</span>
        <span style="font-size:12px;opacity:.85;">${formatBoxCount(day.boxes)} · ${fmt(day.amt)}</span>
      </div>
      <div>
        ${day.records.filter(r => !r.order.archived).map(r => {
          const o = r.order;
          const isReturnDoc = !!o.isReturn;
          const isReturn    = o.deliveryStatus === 'returned';
          const isManualReturn = isReturn && !isReturnDoc;
          const isPartialRow = o.deliveryStatus === 'partial';
          // 반품서(업로드) → 빨간 배경+테두리 / 수동반품 → 연분홍 / 부분납품 → 연노랑 / 납품완료 → 연초록
          const statusColor = isReturnDoc ? '#fff0f0' : isReturn ? '#fef2f2' : isPartialRow ? '#fffbeb' : '#f0fdf4';
          const borderLeft  = isReturnDoc ? '3px solid #dc2626' : 'none';
          const statusText  = isReturnDoc ? '↩️ 반품서' : isReturn ? '반품' : isPartialRow ? '🚚 부분납품' : '납품완료';
          const statusCol   = isReturn ? '#dc2626' : isPartialRow ? '#b45309' : '#16a34a';
          const amtCol      = isReturnDoc ? '#dc2626' : statusCol;
          const rowBoxes    = r.boxes; // v3.3.33: 여러 날짜로 나뉜 경우 이 날짜분만(부호 포함)
          return `
          <div style="padding:10px 14px;border-top:1px solid var(--border);background:${statusColor};border-left:${borderLeft};cursor:pointer;"
               onclick="openModal('${o.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--navy);">${escapeHtml(o.ship)}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo)}</div>
                ${manualDeliveryNote(o.deliveryNote) ? `<div style="font-size:10px;font-weight:700;color:#dc2626;margin-top:3px;">📝 ${escapeHtml(manualDeliveryNote(o.deliveryNote).length > 22 ? manualDeliveryNote(o.deliveryNote).slice(0,22)+'…' : manualDeliveryNote(o.deliveryNote))}</div>` : ''}
                ${(o.items||[]).map(i => {
                  const qtyCol = ((i.qty||0) < 0 || isManualReturn) ? 'color:#dc2626;' : '';
                  const boxStr = formatItemBoxStr(i);
                  return `<div style="font-size:11px;color:#555;margin-top:3px;${qtyCol}">${escapeHtml((i.desc||'').slice(0,22))} · ${i.qty}${displayUnit(i.unit)}${boxStr ? ' · '+boxStr : ''}</div>`;
                }).join('')}
              </div>
              <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                <div style="font-size:13px;font-weight:700;color:${amtCol};">${fmt(r.amt)}</div>
                <div style="font-size:10px;color:${amtCol};margin-top:3px;font-weight:600;">${statusText}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${formatBoxCount(rowBoxes)}</div>
              </div>
            </div>
          </div>`;
        }).join('')}
        <div style="padding:8px 14px;background:#f8fafc;display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--navy);border-top:1px solid var(--border);">
          <span>소계 ${day.records.length}건</span>
          <span>${formatBoxCount(day.boxes)} · ${fmt(day.amt)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
// v3.3.26: 품목 추가 idx 충돌 버그로 인한 과거 손상 데이터 자가 점검 도구
// ══════════════════════════════════════════════════════
// 이 버그는 "새로 입력한 품목이 사라지고, 그 자리에 기존 품목과 완전히
// 동일한(품목명·CODE·수량·단위·단가 모두 같은) 항목이 대신 중복 저장"되는
// 형태로 흔적을 남긴다. 실제로 같은 품목을 의도적으로 두 줄로 나눠 적는
// 경우도 드물게 있을 수 있어 100% 확정 판정은 아니지만, 확인해볼 만한
// 후보를 빠르게 찾아주는 참고용 도구.
function checkDuplicateItems() {
  const flagged = [];
  orders.forEach(o => {
    const items = o.items || [];
    if (items.length < 2) return;
    const seen = new Set();
    const dupDescs = new Set();
    items.forEach(it => {
      const key = [it.desc, it.code, it.qty, it.unit, it.price].join('|');
      if (seen.has(key)) dupDescs.add(it.desc || '(품목명 없음)');
      seen.add(key);
    });
    if (dupDescs.size > 0) flagged.push({ order: o, dupDescs: [...dupDescs] });
  });

  if (!flagged.length) {
    toast('✅ 중복 품목 의심 사례 없음 — 이상 없습니다');
    return;
  }

  const rows = flagged.map(({ order: o, dupDescs }) => `
    <div onclick="_closeDupCheckOv(); openModal('${o.id}');"
         style="padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;">
      <div style="font-weight:800;color:var(--navy);font-size:14px;">${escapeHtml(o.ship || '(선명 없음)')}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo || '')} · ${escapeHtml(o.date || '')}</div>
      <div style="font-size:12px;color:#dc2626;margin-top:4px;">⚠️ 중복 의심 품목: ${dupDescs.map(escapeHtml).join(', ')}</div>
    </div>`).join('');

  const ov = document.createElement('div');
  ov.id = 'dupCheckOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;';
  ov.onclick = (e) => { if (e.target === ov) _closeDupCheckOv(); };
  ov.innerHTML = `
    <div style="background:#fff;width:100%;max-height:80vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;">
      <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--navy);">⚠️ 중복 품목 의심 발주 — ${flagged.length}건</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">v3.3.26에서 수정한 품목 추가 버그로 인한 손상 가능성이 있는 건이에요. 탭하면 상세 확인 후 필요시 수정해주세요.</div>
        </div>
        <button onclick="_closeDupCheckOv()" style="background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;padding:4px 8px;flex-shrink:0;">✕</button>
      </div>
      <div style="overflow-y:auto;">${rows}</div>
    </div>`;
  document.body.appendChild(ov);
}

function _closeDupCheckOv() {
  const ov = document.getElementById('dupCheckOv');
  if (ov) ov.remove();
}
