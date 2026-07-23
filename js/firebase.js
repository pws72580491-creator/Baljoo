// ══════════════════════════════════════════════════════
// firebase.js — Firebase Realtime DB 백업/복원 + 자동 동기화
// ══════════════════════════════════════════════════════

// Firebase SDK (ESM → CDN global 방식으로 변경, module 충돌 방지)
const FB_APP_URL  = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FB_DB_URL   = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "AIzaSyBdRMVcJWMoSA2cSbry90YVRYiKwPEg5WU",
  authDomain:        "baljoo.firebaseapp.com",
  databaseURL:       "https://baljoo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "baljoo",
  storageBucket:     "baljoo.firebasestorage.app",
  messagingSenderId: "701062324268",
  appId:             "1:701062324268:web:614e44295dc1a30a597189",
  measurementId:     "G-MENVMYT1H2"
};

let _db          = null;
let _authReady   = null;   // 익명 로그인 완료 Promise
let _initPromise = null;   // 동시 호출 시 초기화 중복 방지

// Firebase 지연 초기화 (버튼 클릭/자동동기화 시점에 로드) + 익명 인증
// 보안규칙을 auth != null로 걸어두려면 모든 read/write 전에 로그인이 끝나 있어야 하므로,
// db를 반환하기 전에 항상 익명 로그인 완료를 기다린다.
async function getDb() {
  if (_db) { await _authReady; return _db; }
  if (!_initPromise) {
    _initPromise = (async () => {
      const { initializeApp, getApps }               = await import(FB_APP_URL);
      const { getDatabase }                            = await import(FB_DB_URL);
      const { getAuth, signInAnonymously }              = await import(FB_AUTH_URL);
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      _db = getDatabase(app);
      const auth = getAuth(app);
      _authReady = auth.currentUser
        ? Promise.resolve(auth.currentUser)
        : signInAnonymously(auth).then(cred => cred.user);
      await _authReady;
    })();
  }
  await _initPromise;
  return _db;
}

// 인증 관련 에러를 사람이 읽을 수 있게 보강
function _friendlyFbError(e) {
  const msg = e?.message || String(e);
  // Authentication 자체가 프로젝트에서 아직 한 번도 초기화(Get started)되지 않은 경우.
  // "익명 로그인만 꺼져있는" operation-not-allowed와는 원인이 다르므로 별도 안내가 필요함.
  if (/configuration-not-found/.test(msg)) {
    return msg + ' — Firebase 콘솔 → Authentication에서 "시작하기(Get started)"를 아직 누르지 않았을 가능성이 높습니다. '
      + 'Authentication 메뉴에 처음 들어가 시작하기 → Sign-in method 탭에서 "익명" 로그인을 사용 설정해주세요.';
  }
  if (/operation-not-allowed|admin-restricted/.test(msg)) {
    return msg + ' — Firebase 콘솔 → Authentication → Sign-in method에서 "익명" 로그인을 활성화해주세요.';
  }
  return msg;
}

function setFbStatus(msg, color = 'var(--muted)') {
  const el = document.getElementById('fb-status');
  if (el) { el.textContent = msg; el.style.color = color; }
}

// ── 자동 동기화 (save() 후 debounce 3초, 실패 시 backoff 재시도) ──
let _autoSyncTimer  = null;
let _syncRetryCount = 0;
const SYNC_MAX_RETRY = 3;
const SYNC_RETRY_BASE = 5000; // 5초, 10초, 20초

// v3.3.14 fix: 전체 노드 덮어쓰기(set) → runTransaction 기반 병합으로 변경.
// 기존엔 자동동기화·수동백업 모두 set(ref('baljoo/backup'), {orders: 전체배열, ...})로
// 매번 "이 기기가 알고 있는 전체 목록"을 통째로 덮어썼다. 두 기기(또는 두 탭)를
// 동시에 쓰는 경우, A가 방금 추가/수정한 발주를 B가 아직 로컬에 받기 전 상태에서
// B가 먼저 동기화를 돌리면 B의 (A의 변경분이 빠진) 배열이 A의 변경분을 그대로
// 지워버리는 문제가 있었음 — 사용 패턴상 괜찮을 거라 보고 넘어갔던 부분인데,
// 의도적으로 남겨둔 게 아니었으므로 정식으로 수정.
// → runTransaction()으로 baljoo/backup을 갱신: 트랜잭션 함수는 "현재 원격 값"을
//   받아 (1) 내가 로컬에서 지운 id만 골라 제거하고 (2) 내가 갖고 있는 최신 발주로
//   덮어쓴 뒤 나머지(내가 모르는 다른 기기의 항목)는 그대로 둔 배열을 반환한다.
//   Firebase가 중간에 다른 기기의 변경이 커밋된 걸 감지하면 최신 값으로 자동
//   재시도하므로, 내가 모르는 사이 다른 기기가 추가/수정한 발주는 보존된다.
//   백업 데이터 형태(orders 배열 + backedAt/count/version)는 이전과 완전히 동일해
//   fbRestore()나 과거 백업과의 호환성에 영향 없음.
const SYNCED_IDS_KEY = 'fbSyncedOrderIds'; // 이 기기가 마지막으로 성공 동기화한 id 목록(삭제 판정 기준)

function _getSyncedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_IDS_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _setSyncedIds(idSet) {
  try { localStorage.setItem(SYNCED_IDS_KEY, JSON.stringify([...idSet])); } catch(e) {}
}

// v3.3.25: 재고 이력(입고·파손 — localStorage의 delivGoal_<날짜>)은 그동안 Firebase에
// 전혀 백업되지 않고 이 기기의 localStorage에만 있었음. 크롬 캐시/사이트 데이터를
// 지우거나 기기를 바꾸면 발주 데이터(orders)는 Firebase에서 복원되지만 재고 이력은
// 영구히 사라지는 문제가 있었음 — orders와 동일한 백업 노드(baljoo/backup)에
// stockGoals로 함께 저장/복원하도록 보완.
const SYNCED_STOCK_DATES_KEY = 'fbSyncedStockDates'; // 이 기기가 마지막으로 성공 동기화한 재고 이력 날짜 목록(삭제 판정 기준)

function _getSyncedStockDates() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_STOCK_DATES_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _setSyncedStockDates(dateSet) {
  try { localStorage.setItem(SYNCED_STOCK_DATES_KEY, JSON.stringify([...dateSet])); } catch(e) {}
}

// localStorage에 저장된 delivGoal_<날짜> 항목을 전부 모아 { 날짜: {egg,quail,brine,eggDmg,quailDmg,brineDmg} } 형태로 반환
function _collectLocalStockGoals() {
  const goals = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('delivGoal_')) continue;
    let v = null;
    try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) {}
    if (v) goals[k.slice('delivGoal_'.length)] = v;
  }
  return goals;
}

// 기존 delivGoal_* 항목을 전부 제거 (복원 시 새 데이터로 교체하기 전 호출)
function _clearLocalStockGoals() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('delivGoal_')) keysToRemove.push(k);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}

async function _mergeBackupTransaction(db) {
  const { ref, runTransaction } = await import(FB_DB_URL);
  const localById = new Map(orders.filter(o => o.id).map(o => [o.id, o]));
  // 마지막 동기화 땐 있었는데 지금 로컬엔 없는 id = 이 기기에서 삭제된 것
  const deletedIds = _getSyncedIds();
  localById.forEach((_, id) => deletedIds.delete(id));

  const localStockGoals = _collectLocalStockGoals();
  // 마지막 동기화 땐 있었는데 지금 로컬엔 없는 날짜 = 이 기기에서 삭제(입고 삭제)된 것
  const deletedStockDates = _getSyncedStockDates();
  Object.keys(localStockGoals).forEach(d => deletedStockDates.delete(d));

  const result = await runTransaction(ref(db, 'baljoo/backup'), (current) => {
    const remoteOrders = Array.isArray(current?.orders) ? current.orders : [];
    const merged = new Map(remoteOrders.filter(o => o && o.id).map(o => [o.id, o]));
    deletedIds.forEach(id => merged.delete(id));      // 내가 지운 것만 반영
    localById.forEach((o, id) => merged.set(id, o));  // 내가 아는 최신 값으로 덮어씀

    const remoteStockGoals = (current?.stockGoals && typeof current.stockGoals === 'object') ? current.stockGoals : {};
    const mergedStockGoals = { ...remoteStockGoals };
    deletedStockDates.forEach(d => delete mergedStockGoals[d]);
    Object.entries(localStockGoals).forEach(([d, v]) => { mergedStockGoals[d] = v; });

    return {
      orders:     [...merged.values()],
      stockGoals: mergedStockGoals,
      backedAt:   new Date().toISOString(),
      count:      merged.size,
      version:    (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown')
    };
  });
  if (result.committed) {
    _setSyncedIds(new Set(localById.keys()));
    _setSyncedStockDates(new Set(Object.keys(localStockGoals)));
  }
  return result;
}

async function _doAutoSync() {
  try {
    const db = await getDb();
    await _mergeBackupTransaction(db);
    _syncRetryCount = 0;  // 성공 시 재시도 카운터 초기화
    setFbStatus(`☁️ 자동 동기화 완료 (${new Date().toLocaleTimeString('ko-KR')})`, 'var(--success)');
  } catch (e) {
    console.warn('[firebase] 자동 동기화 실패:', _friendlyFbError(e));
    if (_syncRetryCount < SYNC_MAX_RETRY) {
      _syncRetryCount++;
      const delay = SYNC_RETRY_BASE * _syncRetryCount;
      setFbStatus(`⚠️ 동기화 실패 — ${_syncRetryCount}/${SYNC_MAX_RETRY}회 재시도 (${delay/1000}초 후)`, '#d69e2e');
      // _autoSyncTimer에 저장해야 새 저장(scheduleAutoSync)이 이 재시도를 취소할 수 있음
      _autoSyncTimer = setTimeout(_doAutoSync, delay);
    } else {
      _syncRetryCount = 0;
      setFbStatus('⚠️ 동기화 실패 (수동 백업 권장)', '#d69e2e');
    }
  }
}

function scheduleAutoSync() {
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(_doAutoSync, 3000);
}

// ── 백업: 로컬 → Firebase ──
window.fbBackup = async function() {
  try {
    setFbStatus('백업 중...');
    const db = await getDb();
    await _mergeBackupTransaction(db);
    setFbStatus(`✅ 백업 완료 — ${orders.length}건 (${new Date().toLocaleString('ko-KR')})`, 'var(--success)');
    toast('☁️ Firebase 백업 완료 (재고 이력 포함)');
  } catch (e) {
    console.error('[firebase] 백업 실패:', e);
    setFbStatus('❌ 백업 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 백업 실패');
  }
};

// ── 복원: Firebase → 로컬 ──
window.fbRestore = async function() {
  if (!confirm('Firebase에서 데이터를 복원할까요?\n현재 데이터는 백업 데이터로 교체됩니다.')) return;
  try {
    setFbStatus('복원 중...');
    const { ref, get } = await import(FB_DB_URL);
    const db   = await getDb();
    const snap = await get(ref(db, 'baljoo/backup'));
    if (!snap.exists()) {
      setFbStatus('⚠️ 백업 데이터가 없습니다', '#d69e2e');
      return;
    }
    const data = snap.val();
    if (!data.orders || !Array.isArray(data.orders)) {
      setFbStatus('⚠️ 유효하지 않은 백업 데이터', '#d69e2e');
      return;
    }
    // 복원 중 자동 동기화 방지 (대기 중인 이전 동기화가 방금 복원한 데이터를 덮어쓰지 않도록)
    clearTimeout(_autoSyncTimer);
    // 원본 그대로 저장 후 load()에게 하위 호환 정규화를 위임
    // (storage.js load()의 정규화 로직과 중복 실행되는 것을 방지)
    localStorage.setItem('baljuOrders_v2', JSON.stringify(data.orders));
    load();
    // v3.3.14: 복원 직후를 "이 기기의 마지막 동기화 시점"으로 재설정해야
    // 다음 자동동기화가 복원된 항목을 엉뚱하게 삭제 대상으로 오판하지 않음
    _setSyncedIds(new Set(orders.map(o => o.id).filter(Boolean)));
    // v3.3.25: 재고 이력(입고·파손)도 백업 데이터에 있으면 함께 복원
    let restoredStockDates = 0;
    if (data.stockGoals && typeof data.stockGoals === 'object') {
      _clearLocalStockGoals();
      Object.entries(data.stockGoals).forEach(([d, v]) => {
        localStorage.setItem('delivGoal_' + d, JSON.stringify(v));
        restoredStockDates++;
      });
      _setSyncedStockDates(new Set(Object.keys(data.stockGoals)));
    }
    if (typeof window.renderAll === 'function') window.renderAll();
    else if (typeof renderAll === 'function') renderAll();
    const backedAt = data.backedAt ? new Date(data.backedAt).toLocaleString('ko-KR') : '알 수 없음';
    setFbStatus(`✅ 복원 완료 — ${orders.length}건 · 재고 이력 ${restoredStockDates}일 (백업일: ${backedAt})`, 'var(--success)');
    toast(`📥 복원 완료 — ${orders.length}건 · 재고 이력 ${restoredStockDates}일`);
  } catch (e) {
    console.error('[firebase] 복원 실패:', e);
    setFbStatus('❌ 복원 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 복원 실패');
  }
};
