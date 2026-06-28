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
    const isReturned  = o.deliveryStatus === 'returned';
    const isPartial   = o.deliveryStatus === 'partial';
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
        ${(o.items || []).map(i => `<tr>
          <td>${escapeHtml(i.desc)}</td>
          <td style="font-family:monospace;">${fmtQ(i)}</td>
          <td style="font-family:monospace;">${formatBoxCount(calcItemBoxCount(i))}</td>
          <td style="font-family:monospace;">${i.price ? '₩' + Number(i.price).toLocaleString() : '-'}</td>
          <td style="font-family:monospace;font-weight:700;">${i.amount ? '₩' + Number(i.amount).toLocaleString() : '-'}</td>
        </tr>`).join('')}
        <tr class="tr">
          <td colspan="4">TOTAL</td>
          <td style="font-family:monospace;">${fmt(o.total)}</td>
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
      ${o.deliveryNote ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">📝 ${escapeHtml(o.deliveryNote)}</div>` : ''}
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
  } catch (err) {
    console.error('[setDelivery] 오류:', err);
    toast('⚠️ 상태 변경 중 오류가 발생했습니다.');
  }
}

// ── 발주 삭제 ──
function delOrder(id) {
  try {
    if (!confirm('삭제하시겠습니까?')) return;
    orders = orders.filter(o => o.id !== id);
    save();
    renderAll();
    toast('삭제되었습니다.');
  } catch (err) {
    console.error('[delOrder] 오류:', err);
    toast('⚠️ 삭제 중 오류가 발생했습니다.');
  }
}

// ══════════════════════════════════════════════════════
// 발주 수정 모달
// ══════════════════════════════════════════════════════
let _editId = null;

function openEditModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  _editId = id;
  // 상세 모달 닫기 (history.back() 없이 직접 닫아야 popstate 충돌 방지)
  document.getElementById('modalOv').classList.remove('open');

  // 품목 행 렌더
  function itemRow(item, idx) {
    return `
    <div class="edit-item-row" id="eitem-${idx}">
      <input type="text"   id="ei-desc-${idx}"   value="${(item.desc||'').replace(/"/g,'&quot;')}" placeholder="품목명">
      <input type="text"   id="ei-code-${idx}"   value="${item.code||''}" placeholder="CODE">
      <input type="number" id="ei-qty-${idx}"    value="${item.qty||0}"   step="any" min="0">
      <select id="ei-unit-${idx}">
        ${[['box','박스'],['pcs','pcs'],['doz','doz']].map(([v,l]) =>
          `<option value="${v}"${item.unit===v?' selected':''}>${l}</option>`
        ).join('')}
      </select>
      <input type="number" id="ei-price-${idx}"  value="${item.price||0}" step="any" min="0" placeholder="단가">
      <button class="edit-del-btn" onclick="removeEditItem(${idx})">×</button>
    </div>`;
  }

  document.getElementById('edit-body').innerHTML = `
    <div class="edit-row">
      <div class="edit-field">
        <label>선명</label>
        <input id="ef-ship" type="text" value="${(o.ship||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="edit-field">
        <label>구분</label>
        <select id="ef-cat">
          <option value="cruise"${o.category==='cruise'?' selected':''}>크루즈</option>
          <option value="cargo"${o.category==='cargo'?' selected':''}>카고</option>
        </select>
      </div>
    </div>
    <div class="edit-row">
      <div class="edit-field">
        <label>발주일자</label>
        <input id="ef-date" type="date" value="${o.date||''}">
      </div>
      <div class="edit-field">
        <label>납기일자</label>
        <input id="ef-delivery" type="date" value="${o.delivery||''}">
      </div>
    </div>
    <div class="edit-row">
      <div class="edit-field">
        <label>서류번호</label>
        <input id="ef-docno" type="text" value="${(o.docNo||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="edit-field">
        <label>거래처발주번호</label>
        <input id="ef-pono" type="text" value="${(o.poNo||'').replace(/"/g,'&quot;')}">
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
  const idx  = list.querySelectorAll('.edit-item-row').length;
  const div  = document.createElement('div');
  div.innerHTML = `
    <div class="edit-item-row" id="eitem-${idx}">
      <input type="text"   id="ei-desc-${idx}"  placeholder="품목명">
      <input type="text"   id="ei-code-${idx}"  placeholder="CODE">
      <input type="number" id="ei-qty-${idx}"   value="0" step="any" min="0">
      <select id="ei-unit-${idx}">
        <option value="box">박스</option>
        <option value="pcs">pcs</option>
        <option value="doz">doz</option>
      </select>
      <input type="number" id="ei-price-${idx}" value="0" step="any" min="0" placeholder="단가">
      <button class="edit-del-btn" onclick="removeEditItem(${idx})">×</button>
    </div>`;
  list.appendChild(div.firstElementChild);
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
  const rows = document.getElementById('edit-items-list').querySelectorAll('.edit-item-row');
  o.items = [];
  rows.forEach((row, i) => {
    const idx   = row.id.replace('eitem-', '');
    const desc  = (document.getElementById(`ei-desc-${idx}`)?.value  || '').trim();
    const code  = (document.getElementById(`ei-code-${idx}`)?.value  || '').trim();
    const qty   = parseFloat(document.getElementById(`ei-qty-${idx}`)?.value  || 0) || 0;
    const unit  = document.getElementById(`ei-unit-${idx}`)?.value   || 'pcs';
    const price = parseFloat(document.getElementById(`ei-price-${idx}`)?.value || 0) || 0;
    const amount = Math.round(qty * price * 100) / 100;
    if (desc || qty) o.items.push({ desc, code, qty, unit, price, amount });
  });

  // 합계 재계산
  o.total = o.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

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
