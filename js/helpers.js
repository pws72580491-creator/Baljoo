// ══════════════════════════════════════════════════════
// helpers.js  —  순수 유틸리티 (DOM 의존 없음)
// ══════════════════════════════════════════════════════

// ── 포맷 ──
const fmt  = n => (n != null && n !== '') ? '₩' + Number(n).toLocaleString() : '-';
const fmtQ = i => i.qty ? `${Number(i.qty).toLocaleString()} ${i.unit || ''}` : '-';

// ── 배지 HTML ──
const badge = c => {
  if (c === 'cruise') return '<span class="badge b-cruise">크루즈</span>';
  if (c === 'cargo')  return '<span class="badge b-cargo">카고</span>';
  if (c === 'return') return '<span class="badge b-returned">반품</span>';
  return '<span class="badge b-manual">직접입력</span>';
};

const statusBadge = s => {
  if (s === 'delivered') return '<span class="badge b-delivered">납품완료</span>';
  if (s === 'returned')  return '<span class="badge b-returned">반품</span>';
  if (s === 'partial')   return '<span class="badge b-partial">부분납품</span>';
  return '<span class="badge b-pending">미납품</span>';
};

// ── 박스 계산 ──
function getBoxDivisor(unit) {
  if (!unit) return null;
  const u = String(unit).toLowerCase();
  if (u.includes('doz')) return 30;
  if (u.startsWith('pc')) return 360;
  return null;
}

function calcItemBoxCount(item) {
  const d = getBoxDivisor(item.unit);
  if (!d || !item.qty) return 0;
  return Number(item.qty) / d;
}

function formatBoxCount(bc) {
  if (!bc) return '0박스';
  return (bc % 1 === 0) ? `${bc}박스` : `${bc.toFixed(1)}박스`;
}

function calcOrderBoxes(order) {
  return (order.items || []).reduce((s, i) => s + calcItemBoxCount(i), 0);
}

// ── 실납품금액 계산 ──
function calcNetDelivery(order) {
  const total = order.total || 0;
  if (order.deliveryStatus === 'delivered') return total;
  if (order.deliveryStatus === 'returned')  return -(order.returnAmount || total);
  if (order.deliveryStatus === 'partial')   return order.partialAmount || 0;
  return 0;
}

// ── 필터된 발주 목록 ──
function filtered() {
  const from = document.getElementById('fDateFrom')?.value || '';
  const to   = document.getElementById('fDateTo')?.value   || '';
  return orders
    .filter(o => filterMode === 'all' || o.category === filterMode)
    .filter(o => statusMode === 'all' || o.deliveryStatus === statusMode)
    .filter(o => !searchQ || (o.ship + o.docNo + o.poNo).toLowerCase().includes(searchQ.toLowerCase()))
    .filter(o => !from || o.date >= from)
    .filter(o => !to   || o.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── 토스트 ──
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
