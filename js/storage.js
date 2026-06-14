// ══════════════════════════════════════════════════════
// storage.js  —  데이터 저장/불러오기 (localStorage)
// ══════════════════════════════════════════════════════

const STORE_KEY = 'baljuOrders_v2';
let orders = [];

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(orders));
  } catch(e) {
    console.error('[storage] 저장 실패:', e);
  }
}

function load() {
  try {
    let d = localStorage.getItem(STORE_KEY);
    // 구버전 sessionStorage 마이그레이션
    if (!d) {
      const old = sessionStorage.getItem('orders');
      if (old) d = old;
    }
    if (d) {
      orders = JSON.parse(d);
      // 기존 데이터 필드 초기화 (하위 호환)
      orders.forEach(o => {
        if (!o.deliveryStatus)          o.deliveryStatus = 'pending';
        if (o.returnAmount === undefined) o.returnAmount  = 0;
        if (!o.deliveryNote)            o.deliveryNote   = '';
        if (o.category === 'return')    o.deliveryStatus = 'returned';
      });
      save();
    }
  } catch(e) {
    console.error('[storage] 불러오기 실패:', e);
  }
}

function resetOrders() {
  if (!confirm('발주 목록 전체를 초기화할까요?\n저장된 모든 내역이 삭제됩니다.')) return;
  orders = [];
  save();
  renderAll();
  toast('🗑️ 목록 초기화 완료');
}
