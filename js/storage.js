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
        // 반품(카테고리='return' 또는 업로드 반품서 isReturn=true) 건은
        // 이 발주를 최초로 만나는 딱 1번만 미처리(pending) 상태를 'returned'로 보정한다.
        // 한 번 마이그레이션된 뒤로는 사용자가 발주취소/미납품 등 어떤 상태로 바꾸든
        // 다시는 강제로 '반품'으로 되돌리지 않는다 (_retMig 플래그로 재적용 방지).
        if ((o.category === 'return' || o.isReturn === true) && !o._retMig) {
          if (o.deliveryStatus === 'pending') o.deliveryStatus = 'returned';
          o._retMig = true;
        }
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
        // 반품일·취소일 필드 없는 구버전 데이터 보정 (납품일과 동일한 방식 — 발주일로 대체)
        if (o.returnedDate === undefined) {
          o.returnedDate = (o.deliveryStatus === 'returned') ? (o.date || '') : '';
        }
        if (o.cancelledDate === undefined) {
          o.cancelledDate = (o.deliveryStatus === 'cancelled') ? (o.date || '') : '';
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
  // v3.3.14: 전체 초기화 시 더블체크·반품확인 표시도 함께 정리 (모든 id가 사라지므로)
  try { localStorage.removeItem('deliveryDblCheck'); localStorage.removeItem('orderReturnCheck'); } catch(e) {}
  renderAll();
  toast('🗑️ 목록 초기화 완료');
}
