// ══════════════════════════════════════════════════════
// helpers.js  —  순수 유틸리티 (DOM 의존 없음)
// ══════════════════════════════════════════════════════

// ── 오늘 날짜 (YYYY-MM-DD, 로컬 기준) ──
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
  const u = String(unit).toLowerCase().trim().replace(/[^a-z]/g, '');

  // CTN / BOX / CASE / CARTON → qty = 박스 수 (1:1)
  if (u === 'ctn' || u === 'case' || u === 'carton' || u === 'box' || u === 'ct') return 1;

  // DOZ / DOZEN → 30doz = 1박스
  if (u.startsWith('doz') || u === 'dozen') return 30;

  // CS / PC / PCS / EA / PIECE → 360pcs = 1박스  (cs는 pcs와 동일 취급)
  if (u === 'cs' || u.startsWith('pc') || u === 'pcs' || u === 'ea' || u === 'each' || u === 'piece' || u === 'pieces') return 360;

  return null;
}

// 생메추리알 여부 판단 (품목명에 QUAIL 또는 메추리 포함)
function _isQuailEgg(item) {
  const d = String(item.desc || '').toUpperCase();
  return d.includes('QUAIL') || d.includes('메추리');
}

function calcItemBoxCount(item) {
  // boxes 필드가 직접 있으면 우선 사용
  if (item.boxes != null && Number(item.boxes) > 0) return Number(item.boxes);

  // 생메추리알 특별 처리: 40doz = 1박스 고정
  if (_isQuailEgg(item)) {
    const qty = Number(item.qty) || 0;
    if (qty > 0) {
      const u = String(item.unit || '').toLowerCase().replace(/[^a-z]/g, '');
      const isDoz = u.startsWith('doz') || u === 'dozen';
      return qty / (isDoz ? 40 : 480);
    }
  }

  // 일반 품목: desc에서 "NNN PCS/BOX" 또는 "NNN DOZ/BOX" 패턴 파싱
  // 단, 단위가 이미 box/ctn/case이면 qty = 박스 수 (1:1) → desc 패턴 무시
  const unitNorm = String(item.unit || '').toLowerCase().replace(/[^a-z]/g, '');
  const isBoxUnit = unitNorm === 'box' || unitNorm === 'ctn' || unitNorm === 'case' || unitNorm === 'carton' || unitNorm === 'ct';
  if (!isBoxUnit && item.desc) {
    const mPcs = String(item.desc).match(/(\d+)\s*(?:PCS|EA)[\s\/]*(?:BOX|CTN|CS|CASE)/i);
    if (mPcs) {
      const perBox = Number(mPcs[1]);
      if (perBox > 0 && item.qty) return Number(item.qty) / perBox;
    }
    const mDoz = String(item.desc).match(/(\d+)\s*(?:DOZ|DOZEN)[\s\/]*(?:BOX|CTN|CS|CASE)/i);
    if (mDoz) {
      const perBox = Number(mDoz[1]);
      if (perBox > 0 && item.qty) return Number(item.qty) / perBox;
    }
  }

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
