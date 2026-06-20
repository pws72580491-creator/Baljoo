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
        // 실 납품일 필드 없는 구버전 데이터 보정: 이미 납품/부분납품 상태면 발주일로 대체
        if (o.deliveredDate === undefined) {
          o.deliveredDate = (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial') ? (o.date || '') : '';
        }
        // unit=cs 인데 실제 단위가 doz인 경우 자동 보정
        (o.items || []).forEach(item => {
          if (item.unit === 'cs') {
            const desc = String(item.desc || '').toUpperCase();
            if (/DOZ|DOZEN/.test(desc)) {
              item.unit = 'doz';
            }
          }
        });
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
