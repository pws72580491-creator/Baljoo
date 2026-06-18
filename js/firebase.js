// ══════════════════════════════════════════════════════
// firebase.js — Firebase Realtime DB 백업/복원
// ══════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyBdRMVcJWMoSA2cSbry90YVRYiKwPEg5WU",
  authDomain: "baljoo.firebaseapp.com",
  databaseURL: "https://baljoo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "baljoo",
  storageBucket: "baljoo.firebasestorage.app",
  messagingSenderId: "701062324268",
  appId: "1:701062324268:web:614e44295dc1a30a597189",
  measurementId: "G-MENVMYT1H2"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

function setFbStatus(msg, color = 'var(--muted)') {
  const el = document.getElementById('fb-status');
  if (el) { el.textContent = msg; el.style.color = color; }
}

// ── 백업: 로컬 → Firebase ──
window.fbBackup = async function() {
  try {
    setFbStatus('백업 중...');
    const data = {
      orders,
      backedAt: new Date().toISOString(),
      count: orders.length
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
    orders = data.orders;
    save();
    renderAll();
    const backedAt = data.backedAt ? new Date(data.backedAt).toLocaleString('ko-KR') : '알 수 없음';
    setFbStatus(`✅ 복원 완료 — ${orders.length}건 (백업일: ${backedAt})`, 'var(--success)');
    toast(`📥 복원 완료 — ${orders.length}건`);
  } catch (e) {
    console.error('[firebase] 복원 실패:', e);
    setFbStatus('❌ 복원 실패: ' + e.message, '#e53e3e');
    toast('❌ 복원 실패');
  }
};
