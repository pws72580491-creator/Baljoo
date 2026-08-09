// ══════════════════════════════════════════════════════
// modal.js  —  발주 상세 모달 · 납품 상태 변경 · 삭제
// ══════════════════════════════════════════════════════

let modalSwipeY = 0;

function openModal(id) {
  try {
    const o = orders.find(x => x.id === id);
    if (!o) return;

    document.getElementById('m-title').textContent = o.ship;
    document.getElementById('m-docid').textContent = (o.docNo || '') + (o.poNo ? ' · ' + o.poNo : '');

    const boxes       = calcOrderBoxes(o);
    const netAmt      = calcNetDelivery(o);
    const isDelivered = o.deliveryStatus === 'delivered';
    const isPartial   = o.deliveryStatus === 'partial';
    const isReturned  = o.deliveryStatus === 'returned';
    const isCancelled = o.deliveryStatus === 'cancelled';
    const isArchived  = !!o.archived;

    document.getElementById('m-body').innerHTML = `
    <div class="info-row">
      <div><span class="ir-lbl">발주일자</span><span class="ir-val">${escapeHtml(o.date)}</span></div>
      <div><span class="ir-lbl">납기일자</span><span class="ir-val">${escapeHtml(o.delivery) || '-'}</span></div>
      <div><span class="ir-lbl">구분</span><span class="ir-val">${badge(o.category)}</span></div>
      <div><span class="ir-lbl">납품상태</span><span class="ir-val">${statusBadge(o.deliveryStatus || 'pending')}</span></div>
      <div><span class="ir-lbl">거래처발주번호</span><span class="ir-val" style="font-size:12px;">${escapeHtml(o.poNo) || '-'}</span></div>
      <div><span class="ir-lbl">발주총액</span><span class="ir-val" style="font-weight:700;">${fmt(o.total)}</span></div>
    </div>

    <div class="sdiv" style="margin-top:0;">품목 상세</div>
    <table class="items-tbl">
      <thead><tr><th>품목</th><th>수량</th><th>박스</th><th>단가</th><th>금액</th></tr></thead>
      <tbody>
        ${(o.items || []).map(i => {
          const boxWarn = _boxRatioWarning(i);
          const total   = calcItemBoxCount(i);
          const done    = calcItemDeliveredBoxes(i);
          const progressStr = (isPartial && done > 0)
            ? `<div style="font-size:10px;color:#b45309;font-weight:700;margin-top:2px;">🚚 ${formatBoxCount(done)} / ${formatBoxCount(total)} 배송</div>` : '';
          return `<tr>
          <td>${escapeHtml(i.desc)}</td>
          <td style="font-family:monospace;">${fmtQ(i)}</td>
          <td style="font-family:monospace;${boxWarn ? 'color:#c2410c;font-weight:700;background:#fff7ed;' : ''}"${boxWarn ? ` title="${escapeHtml(boxWarn)}"` : ''}>${formatBoxCount(total)}${boxWarn ? ' ⚠️' : ''}${progressStr}</td>
          <td style="font-family:monospace;">${i.price ? '₩' + Number(i.price).toLocaleString() : '-'}</td>
          <td style="font-family:monospace;font-weight:700;">${i.amount ? '₩' + Number(i.amount).toLocaleString() : '-'}</td>
        </tr>${boxWarn ? `<tr><td colspan="5" style="font-size:10px;color:#9a3412;background:#ffedd5;padding:5px 8px;">${escapeHtml(boxWarn)}</td></tr>` : ''}`;
        }).join('')}
        <tr class="tr">
          <td colspan="4">TOTAL</td>
          <td style="font-family:monospace;">${fmt(o.total)}</td>
        </tr>
      </tbody>
    </table>

    ${(isDelivered || isPartial || isReturned || isCancelled) ? `
    <div class="delivery-block">
      <div class="db-title">납품 금액 현황</div>
      ${isDelivered ? `
        <div class="db-row"><span class="db-label">납품금액</span><span class="db-val plus">${fmt(o.total)}</span></div>
      ` : ''}
      ${isPartial ? `
        <div class="db-row"><span class="db-label">발주금액</span><span class="db-val">${fmt(o.total)}</span></div>
        <div class="db-row"><span class="db-label">배송 진행</span><span class="db-val" style="color:#b45309;">${formatBoxCount(calcOrderDeliveredBoxes(o))} / ${formatBoxCount(boxes)}</span></div>
        <div class="db-divider"></div>
        <div class="db-row"><span class="db-label">배송분 금액</span><span class="db-val net">${fmt(netAmt)}</span></div>
      ` : ''}
      ${isReturned ? `
        <div class="db-row"><span class="db-label">발주금액</span><span class="db-val">${fmt(o.total)}</span></div>
        <div class="db-row"><span class="db-label">반품금액</span><span class="db-val minus">-${fmt(o.returnAmount ?? o.total)}</span></div>
        <div class="db-divider"></div>
        <div class="db-row"><span class="db-label">실 납품금액</span><span class="db-val net">${fmt(netAmt)}</span></div>
        <div class="db-divider"></div>
        ${!o.isReturn ? (
          o.deliveredDate
            ? `<div class="db-row"><span class="db-label">납품 이력</span><span class="db-val" style="color:#16a34a;">✅ ${escapeHtml(o.deliveredDate)} 납품완료 → 반품처리</span></div>`
            : `<div class="db-row"><span class="db-label">납품 이력</span><span class="db-val" style="color:#c2410c;">⚠️ 미납품 상태에서 바로 반품 처리됨</span></div>`
        ) : `<div class="db-row"><span class="db-label">문서 구분</span><span class="db-val" style="color:var(--muted);">📄 업로드된 반품서 (원 발주와 별개 문서)</span></div>`}
      ` : ''}
      ${isCancelled ? `
        <div class="db-row"><span class="db-label">발주금액</span><span class="db-val" style="text-decoration:line-through;color:var(--muted);">${fmt(o.total)}</span></div>
        <div class="db-row"><span class="db-label">상태</span><span class="db-val" style="color:#6d28d9;">🚫 발주취소 (모든 집계에서 제외)</span></div>
      ` : ''}
      ${manualDeliveryNote(o.deliveryNote) ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">📝 ${escapeHtml(manualDeliveryNote(o.deliveryNote))}</div>` : ''}
    </div>` : ''}

    <div class="sdiv">납품 처리</div>
    <div class="delivery-actions">
      <!-- 납품완료: 이미 완료 상태면 터치 시 취소(미납품으로) -->
      <button class="btn ${isDelivered ? 'btn-success' : 'btn-g'}"
        onclick="toggleDelivered('${o.id}')">
        ${isDelivered ? '✅ 납품완료 · 터치하면 취소' : '📦 납품완료 처리'}
      </button>
      <button class="btn ${isPartial ? 'btn-success' : 'btn-g'}" onclick="openPartialModal('${o.id}')">
        ${isPartial ? '🚚 부분납품 수정' : '🚚 부분납품 처리'}
      </button>
      <button class="btn btn-warn ${isReturned ? '' : 'btn-g'}" onclick="setDelivery('${o.id}','returned')">
        ${isReturned ? '↩️ 반품처리됨 · 터치하면 취소' : '↩️ 반품 처리'}
      </button>
      <button class="btn ${isCancelled ? 'btn-cancel' : 'btn-g'}" onclick="setDelivery('${o.id}','cancelled')">
        ${isCancelled ? '🚫 발주취소됨 · 터치하면 취소' : '🚫 발주취소'}
      </button>
    </div>

    <div style="margin-top:12px;">
      ${isDelivered ? `
      <button class="btn ${isArchived ? 'btn-warn' : 'btn-g'} btn-block" style="margin-bottom:8px;"
        onclick="toggleArchive('${o.id}')">
        ${isArchived ? '📤 보관 해제 (목록 복원)' : '📦 보관함으로 이동'}
      </button>` : ''}
      <div style="margin-top:${isDelivered ? '0' : '12px'};display:flex;gap:8px;">
        <button class="btn btn-g" style="flex:1;" onclick="openEditModal('${o.id}')">✏️ 수정</button>
        <button class="btn btn-d" style="flex:1;" onclick="delOrder('${o.id}');closeModalBtn()">🗑 삭제</button>
      </div>
    </div>
  `;

    document.getElementById('modalOv').classList.add('open');
    history.pushState({ modal: 'detail' }, '');

    // 기존 스와이프 리스너 제거 후 재등록 (openModal 반복 호출 시 누적 방지)
    const freshModal = modal.cloneNode(true);
    modal.parentNode.replaceChild(freshModal, modal);
    freshModal.addEventListener('touchstart', e => { modalSwipeY = e.touches[0].clientY; }, { passive: true });
    freshModal.addEventListener('touchmove', e => {
      if (freshModal.scrollTop > 0) return;
      if (e.touches[0].clientY - modalSwipeY > 60) closeModalBtn();
    }, { passive: true });
  } catch (err) {
    console.error('[openModal] 오류:', err);
    toast('⚠️ 발주 상세를 불러오지 못했습니다.');
  }
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOv')) closeModalBtn();
}

function closeModalBtn() {
  document.getElementById('modalOv').classList.remove('open');
  if (history.state && history.state.modal === 'detail') history.back();
}

// ══════════════════════════════════════════════════════
// v3.3.28: 부분납품(partial delivery) — 품목별 배송 진행 처리
// ══════════════════════════════════════════════════════
function openPartialModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const items = o.items || [];
  if (!items.length) { toast('⚠️ 품목이 없는 발주입니다.'); return; }

  // 상세 모달 닫기 (openEditModal과 동일한 방식 — history.back() 없이 직접 닫아야 popstate 충돌 방지)
  document.getElementById('modalOv').classList.remove('open');

  document.getElementById('partial-docid').textContent = (o.docNo || '') + (o.poNo ? ' · ' + o.poNo : '');
  document.getElementById('partial-body').innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">
      품목별로 <b>지금까지 배송된 박스 수</b>를 입력해주세요. 모든 품목이 전체 박스를 채우면 자동으로 '납품완료'로 처리돼요.
    </div>
    ${items.map((item, idx) => {
      const total = calcItemBoxCount(item);
      const done  = calcItemDeliveredBoxes(item);
      return `
      <div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border);">
        <div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:2px;">${escapeHtml(item.desc) || '(품목명 없음)'}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">전체 ${formatBoxCount(total)}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button onclick="_adjustPartialBox(${idx},-1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);
                         background:#f8fafc;font-size:20px;cursor:pointer;line-height:1;">−</button>
          <input id="partial-box-${idx}" type="number" min="0" max="${total}" step="0.1" inputmode="decimal"
                 value="${done}" onfocus="this.select()"
                 style="width:72px;flex-shrink:0;text-align:center;font-size:18px;font-weight:800;
                        border:2px solid var(--border);border-radius:10px;padding:5px 4px;color:var(--navy);">
          <button onclick="_adjustPartialBox(${idx},1)"
                  style="width:36px;height:36px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);
                         background:#f8fafc;font-size:20px;cursor:pointer;line-height:1;">+</button>
          <span style="font-size:12px;color:var(--muted);">/ ${formatBoxCount(total)}</span>
          <button onclick="document.getElementById('partial-box-${idx}').value=${total};"
                  style="margin-left:auto;font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;text-decoration:underline;">전체완료</button>
        </div>
      </div>`;
    }).join('')}
    <div style="margin-top:6px;padding:14px;background:#f8fafc;border-radius:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:13px;font-weight:700;color:var(--navy);white-space:nowrap;">📅 납품 날짜</span>
        <input id="partial-delivery-date" type="date" value="${o.deliveredDate || todayStr()}"
               style="flex:1;font-size:14px;font-weight:700;border:2px solid var(--border);
                      border-radius:8px;padding:6px 10px;color:var(--navy);background:#fff;">
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;padding-bottom:8px;">
      <button class="btn btn-g" style="flex:1;" onclick="closePartialModal()">취소</button>
      <button class="btn btn-success" style="flex:1;" onclick="savePartialDelivery('${o.id}')">💾 저장</button>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('partialModalOv').classList.add('open');
    history.pushState({ modal: 'partial' }, '');
  }, 50);

  // 스와이프 닫기 (리스너 누적 방지: clone으로 기존 리스너 제거)
  const pmOld = document.getElementById('partialModal');
  const pm = pmOld.cloneNode(true);
  pmOld.parentNode.replaceChild(pm, pmOld);
  let _psy = 0;
  pm.addEventListener('touchstart', e => { _psy = e.touches[0].clientY; }, { passive: true });
  pm.addEventListener('touchmove', e => {
    if (pm.scrollTop > 0) return;
    if (e.touches[0].clientY - _psy > 60) closePartialModal();
  }, { passive: true });
}

function closePartialModal() {
  document.getElementById('partialModalOv').classList.remove('open');
  if (history.state && history.state.modal === 'partial') history.back();
}

function closePartialModalOv(e) {
  if (e.target === document.getElementById('partialModalOv')) closePartialModal();
}

function _adjustPartialBox(idx, delta) {
  const input = document.getElementById(`partial-box-${idx}`);
  if (!input) return;
  const max = Number(input.max) || 0;
  const newVal = Math.max(0, Math.min(max, (parseFloat(input.value) || 0) + delta));
  input.value = (newVal % 1 === 0) ? newVal : Math.round(newVal * 10) / 10;
}

function savePartialDelivery(id) {
  try {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    const dateVal = document.getElementById('partial-delivery-date')?.value;
    if (!dateVal) { toast('⚠️ 납품 날짜를 선택해주세요'); return; }
    const items = o.items || [];
    // v3.3.33: 이번 저장으로 늘거나 준 품목별 박스 수를 dateVal 날짜의 배송 이력
    // (deliveryEvents)으로 기록 — 여러 날짜에 걸친 부분납품을 정확히 추적하기 위함
    const prevBoxes = items.map(item => calcItemDeliveredBoxes(item));
    const nextBoxes = items.map((item, idx) => {
      const input = document.getElementById(`partial-box-${idx}`);
      const total = calcItemBoxCount(item);
      return input ? Math.max(0, Math.min(total, parseFloat(input.value) || 0)) : 0;
    });
    items.forEach((item, idx) => { item.deliveredBoxes = nextBoxes[idx]; });
    _recordDeliveryDelta(o, dateVal, prevBoxes, nextBoxes);

    const newStatus = _deriveDeliveryStatusFromItems(o);
    o.deliveryStatus = newStatus;
    o.partialAmount  = calcPartialDeliveredAmount(o); // 참고용 캐시 — 기존에 있던 필드를 재활용
    if (newStatus === 'delivered') {
      o.deliveryStatus = 'delivered';
      o.deliveredDate  = dateVal;
      o.returnedDate   = '';
      o.cancelledDate  = '';
    } else if (newStatus === 'partial') {
      o.deliveredDate  = dateVal; // 이번에 박스가 움직인(부분납품이 반영된) 날짜 — 사용자가 선택
    } else {
      o.deliveredDate  = '';
      _clearDeliveryEvents(o); // 미납품으로 되돌아가면 이력도 초기화
    }
    save();
    closePartialModal();
    renderAll();
    toast(newStatus === 'delivered' ? '✅ 전량 납품완료로 처리되었습니다.' : '🚚 부분납품이 저장되었습니다.');
  } catch (err) {
    console.error('[savePartialDelivery] 오류:', err);
    toast('⚠️ 부분납품 처리 중 오류가 발생했습니다.');
  }
}

// ── 납품완료 토글 (완료 → 취소 / 미납품 → 완료) ──
function toggleDelivered(id) {
  try {
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
      (o.items || []).forEach(i => { i.deliveredBoxes = 0; }); // v3.3.28: 부분납품 진행분도 함께 초기화
      _clearDeliveryEvents(o); // v3.3.33: 배송 이력도 함께 초기화
      save();
      closeModalBtn();
      renderAll();
      toast('⏪ 납품완료가 취소되었습니다.');
    } else {
      // 납품완료 처리
      const note = prompt('납품 비고 (선택사항)', o.deliveryNote || '');
      if (note === null) return;
      o.deliveryNote   = note.trim();
      // v3.3.43: 반품 상태였다가 바로 납품완료로 전환하는 경우, 남아있던 반품확인 체크를 정리
      if (o.deliveryStatus === 'returned') _pruneReturnChk(o.id);
      const dateVal = todayStr();
      // v3.3.33: 부분납품 중이었다면 "오늘 새로 채워진 만큼"을 이력에 기록
      const prevBoxes = (o.items || []).map(i => calcItemDeliveredBoxes(i));
      const nextBoxes = (o.items || []).map(i => calcItemBoxCount(i));
      o.deliveryStatus = 'delivered';
      o.deliveredDate  = dateVal;
      o.returnedDate   = '';
      o.cancelledDate  = '';
      // v3.3.28: 부분납품 중이었더라도 전량 완료로 처리하면 모든 품목을 완료 처리
      (o.items || []).forEach((i, idx) => { i.deliveredBoxes = nextBoxes[idx]; });
      _recordDeliveryDelta(o, dateVal, prevBoxes, nextBoxes);
      save();
      closeModalBtn();
      renderAll();
      toast('✅ 납품완료로 처리되었습니다.');
    }
  } catch (err) {
    console.error('[toggleDelivered] 오류:', err);
    toast('⚠️ 납품 처리 중 오류가 발생했습니다.');
  }
}

// ── 납품 상태 변경 ──
function setDelivery(id, status) {
  try {
    const o = orders.find(x => x.id === id);
    if (!o) return;

    if (status === 'cancelled') {
      // 이미 발주취소 상태면 터치 시 미납품으로 되돌림 (토글)
      if (o.deliveryStatus === 'cancelled') {
        o.deliveryStatus = 'pending';
        o.deliveryNote   = '';
        o.cancelledDate  = '';
        save();
        closeModalBtn();
        renderAll();
        toast('⏪ 발주취소가 취소되고 미납품으로 되돌아갔습니다.');
        return;
      }
      if (!confirm(`[${o.ship}]\n이 발주를 취소 처리할까요?\n(모든 금액·박스 집계에서 제외됩니다)`)) return;
      const note = prompt('취소 사유 (선택사항)', o.deliveryNote || '');
      if (note !== null) o.deliveryNote = note.trim();
      // v3.3.43: 반품 상태였다가 바로 취소 처리하는 경우, 남아있던 반품확인 체크를 정리
      if (o.deliveryStatus === 'returned') _pruneReturnChk(o.id);
      o.returnAmount  = 0;
      o.partialAmount = 0;
      o.deliveredDate = '';
      o.returnedDate  = '';
      o.cancelledDate = todayStr();
      o.deliveryStatus = 'cancelled';
      (o.items || []).forEach(i => { i.deliveredBoxes = 0; }); // v3.3.28
      _clearDeliveryEvents(o); // v3.3.33
      save();
      closeModalBtn();
      renderAll();
      toast('🚫 발주취소로 처리되었습니다.');
      return;
    }

    if (status === 'returned') {
      // 이미 반품 상태면 터치 시 미납품으로 되돌림 (토글) — 발주취소/납품완료 버튼과 동일한 패턴
      if (o.deliveryStatus === 'returned') {
        o.deliveryStatus = 'pending';
        o.deliveryNote   = '';
        o.returnAmount   = 0;
        o.partialAmount  = 0;
        o.returnedDate   = '';
        o.cancelledDate  = '';
        o.deliveredDate  = '';
        (o.items || []).forEach(i => { i.deliveredBoxes = 0; });
        _clearDeliveryEvents(o); // v3.3.33
        // v3.3.43: 반품 확인 체크도 함께 초기화 — 안 지우면 나중에 이 발주가 다시 반품
        // 처리될 때 예전 체크가 남아있어 재확인 없이 곧바로 "재고반영됨"으로 보이게 됨.
        _pruneReturnChk(o.id);
        save();
        closeModalBtn();
        renderAll();
        toast('⏪ 반품 처리가 취소되고 미납품으로 되돌아갔습니다.');
        return;
      }
      const input = prompt(
        `반품 금액을 입력하세요\n(전액 반품이면 비워두세요, 발주금액 ${fmt(o.total)} 적용)`,
        o.returnAmount || ''
      );
      if (input === null) return;
      const amt = input.trim() === '' ? (o.total || 0) : parseFloat(input.replace(/[^0-9.]/g, ''));
      o.returnAmount = isNaN(amt) ? (o.total || 0) : amt;
      const note = prompt('비고 (선택사항)', o.deliveryNote || '');
      if (note !== null) o.deliveryNote = note.trim();
      o.cancelledDate = ''; // 취소 상태였다가 바로 반품 처리하는 경우 대비
      (o.items || []).forEach(i => { i.deliveredBoxes = 0; }); // v3.3.28: 부분납품 진행분은 반품 처리로 정리
      _clearDeliveryEvents(o); // v3.3.33
    } else if (status === 'delivered') {
      const note = prompt('납품 비고 (선택사항)', o.deliveryNote || '');
      if (note !== null) o.deliveryNote = note.trim();
      // v3.3.33: 부분납품 중이었다면 "오늘 새로 채워진 만큼"을 이력에 기록
      const dateVal = todayStr();
      const prevBoxes = (o.items || []).map(i => calcItemDeliveredBoxes(i));
      const nextBoxes = (o.items || []).map(i => calcItemBoxCount(i));
      (o.items || []).forEach((i, idx) => { i.deliveredBoxes = nextBoxes[idx]; }); // v3.3.28
      _recordDeliveryDelta(o, dateVal, prevBoxes, nextBoxes);
    }

    if (status === 'delivered') { o.deliveredDate = todayStr(); o.returnedDate = ''; o.cancelledDate = ''; }
    if (status === 'returned')  o.returnedDate  = todayStr();

    o.deliveryStatus = status;
    save();
    closeModalBtn();
    renderAll();

    const msgs = {
      delivered: '✅ 납품완료로 변경되었습니다.',
      returned:  '↩️ 반품 처리되었습니다.'
    };
    toast(msgs[status] || '변경되었습니다.');
  } catch (err) {
    console.error('[setDelivery] 오류:', err);
    toast('⚠️ 상태 변경 중 오류가 발생했습니다.');
  }
}

// ── 발주 삭제 (v3.3.53: 즉시 영구삭제 대신 휴지통으로 이동) ──
function delOrder(id) {
  try {
    if (!confirm(`삭제하시겠습니까?\n(휴지통으로 이동 · ${TRASH_RETENTION_DAYS}일 후 자동으로 완전삭제됩니다)`)) return;
    const target = orders.find(o => o.id === id);
    orders = orders.filter(o => o.id !== id);
    save();
    if (target) {
      target.deletedAt = new Date().toISOString();
      deletedOrders.push(target);
      saveTrash();
    }
    // v3.3.53: 더블체크/반품확인 표시는 여기서 정리하지 않음 — 휴지통에서 복원하면
    // 그대로 되살아나야 하므로, 실제 영구삭제(보관기간 만료·수동 완전삭제) 시점에만 정리한다.
    renderAll();
    toast(`🗑️ 휴지통으로 이동했습니다 (${TRASH_RETENTION_DAYS}일 후 자동삭제)`);
  } catch (err) {
    console.error('[delOrder] 오류:', err);
    toast('⚠️ 삭제 중 오류가 발생했습니다.');
  }
}

// ── 휴지통: 복원 (v3.3.53) ──
function restoreOrder(id) {
  try {
    const idx = deletedOrders.findIndex(o => o.id === id);
    if (idx === -1) return;
    const [target] = deletedOrders.splice(idx, 1);
    delete target.deletedAt;
    orders.push(target);
    save();
    saveTrash();
    renderAll();
    toast('↩️ 복원되었습니다.');
  } catch (err) {
    console.error('[restoreOrder] 오류:', err);
    toast('⚠️ 복원 중 오류가 발생했습니다.');
  }
}

// ── 휴지통: 수동 완전삭제 (v3.3.53) ──
function permanentlyDeleteOrder(id) {
  try {
    if (!confirm('완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    deletedOrders = deletedOrders.filter(o => o.id !== id);
    saveTrash();
    _pruneOrderChecks(id); // 영구삭제 시점에 더블체크/반품확인 표시 정리
    renderAll();
    toast('완전히 삭제되었습니다.');
  } catch (err) {
    console.error('[permanentlyDeleteOrder] 오류:', err);
    toast('⚠️ 삭제 중 오류가 발생했습니다.');
  }
}

// ══════════════════════════════════════════════════════
// 발주 수정 모달
// ══════════════════════════════════════════════════════
let _editId = null;
// v3.3.26 fix: 품목 행의 다음 idx를 "현재 화면에 남은 행 개수"로 계산하면,
// 마지막이 아닌 중간 품목을 삭제한 뒤 "+ 품목 추가"를 누를 때 이미 존재하는
// idx와 충돌해서(예: 0,1,2 중 1을 지우면 남은 행이 2개 → 새 idx도 2로 배정,
// 기존 idx=2 행과 중복) getElementById가 항상 먼저 나온(기존) 요소를 반환하게 됨.
// 그 결과 새로 입력한 품목은 저장 시 조용히 버려지고, 기존 품목이 대신
// 중복 저장되는 심각한 데이터 유실 버그가 있었음 — 절대 재사용되지 않는
// 증가 전용 카운터로 교체.
let _editItemNextIdx = 0;

// v3.3.14 fix: 품목 단위 select 옵션 생성 헬퍼.
// 기존엔 select 옵션이 box/pcs/doz/pkt 4개뿐이라, analyzer.js AI가 반환하는
// ctn·kg·l·btl(그리고 구버전 데이터의 cs) 단위 품목을 수정 모달에서 열었다가
// 단위를 건드리지 않고 그냥 저장만 눌러도 select가 첫 옵션(box)으로 조용히
// 바뀌어 저장되는 문제가 있었다. kg/l/btl은 박스 환산 자체가 없는(0박스) 단위인데
// box로 바뀌면 수량이 그대로 박스수로 잡혀버려 재고 집계가 틀어짐.
// → 기본 옵션 목록에 없는 단위는 원래 값 그대로 옵션을 하나 추가해 선택해 두어
//   어떤 단위든 손대지 않으면 절대 값이 바뀌지 않도록 함.
const _EDIT_UNIT_BASE = [['box','박스'],['ctn','ctn'],['pcs','pcs'],['doz','doz'],['pkt','봉지'],['kg','kg'],['l','L'],['btl','병']];
function _unitOptions(current) {
  const known = _EDIT_UNIT_BASE.some(([v]) => v === current);
  const list  = (known || !current) ? _EDIT_UNIT_BASE : [..._EDIT_UNIT_BASE, [current, current]];
  return list.map(([v,l]) => `<option value="${escapeHtml(v)}"${current===v?' selected':''}>${escapeHtml(l)}</option>`).join('');
}

function openEditModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  _editId = id;
  // 최초 렌더되는 품목 행은 0..N-1을 그대로 쓰므로, 다음에 추가될 새 행은
  // 그 뒤(N)부터 — 이후 몇 개를 지우든 절대 기존 idx와 겹치지 않음
  _editItemNextIdx = (o.items || []).length;
  // 상세 모달 닫기 (history.back() 없이 직접 닫아야 popstate 충돌 방지)
  document.getElementById('modalOv').classList.remove('open');

  // 품목 행 렌더
  function itemRow(item, idx) {
    const priceDisplay = item.price ? Number(item.price).toLocaleString() : '';
    const amountDisplay = item.amount ? Number(item.amount).toLocaleString() : '';
    return `
    <div class="edit-item-row" id="eitem-${idx}">
      <input type="text" id="ei-desc-${idx}"  value="${escapeHtml(item.desc)}" placeholder="품목명" enterkeyhint="next">
      <input type="text" id="ei-code-${idx}"  value="${escapeHtml(item.code)}" placeholder="CODE" enterkeyhint="next">
      <input type="number" id="ei-qty-${idx}" value="${item.qty||0}" step="any" min="0" inputmode="decimal" enterkeyhint="next" oninput="recalcEditItem(${idx})">
      <select id="ei-unit-${idx}">
        ${_unitOptions(item.unit)}
      </select>
      <input type="text" id="ei-price-${idx}" value="${priceDisplay}" placeholder="단가"
        inputmode="numeric" enterkeyhint="next"
        onfocus="this.value=this.value.replace(/,/g,'')"
        onblur="formatPriceField(this,${idx})"
        oninput="_formatPriceLive(this,${idx})">
      <span id="ei-amt-${idx}" style="font-size:11px;color:var(--muted);white-space:nowrap;align-self:center;">${amountDisplay ? '₩'+amountDisplay : ''}</span>
      <button class="edit-del-btn" onclick="removeEditItem(${idx})">×</button>
    </div>`;
  }

  document.getElementById('edit-body').innerHTML = `
    <div class="edit-row">
      <div class="edit-field">
        <label>선명</label>
        <input id="ef-ship" type="text" value="${escapeHtml(o.ship)}" enterkeyhint="next">
      </div>
      <div class="edit-field">
        <label>구분</label>
        <select id="ef-cat">
          <option value="cruise"${o.category==='cruise'?' selected':''}>크루즈</option>
          <option value="cargo"${o.category==='cargo'?' selected':''}>카고</option>
          <option value="return"${o.category==='return'?' selected':''}>반품</option>
          <option value="manual"${(o.category==='manual'||!o.category)?' selected':''}>직접입력</option>
        </select>
      </div>
    </div>
    <div class="edit-row">
      <div class="edit-field">
        <label>발주일자</label>
        <input id="ef-date" type="date" value="${o.date||''}" enterkeyhint="next">
      </div>
      <div class="edit-field">
        <label>납기일자</label>
        <input id="ef-delivery" type="date" value="${o.delivery||''}" enterkeyhint="next">
      </div>
    </div>
    <div class="edit-row">
      <div class="edit-field">
        <label>서류번호</label>
        <input id="ef-docno" type="text" value="${escapeHtml(o.docNo)}" enterkeyhint="next">
      </div>
      <div class="edit-field">
        <label>거래처발주번호</label>
        <input id="ef-pono" type="text" value="${escapeHtml(o.poNo)}" enterkeyhint="next">
      </div>
    </div>

    <div class="sdiv" style="margin-top:4px;">품목</div>
    <div class="edit-item-hdr">
      <span>품목명</span><span>CODE</span><span>수량</span><span>단위</span><span>단가</span><span></span>
    </div>
    <div id="edit-items-list">
      ${(o.items||[]).map((item,idx) => itemRow(item,idx)).join('')}
    </div>
    <button class="edit-add-btn" onclick="addEditItem()">+ 품목 추가</button>

    <div style="display:flex;gap:8px;margin-top:20px;padding-bottom:8px;">
      <button class="btn btn-g" style="flex:1;" onclick="closeEditModal()">취소</button>
      <button class="btn btn-success" style="flex:1;" onclick="saveEditOrder()">💾 저장</button>
    </div>
  `;

  // setTimeout으로 popstate 이벤트가 먼저 처리된 후 editModal 열기
  setTimeout(() => {
    document.getElementById('editModalOv').classList.add('open');
    history.pushState({ modal: 'edit' }, '');

    // ── Enter/Next 키 → 다음 필드로 포커스 이동 ──
    // 이동 순서: 선명 → 발주일 → 납기일 → 서류번호 → 거래처발주번호 → 품목명 → CODE → 수량 → 단가 → 다음행 품목명 … → 마지막 단가에서 저장
    const editBody = document.getElementById('edit-body');

    function _handleEditFieldNav(e) {
      if (e.key !== 'Enter' && e.key !== 'Go' && e.key !== 'Next') return;
      const active = document.activeElement;
      if (!active || active.tagName === 'BUTTON' || active.tagName === 'SELECT') return;
      e.preventDefault();

      // 고정 헤더 필드 순서 (날짜 필드 포함)
      const HEADER_IDS = ['ef-ship', 'ef-date', 'ef-delivery', 'ef-docno', 'ef-pono'];
      const hi = HEADER_IDS.indexOf(active.id);
      if (hi !== -1) {
        const nextId = HEADER_IDS[hi + 1];
        if (nextId) {
          document.getElementById(nextId)?.focus();
        } else {
          document.getElementById('ei-desc-0')?.focus();
        }
        return;
      }

      const m = active.id.match(/^ei-(desc|code|qty|price)-(\d+)$/);
      if (m) {
        const field = m[1], idx = Number(m[2]);
        const ORDER = ['desc', 'code', 'qty', 'price'];
        const fi = ORDER.indexOf(field);
        if (fi < ORDER.length - 1) {
          document.getElementById(`ei-${ORDER[fi + 1]}-${idx}`)?.focus();
        } else {
          const nextDesc = document.getElementById(`ei-desc-${idx + 1}`);
          if (nextDesc) {
            nextDesc.focus();
          } else {
            document.querySelector('#edit-body .btn-success')?.focus();
          }
        }
      }
    }

    // keydown: 폼 submit / 기본 동작 방지
    editBody.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Go' || e.key === 'Next') e.preventDefault();
    });
    // keyup: 실제 필드 이동 처리 (삼성 키보드 등 모바일 키보드 호환)
    editBody.addEventListener('keyup', _handleEditFieldNav);

    // 초기 enterkeyhint 설정
    _updateItemEnterHints();
  }, 50);

  // 스와이프 닫기 (리스너 누적 방지: clone으로 기존 리스너 제거)
  const emOld = document.getElementById('editModal');
  const em = emOld.cloneNode(true);
  emOld.parentNode.replaceChild(em, emOld);
  let _sy = 0;
  em.addEventListener('touchstart', e => { _sy = e.touches[0].clientY; }, { passive: true });
  em.addEventListener('touchmove', e => {
    if (em.scrollTop > 0) return;
    if (e.touches[0].clientY - _sy > 60) closeEditModal();
  }, { passive: true });
}

function closeEditModal() {
  document.getElementById('editModalOv').classList.remove('open');
  _editId = null;
  if (history.state && history.state.modal === 'edit') history.back();
}

function closeEditModalOv(e) {
  if (e.target === document.getElementById('editModalOv')) closeEditModal();
}

function addEditItem() {
  const list = document.getElementById('edit-items-list');
  const idx  = _editItemNextIdx++; // v3.3.26: 항상 새 값 — 삭제된 idx를 재사용하지 않음
  const div  = document.createElement('div');
  div.innerHTML = `
    <div class="edit-item-row" id="eitem-${idx}">
      <input type="text"   id="ei-desc-${idx}"  placeholder="품목명"  enterkeyhint="next">
      <input type="text"   id="ei-code-${idx}"  placeholder="CODE"    enterkeyhint="next">
      <input type="number" id="ei-qty-${idx}"   value="0" step="any" min="0" inputmode="decimal" enterkeyhint="next" oninput="recalcEditItem(${idx})">
      <select id="ei-unit-${idx}">
        ${_unitOptions('box')}
      </select>
      <input type="text" id="ei-price-${idx}" value="" placeholder="단가"
        inputmode="numeric" enterkeyhint="next"
        onfocus="this.value=this.value.replace(/,/g,'')"
        onblur="formatPriceField(this,${idx})"
        oninput="_formatPriceLive(this,${idx})">
      <span id="ei-amt-${idx}" style="font-size:11px;color:var(--muted);white-space:nowrap;align-self:center;"></span>
      <button class="edit-del-btn" onclick="removeEditItem(${idx})">×</button>
    </div>`;
  list.appendChild(div.firstElementChild);
  _updateItemEnterHints();
  // 새 행 품목명으로 자동 포커스
  setTimeout(() => document.getElementById(`ei-desc-${idx}`)?.focus(), 50);
}

// 마지막 품목 행의 단가 필드만 enterkeyhint="done"으로, 나머지는 "next"로 설정
function _updateItemEnterHints() {
  const rows = document.querySelectorAll('#edit-items-list .edit-item-row');
  rows.forEach((row, i) => {
    const isLast = i === rows.length - 1;
    ['desc','code','qty'].forEach(f => {
      const el = row.querySelector(`input[id^="ei-${f}-"]`);
      if (el) el.setAttribute('enterkeyhint', 'next');
    });
    const priceEl = row.querySelector(`input[id^="ei-price-"]`);
    if (priceEl) priceEl.setAttribute('enterkeyhint', isLast ? 'done' : 'next');
  });
}

// v3.3.22: 단가 입력 중(oninput)에도 1,000 단위 콤마를 실시간으로 넣어준다.
// 기존엔 blur(포커스 아웃) 시에만 콤마가 붙어서, 타이핑 중엔 "3800"처럼 숫자만
// 보이다가 다른 칸으로 넘어가야 "3,800"으로 바뀌었음 — 타이핑 중에도 바로 보이도록 개선.
// 커서 위치는 "커서 앞에 있던 숫자 개수"를 기준으로 다시 찾아 이동시켜, 콤마가
// 추가/삭제되며 글자 수가 바뀌어도 커서가 엉뚱한 자리로 튀지 않도록 함.
function _formatPriceLive(el, idx) {
  const cursorPos = el.selectionStart;
  const digitsBeforeCursor = el.value.slice(0, cursorPos).replace(/[^0-9]/g, '').length;
  const raw = el.value.replace(/[^0-9]/g, '');
  const num = raw ? parseInt(raw, 10) : 0;
  el.value = raw ? num.toLocaleString() : '';
  let pos = 0, seen = 0;
  while (pos < el.value.length && seen < digitsBeforeCursor) {
    if (/[0-9]/.test(el.value[pos])) seen++;
    pos++;
  }
  el.setSelectionRange(pos, pos);
  recalcEditItem(idx); // 타이핑 중에도 금액이 바로 반영되도록 함께 재계산
}

// 단가 입력란 포맷: blur 시 숫자에 , 추가 + 금액 재계산
function formatPriceField(el, idx) {
  const raw = parseFloat(el.value.replace(/,/g, '')) || 0;
  el.value  = raw ? Number(raw).toLocaleString() : '';
  recalcEditItem(idx);
}

// 수량 또는 단가 변경 시 금액 자동 계산
function recalcEditItem(idx) {
  const qty   = parseFloat(document.getElementById(`ei-qty-${idx}`)?.value || 0)   || 0;
  const price = parseFloat((document.getElementById(`ei-price-${idx}`)?.value || '0').replace(/,/g, '')) || 0;
  const amt   = Math.round(qty * price);
  const span  = document.getElementById(`ei-amt-${idx}`);
  if (span) span.textContent = amt ? '₩' + amt.toLocaleString() : '';
}

function removeEditItem(idx) {
  const row = document.getElementById(`eitem-${idx}`);
  if (row) row.remove();
}

function saveEditOrder() {
  try {
    const o = orders.find(x => x.id === _editId);
    if (!o) return;

  o.ship     = document.getElementById('ef-ship').value.trim();
  o.category = document.getElementById('ef-cat').value;
  o.date     = document.getElementById('ef-date').value;
  o.delivery = document.getElementById('ef-delivery').value;
  o.docNo    = document.getElementById('ef-docno').value.trim();
  o.poNo     = document.getElementById('ef-pono').value.trim();

  // 품목 수집
  // v3.3.32: row의 idx는 openEditModal에서 기존 품목의 원래 배열 위치를 그대로 쓰고
  // (addEditItem으로 새로 추가되는 품목만 그 뒤 번호를 받음 — _editItemNextIdx),
  // 이 idx가 oldItems 범위 안이면 같은 품목 행이 수정된 것이므로 부분납품 진행량
  // (deliveredBoxes)을 이어받는다. 이걸 빠뜨리면 부분납품 중인 발주를 단순 오타
  // 수정만 해도 진행량이 전부 0으로 사라지는 문제가 있었음.
  const oldItems = o.items || [];
  const oldToNewIdxMap = {}; // 원래 배열 idx → 수정 후 새 배열 idx (품목 삭제로 인한 위치 이동 대응)
  const rows = document.getElementById('edit-items-list').querySelectorAll('.edit-item-row');
  o.items = [];
  rows.forEach((row, i) => {
    const idx   = row.id.replace('eitem-', '');
    const desc  = (document.getElementById(`ei-desc-${idx}`)?.value  || '').trim();
    const code  = (document.getElementById(`ei-code-${idx}`)?.value  || '').trim();
    const qty   = parseFloat(document.getElementById(`ei-qty-${idx}`)?.value  || 0) || 0;
    const unit  = document.getElementById(`ei-unit-${idx}`)?.value   || 'pcs';
    const price = parseFloat((document.getElementById(`ei-price-${idx}`)?.value || '0').replace(/,/g, '')) || 0;
    const amount = Math.round(qty * price * 100) / 100;
    if (desc || qty) {
      const newItem = { desc, code, qty, unit, price, amount };
      const oldItem = oldItems[Number(idx)];
      if (oldItem && oldItem.deliveredBoxes) newItem.deliveredBoxes = oldItem.deliveredBoxes;
      oldToNewIdxMap[Number(idx)] = o.items.length;
      o.items.push(newItem);
    }
  });

  // v3.3.33: 배송 이력(deliveryEvents)도 품목 위치 변경에 맞춰 재매핑 —
  // 품목이 중간에서 삭제되면 뒤 품목들의 배열 idx가 당겨지므로 그대로 두면 엉뚱한
  // 품목에 이력이 붙는다. 삭제된 품목의 이력분은 더 이상 대응하는 품목이 없으므로 버린다.
  if (Array.isArray(o.deliveryEvents) && o.deliveryEvents.length) {
    o.deliveryEvents = o.deliveryEvents.map(ev => {
      const remapped = {};
      Object.keys(ev.perItem || {}).forEach(oldIdx => {
        const newIdx = oldToNewIdxMap[Number(oldIdx)];
        if (newIdx != null) remapped[newIdx] = (Number(remapped[newIdx]) || 0) + (Number(ev.perItem[oldIdx]) || 0);
      });
      return { date: ev.date, perItem: remapped };
    }).filter(ev => Object.keys(ev.perItem).length > 0);
  }

  // 합계 재계산
  const oldTotal = o.total;
  o.total = o.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // v3.3.32: 부분납품 진행 중이던 발주는 품목 수정 후 진행 상태를 다시 계산
  // (수량이 줄어 이미 전량 배송된 것으로 확인되거나, 품목이 삭제돼 진행량이
  //  전부 없어지는 경우를 반영해 "부분납품인데 진행률 0%" 모순을 방지)
  if (o.deliveryStatus === 'partial') {
    const derivedStatus = _deriveDeliveryStatusFromItems(o);
    o.deliveryStatus = derivedStatus;
    if (derivedStatus === 'pending') {
      o.deliveredDate = ''; // savePartialDelivery와 동일 규칙
      _clearDeliveryEvents(o); // v3.3.33
    }
  }

  // 반품 건은 반품금액(returnAmount)도 함께 동기화
  if (o.isReturn) {
    // 업로드된 반품서: 반품금액은 항상 |총액|과 일치
    o.returnAmount = Math.abs(o.total);
  } else if (o.deliveryStatus === 'returned' && o.returnAmount === oldTotal) {
    // 수동 반품(전액 반품, 커스텀 금액을 입력하지 않은 경우)만 총액을 따라감
    // (반품 처리 시 일부 금액만 따로 입력해둔 경우는 그대로 유지)
    o.returnAmount = o.total;
  }

  save();
  renderAll();
  closeEditModal();
  toast('✅ 수정되었습니다.');
  } catch (err) {
    console.error('[saveEditOrder] 오류:', err);
    toast('⚠️ 저장 중 오류가 발생했습니다.');
  }
}

// ── 보관 토글 (납품완료 건 숨김 ↔ 복원) ──
function toggleArchive(id) {
  try {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    if (o.archived) {
      // 보관 해제 → 목록 복원
      delete o.archived;
      save();
      closeModalBtn();
      renderAll();
      toast('📤 보관이 해제되어 목록에 복원되었습니다.');
    } else {
      // 보관함으로 이동 (납품완료 건만 가능)
      if (o.deliveryStatus !== 'delivered') {
        toast('⚠️ 납품완료 건만 보관할 수 있습니다.');
        return;
      }
      if (!confirm(`[${o.ship}]\n보관함으로 이동하면 발주목록에서 숨겨집니다.\n납품금액·통계에는 그대로 반영됩니다.\n\n보관하시겠습니까?`)) return;
      o.archived = true;
      save();
      closeModalBtn();
      renderAll();
      toast('📦 보관함으로 이동했습니다.');
    }
  } catch (err) {
    console.error('[toggleArchive] 오류:', err);
    toast('⚠️ 보관 처리 중 오류가 발생했습니다.');
  }
}
