// ══════════════════════════════════════════════════════
// ui.js  —  렌더링 전용 (대시보드 · 발주목록 · 통계)
// ══════════════════════════════════════════════════════

// ── 필터 상태 ──
let filterMode = 'all';
let statusMode = 'all';
let searchQ    = '';

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
  const total = orders.reduce((s, o) => s + (o.total || 0), 0);

  // 대시보드 본문은 선택된 월(_dashMonth) 데이터만 사용
  _renderDashMonthNav();
  const monthOrders = _filterByMonth(orders, _dashMonth);
  const ships = new Set(monthOrders.map(o => o.ship)).size;

  // 납품 기준 통계 (해당 월)
  const deliveredOrders = monthOrders.filter(o => o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial');
  const deliveredBoxes  = deliveredOrders.reduce((s, o) => s + calcOrderBoxes(o), 0);
  const netTotal        = monthOrders.reduce((s, o) => s + calcNetDelivery(o), 0);
  const deliveredCnt    = deliveredOrders.length;

  // 납품 박스 품목별 집계: 계란 / 생메추리 / 깐메추리
  let dashEggBoxes = 0, dashQuailRawBoxes = 0, dashQuailBrineBoxes = 0, dashQuailBrinePkts = 0;
  deliveredOrders.forEach(o => {
    (o.items || []).forEach(item => {
      const bc = calcItemBoxCount(item);
      if (_isQuailBrine(item)) {
        if (_isPktUnit(item.unit)) dashQuailBrinePkts  += (Number(item.qty) || 0);
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
  document.getElementById('h-cnt').textContent    = orders.filter(o => !o.archived).length;
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
  const partial     = monthOrders.filter(o => o.deliveryStatus === 'partial');
  // 미납품(pending)은 발주월과 무관하게 항상 "지금 처리 안 된 전체 건"을 보여줌 (예외: 월 필터 미적용)
  const pendingAll  = orders.filter(o => !o.archived && (!o.deliveryStatus || o.deliveryStatus === 'pending'));

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  // 반품서(isReturn): total이 이미 음수이므로 Math.abs 사용; 수동반품: returnAmount는 양수
  const returnedAmt  = returned.reduce((s, o) => s + (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount || Math.abs(o.total) || 0)), 0);
  const partialAmt   = partial.reduce((s, o) => s + (o.total || 0), 0);
  const pendingAllAmt = pendingAll.reduce((s, o) => s + (o.total || 0), 0);
  const netAmt       = deliveredAmt - returnedAmt;

  document.getElementById('ds-delivered-cnt').textContent = delivered.length;
  document.getElementById('ds-returned-cnt').textContent  = returned.length;
  document.getElementById('ds-pending-cnt').textContent   = pendingAll.length + partial.length;
  document.getElementById('ds-delivered-amt').textContent = fmt(deliveredAmt);
  document.getElementById('ds-returned-amt').textContent  = returned.length ? '-' + fmt(returnedAmt) : fmt(0);
  document.getElementById('ds-returned-amt').style.color = returned.length ? '#f87171' : '';
  document.getElementById('ds-pending-amt').textContent   = fmt(pendingAllAmt + partialAmt);
  document.getElementById('ds-net-amt').textContent       = fmt(netAmt);

  // 대시보드 최근 목록 — 납품완료 + 반품 표시 (보관건 제외, 해당 월)
  const recent = [...monthOrders]
    .filter(o => !o.archived && (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial' || o.deliveryStatus === 'returned'))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  document.getElementById('dash-list').innerHTML = recent.length
    ? recent.map(o => orderCard(o, false)).join('')
    : '<div class="empty"><div class="empty-icon">📦</div><div class="empty-t">납품완료 내역 없음</div></div>';

  // 날짜별 기록 (펼쳐진 상태면 즉시 재렌더)
  const bydateEl = document.getElementById('dash-bydate');
  if (bydateEl && bydateEl.style.display !== 'none') renderDashByDate();

  // 발주 목록
  const list = filtered();
  const archivedCnt = orders.filter(o => !!o.archived).length;
  const subTxt = statusMode === 'archived'
    ? `보관함 ${list.length}건`
    : `${list.length}건${archivedCnt > 0 ? ` · 📦보관 ${archivedCnt}` : ''}`;
  document.getElementById('o-sub').textContent      = subTxt;
  document.getElementById('orders-list').innerHTML  = list.length
    ? list.map(o => orderCard(o, true)).join('')
    : `<div class="empty"><div class="empty-icon">${statusMode === 'archived' ? '📦' : '📭'}</div><div class="empty-t">${statusMode === 'archived' ? '보관된 발주가 없습니다' : '결과 없음'}</div></div>`;
}

// ── 발주 카드 HTML ──
function orderCard(o, showDel) {
  const item        = o.items?.[0] || {};
  const isReturnDoc = !!o.isReturn;
  const delBtn      = showDel
    ? `<button class="btn btn-d btn-sm" onclick="event.stopPropagation();delOrder('${o.id}')">삭제</button>`
    : '';
  const net       = calcNetDelivery(o);
  const netStr    = o.deliveryStatus && o.deliveryStatus !== 'pending'
    ? `<span class="oc-net">실납품: <b>${net < 0 ? '-' + fmt(-net) : fmt(net)}</b></span>`
    : '';
  const statusClass = o.deliveryStatus === 'delivered' ? 'status-delivered'
    : o.deliveryStatus === 'returned' ? 'status-returned'
    : o.deliveryStatus === 'partial'  ? 'status-partial'
    : '';
  // 반품서 뱃지 (업로드된 반품서만)
  const returnDocBadge = isReturnDoc
    ? `<span class="badge b-returned" style="font-size:10px;">↩️ 반품서</span>`
    : '';
  // 금액 색상: 반품서는 빨간색
  const amtStyle = isReturnDoc ? 'color:#dc2626;font-weight:700;' : '';

  // 보관 뱃지
  const archivedBadge = o.archived
    ? `<span class="badge b-archived">📦 보관중</span>`
    : '';

  // 일괄 모드 처리 (납품 or 보관)
  let canBulk, isDisabled, bulkClass, bulkChk, clickHandler;
  if (isBulkMode && showDel) {
    const isChecked = bulkSelected.has(o.id);
    if (isBulkMode === 'deliver') {
      canBulk = !isReturnDoc && o.deliveryStatus !== 'delivered' && o.deliveryStatus !== 'returned' && !o.archived;
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

  return `
  <div class="order-card ${statusClass}${isReturnDoc ? ' is-return-doc' : ''}${o.archived ? ' archived-card' : ''}${bulkClass}" ${clickHandler}>
    ${bulkChk}
    <div class="oc-top">
      <div class="oc-ship">${escapeHtml(o.ship)}</div>
      <div class="oc-amount" style="${amtStyle}">${fmt(o.total)}</div>
    </div>
    <div class="oc-meta">
      <span class="oc-doc">${escapeHtml(o.docNo)}</span>
      ${badge(o.category)}
      ${returnDocBadge}
      ${archivedBadge}
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
    ${netStr ? `<div class="oc-status-row">${netStr}</div>` : ''}
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
              onclick="selectStatMonth('${lastYM}')">저번달</button>` : ''}
      ${availableMonths
        .filter(m => m !== thisYM && m !== lastYM)
        .map(m => {
          const [y, mo] = m.split('-');
          return `<button class="chip${_statMonth===m?' active':''}" style="font-size:11px;"
                          onclick="selectStatMonth('${m}')">${Number(y)}년 ${Number(mo)}월</button>`;
        }).join('')}
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
      const mDel    = mOrders.filter(o => o.deliveryStatus === 'delivered');
      const mRet    = mOrders.filter(o => o.deliveryStatus === 'returned');
      const mPar    = mOrders.filter(o => o.deliveryStatus === 'partial');
      const mDelAmt = mDel.reduce((s,o) => s+(o.total||0), 0);
      const mRetAmt = mRet.reduce((s,o) => s+(o.isReturn ? Math.abs(o.total||0) : (o.returnAmount||Math.abs(o.total)||0)), 0);
      const mParAmt = mPar.reduce((s,o) => s+(o.partialAmount||0), 0);
      const mNet    = mDelAmt + mParAmt - mRetAmt;
      const mBoxes  = [...mDel, ...mPar].reduce((s,o) => s + calcOrderBoxes(o), 0);
      const mCruise = mOrders.filter(o => o.category === 'cruise');
      const mCargo  = mOrders.filter(o => o.category !== 'cruise');
      const mCruiseNet = mCruise.reduce((s,o) => s + calcNetDelivery(o), 0);
      const mCargoNet  = mCargo.reduce((s,o) => s + calcNetDelivery(o), 0);
      return { m, y, mo, net: mNet, boxes: mBoxes, cnt: mDel.length + mPar.length,
               delAmt: mDelAmt + mParAmt, retAmt: mRetAmt,
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
          <div style="display:flex;align-items:flex-end;gap:6px;height:90px;">
            ${[...monthData].reverse().map(d => {
              const pct = Math.max((d.net / maxNet) * 100, 2);
              const isThis = d.m === thisYM;
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;"
                     onclick="selectStatMonth('${d.m}')">
                  <div style="font-size:9px;color:var(--muted);writing-mode:initial;">
                    ${fmt(d.net).replace('₩','').replace(',000','.0K').replace(/(\d{1,3}),(\d{3})$/,'$1.$2K')}
                  </div>
                  <div style="width:100%;background:${isThis ? 'var(--accent)' : 'var(--accent-light)'};
                              border-radius:4px 4px 0 0;height:${pct}%;min-height:4px;opacity:${isThis?1:0.7};
                              transition:opacity .15s;" title="${d.m} · ${fmt(d.net)}"></div>
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
        <button onclick="exportMonthCSV('${_statMonth}')"
                style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;
                       border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">
          📥 CSV 내보내기
        </button>
      </div>`;
  }

  // ── 데이터 필터 ──
  const scopeOrders = _filterByMonth(orders, _statMonth);

  const delivered = scopeOrders.filter(o => o.deliveryStatus === 'delivered');
  const returned  = scopeOrders.filter(o => o.deliveryStatus === 'returned');
  const partial   = scopeOrders.filter(o => o.deliveryStatus === 'partial');
  const pending   = scopeOrders.filter(o => !o.deliveryStatus || o.deliveryStatus === 'pending');

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  const returnedAmt  = returned.reduce((s, o) => s + (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount || Math.abs(o.total) || 0)), 0);
  const partialAmt   = partial.reduce((s, o) => s + (o.partialAmount || 0), 0);
  const netAmt       = deliveredAmt + partialAmt - returnedAmt;

  // 총 박스 수
  const totalBoxes = [...delivered, ...partial].reduce((s,o) => s + calcOrderBoxes(o), 0);

  // ── 크루즈 / 카고 구분 집계 ──
  const doneOrders = [...delivered, ...partial];
  const cruiseOrders = doneOrders.filter(o => o.category === 'cruise');
  const cargoOrders  = doneOrders.filter(o => o.category !== 'cruise');
  const cruiseAmt = cruiseOrders.reduce((s,o) => s + calcNetDelivery(o), 0);
  const cargoAmt  = cargoOrders.reduce((s,o) => s + calcNetDelivery(o), 0);
  const cruiseBoxes = cruiseOrders.reduce((s,o) => s + calcOrderBoxes(o), 0);
  const cargoBoxes  = cargoOrders.reduce((s,o) => s + calcOrderBoxes(o), 0);

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

  // ── 일별 납품 집계 ──
  const byDay = {};
  [...delivered, ...partial, ...returned].forEach(o => {
    const d = o.deliveredDate || o.date || '미상';
    if (!byDay[d]) byDay[d] = { date: d, cnt: 0, amt: 0, boxes: 0, orders: [] };
    byDay[d].cnt++;
    byDay[d].amt   += calcNetDelivery(o);
    byDay[d].boxes += calcOrderBoxes(o);
    byDay[d].orders.push(o);
  });
  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  // ── 선명별 집계 ──
  const byShip = {};
  scopeOrders.forEach(o => {
    if (!byShip[o.ship]) byShip[o.ship] = { ship: o.ship, cnt: 0, total: 0, net: 0, returned: 0, boxes: 0 };
    byShip[o.ship].cnt++;
    byShip[o.ship].total   += (o.total || 0);
    byShip[o.ship].net     += calcNetDelivery(o);
    byShip[o.ship].boxes   += calcOrderBoxes(o);
    if (o.deliveryStatus === 'returned')
      byShip[o.ship].returned += (o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount || Math.abs(o.total) || 0));
  });
  const ships = Object.values(byShip).sort((a, b) => b.net - a.net);

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
          <div class="ds-val c-pending">${fmt(partialAmt)}</div>
          <div class="ds-lbl">부분납품</div>
          <div class="ds-amount">${partial.length}건</div>
        </div>
      </div>
      <div class="ds-net">
        <div class="ds-net-lbl">실 납품금액 합계</div>
        <div class="ds-net-val">${fmt(netAmt)}</div>
      </div>
      <!-- 총 박스 수 -->
      <div style="text-align:center;font-size:12px;color:var(--muted);padding:6px 0 2px;">
        총 납품 <strong style="color:var(--navy);">${formatBoxCount(totalBoxes)}</strong>
      </div>
    </div>

    <!-- 크루즈 / 카고 구분 -->
    ${categoryHtml}

    <!-- 일별 납품 정리 -->
    ${dayList.length ? `
    <div class="sdiv" style="display:flex;align-items:center;justify-content:space-between;">
      <span>일별 납품 현황</span>
      <span style="font-size:10px;color:var(--muted);font-weight:400;">${dayList.length}일</span>
    </div>
    ${dayList.map(day => `
      <div class="form-card" style="padding:0;overflow:hidden;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--border);cursor:pointer;"
             onclick="this.nextElementSibling.classList.toggle('collapsed')">
          <div>
            <span style="font-size:13px;font-weight:700;color:var(--navy);">📅 ${fmtDate(day.date)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:8px;">${day.cnt}건 · ${formatBoxCount(day.boxes)}</span>
          </div>
          <span style="font-size:13px;font-weight:700;color:var(--success);">${fmt(day.amt)}</span>
        </div>
        <div class="day-orders">
          ${day.orders.map(o => `
            <div onclick="openModal('${o.id}')"
                 style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;
                        background:${o.isReturn ? '#fff0f0' : o.deliveryStatus==='partial'?'#fffbeb':'#fff'};
                        border-left:${o.isReturn ? '3px solid #dc2626' : 'none'};">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(o.ship)}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo)||'-'} ${o.items?.[0]?.desc?'· '+escapeHtml(o.items[0].desc):''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                <div style="font-size:13px;font-weight:700;color:${o.isReturn ? '#dc2626' : 'inherit'};">${fmt(calcNetDelivery(o))}</div>
                <div style="font-size:10px;margin-top:2px;">${o.isReturn ? '<span class="badge b-returned">↩️ 반품서</span>' : statusBadge(o.deliveryStatus)}</div>
              </div>
            </div>
          `).join('')}
          <div style="display:flex;justify-content:space-between;padding:8px 14px;
                      background:var(--bg);font-size:12px;color:var(--muted);">
            <span>${day.cnt}건 · ${formatBoxCount(day.boxes)}</span>
            <span style="font-weight:700;color:var(--navy);">합계 ${fmt(day.amt)}</span>
          </div>
        </div>
      </div>
    `).join('')}` : ''}

    <!-- 미납품 목록 -->
    ${pending.length ? `
    <div class="sdiv">미납품 발주 (${pending.length}건)</div>
    ${pending.sort((a, b) => a.date.localeCompare(b.date)).map(o => `
      <div class="order-card" onclick="openModal('${o.id}')">
        <div class="oc-top"><div class="oc-ship">${escapeHtml(o.ship)}</div><div class="oc-amount">${fmt(o.total)}</div></div>
        <div class="oc-meta"><span class="oc-doc">${escapeHtml(o.docNo)}</span>${badge(o.category)}${statusBadge('pending')}</div>
        <div class="oc-bottom"><div class="oc-item">${escapeHtml(o.date)}</div></div>
      </div>
    `).join('')}` : ''}

    <!-- 반품 내역 -->
    ${returned.length ? `
    <div class="sdiv">반품 내역 (${returned.length}건)</div>
    ${returned.map(o => `
      <div class="order-card status-returned" onclick="openModal('${o.id}')">
        <div class="oc-top"><div class="oc-ship">${escapeHtml(o.ship)}</div><div class="oc-amount" style="color:var(--danger);">-${fmt(o.isReturn ? Math.abs(o.total || 0) : (o.returnAmount || Math.abs(o.total) || 0))}</div></div>
        <div class="oc-meta"><span class="oc-doc">${escapeHtml(o.docNo)}</span>${o.isReturn ? '<span class="badge b-returned">↩️ 반품서</span>' : statusBadge('returned')}</div>
        <div class="oc-bottom"><div class="oc-item">${escapeHtml(o.deliveryNote) || '-'}</div><div class="oc-dates">${escapeHtml(o.date)}</div></div>
      </div>
    `).join('')}` : ''}

    <!-- 선명별 납품 현황 (박스 열 추가) -->
    ${ships.length ? `
    <div class="sdiv">선명별 납품 현황</div>
    <div class="form-card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:var(--bg);">
            <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;">선명</th>
            <th style="padding:10px 6px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">박스</th>
            <th style="padding:10px 6px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">반품</th>
            <th style="padding:10px 12px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">실납품</th>
          </tr>
        </thead>
        <tbody>
          ${ships.map(s => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:10px 12px;font-weight:600;font-size:11px;">${escapeHtml(s.ship)}</td>
            <td style="padding:10px 6px;text-align:right;font-family:monospace;color:var(--muted);font-size:11px;">${formatBoxCount(s.boxes)}</td>
            <td style="padding:10px 6px;text-align:right;font-family:monospace;color:var(--danger);font-size:11px;">${s.returned ? '-'+fmt(s.returned) : '-'}</td>
            <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700;font-size:11px;
                color:${s.net >= 0 ? 'var(--navy)' : 'var(--danger)'};">${fmt(s.net)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
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

function selectDelivMonth(m) {
  _delivMonth = m;
  renderDeliveryStatus();
}

function renderDeliveryStatus() {
  const el = document.getElementById('delivery-status-content');
  if (!el) return;

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
              onclick="selectDelivMonth('${lastYM}')">저번달</button>` : ''}
      ${availableMonths
        .filter(m => m !== thisYM && m !== lastYM)
        .map(m => {
          const [y, mo] = m.split('-');
          return `<button class="chip${_delivMonth===m?' active':''}" style="font-size:11px;"
                          onclick="selectDelivMonth('${m}')">${Number(y)}년 ${Number(mo)}월</button>`;
        }).join('')}
      <button class="chip${_delivMonth==='all'?' active':''}" style="font-size:11px;"
              onclick="selectDelivMonth('all')">전체</button>
    </div>
  `;

  // ── 월 필터 적용 ──
  // 납품완료/부분납품 + 반품서(isReturn) 포함 → 납품현황에서 반품 차감 표시
  // 금액·박스 집계는 보관건 포함, 카드 목록에서만 보관건 제외
  const allDone = orders.filter(o =>
    o.deliveryStatus === 'delivered' ||
    o.deliveryStatus === 'partial'   ||
    o.isReturn === true
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
  const byDay = {};
  done.forEach(o => {
    const d = o.deliveredDate || o.date || '미상';
    if (!byDay[d]) byDay[d] = { date: d, orders: [], totalAmt: 0, totalBoxes: 0, eggBoxes: 0, quailRawBoxes: 0, quailBrineBoxes: 0, quailBrinePkts: 0 };
    byDay[d].orders.push(o);
    byDay[d].totalAmt += calcNetDelivery(o);
    const sign = o.isReturn ? -1 : 1;
    (o.items||[]).forEach(item => {
      const bc = calcItemBoxCount(item);
      const isBrine = _isQuailBrine(item);
      const isRawQ  = _isQuailEgg(item);
      if (isBrine) {
        if (_isPktUnit(item.unit)) byDay[d].quailBrinePkts  += sign * (Number(item.qty)||0);
        else                       byDay[d].quailBrineBoxes += sign * bc;
      } else if (isRawQ) {
        byDay[d].quailRawBoxes += sign * bc;
      } else {
        byDay[d].eggBoxes += sign * bc;
      }
      byDay[d].totalBoxes += sign * bc;
    });
  });

  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  // ── 합계 (납품/반품 분리) ──
  const delivDone  = done.filter(o => !o.isReturn);
  const returnDone = done.filter(o => !!o.isReturn);
  const grandAmt   = done.reduce((s, o) => s + calcNetDelivery(o), 0);
  const grandBoxes = delivDone.reduce((s, o) => s + calcOrderBoxes(o), 0)
                   - returnDone.reduce((s, o) => s + calcOrderBoxes(o), 0);
  const returnAmt   = returnDone.reduce((s, o) => s + Math.abs(calcNetDelivery(o)), 0);
  const returnCount = returnDone.length;

  // 계란 / 생메추리 / 깐메추리 분리 집계
  let grandEggBoxes = 0, grandQuailRawBoxes = 0, grandQuailBrineBoxes = 0, grandQuailBrinePkts = 0;
  delivDone.forEach(o => {
    (o.items||[]).forEach(item => {
      const bc = calcItemBoxCount(item);
      if (_isQuailBrine(item)) {
        if (_isPktUnit(item.unit)) grandQuailBrinePkts  += (Number(item.qty)||0);
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
        <div style="font-size:11px;opacity:.7;margin-top:2px;">반품서 포함</div>
      </div>
      <div style="flex:1;background:#fff0f0;color:#dc2626;padding:10px 16px;text-align:center;">
        <div style="font-size:14px;font-weight:800;">-${fmt(returnAmt)}</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">반품금액</div>
      </div>
    </div>` : ''}

    <!-- 날짜별 카드 -->
    ${dayList.map((day, idx) => {
      const dayId = `deliv-day-${idx}`;
      return `
      <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);">
        <!-- 날짜 헤더 (클릭 시 접기/펼치기) -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:11px 14px;background:var(--navy);color:#fff;cursor:pointer;user-select:none;"
             onclick="toggleDelivDay('${dayId}')">
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="${dayId}-arrow" style="font-size:11px;opacity:.7;transition:transform .2s;">▼</span>
            <span style="font-size:13px;font-weight:700;">📅 ${fmtDate(day.date)}</span>
            <span style="font-size:11px;opacity:.65;">${day.orders.length}척</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:700;">${fmt(day.totalAmt)}</div>
            <div style="font-size:10px;opacity:.8;margin-top:2px;">
              ${day.eggBoxes       ? `계란 ${formatBoxCount(day.eggBoxes)}` : ''}
              ${day.quailRawBoxes   ? (day.eggBoxes ? ' · ' : '') + `🥚메추리 ${formatBoxCount(day.quailRawBoxes)}` : ''}
              ${day.quailBrineBoxes || day.quailBrinePkts ? ' · 깐메추리 ' + (day.quailBrineBoxes ? formatBoxCount(day.quailBrineBoxes) : '') + (day.quailBrineBoxes && day.quailBrinePkts ? ' ' : '') + (day.quailBrinePkts ? formatPktCount(day.quailBrinePkts) : '') : ''}
            </div>
          </div>
        </div>
        <!-- 선명별 행 (접기/펼치기 대상) -->
        <div id="${dayId}">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:7px 14px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">선명</th>
              <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">박스</th>
              <th style="padding:7px 14px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">금액</th>
            </tr>
          </thead>
          <tbody>
            ${day.orders.filter(o => !o.archived).map(o => {
              const isReturnDoc = !!o.isReturn;
              const rowBg  = isReturnDoc ? '#fff0f0' : o.deliveryStatus==='partial' ? '#fffbeb' : '#fff';
              const rowBdl = isReturnDoc ? 'border-left:3px solid #dc2626;' : '';
              const amtCol = isReturnDoc ? '#dc2626' : 'var(--success)';
              return `
            <tr style="border-top:1px solid var(--border);cursor:pointer;background:${rowBg};${rowBdl}"
                onclick="openModal('${o.id}')">
              <td style="padding:10px 14px;">
                <div style="font-size:13px;font-weight:600;color:var(--navy);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${escapeHtml(o.ship)}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo)}</div>
                ${(o.items||[]).map(item => {
                  const boxStr = formatItemBoxStr(item);
                  const rawDesc = item.desc || '';
                  const desc = escapeHtml(rawDesc.length > 18 ? rawDesc.slice(0,18)+'…' : rawDesc);
                  const qtyCol = (item.qty||0) < 0 ? 'color:#dc2626;' : '';
                  return `<div style="font-size:10px;color:var(--muted);margin-top:3px;display:flex;gap:4px;align-items:center;">
                    <span style="color:var(--navy);font-weight:600;">${desc}</span>
                    <span style="${qtyCol}">${item.qty}${displayUnit(item.unit)}${boxStr ? ' · '+boxStr : ''}</span>
                  </div>`;
                }).join('')}
              </td>
              <td style="padding:10px;text-align:right;font-size:11px;font-weight:700;color:${isReturnDoc?'#dc2626':'#1a3a6e'};white-space:nowrap;vertical-align:top;">
                ${(o.items||[]).map(item => {
                  const bc = calcItemBoxCount(item);
                  const rawDesc = item.desc || '';
                  const isBrineItem = _isQuailBrine(item);
                  const isRawQItem  = _isQuailEgg(item);
                  const label = isBrineItem ? '깐메추리' : isRawQItem ? '🥚메추리' : '🥚계란';
                  if (_isPktUnit(item.unit)) {
                    const q = Number(item.qty) || 0;
                    if (!q) return '';
                    return `<div style="margin-bottom:2px;">🛍️봉지<br><span style="font-size:12px;">${formatPktCount(q)}</span></div>`;
                  }
                  if (!bc) return '';
                  return `<div style="margin-bottom:2px;">${label}<br><span style="font-size:12px;">${formatBoxCount(bc)}</span></div>`;
                }).filter(Boolean).join('')}
              </td>
              <td style="padding:10px 14px;text-align:right;white-space:nowrap;">
                <div style="font-size:13px;font-weight:700;color:${amtCol};">${fmt(calcNetDelivery(o))}</div>
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

  // 날짜별 그룹핑 (선택된 월의 납품완료 + 반품 전체)
  const monthOrders = _filterByMonth(orders, _dashMonth);
  const target = monthOrders.filter(o =>
    o.deliveryStatus === 'delivered' ||
    o.deliveryStatus === 'partial'   ||
    o.deliveryStatus === 'returned'
  );

  const byDay = {};
  target.forEach(o => {
    const d = o.deliveredDate || o.date || '날짜없음';
    if (!byDay[d]) byDay[d] = { date: d, orders: [], amt: 0, boxes: 0 };
    byDay[d].orders.push(o);
    byDay[d].amt   += calcNetDelivery(o);
    byDay[d].boxes += calcOrderBoxes(o);
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
        <span style="font-size:13px;font-weight:700;">📅 ${dateStr} · ${day.orders.length}건</span>
        <span style="font-size:12px;opacity:.85;">${formatBoxCount(day.boxes)} · ${fmt(day.amt)}</span>
      </div>
      <div>
        ${day.orders.filter(o => !o.archived).map(o => {
          const isReturnDoc = !!o.isReturn;
          const isReturn    = o.deliveryStatus === 'returned';
          const isPartial   = o.deliveryStatus === 'partial';
          // 반품서(업로드) → 빨간 배경+테두리 / 수동반품 → 연분홍 / 부분납품 → 노랑 / 납품완료 → 연초록
          const statusColor = isReturnDoc ? '#fff0f0' : isReturn ? '#fef2f2' : isPartial ? '#fffbeb' : '#f0fdf4';
          const borderLeft  = isReturnDoc ? '3px solid #dc2626' : 'none';
          const statusText  = isReturnDoc ? '↩️ 반품서' : isReturn ? '반품' : isPartial ? '부분납품' : '납품완료';
          const statusCol   = isReturn ? '#dc2626' : isPartial ? '#d97706' : '#16a34a';
          const amtCol      = isReturnDoc ? '#dc2626' : statusCol;
          return `
          <div style="padding:10px 14px;border-top:1px solid var(--border);background:${statusColor};border-left:${borderLeft};cursor:pointer;"
               onclick="openModal('${o.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--navy);">${escapeHtml(o.ship)}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escapeHtml(o.docNo)}</div>
                ${(o.items||[]).map(i => {
                  const qtyCol = (i.qty||0) < 0 ? 'color:#dc2626;' : '';
                  const boxStr = formatItemBoxStr(i);
                  return `<div style="font-size:11px;color:#555;margin-top:3px;${qtyCol}">${escapeHtml((i.desc||'').slice(0,22))} · ${i.qty}${displayUnit(i.unit)}${boxStr ? ' · '+boxStr : ''}</div>`;
                }).join('')}
              </div>
              <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                <div style="font-size:13px;font-weight:700;color:${amtCol};">${fmt(calcNetDelivery(o))}</div>
                <div style="font-size:10px;color:${amtCol};margin-top:3px;font-weight:600;">${statusText}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${formatBoxCount(calcOrderBoxes(o))}</div>
              </div>
            </div>
          </div>`;
        }).join('')}
        <div style="padding:8px 14px;background:#f8fafc;display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--navy);border-top:1px solid var(--border);">
          <span>소계 ${day.orders.length}건</span>
          <span>${formatBoxCount(day.boxes)} · ${fmt(day.amt)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
