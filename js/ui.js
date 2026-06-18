// ══════════════════════════════════════════════════════
// ui.js  —  렌더링 전용 (대시보드 · 발주목록 · 통계)
// ══════════════════════════════════════════════════════

// ── 필터 상태 ──
let filterMode = 'all';
let statusMode = 'all';
let searchQ    = '';

// ── 전체 렌더 ──
function renderAll() {
  const total = orders.reduce((s, o) => s + (o.total || 0), 0);
  const ships = new Set(orders.map(o => o.ship)).size;

  // 납품 기준 통계
  const deliveredOrders = orders.filter(o => o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial');
  const deliveredBoxes  = deliveredOrders.reduce((s, o) => s + calcOrderBoxes(o), 0);
  const netTotal        = orders.reduce((s, o) => s + calcNetDelivery(o), 0);
  const deliveredCnt    = deliveredOrders.length;

  document.getElementById('h-cnt').textContent    = orders.length;
  document.getElementById('h-tot').textContent    = fmt(total);
  document.getElementById('s-cnt').textContent    = deliveredCnt;
  document.getElementById('s-tot').textContent    = fmt(netTotal);
  document.getElementById('s-ships').textContent  = ships;
  document.getElementById('s-boxes').textContent  = formatBoxCount(deliveredBoxes);

  // 납품 현황 요약 카드
  const delivered   = orders.filter(o => o.deliveryStatus === 'delivered');
  const returned    = orders.filter(o => o.deliveryStatus === 'returned');
  const pending     = orders.filter(o => !o.deliveryStatus || o.deliveryStatus === 'pending');
  const partial     = orders.filter(o => o.deliveryStatus === 'partial');

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  const returnedAmt  = returned.reduce((s, o) => s + (o.returnAmount || o.total || 0), 0);
  const pendingAmt   = [...pending, ...partial].reduce((s, o) => s + (o.total || 0), 0);
  const netAmt       = deliveredAmt - returnedAmt;

  document.getElementById('ds-delivered-cnt').textContent = delivered.length;
  document.getElementById('ds-returned-cnt').textContent  = returned.length;
  document.getElementById('ds-pending-cnt').textContent   = pending.length + partial.length;
  document.getElementById('ds-delivered-amt').textContent = fmt(deliveredAmt);
  document.getElementById('ds-returned-amt').textContent  = returned.length ? '-' + fmt(returnedAmt) : fmt(0);
  document.getElementById('ds-pending-amt').textContent   = fmt(pendingAmt);
  document.getElementById('ds-net-amt').textContent       = fmt(netAmt);

  // 대시보드 최근 목록
  const recent = [...orders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  document.getElementById('dash-list').innerHTML = recent.length
    ? recent.map(o => orderCard(o, false)).join('')
    : '<div class="empty"><div class="empty-icon">📭</div><div class="empty-t">발주 내역 없음</div></div>';

  // 발주 목록
  const list = filtered();
  document.getElementById('o-sub').textContent      = `${list.length}건`;
  document.getElementById('orders-list').innerHTML  = list.length
    ? list.map(o => orderCard(o, true)).join('')
    : '<div class="empty"><div class="empty-icon">📭</div><div class="empty-t">결과 없음</div></div>';
}

// ── 발주 카드 HTML ──
function orderCard(o, showDel) {
  const item      = o.items?.[0] || {};
  const delBtn    = showDel
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
  return `
  <div class="order-card ${statusClass}" onclick="openModal('${o.id}')">
    <div class="oc-top">
      <div class="oc-ship">${o.ship}</div>
      <div class="oc-amount">${fmt(o.total)}</div>
    </div>
    <div class="oc-meta">
      <span class="oc-doc">${o.docNo || ''}</span>
      ${badge(o.category)}
      ${statusBadge(o.deliveryStatus || 'pending')}
      ${delBtn}
    </div>
    <div class="oc-bottom">
      <div class="oc-item">${item.desc || '-'}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-shrink:0;margin-left:8px;">
        <span class="oc-qty">${fmtQ(item)}${calcItemBoxCount(item) ? ` (${formatBoxCount(calcItemBoxCount(item))})` : ''}</span>
        <span class="oc-dates">${o.date}${o.delivery ? ' → ' + o.delivery : ''}</span>
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

function clearDateFilter() {
  document.getElementById('fDateFrom').value = '';
  document.getElementById('fDateTo').value   = '';
  renderAll();
}

// ── 납품 통계 탭 렌더 ──
function renderStats() {
  const delivered = orders.filter(o => o.deliveryStatus === 'delivered');
  const returned  = orders.filter(o => o.deliveryStatus === 'returned');
  const partial   = orders.filter(o => o.deliveryStatus === 'partial');
  const pending   = orders.filter(o => !o.deliveryStatus || o.deliveryStatus === 'pending');

  const deliveredAmt = delivered.reduce((s, o) => s + (o.total || 0), 0);
  const returnedAmt  = returned.reduce((s, o) => s + (o.returnAmount || o.total || 0), 0);
  const partialAmt   = partial.reduce((s, o) => s + (o.partialAmount || 0), 0);
  const netAmt       = deliveredAmt + partialAmt - returnedAmt;

  // ── 일별 납품 집계 (납품완료 + 부분납품, 날짜 기준) ──
  const byDay = {};
  [...delivered, ...partial].forEach(o => {
    const d = o.date || '미상';
    if (!byDay[d]) byDay[d] = { date: d, cnt: 0, amt: 0, boxes: 0, orders: [] };
    byDay[d].cnt++;
    byDay[d].amt   += calcNetDelivery(o);
    byDay[d].boxes += calcOrderBoxes(o);
    byDay[d].orders.push(o);
  });
  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  // ── 선명별 집계 ──
  const byShip = {};
  orders.forEach(o => {
    if (!byShip[o.ship]) byShip[o.ship] = { ship: o.ship, cnt: 0, total: 0, net: 0, returned: 0 };
    byShip[o.ship].cnt++;
    byShip[o.ship].total    += (o.total || 0);
    byShip[o.ship].net      += calcNetDelivery(o);
    if (o.deliveryStatus === 'returned')
      byShip[o.ship].returned += (o.returnAmount || o.total || 0);
  });
  const ships = Object.values(byShip).sort((a, b) => b.net - a.net);

  document.getElementById('stats-content').innerHTML = `

    <!-- 합산 요약 카드 -->
    <div class="delivery-summary" style="margin-bottom:16px;">
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
    </div>

    <!-- 일별 납품 정리 -->
    ${dayList.length ? `
    <div class="sdiv" style="display:flex;align-items:center;justify-content:space-between;">
      <span>일별 납품 현황</span>
      <span style="font-size:10px;color:var(--muted);font-weight:400;">${dayList.length}일</span>
    </div>
    ${dayList.map(day => `
      <div class="form-card" style="padding:0;overflow:hidden;margin-bottom:10px;">
        <!-- 날짜 헤더 -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--border);cursor:pointer;"
             onclick="this.nextElementSibling.classList.toggle('collapsed')">
          <div>
            <span style="font-size:13px;font-weight:700;color:var(--navy);">📅 ${fmtDate(day.date)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:8px;">${day.cnt}건 · ${formatBoxCount(day.boxes)}</span>
          </div>
          <span style="font-size:13px;font-weight:700;color:var(--success);">${fmt(day.amt)}</span>
        </div>
        <!-- 날짜별 발주 목록 (접기 가능) -->
        <div class="day-orders">
          ${day.orders.map(o => `
            <div onclick="openModal('${o.id}')"
                 style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;
                        background:${o.deliveryStatus==='partial'?'#fffbeb':'#fff'};">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${o.ship}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${o.docNo||'-'} ${o.items?.[0]?.desc?'· '+o.items[0].desc:''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                <div style="font-size:13px;font-weight:700;">${fmt(calcNetDelivery(o))}</div>
                <div style="font-size:10px;margin-top:2px;">${statusBadge(o.deliveryStatus)}</div>
              </div>
            </div>
          `).join('')}
          <!-- 일별 소계 -->
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
        <div class="oc-top"><div class="oc-ship">${o.ship}</div><div class="oc-amount">${fmt(o.total)}</div></div>
        <div class="oc-meta"><span class="oc-doc">${o.docNo || ''}</span>${badge(o.category)}${statusBadge('pending')}</div>
        <div class="oc-bottom"><div class="oc-item">${o.date}</div></div>
      </div>
    `).join('')}` : ''}

    <!-- 반품 내역 -->
    ${returned.length ? `
    <div class="sdiv">반품 내역 (${returned.length}건)</div>
    ${returned.map(o => `
      <div class="order-card status-returned" onclick="openModal('${o.id}')">
        <div class="oc-top"><div class="oc-ship">${o.ship}</div><div class="oc-amount" style="color:var(--danger);">-${fmt(o.returnAmount || o.total)}</div></div>
        <div class="oc-meta"><span class="oc-doc">${o.docNo || ''}</span>${statusBadge('returned')}</div>
        <div class="oc-bottom"><div class="oc-item">${o.deliveryNote || '-'}</div><div class="oc-dates">${o.date}</div></div>
      </div>
    `).join('')}` : ''}

    <!-- 선명별 납품 현황 -->
    ${ships.length ? `
    <div class="sdiv">선명별 납품 현황</div>
    <div class="form-card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:var(--bg);">
            <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:10px;font-weight:700;">선명</th>
            <th style="padding:10px 8px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">발주</th>
            <th style="padding:10px 8px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">반품</th>
            <th style="padding:10px 12px;text-align:right;color:var(--muted);font-size:10px;font-weight:700;">실납품</th>
          </tr>
        </thead>
        <tbody>
          ${ships.map(s => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:10px 12px;font-weight:600;">${s.ship}</td>
            <td style="padding:10px 8px;text-align:right;font-family:monospace;color:var(--muted);">${fmt(s.total)}</td>
            <td style="padding:10px 8px;text-align:right;font-family:monospace;color:var(--danger);">${s.returned ? '-' + fmt(s.returned) : '-'}</td>
            <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700;color:${s.net >= 0 ? 'var(--navy)' : 'var(--danger)'};">${fmt(s.net)}</td>
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
// renderDeliveryStatus — 납품현황 탭 (날짜별 선명·박스·금액)
// ══════════════════════════════════════════════════════
function renderDeliveryStatus() {
  const el = document.getElementById('delivery-status-content');
  if (!el) return;

  // 납품완료 + 부분납품만
  const done = orders.filter(o => o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial');

  if (!done.length) {
    el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--muted);">
      <div style="font-size:40px;margin-bottom:12px;">📦</div>
      <div style="font-size:14px;">납품 완료된 발주가 없습니다</div>
    </div>`;
    return;
  }

  // ── 날짜별 집계 ──
  const byDay = {};
  done.forEach(o => {
    const d = o.date || '미상';
    if (!byDay[d]) byDay[d] = { date: d, orders: [], totalAmt: 0, totalBoxes: 0 };
    byDay[d].orders.push(o);
    byDay[d].totalAmt   += calcNetDelivery(o);
    byDay[d].totalBoxes += calcOrderBoxes(o);
  });

  const dayList = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  // ── 전체 합계 ──
  const grandAmt   = done.reduce((s, o) => s + calcNetDelivery(o), 0);
  const grandBoxes = done.reduce((s, o) => s + calcOrderBoxes(o), 0);

  el.innerHTML = `
    <!-- 전체 요약 바 -->
    <div style="display:flex;gap:0;margin-bottom:14px;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <div style="flex:1;background:var(--navy);color:#fff;padding:14px 16px;text-align:center;">
        <div style="font-size:18px;font-weight:800;">${done.length}<span style="font-size:12px;font-weight:400;margin-left:2px;">건</span></div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">납품완료</div>
      </div>
      <div style="flex:1;background:#1a3a6e;color:#fff;padding:14px 16px;text-align:center;">
        <div style="font-size:18px;font-weight:800;">${formatBoxCount(grandBoxes)}</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">총 박스</div>
      </div>
      <div style="flex:1;background:var(--success);color:#fff;padding:14px 16px;text-align:center;">
        <div style="font-size:15px;font-weight:800;">${fmt(grandAmt)}</div>
        <div style="font-size:11px;opacity:.7;margin-top:2px;">납품금액</div>
      </div>
    </div>

    <!-- 날짜별 카드 -->
    ${dayList.map(day => `
      <div style="background:#fff;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);">

        <!-- 날짜 헤더 -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:11px 14px;background:var(--navy);color:#fff;">
          <div>
            <span style="font-size:13px;font-weight:700;">📅 ${fmtDate(day.date)}</span>
            <span style="font-size:11px;opacity:.65;margin-left:8px;">${day.orders.length}척</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:700;">${fmt(day.totalAmt)}</div>
            <div style="font-size:10px;opacity:.65;">${formatBoxCount(day.totalBoxes)}</div>
          </div>
        </div>

        <!-- 선명별 행 -->
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:7px 14px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">선명</th>
              <th style="padding:7px 10px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">박스</th>
              <th style="padding:7px 14px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;">금액</th>
            </tr>
          </thead>
          <tbody>
            ${day.orders.map((o, i) => `
            <tr style="border-top:1px solid var(--border);cursor:pointer;background:${o.deliveryStatus==='partial'?'#fffbeb':'#fff'};"
                onclick="openModal('${o.id}')">
              <td style="padding:10px 14px;">
                <div style="font-size:13px;font-weight:600;color:var(--navy);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${o.ship}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">${o.docNo||''}</div>
              </td>
              <td style="padding:10px;text-align:right;font-size:13px;font-weight:700;color:#1a3a6e;white-space:nowrap;">
                ${formatBoxCount(calcOrderBoxes(o))}
              </td>
              <td style="padding:10px 14px;text-align:right;white-space:nowrap;">
                <div style="font-size:13px;font-weight:700;color:var(--success);">${fmt(calcNetDelivery(o))}</div>
                <div style="font-size:10px;margin-top:2px;">${statusBadge(o.deliveryStatus)}</div>
              </td>
            </tr>`).join('')}
          </tbody>
          <!-- 일별 소계 -->
          <tfoot>
            <tr style="background:#f1f5f9;border-top:2px solid var(--border);">
              <td style="padding:9px 14px;font-size:12px;font-weight:700;color:var(--navy);">소계</td>
              <td style="padding:9px 10px;text-align:right;font-size:12px;font-weight:700;color:#1a3a6e;">${formatBoxCount(day.totalBoxes)}</td>
              <td style="padding:9px 14px;text-align:right;font-size:12px;font-weight:700;color:var(--success);">${fmt(day.totalAmt)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `).join('')}
  `;
}
