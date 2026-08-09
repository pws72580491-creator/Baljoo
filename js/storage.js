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
        // v3.3.51: 선명에 괄호 부가정보가 남아있으면(v3.3.48 이전 저장분, 또는 중첩 괄호
        // 때문에 생긴 깨진 잔재 — v3.3.50까지도 완전히 못 걸러졌음) 정리한다.
        // _stripShipParen()은 이미 깨끗한 값엔 그대로(변화 없음)라 매 로드마다 적용해도 안전.
        o.ship = _stripShipParen(o.ship);
        if (o._shipOriginal) o._shipOriginal = _stripShipParen(o._shipOriginal);
        // 반품(카테고리='return' 또는 업로드 반품서 isReturn=true) 건은
        // 이 발주를 최초로 만나는 딱 1번만 미처리(pending) 상태를 'returned'로 보정한다.
        // 한 번 마이그레이션된 뒤로는 사용자가 발주취소/미납품 등 어떤 상태로 바꾸든
        // 다시는 강제로 '반품'으로 되돌리지 않는다 (_retMig 플래그로 재적용 방지).
        if ((o.category === 'return' || o.isReturn === true) && !o._retMig) {
          if (o.deliveryStatus === 'pending') o.deliveryStatus = 'returned';
          o._retMig = true;
        }
        // v3.3.28: 예전에 있었다가 폐지됐던 "부분납품(partial)" 개념을 '발주취소'로
        // 자동 변환하던 마이그레이션 코드가 여기 있었음 — 부분납품 기능을 새로
        // (품목별 진행 추적 방식으로) 다시 도입하면서 제거함. 과거에 이미 이
        // 마이그레이션을 거쳐 'cancelled'로 바뀐 건은 이미 저장된 데이터라
        // 영향 없음(그대로 발주취소로 남음) — 앞으로 새로 저장되는 'partial'
        // 값만 더 이상 강제 변환되지 않도록 하는 것이 이 수정의 목적.
        // 실 납품일 필드 없는 구버전 데이터 보정: 이미 납품/부분납품 상태면 발주일로 대체
        if (o.deliveredDate === undefined) {
          o.deliveredDate = (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial') ? (o.date || '') : '';
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
      // v3.3.41: "반품 확인" 체크가 재고 반영 여부를 좌우하도록 바뀌면서, 이 업데이트
      // 이전에 이미 '반품' 처리돼 있던 기존 건들까지 갑자기 미확인 취급되면 과거에 이미
      // 보고했던 재고/통계 수치가 이 업데이트만으로 소급 변경돼버린다. 그래서 이 마이그레이션
      // 시점에 존재하는 반품 건은 전부 "이미 확인됨"으로 한 번만 자동 표시해 기존 수치를
      // 그대로 유지하고, 이 시점 이후 새로 반품 처리되는 건부터만 실제로 확인이 필요하게 한다.
      // 한 기기당 한 번만 실행(재실행 시 사용자가 이후에 직접 해제한 것까지 되돌리지 않도록).
      if (!localStorage.getItem('retChkMigrated_v341')) {
        try {
          const chkSet = new Set(JSON.parse(localStorage.getItem('orderReturnCheck') || '[]'));
          orders.forEach(o => {
            if (o.deliveryStatus === 'returned' && !_isPhantomReturn(o)) {
              chkSet.add(o.id);
            }
          });
          localStorage.setItem('orderReturnCheck', JSON.stringify([...chkSet]));
        } catch (e) { console.warn('[storage] 반품확인 마이그레이션 실패:', e); }
        localStorage.setItem('retChkMigrated_v341', '1');
      }
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
  // v3.3.42: retChkMigrated_v341도 같이 지워야 함 — 안 지우면 초기화 후 Firebase 등으로
  // 다시 복원했을 때 "기존 반품 자동 확인" 마이그레이션(storage.js load())이 재실행되지
  // 않아, 복원된 반품 건들이 전부 미확인 상태로 보여서 재고 수치가 초기화 전과 달라진다.
  try {
    localStorage.removeItem('deliveryDblCheck');
    localStorage.removeItem('orderReturnCheck');
    localStorage.removeItem('retChkMigrated_v341');
  } catch(e) {}
  renderAll();
  toast('🗑️ 목록 초기화 완료');
}
