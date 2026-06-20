// ══════════════════════════════════════════════════════
// modal.js  —  발주 상세 모달 · 납품 상태 변경 · 삭제
// ══════════════════════════════════════════════════════

let modalSwipeY = 0;

function openModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  document.getElementById('m-title').textContent = o.ship;
  document.getElementById('m-docid').textContent = (o.docNo || '') + (o.poNo ? ' · ' + o.poNo : '');

  const boxes       = calcOrderBoxes(o);
  const netAmt      = calcNetDelivery(o);
  const isDelivered = o.deliveryStatus === 'delivered';
  const isReturned  = o.deliveryStatus === 'returned';
  const isPartial   = o.deliveryStatus === 'partial';

  document.getElementById('m-body').innerHTML = `
    <div class="info-row">
      <div><span class="ir-lbl">발주일자</span><span class="ir-val">${o.date}</span></div>
      <div><span class="ir-lbl">납기일자</span><span class="ir-val">${o.delivery || '-'}</span></div>
      <div><span class="ir-lbl">구분</span><span class="ir-val">${badge(o.category)}</span></div>
      <div><span class="ir-lbl">납품상태</span><span class="ir-val">${statusBadge(o.deliveryStatus || 'pending')}</span></div>
      <div><span class="ir-lbl">거래처발주번호</span><span class="ir-val" style="font-size:12px;">${o.poNo || '-'}</span></div>
      <div><span class="ir-lbl">발주총액</span><span class="ir-val" style="font-weight:700;">${fmt(o.total)}</span></div>
    </div>

    <div class="sdiv" style="margin-top:0;">품목 상세</div>
    <table class="items-tbl">
      <thead><tr><th>품목</th><th>CODE</th><th>수량</th><th>박스</th><th>단가</th><th>금액</th></tr></thead>
      <tbody>
        ${o.items.map(i => `<tr>
          <td>${i.desc}</td>
          <td style="font-family:monospace;">${i.code || '-'}</td>
          <td style="font-family:monospace;">${fmtQ(i)}</td>
          <td style="font-family:monospace;">${formatBoxCount(calcItemBoxCount(i))}</td>
          <td style="font-family:monospace;">${i.price ? '₩' + Number(i.price).toLocaleString() : '-'}</td>
          <td style="font-family:monospace;font-weight:700;">${i.amount ? '₩' + Number(i.amount).toLocaleString() : '-'}</td>
        </tr>`).join('')}
        <tr class="tr">
          <td colspan="3">TOTAL</td>
          <td style="font-family:monospace;">${formatBoxCount(boxes)}</td>
          <td colspan="2" style="font-family:monospace;">${fmt(o.total)}</td>
        </tr>
      </tbody>
    </table>

    ${(isDelivered || isReturned || isPartial) ? `
    <div class="delivery-block">
      <div class="db-title">납품 금액 현황</div>
      ${isDelivered ? `
        <div class="db-row"><span class="db-label">납품금액</span><span class="db-val plus">${fmt(o.total)}</span></div>
      ` : ''}
      ${isReturned ? `
        <div class="db-row"><span class="db-label">발주금액</span><span class="db-val">${fmt(o.total)}</span></div>
        <div class="db-row"><span class="db-label">반품금액</span><span class="db-val minus">-${fmt(o.returnAmount || o.total)}</span></div>
        <div class="db-divider"></div>
        <div class="db-row"><span class="db-label">실 납품금액</span><span class="db-val net">${fmt(netAmt)}</span></div>
      ` : ''}
      ${isPartial ? `
        <div class="db-row"><span class="db-label">발주금액</span><span class="db-val">${fmt(o.total)}</span></div>
        <div class="db-row"><span class="db-label">실 납품금액</span><span class="db-val plus">${fmt(o.partialAmount || 0)}</span></div>
      ` : ''}
      ${o.deliveryNote ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">📝 ${o.deliveryNote}</div>` : ''}
    </div>` : ''}

    <div class="sdiv">납품 처리</div>
    <div class="delivery-actions">
      <!-- 납품완료: 이미 완료 상태면 터치 시 취소(미납품으로) -->
      <button class="btn ${isDelivered ? 'btn-success' : 'btn-g'}"
        onclick="toggleDelivered('${o.id}')">
        ${isDelivered ? '✅ 납품완료 · 터치하면 취소' : '📦 납품완료 처리'}
      </button>
      <button class="btn btn-warn ${isReturned ? '' : 'btn-g'}" onclick="setDelivery('${o.id}','returned')">
        ${isReturned ? '↩️ 반품처리됨' : '↩️ 반품 처리'}
      </button>
      <button class="btn btn-g" onclick="setDelivery('${o.id}','partial')">📋 부분납품</button>
      <button class="btn btn-g" onclick="setDelivery('${o.id}','pending')">⏳ 미납품으로</button>
    </div>

    <div style="margin-top:12px;">
      <button class="btn btn-d btn-block" onclick="delOrder('${o.id}');closeModalBtn()">🗑 이 발주 삭제</button>
    </div>
  `;

  document.getElementById('modalOv').classList.add('open');

  const modal = document.getElementById('modal');
  modal.addEventListener('touchstart', e => { modalSwipeY = e.touches[0].clientY; }, { passive: true });
  modal.addEventListener('touchmove', e => {
    if (modal.scrollTop > 0) return;
    if (e.touches[0].clientY - modalSwipeY > 60) closeModalBtn();
  }, { passive: true });
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOv')) closeModalBtn();
}

function closeModalBtn() {
  document.getElementById('modalOv').classList.remove('open');
}

// ── 납품완료 토글 (완료 → 취소 / 미납품 → 완료) ──
function toggleDelivered(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  if (o.deliveryStatus === 'delivered') {
    // 취소 확인
    if (!confirm(`[${o.ship}]\n납품완료를 취소하고 미납품으로 되돌릴까요?`)) return;
    o.deliveryStatus = 'pending';
    o.deliveryNote   = '';
    o.returnAmount   = 0;
    o.partialAmount  = 0;
    o.deliveredDate  = '';
    save();
    closeModalBtn();
    renderAll();
    toast('⏪ 납품완료가 취소되었습니다.');
  } else {
    // 납품완료 처리
    const note = prompt('납품 비고 (선택사항)', o.deliveryNote || '');
    if (note === null) return;
    o.deliveryNote   = note.trim();
    o.deliveryStatus = 'delivered';
    o.deliveredDate  = todayStr();
    save();
    closeModalBtn();
    renderAll();
    toast('✅ 납품완료로 처리되었습니다.');
  }
}

// ── 납품 상태 변경 ──
function setDelivery(id, status) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  if (status === 'returned') {
    const input = prompt(
      `반품 금액을 입력하세요\n(전액 반품이면 비워두세요, 발주금액 ${fmt(o.total)} 적용)`,
      o.returnAmount || ''
    );
    if (input === null) return;
    const amt = input.trim() === '' ? (o.total || 0) : parseFloat(input.replace(/[^0-9.]/g, ''));
    o.returnAmount = isNaN(amt) ? (o.total || 0) : amt;
    const note = prompt('비고 (선택사항)', o.deliveryNote || '');
    if (note !== null) o.deliveryNote = note.trim();
  } else if (status === 'partial') {
    const input = prompt('실제 납품된 금액을 입력하세요', o.partialAmount || '');
    if (input === null) return;
    const amt = parseFloat(input.replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) { toast('⚠️ 올바른 금액을 입력해주세요'); return; }
    o.partialAmount = amt;
    const note = prompt('비고 (선택사항)', o.deliveryNote || '');
    if (note !== null) o.deliveryNote = note.trim();
  } else if (status === 'delivered') {
    const note = prompt('납품 비고 (선택사항)', o.deliveryNote || '');
    if (note !== null) o.deliveryNote = note.trim();
  } else {
    o.deliveryNote  = '';
    o.returnAmount  = 0;
    o.partialAmount = 0;
  }

  if (status === 'delivered' || status === 'partial') o.deliveredDate = todayStr();
  if (status === 'pending') o.deliveredDate = '';

  o.deliveryStatus = status;
  save();
  closeModalBtn();
  renderAll();

  const msgs = {
    delivered: '✅ 납품완료로 변경되었습니다.',
    returned:  '↩️ 반품 처리되었습니다.',
    partial:   '📋 부분납품으로 변경되었습니다.',
    pending:   '⏳ 미납품으로 변경되었습니다.'
  };
  toast(msgs[status] || '변경되었습니다.');
}

// ── 발주 삭제 ──
function delOrder(id) {
  if (!confirm('삭제하시겠습니까?')) return;
  orders = orders.filter(o => o.id !== id);
  save();
  renderAll();
  toast('삭제되었습니다.');
}
