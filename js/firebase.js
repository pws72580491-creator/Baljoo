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

async function _doAutoSync() {
  try {
    const { ref, set } = await import(FB_DB_URL);
    const db = await getDb();
    await set(ref(db, 'baljoo/backup'), {
      orders,
      backedAt: new Date().toISOString(),
      count:    orders.length,
      version:  (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown')
    });
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
    const { ref, set } = await import(FB_DB_URL);
    const db   = await getDb();
    const data = {
      orders,
      backedAt: new Date().toISOString(),
      count:    orders.length,
      version:  (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown')
    };
    await set(ref(db, 'baljoo/backup'), data);
    setFbStatus(`✅ 백업 완료 — ${orders.length}건 (${new Date().toLocaleString('ko-KR')})`, 'var(--success)');
    toast('☁️ Firebase 백업 완료');
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
    if (typeof window.renderAll === 'function') window.renderAll();
    else if (typeof renderAll === 'function') renderAll();
    const backedAt = data.backedAt ? new Date(data.backedAt).toLocaleString('ko-KR') : '알 수 없음';
    setFbStatus(`✅ 복원 완료 — ${orders.length}건 (백업일: ${backedAt})`, 'var(--success)');
    toast(`📥 복원 완료 — ${orders.length}건`);
  } catch (e) {
    console.error('[firebase] 복원 실패:', e);
    setFbStatus('❌ 복원 실패: ' + _friendlyFbError(e), '#e53e3e');
    toast('❌ 복원 실패');
  }
};
