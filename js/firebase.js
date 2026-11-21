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
    })().catch(e => { _initPromise = null; _db = null; _authReady = null; throw e; });
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

// v3.3.53: 휴지통(deletedOrders) 동기화 — orders와 동일한 id-diff 병합 패턴 재사용.
// 로컬에서 복원하거나(휴지통→orders) 완전삭제(수동/보관기간 만료)하면 이 기기 기준
// "마지막 동기화 때는 있었는데 지금은 없는 id"가 되어 원격에서도 함께 제거된다.
const SYNCED_TRASH_IDS_KEY = 'fbSyncedTrashIds';

function _getSyncedTrashIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_TRASH_IDS_KEY) || '[]')); }
  catch(e) { return new Set(); }
}
function _setSyncedTrashIds(idSet) {
  try { localStorage.setItem(SYNCED_TRASH_IDS_KEY, JSON.stringify([...idSet])); } catch(e) {}
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

// v3.3.95: 통계 보관함·반품확인·더블체크도 백업에 포함.
// 그동안 orders/휴지통/재고이력만 백업돼서, 새 기기(또는 사이트 데이터 삭제 후)에서 복원하면
// 통계 보관함(삭제·만료분의 월별 결산)과 반품 '확인' 체크(재고 반영 여부를 좌우)가 사라져 수치가 달라졌다.
// 복원 때만 로컬에 반영한다(다른 기기의 체크가 실시간으로 덮어쓰지 않음 — 반품확인은 기기별 저장이라는
// 기존 설계 유지). 체크 목록은 orders와 같은 id-diff 방식: (원격 ∪ 로컬) − (내가 지운 것).
const SYNCED_ARCHIVE_IDS_KEY = 'fbSyncedArchiveIds';
const SYNCED_RETCHK_KEY      = 'fbSyncedReturnChk';
const SYNCED_DBLCHK_KEY      = 'fbSyncedDblChk';
function _getKeySet(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (e) { return new Set(); } }
function _setKeySet(k, set) { try { localStorage.setItem(k, JSON.stringify([...set])); } catch (e) {} }
function _lsJson(k, fb) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } }
// Firebase 키에는 . / # $ [ ] 를 쓸 수 없어 id를 키로 못 쓰므로 반품확인 날짜는 [{id,d}] 배열로 저장
function _collectExtraBackup() {
  const dateMap = _lsJson('orderReturnCheckDate', {});
  return {
    statsArchive:     (typeof statsArchive !== 'undefined' && Array.isArray(statsArchive)) ? statsArchive : [],
    returnChecks:     _lsJson('orderReturnCheck', []),
    returnCheckDates: Object.entries(dateMap).map(([id, d]) => ({ id, d })),
    dblChecks:        _lsJson('deliveryDblCheck', [])
  };
}
// 백업 데이터(스냅샷 포함)의 추가 항목을 로컬에 반영 — load() 호출 전에 실행해야 보관함이 읽힘.
// Firebase는 빈 배열을 저장하지 않고 필드를 생략하므로 "필드 없음"만으로는 구버전 백업과 구분할 수 없다.
// → 백업에 기록된 version(v3.3.95 이상)으로 판별하고, 구버전 백업이면 로컬 값을 건드리지 않는다.
function _backupHasExtra(data) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(data && data.version || ''));
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])], t = [3, 3, 95];
  for (let i = 0; i < 3; i++) { if (v[i] !== t[i]) return v[i] > t[i]; }
  return true;
}
function _applyExtraBackup(data) {
  if (!_backupHasExtra(data)) return;
  const arr = x => Array.isArray(x) ? x : [];
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(arr(data.statsArchive).filter(o => o && o.id)));
    localStorage.setItem('orderReturnCheck', JSON.stringify(arr(data.returnChecks)));
    const m = {};
    arr(data.returnCheckDates).forEach(x => { if (x && x.id) m[x.id] = x.d; });
    localStorage.setItem('orderReturnCheckDate', JSON.stringify(m));
    localStorage.setItem('deliveryDblCheck', JSON.stringify(arr(data.dblChecks)));
    // 백업에 확인 체크가 포함돼 있으므로 '기존 반품 자동 확인' 1회 마이그레이션이 복원값을 덮지 않게 함
    localStorage.setItem('retChkMigrated_v341', '1');
  } catch (e) { console.warn('[firebase] 확인 체크·통계 보관함 복원 실패:', e); }
}

// 복원 직후를 '마지막 동기화 시점'으로 재설정(보관함·체크 목록) — 다음 동기화가 복원분을 삭제로 오판하지 않도록
function _afterRestoreSyncMarks() {
  _setKeySet(SYNCED_ARCHIVE_IDS_KEY, new Set((statsArchive || []).map(o => o.id).filter(Boolean)));
  _setKeySet(SYNCED_RETCHK_KEY, new Set(_lsJson('orderReturnCheck', [])));
  _setKeySet(SYNCED_DBLCHK_KEY, new Set(_lsJson('deliveryDblCheck', [])));
}

async function _mergeBackupTransaction(db) {
  // v3.3.74: 로컬이 비었는데 이전에 동기화한 이력이 있으면 원격 백업을 비우지 않도록 차단(손상·초기화 사고 방지)
  if (!orders.length && _getSyncedIds().size > 0 && !window._allowEmptySync) {
    throw new Error('로컬 발주가 0건이라 동기화를 중단했습니다(원격 데이터 보호). 의도한 경우 수동 백업을 누르세요.');
  }
  const { ref, runTransaction } = await import(FB_DB_URL);
  const localById = new Map(orders.filter(o => o.id).map(o => [o.id, o]));
  // 마지막 동기화 땐 있었는데 지금 로컬엔 없는 id = 이 기기에서 삭제된 것
  const deletedIds = _getSyncedIds();
  localById.forEach((_, id) => deletedIds.delete(id));

  const localStockGoals = _collectLocalStockGoals();
  // 마지막 동기화 땐 있었는데 지금 로컬엔 없는 날짜 = 이 기기에서 삭제(입고 삭제)된 것
  const deletedStockDates = _getSyncedStockDates();
  Object.keys(localStockGoals).forEach(d => deletedStockDates.delete(d));

  // v3.3.53: 휴지통도 동일한 id-diff 방식으로 병합 (복원·완전삭제 시 다른 기기에도 반영)
  const localTrashById = new Map((deletedOrders || []).filter(o => o.id).map(o => [o.id, o]));
  const deletedTrashIds = _getSyncedTrashIds();
  localTrashById.forEach((_, id) => deletedTrashIds.delete(id));

  // v3.3.95: 통계 보관함·반품확인·더블체크 병합 준비
  const extra = _collectExtraBackup();
  const localArchById = new Map(extra.statsArchive.filter(o => o && o.id).map(o => [o.id, o]));
  const deletedArchIds = _getKeySet(SYNCED_ARCHIVE_IDS_KEY);
  localArchById.forEach((_, id) => deletedArchIds.delete(id));
  const localRet = new Set(extra.returnChecks);
  const deletedRet = _getKeySet(SYNCED_RETCHK_KEY); localRet.forEach(id => deletedRet.delete(id));
  const localDbl = new Set(extra.dblChecks);
  const deletedDbl = _getKeySet(SYNCED_DBLCHK_KEY); localDbl.forEach(id => deletedDbl.delete(id));
  const localRetDates = new Map(extra.returnCheckDates.map(x => [x.id, x.d]));

  const result = await runTransaction(ref(db, 'baljoo/backup'), (current) => {
    const remoteOrders = Array.isArray(current?.orders) ? current.orders : [];
    const merged = new Map(remoteOrders.filter(o => o && o.id).map(o => [o.id, o]));
    deletedIds.forEach(id => merged.delete(id));      // 내가 지운 것만 반영
    // v3.3.95: 같은 id를 원격이 더 늦게 수정했다면(_upd 비교) 오래된 로컬본으로 덮지 않는다.
    // 이전엔 무조건 로컬이 이겨서, 한동안 안 켠 기기가 동기화되며 다른 기기의 최신 수정을 되돌렸다.
    // 수정시각(_upd)이 한쪽이라도 없으면(구버전 데이터) 기존대로 로컬 우선.
    localById.forEach((o, id) => {
      const r = merged.get(id);
      if (r && r._upd && o._upd && Number(r._upd) > Number(o._upd)) return;
      merged.set(id, o);
    });

    const remoteStockGoals = (current?.stockGoals && typeof current.stockGoals === 'object') ? current.stockGoals : {};
    const mergedStockGoals = { ...remoteStockGoals };
    deletedStockDates.forEach(d => delete mergedStockGoals[d]);
    Object.entries(localStockGoals).forEach(([d, v]) => { mergedStockGoals[d] = v; });

    const remoteTrash = Array.isArray(current?.deletedOrders) ? current.deletedOrders : [];
    const mergedTrash = new Map(remoteTrash.filter(o => o && o.id).map(o => [o.id, o]));
    deletedTrashIds.forEach(id => mergedTrash.delete(id));     // 내가 복원/완전삭제한 것만 반영
    localTrashById.forEach((o, id) => mergedTrash.set(id, o)); // 내가 아는 최신 값으로 덮어씀

    // v3.3.95: 통계 보관함 / 반품확인 / 더블체크
    const remoteArch = Array.isArray(current?.statsArchive) ? current.statsArchive : [];
    const mergedArch = new Map(remoteArch.filter(o => o && o.id).map(o => [o.id, o]));
    deletedArchIds.forEach(id => mergedArch.delete(id));
    localArchById.forEach((o, id) => mergedArch.set(id, o));
    const mergeSet = (remote, local, deleted) => {
      const out = new Set(Array.isArray(remote) ? remote : []);
      deleted.forEach(id => out.delete(id));
      local.forEach(id => out.add(id));
      return [...out];
    };
    const mergedRet = mergeSet(current?.returnChecks, localRet, deletedRet);
    const mergedDbl = mergeSet(current?.dblChecks, localDbl, deletedDbl);
    const dm = new Map((Array.isArray(current?.returnCheckDates) ? current.returnCheckDates : []).filter(x => x && x.id).map(x => [x.id, x.d]));
    deletedRet.forEach(id => dm.delete(id));
    localRetDates.forEach((d, id) => dm.set(id, d));
    const retSet = new Set(mergedRet);

    return {
      orders:        [...merged.values()],
      stockGoals:    mergedStockGoals,
      deletedOrders: [...mergedTrash.values()],
      statsArchive:     [...mergedArch.values()],
      returnChecks:     mergedRet,
      returnCheckDates: [...dm.entries()].filter(([id]) => retSet.has(id)).map(([id, d]) => ({ id, d })),
      dblChecks:        mergedDbl,
      backedAt:      new Date().toISOString(),
      count:         merged.size,
      version:       (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown')
    };
  });
  if (result.committed) {
    _setSyncedIds(new Set(localById.keys()));
    _setSyncedStockDates(new Set(Object.keys(localStockGoals)));
    _setSyncedTrashIds(new Set(localTrashById.keys()));
    _setKeySet(SYNCED_ARCHIVE_IDS_KEY, new Set(localArchById.keys()));
    _setKeySet(SYNCED_RETCHK_KEY, localRet);
    _setKeySet(SYNCED_DBLCHK_KEY, localDbl);
    window._allowEmptySync = false;   // v3.3.95: 일회용 허용 — 이전엔 한 번 켜지면 새로고침 전까지 '빈 로컬 보호'가 계속 꺼져 있었다
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
    if (!orders.length) {
      if (!confirm('로컬 발주가 0건입니다. 클라우드 백업도 비워질 수 있습니다. 계속할까요?')) return;
      window._allowEmptySync = true;
    }
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

// ══════════════════════════════════════════════════════
// v3.3.60: 시점별 스냅샷 — baljoo/backup(계속 덮어써지는 "최신 백업" 1개)과는
// 별개로, baljoo/snapshots/{시각} 에 그 순간의 전체 데이터를 통째로 복사해둔다.
// 매일 앱을 열 때 1회 자동 저장 + 언제든 수동 저장 가능. 복원할 땐 목록에서
// 원하는 시점을 골라 그 시점 데이터로 되돌릴 수 있다.
// ══════════════════════════════════════════════════════

// 스냅샷 저장 공통 로직 (수동/자동 공용) — auto=true면 실패해도 조용히 무시(호출부에서 처리)
async function _fbSaveSnapshotCore(label, auto) {
  const db = await getDb();
  const { ref, update } = await import(FB_DB_URL);
  // Firebase 키 금지문자(. # $ [ ] /) 제거 — ISO 문자열은 시간순 정렬이 그대로 유지됨
  const snapshotId = new Date().toISOString().replace(/[.:]/g, '-');
  const payload = {
    orders:        orders,
    deletedOrders: deletedOrders || [],
    stockGoals:    _collectLocalStockGoals(),
    ..._collectExtraBackup(),   // v3.3.95: 통계 보관함·반품확인·더블체크
    backedAt:      new Date().toISOString(),
    count:         orders.length,
    version:       (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown'),
    label:         label || '',
    auto:          !!auto
  };
  // v3.3.95: 목록 조회용 경량 인덱스(snapshotIndex)를 같은 요청으로 함께 기록 — 목록을 볼 때마다
  // 스냅샷 전체(발주 데이터 포함)를 내려받던 것을 방지. 두 경로를 한 번에 써서 불일치도 없다.
  const meta = { backedAt: payload.backedAt, count: payload.count, label: payload.label, auto: payload.auto, version: payload.version };
  try {
    await update(ref(db, 'baljoo'), {
      ['snapshots/' + snapshotId]: payload,
      ['snapshotIndex/' + snapshotId]: meta
    });
  } catch (e) {
    // DB 보안규칙이 snapshotIndex 경로를 허용하지 않는 경우(PERMISSION_DENIED)에도 스냅샷 저장 자체는 되도록
    // 기존 방식(snapshots 경로만 쓰기)으로 폴백한다. 이 경우 목록은 예전처럼 전체 조회로 동작.
    console.warn('[firebase] 인덱스 포함 저장 실패 — 기존 방식으로 재시도:', e && e.message);
    const { set } = await import(FB_DB_URL);
    await set(ref(db, 'baljoo/snapshots/' + snapshotId), payload);
  }
  if (auto) { _pruneAutoSnapshots(db, snapshotId).catch(e => console.warn('[firebase] 스냅샷 정리 실패(무시):', e)); }
  return snapshotId;
}

// v3.3.95: 자동 스냅샷은 매일 쌓이기만 했다 — 최근 N개만 남기고 오래된 자동분을 삭제(수동 저장분은 보존).
const AUTO_SNAPSHOT_KEEP = 40;
async function _pruneAutoSnapshots(db, justSavedId) {
  const list = await fbListSnapshots();
  const autos = list.filter(s => s.auto && s.id !== justSavedId && !/^복원 전/.test(s.label || ''));   // 최신순 ('복원 전 자동 보관'은 안전망이라 제외)
  const extra = autos.slice(Math.max(0, AUTO_SNAPSHOT_KEEP - 1));  // 방금 저장분 포함 KEEP개 유지
  if (!extra.length) return;
  const { ref, update } = await import(FB_DB_URL);
  const patch = {};
  extra.forEach(s => { patch['snapshots/' + s.id] = null; patch['snapshotIndex/' + s.id] = null; });
  await update(ref(db, 'baljoo'), patch);
}

// 수동 스냅샷 저장 (버튼)
window.fbSaveSnapshotManual = async function() {
  try {
    setFbStatus('스냅샷 저장 중...');
    const _p = prompt('스냅샷 이름(선택, 비워도 됩니다):', '');
    if (_p === null) { setFbStatus(''); return; }
    const label = _p.trim();
    await _fbSaveSnapshotCore(label, false);
    setFbStatus(`✅ 스냅샷 저장 완료 (${new Date().toLocaleString('ko-KR')})`, 'var(--success)');
    toast('📸 스냅샷 저장 완료');
  } catch (e) {
    console.error('[firebase] 스냅샷 저장 실패:', e);
    setFbStatus('❌ 스냅샷 저장 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 스냅샷 저장 실패');
  }
};

// 자동 일일 스냅샷 — 앱을 열 때(init) 호출. 오늘 날짜로 이미 저장했으면 건너뜀.
// 실패(네트워크 오류 등)해도 사용자 흐름을 방해하지 않도록 조용히 무시한다.
const LAST_AUTO_SNAPSHOT_KEY = 'fbLastAutoSnapshotDate';
async function maybeAutoSnapshot() {
  try {
    const today = todayStr();
    if (localStorage.getItem(LAST_AUTO_SNAPSHOT_KEY) === today) return;
    await _fbSaveSnapshotCore('자동 저장', true);
    localStorage.setItem(LAST_AUTO_SNAPSHOT_KEY, today);
  } catch (e) {
    console.warn('[firebase] 자동 스냅샷 실패(무시):', e);
  }
}

// 저장된 스냅샷 목록 조회 — 최신순 정렬
// v3.3.95: 경량 인덱스(snapshotIndex)에서 읽는다. 인덱스가 없는 구버전 스냅샷은 1회만 전체를 읽어
// 인덱스를 채워둔다(이후로는 가벼운 조회).
async function fbListSnapshots() {
  const db = await getDb();
  const { ref, get, update } = await import(FB_DB_URL);
  let idx = {};
  try {
    const idxSnap = await get(ref(db, 'baljoo/snapshotIndex'));
    idx = idxSnap.exists() ? idxSnap.val() : {};
  } catch (e) { console.warn('[firebase] 스냅샷 인덱스 조회 실패 — 전체 조회로 대체:', e && e.message); }
  let rows;
  if (Object.keys(idx).length) {
    rows = Object.entries(idx).map(([id, v]) => ({ id, ...v }));
  } else {
    const snap = await get(ref(db, 'baljoo/snapshots'));
    if (!snap.exists()) return [];
    const data = snap.val();
    rows = Object.entries(data).map(([id, v]) => ({
      id, backedAt: v.backedAt || '', count: v.count ?? (Array.isArray(v.orders) ? v.orders.length : 0),
      label: v.label || '', auto: !!v.auto, version: v.version || ''
    }));
    try {
      const patch = {};
      rows.forEach(r => { const { id, ...m } = r; patch['snapshotIndex/' + id] = m; });
      await update(ref(db, 'baljoo'), patch);
    } catch (e) { console.warn('[firebase] 스냅샷 인덱스 생성 실패(무시):', e); }
  }
  return rows.sort((a, b) => String(b.backedAt || b.id).localeCompare(String(a.backedAt || a.id)));
}

// 특정 스냅샷 1건 삭제
window.fbDeleteSnapshot = async function(snapshotId) {
  if (!confirm('이 스냅샷을 삭제할까요? (되돌릴 수 없습니다)')) return;
  try {
    const db = await getDb();
    const { ref, update } = await import(FB_DB_URL);
    try {
      await update(ref(db, 'baljoo'), { ['snapshots/' + snapshotId]: null, ['snapshotIndex/' + snapshotId]: null });
    } catch (e1) {
      const { remove } = await import(FB_DB_URL);
      await remove(ref(db, 'baljoo/snapshots/' + snapshotId));
    }
    toast('스냅샷을 삭제했습니다.');
    openSnapshotPicker(); // 목록 새로고침
  } catch (e) {
    console.error('[firebase] 스냅샷 삭제 실패:', e);
    toast('❌ 스냅샷 삭제 실패');
  }
};

// 특정 시점(스냅샷)으로 복원 — fbRestore()와 로직은 유사하지만, 이미 검증된
// fbRestore()를 건드리지 않기 위해 의도적으로 별도 함수로 둔다(안정성 우선).
window.fbRestoreSnapshot = async function(snapshotId, labelForConfirm) {
  if (!confirm(`"${labelForConfirm || snapshotId}" 시점으로 복원할까요?\n현재 데이터는 이 스냅샷 데이터로 교체됩니다.`)) return;
  try {
    setFbStatus('시점 복원 중...');
    try { if (orders.length) await _fbSaveSnapshotCore('복원 전 자동 보관', true); } catch (e) { console.warn('[firebase] 복원 전 스냅샷 실패(계속 진행):', e); }
    const db = await getDb();
    const { ref, get } = await import(FB_DB_URL);
    const snap = await get(ref(db, 'baljoo/snapshots/' + snapshotId));
    if (!snap.exists()) { toast('❌ 스냅샷을 찾을 수 없습니다.'); return; }
    const data = snap.val();
    if (!data.orders || !Array.isArray(data.orders)) { toast('❌ 복원할 데이터가 없습니다.'); return; }

    clearTimeout(_autoSyncTimer);
    localStorage.setItem('baljuOrders_v2', JSON.stringify(data.orders));
    if (data.deletedOrders && Array.isArray(data.deletedOrders)) {
      localStorage.setItem(TRASH_KEY, JSON.stringify(data.deletedOrders));
    }
    _applyExtraBackup(data);   // v3.3.95: 통계 보관함·반품확인·더블체크 (load()가 보관함을 읽기 전에)
    load();
    _setSyncedIds(new Set(orders.map(o => o.id).filter(Boolean)));
    _setSyncedTrashIds(new Set(deletedOrders.map(o => o.id).filter(Boolean)));
    _afterRestoreSyncMarks();
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
    setFbStatus(`✅ 시점 복원 완료 — ${orders.length}건 · 재고 이력 ${restoredStockDates}일 · 휴지통 ${deletedOrders.length}건 (시점: ${backedAt})`, 'var(--success)');
    toast(`📥 ${backedAt} 시점으로 복원 완료`);
    _closeSnapshotOv();
  } catch (e) {
    console.error('[firebase] 시점 복원 실패:', e);
    setFbStatus('❌ 시점 복원 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 시점 복원 실패');
  }
};

// 시점 선택 복원 — 스냅샷 목록을 바텀시트로 보여준다 (checkDuplicateItems()의
// 오버레이 패턴과 동일한 방식)
window.openSnapshotPicker = async function() {
  _closeSnapshotOv();
  toast('스냅샷 목록 불러오는 중...');
  let list = [];
  try {
    list = await fbListSnapshots();
  } catch (e) {
    console.error('[firebase] 스냅샷 목록 조회 실패:', e);
    toast('❌ 스냅샷 목록을 불러오지 못했습니다.');
    return;
  }

  const rows = list.length ? list.map(s => {
    const dt = s.backedAt ? new Date(s.backedAt).toLocaleString('ko-KR') : s.id;
    const labelText = s.label ? escapeHtml(s.label) : (s.auto ? '자동 저장' : '(이름 없음)');
    return `
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="min-width:0;flex:1;" data-sid="${escapeHtml(s.id)}" data-dt="${escapeHtml(dt)}" onclick="fbRestoreSnapshot(this.dataset.sid, this.dataset.dt)">
        <div style="font-weight:700;color:var(--navy);font-size:13px;">${escapeHtml(dt)} ${s.auto ? '<span style="font-size:10px;color:#6b7280;font-weight:400;">🤖자동</span>' : ''}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${labelText} · 발주 ${Number(s.count ?? (s.orders ? s.orders.length : 0)) || 0}건</div>
      </div>
      <button data-sid="${escapeHtml(s.id)}" onclick="event.stopPropagation();fbDeleteSnapshot(this.dataset.sid)" style="background:none;border:none;color:#dc2626;font-size:16px;cursor:pointer;padding:4px 6px;flex-shrink:0;">✕</button>
    </div>`;
  }).join('') : '<div style="padding:24px 14px;text-align:center;color:var(--muted);font-size:13px;">저장된 스냅샷이 없습니다</div>';

  const ov = document.createElement('div');
  ov.id = 'snapshotOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;';
  ov.onclick = (e) => { if (e.target === ov) _closeSnapshotOv(); };
  ov.innerHTML = `
    <div style="background:#fff;width:100%;max-height:80vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;">
      <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--navy);">🕐 시점 선택 복원 — ${list.length}개</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">원하는 시점을 탭하면 그 시점 데이터로 복원됩니다.</div>
        </div>
        <button onclick="_closeSnapshotOv()" style="background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;padding:4px 8px;flex-shrink:0;">✕</button>
      </div>
      <div style="overflow-y:auto;">${rows}</div>
    </div>`;
  document.body.appendChild(ov);
};

function _closeSnapshotOv() {
  const ov = document.getElementById('snapshotOv');
  if (ov) ov.remove();
}

// ── 복원: Firebase → 로컬 ──
window.fbRestore = async function() {
  if (!confirm('Firebase에서 데이터를 복원할까요?\n현재 데이터는 백업 데이터로 교체됩니다.')) return;
  try {
    setFbStatus('복원 중...');
    try { if (orders.length) await _fbSaveSnapshotCore('복원 전 자동 보관', true); } catch (e) { console.warn('[firebase] 복원 전 스냅샷 실패(계속 진행):', e); }
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
    // v3.3.53: 휴지통도 백업 데이터에 있으면 load()가 읽어들일 수 있도록 미리 저장
    // (없으면 기존 로컬 휴지통을 그대로 둠 — 백업 데이터에 필드 자체가 없는 구버전 백업 대비)
    if (data.deletedOrders && Array.isArray(data.deletedOrders)) {
      localStorage.setItem(TRASH_KEY, JSON.stringify(data.deletedOrders));
    }
    _applyExtraBackup(data);   // v3.3.95: 통계 보관함·반품확인·더블체크 (load()가 보관함을 읽기 전에)
    load();
    // v3.3.14: 복원 직후를 "이 기기의 마지막 동기화 시점"으로 재설정해야
    // 다음 자동동기화가 복원된 항목을 엉뚱하게 삭제 대상으로 오판하지 않음
    _setSyncedIds(new Set(orders.map(o => o.id).filter(Boolean)));
    _setSyncedTrashIds(new Set(deletedOrders.map(o => o.id).filter(Boolean))); // v3.3.53
    _afterRestoreSyncMarks();
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
    setFbStatus(`✅ 복원 완료 — ${orders.length}건 · 재고 이력 ${restoredStockDates}일 · 휴지통 ${deletedOrders.length}건 (백업일: ${backedAt})`, 'var(--success)');
    toast(`📥 복원 완료 — ${orders.length}건 · 재고 이력 ${restoredStockDates}일`);
  } catch (e) {
    console.error('[firebase] 복원 실패:', e);
    setFbStatus('❌ 복원 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 복원 실패');
  }
};
