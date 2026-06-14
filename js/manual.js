// ══════════════════════════════════════════════════════
// manual.js  —  직접 입력 탭
// ══════════════════════════════════════════════════════

let itemCount = 0;

function initManual() {
  itemCount = 0;
  document.getElementById('items-list').innerHTML = '';
  addItem();
}

function addItem() {
  itemCount++;
  const id  = 'ir-' + itemCount;
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id        = id;
  div.innerHTML = `
    <div class="ir-top">
      <div class="fg" style="margin-bottom:0;flex:1;">
        <span class="item-sublabel">품목명</span>
        <input class="fi" placeholder="품목명" style="font-size:14px;"/>
      </div>
      <button class="rm-btn" onclick="rmItem('${id}')">✕</button>
    </div>
    <div class="ir-bot">
      <div class="fg" style="margin-bottom:0;">
        <span class="item-sublabel">수량</span>
        <input class="fi" type="number" placeholder="0" style="font-size:14px;"/>
      </div>
      <div class="fg" style="margin-bottom:0;">
        <span class="item-sublabel">단위</span>
        <select class="fs" style="font-size:14px;">
          <option>DOZ</option><option>PCS</option><option>BOX</option><option>KG</option><option>EA</option>
        </select>
      </div>
      <div class="fg" style="margin-bottom:0;">
        <span class="item-sublabel">단가(₩)</span>
        <input class="fi" type="number" placeholder="0" style="font-size:14px;"/>
      </div>
    </div>
  `;
  document.getElementById('items-list').appendChild(div);
}

function rmItem(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function saveManual() {
  const date = document.getElementById('m-date').value;
  const ship = document.getElementById('m-ship').value.trim();
  if (!date || !ship) { toast('⚠️ 발주일자와 선명 필수'); return; }

  const cat   = document.getElementById('m-cat').value;
  const rows  = document.querySelectorAll('#items-list .item-row');
  const items = [];
  let total   = 0;

  rows.forEach(row => {
    const ins  = row.querySelectorAll('input');
    const sel  = row.querySelector('select');
    const desc = ins[0].value.trim();
    const qty  = parseFloat(ins[1].value) || 0;
    const unit = sel.value;
    const price  = parseFloat(ins[2].value) || 0;
    const amount = qty * price;
    if (desc) { items.push({ desc, qty, unit, price, amount }); total += amount; }
  });

  const o = {
    id:             'MAN-' + Date.now(),
    docNo:          document.getElementById('m-doc').value.trim() || 'MAN-' + Date.now(),
    date,
    delivery:       document.getElementById('m-del').value,
    ship,
    poNo:           document.getElementById('m-po').value.trim(),
    category:       cat,
    items,
    total,
    source:         'manual',
    deliveryStatus: cat === 'return' ? 'returned' : 'pending',
    returnAmount:   cat === 'return' ? total : 0
  };

  orders.push(o);
  save();
  resetManual();
  toast('✅ 저장되었습니다.');
  setTimeout(() => goTo(1), 600);
}

function resetManual() {
  document.getElementById('m-date').value = new Date().toISOString().split('T')[0];
  ['m-del', 'm-doc', 'm-po', 'm-ship'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('m-cat').value = 'manual';
  initManual();
}
