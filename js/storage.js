// ══════════════════════════════════════════════════════
// storage.js  —  데이터 저장/불러오기 (localStorage)
// ══════════════════════════════════════════════════════

const STORE_KEY = 'baljuOrders_v2';
let orders = [];

let _loadInProgress = false;  // load() 중 save() 시 자동동기화 방지

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(orders));
    // Firebase 자동 동기화 (3초 debounce) — 앱 초기 로드 중엔 건너뜀
    if (!_loadInProgress && typeof scheduleAutoSync === 'function') scheduleAutoSync();
  } catch(e) {
    console.error('[storage] 저장 실패:', e);
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      if (typeof toast === 'function') toast('⚠️ 저장 공간이 부족합니다. 오래된 데이터를 정리해주세요.');
    }
  }
}

function load() {
  try {
    let raw = localStorage.getItem(STORE_KEY);
    // 구버전 sessionStorage 마이그레이션
    if (!raw) {
      const old = sessionStorage.getItem('orders');
      if (old) raw = old;
    }
    if (raw) {
      const parsed = safeParse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[storage] 저장 데이터 형식 오류 — 초기화합니다.');
        orders = [];
        return;
      }
      orders = parsed;
      // 기존 데이터 필드 초기화 (하위 호환)
      orders.forEach(o => {
        if (!o.deliveryStatus)          o.deliveryStatus = 'pending';
        if (o.returnAmount === undefined) o.returnAmount  = 0;
        if (!o.deliveryNote)            o.deliveryNote   = '';
        // category='return'인데 상태가 아직 미처리(pending)인 구버전 데이터만 'returned'로 보정
        // (이미 사용자가 발주취소 등으로 명시적으로 바꾼 상태는 덮어쓰지 않음)
        if (o.category === 'return' && (!o.deliveryStatus || o.deliveryStatus === 'pending')) o.deliveryStatus = 'returned';
        // isReturn=true인 반품서는 최초 로드 시(미처리 상태)에만 deliveryStatus='returned' 보장
        // (사용자가 발주취소 등으로 명시적으로 바꾼 상태는 덮어쓰지 않음)
        if (o.isReturn === true && (!o.deliveryStatus || o.deliveryStatus === 'pending')) o.deliveryStatus = 'returned';
        // 구버전 "부분납품(partial)" 개념 폐지 → "발주취소(cancelled)"로 마이그레이션
        // (부분납품은 더 이상 지원하지 않으며, 발주취소는 모든 집계에서 제외됨)
        if (o.deliveryStatus === 'partial') {
          o.deliveryStatus = 'cancelled';
          o.deliveredDate  = '';
          o.partialAmount  = 0;
        }
        // 실 납품일 필드 없는 구버전 데이터 보정: 이미 납품 상태면 발주일로 대체
        if (o.deliveredDate === undefined) {
          o.deliveredDate = (o.deliveryStatus === 'delivered') ? (o.date || '') : '';
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
      _loadInProgress = true;
      save();
      _loadInProgress = false;
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
