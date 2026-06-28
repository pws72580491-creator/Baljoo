// ══════════════════════════════════════════════════════
// firebase.js — Firebase Realtime DB 백업/복원 + 자동 동기화
// ══════════════════════════════════════════════════════

// Firebase SDK (ESM → CDN global 방식으로 변경, module 충돌 방지)
const FB_APP_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FB_DB_URL  = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

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

let _db = null;

// Firebase 지연 초기화 (버튼 클릭 시점에 로드)
async function getDb() {
  if (_db) return _db;
  const { initializeApp, getApps } = await import(FB_APP_URL);
  const { getDatabase }              = await import(FB_DB_URL);
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  _db = getDatabase(app);
  return _db;
}

function setFbStatus(msg, color = 'var(--muted)') {
  const el = document.getElementById('fb-status');
  if (el) { el.textContent = msg; el.style.color = color; }
}

// 복원 데이터 하위 호환 처리 (storage.js load()와 동일한 로직)
function normalizeOrders(arr) {
  arr.forEach(o => {
    if (!o.deliveryStatus)           o.deliveryStatus = 'pending';
    if (o.returnAmount === undefined) o.returnAmount   = 0;
    if (!o.deliveryNote)             o.deliveryNote    = '';
    if (o.category === 'return')     o.deliveryStatus  = 'returned';
    // isReturn=true인 반품서는 항상 deliveryStatus='returned' 보장
    if (o.isReturn === true && o.deliveryStatus !== 'returned') o.deliveryStatus = 'returned';
    if (o.deliveredDate === undefined) {
      o.deliveredDate = (o.deliveryStatus === 'delivered' || o.deliveryStatus === 'partial') ? (o.date || '') : '';
    }
  });
  return arr;
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
      version:  document.title.match(/v[\d.]+/)?.[0] || 'unknown'
    });
    _syncRetryCount = 0;  // 성공 시 재시도 카운터 초기화
    setFbStatus(`☁️ 자동 동기화 완료 (${new Date().toLocaleTimeString('ko-KR')})`, 'var(--success)');
  } catch (e) {
    console.warn('[firebase] 자동 동기화 실패:', e.message);
    if (_syncRetryCount < SYNC_MAX_RETRY) {
      _syncRetryCount++;
      const delay = SYNC_RETRY_BASE * _syncRetryCount;
      setFbStatus(`⚠️ 동기화 실패 — ${_syncRetryCount}/${SYNC_MAX_RETRY}회 재시도 (${delay/1000}초 후)`, '#d69e2e');
      setTimeout(_doAutoSync, delay);
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
      version:  document.title.match(/v[\d.]+/)?.[0] || 'unknown'
    };
    await set(ref(db, 'baljoo/backup'), data);
    setFbStatus(`✅ 백업 완료 — ${orders.length}건 (${new Date().toLocaleString('ko-KR')})`, 'var(--success)');
    toast('☁️ Firebase 백업 완료');
  } catch (e) {
    console.error('[firebase] 백업 실패:', e);
    setFbStatus('❌ 백업 실패: ' + e.message, '#e53e3e');
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
    // 하위 호환 필드 정규화 후 저장
    orders = normalizeOrders(data.orders);
    // 복원 중 자동 동기화 방지
    clearTimeout(_autoSyncTimer);
    localStorage.setItem('baljuOrders_v2', JSON.stringify(orders));
    clearTimeout(_autoSyncTimer);
    load();
    clearTimeout(_autoSyncTimer);
    if (typeof window.renderAll === 'function') window.renderAll();
    else if (typeof renderAll === 'function') renderAll();
    const backedAt = data.backedAt ? new Date(data.backedAt).toLocaleString('ko-KR') : '알 수 없음';
    setFbStatus(`✅ 복원 완료 — ${orders.length}건 (백업일: ${backedAt})`, 'var(--success)');
    toast(`📥 복원 완료 — ${orders.length}건`);
  } catch (e) {
    console.error('[firebase] 복원 실패:', e);
    setFbStatus('❌ 복원 실패: ' + e.message, '#e53e3e');
    toast('❌ 복원 실패');
  }
};
