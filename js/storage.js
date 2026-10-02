// ══════════════════════════════════════════════════════
// storage.js  —  데이터 저장/불러오기 (localStorage)
// ══════════════════════════════════════════════════════

const STORE_KEY = 'baljuOrders_v2';
let orders = [];

// v3.3.53: 휴지통 — delOrder()가 즉시 영구삭제하는 대신 여기로 옮겨 TRASH_RETENTION_DAYS일
// 보관 후 자동 영구삭제한다 (load() 시점마다 기한 지난 항목을 정리).
const TRASH_KEY = 'baljuDeletedOrders_v1';
const TRASH_RETENTION_DAYS = 30;
let deletedOrders = [];

// v3.3.77: 통계 보존 보관함 — 휴지통 만료(자동)·완전삭제 시 발주를 여기로 옮겨 통계(월별 결산·반품차감 등)가 변하지 않게 한다.
const ARCHIVE_KEY = 'baljuStatsArchive_v1';
let statsArchive = [];
function saveArchive() {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(statsArchive)); }
  catch (e) { console.error('[storage] 통계 보관함 저장 실패:', e); if (typeof toast === 'function') toast('⚠️ 저장 공간 부족 — 통계 보관함 저장 실패'); }
}
function _archiveForStats(o) {
  if (!o || !o.id) return;
  const c = { ...o }; delete c.deletedAt;
  const i = statsArchive.findIndex(x => x.id === o.id);
  if (i >= 0) statsArchive[i] = c; else statsArchive.push(c);
}
// 통계 탭 전용 데이터 소스: 현재 발주 + 휴지통 + 보관함 (id 중복 시 현재 발주 우선)
// v3.3.78: 통계·납품현황·대시보드·재고 이월 공통 기준. 삭제된 건은 '실제 납품/반품 기록'(납품완료·부분납품·반품)만 포함
// (미납품·발주취소 상태로 삭제한 건은 원래 집계 대상이 아니므로 제외)
const _STATS_DONE = ['delivered', 'partial', 'returned'];
function _statsOrders() {
  const ids = new Set(orders.map(o => o.id));
  const out = orders.slice();
  [deletedOrders, statsArchive].forEach(list => list.forEach(o => {
    if (!ids.has(o.id) && _STATS_DONE.includes(o.deliveryStatus)) { ids.add(o.id); out.push(o); }
  }));
  return out;
}
function _isLive(o) { return !!o && orders.some(x => x.id === o.id); }

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

// v3.3.53: 휴지통 저장 (orders와 별도 localStorage 키 — 자동동기화 debounce는 동일하게 재사용)
function saveTrash() {
  try {
    localStorage.setItem(TRASH_KEY, JSON.stringify(deletedOrders));
    if (!_loadInProgress && typeof scheduleAutoSync === 'function') scheduleAutoSync();
  } catch(e) {
    console.error('[storage] 휴지통 저장 실패:', e);
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
        try { localStorage.setItem('baljuOrders_corrupt_backup', raw); } catch (e) {}
        console.warn('[storage] 저장 데이터 형식 오류 — 원본을 baljuOrders_corrupt_backup에 보관 후 초기화합니다.');
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

    // v3.3.53: 휴지통 불러오기 + 보관기간(TRASH_RETENTION_DAYS) 지난 항목 자동 영구삭제.
    // orders 유무와 무관하게 항상 실행되어야 하므로 위 if(raw) 블록 밖에 둔다.
    try {
      const rawTrash    = localStorage.getItem(TRASH_KEY);
      const parsedTrash = rawTrash ? safeParse(rawTrash) : [];
      deletedOrders = Array.isArray(parsedTrash) ? parsedTrash : [];
      try { const ra = safeParse(localStorage.getItem(ARCHIVE_KEY) || '[]'); statsArchive = Array.isArray(ra) ? ra : []; } catch (e) { statsArchive = []; }

      const cutoff    = Date.now() - TRASH_RETENTION_DAYS * 86400000;
      const isExpired = o => { if (!o.deletedAt) { o.deletedAt = new Date().toISOString(); return false; } return new Date(o.deletedAt).getTime() < cutoff; };
      const expired   = deletedOrders.filter(isExpired);
      if (expired.length) {
        // 영구삭제 시점에만 더블체크/반품확인 표시 정리 (휴지통에 있는 동안은 복원 시
        // 그대로 되살아나야 하므로 건드리지 않음)
        expired.forEach(o => { _archiveForStats(o); if (typeof _pruneOrderChecks === 'function') _pruneOrderChecks(o.id); });
        saveArchive();  // v3.3.77: 휴지통 만료분은 통계용으로 보존
        deletedOrders = deletedOrders.filter(o => !isExpired(o));
        _loadInProgress = true;
        saveTrash();
        _loadInProgress = false;
      }
    } catch(e) {
      console.error('[storage] 휴지통 불러오기 실패:', e);
    }
  } catch(e) {
    console.error('[storage] 불러오기 실패:', e);
  }
}

function resetOrders() {
  if (!confirm('발주 목록 전체를 초기화할까요?\n저장된 모든 내역이 삭제되며 클라우드 자동동기화에도 반영됩니다.\n(먼저 "스냅샷 지금 저장"을 권장합니다)')) return;
  window._allowEmptySync = true;
  statsArchive = []; saveArchive();  // 전체 초기화는 통계 보관함도 비움
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
