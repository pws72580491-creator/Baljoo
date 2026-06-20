// ══════════════════════════════════════════════════════
// app.js  —  앱 초기화 · 스와이프 네비게이션 · 엑셀 내보내기
// ══════════════════════════════════════════════════════

// PDF.js worker 설정
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── 스와이프 상태 ──
let curView      = 0;
const TOTAL      = 5;
let touchStartX  = 0, touchStartY = 0, touchStartTime = 0;
let isDragging   = false, dragX = 0;

// ── 탭 이동 ──
function goTo(idx, animate = true) {
  idx     = Math.max(0, Math.min(TOTAL - 1, idx));
  curView = idx;

  const track = document.getElementById('swipeTrack');
  if (!animate) track.classList.add('no-transition');
  const W = root.offsetWidth;
  track.style.transform = `translateX(-${idx * W}px)`;
  if (!animate) requestAnimationFrame(() => { track.classList.remove('no-transition'); });

  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  document.getElementById('tabInk').style.left = (idx * 20) + '%';

  if (idx === 0 || idx === 1) renderAll();
  if (idx === 3) renderDeliveryStatus();
  if (idx === 4) renderStats();
  if (idx === 2 && !pendingOrders.length) {
    setStatus('');
    document.getElementById('progWrap').style.display = 'none';
  }
  if (idx === 2) {
    document.getElementById('delProgWrap').style.display = 'none';
    if (typeof setDelStatus === 'function') setDelStatus('');
  }
}

// ── 스와이프 이벤트 ──
const root = document.getElementById('swipeRoot');

root.addEventListener('touchstart', e => {
  if (document.getElementById('modalOv').classList.contains('open')) return;
  touchStartX    = e.touches[0].clientX;
  touchStartY    = e.touches[0].clientY;
  touchStartTime = Date.now();
  isDragging     = false;
  dragX          = 0;
}, { passive: true });

root.addEventListener('touchmove', e => {
  if (document.getElementById('modalOv').classList.contains('open')) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (!isDragging && Math.abs(dy) > Math.abs(dx)) return;
  if (!isDragging && Math.abs(dx) > 12) { isDragging = true; }
  if (!isDragging) return;
  dragX = dx;
  const W     = root.offsetWidth;
  const offset = -curView * W + dx;
  const track  = document.getElementById('swipeTrack');
  track.classList.add('no-transition');
  track.style.transform = `translateX(${offset}px)`;
}, { passive: true });

root.addEventListener('touchend', e => {
  if (!isDragging) { isDragging = false; return; }
  isDragging = false;
  const track     = document.getElementById('swipeTrack');
  track.classList.remove('no-transition');
  const dt        = Date.now() - touchStartTime;
  const velocity  = Math.abs(dragX) / dt;
  const threshold = root.offsetWidth * 0.4;
  if      (dragX < -threshold || (velocity > 0.6 && dragX < -50)) goTo(curView + 1);
  else if (dragX >  threshold || (velocity > 0.6 && dragX >  50)) goTo(curView - 1);
  else goTo(curView);
}, { passive: true });

// ── 엑셀 내보내기 ──
function exportExcel() {
  if (!orders.length)  { toast('⚠️ 내보낼 데이터가 없습니다'); return; }
  if (!window.XLSX)    { toast('⚠️ 엑셀 라이브러리 로드 중...'); return; }

  const rows = [];
  orders.forEach(o => {
    (o.items || [{ desc: '-', qty: 0, unit: '', price: 0, amount: 0 }]).forEach((item, idx) => {
      rows.push({
        '발주일자':       o.date,
        '납기일자':       o.delivery || '',
        '선명':          o.ship,
        '서류번호':       o.docNo || '',
        '거래처발주번호':  o.poNo || '',
        '구분':          o.category === 'cruise' ? '크루즈' : o.category === 'cargo' ? '카고' : o.category === 'return' ? '반품' : '직접입력',
        '납품상태':       o.deliveryStatus === 'delivered' ? '납품완료' : o.deliveryStatus === 'returned' ? '반품' : o.deliveryStatus === 'partial' ? '부분납품' : '미납품',
        '품목':          item.desc   || '',
        '코드':          item.code   || '',
        '수량':          item.qty    || 0,
        '단위':          item.unit   || '',
        '박스':          calcItemBoxCount(item) || 0,
        '단가':          item.price  || 0,
        '품목금액':       item.amount || 0,
        '발주총액':       idx === 0 ? (o.total        || 0) : '',
        '반품금액':       idx === 0 ? (o.returnAmount  || 0) : '',
        '실납품금액':     idx === 0 ? calcNetDelivery(o)    : '',
        '비고':          idx === 0 ? (o.deliveryNote  || '') : ''
      });
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '발주목록');

  const delivered = orders.filter(o => o.deliveryStatus === 'delivered');
  const returned  = orders.filter(o => o.deliveryStatus === 'returned');
  const partial   = orders.filter(o => o.deliveryStatus === 'partial');
  const pending   = orders.filter(o => !o.deliveryStatus || o.deliveryStatus === 'pending');
  const statsRows = [
    { 항목: '총 발주건수',   값: orders.length },
    { 항목: '총 발주금액',   값: orders.reduce((s, o) => s + (o.total || 0), 0) },
    { 항목: '납품완료건수',  값: delivered.length },
    { 항목: '납품완료금액',  값: delivered.reduce((s, o) => s + (o.total || 0), 0) },
    { 항목: '반품건수',     값: returned.length },
    { 항목: '반품금액',     값: returned.reduce((s, o) => s + (o.returnAmount || o.total || 0), 0) },
    { 항목: '부분납품건수',  값: partial.length },
    { 항목: '미납품건수',   값: pending.length },
    { 항목: '실납품금액합계', 값: orders.reduce((s, o) => s + calcNetDelivery(o), 0) },
  ];
  const ws2 = XLSX.utils.json_to_sheet(statsRows);
  XLSX.utils.book_append_sheet(wb, ws2, '납품통계');

  XLSX.writeFile(wb, `발주관리_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('📥 엑셀 파일 다운로드 완료');
}

// ── 앱 초기화 ──
function init() {
  migrateOldKey();
  load();
  loadGeminiKeys();
  goTo(0, false);
  renderAll();
  loadApiKey();
  document.getElementById('tabInk').style.left = '0%';
}
init();

// ── Service Worker 등록 ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 등록 실패:', e));
  });
}

// ── Pull-to-Refresh ──
(function() {
  const PTR_THRESHOLD = 70;   // 이 거리(px) 이상 당기면 새로고침
  const PTR_MAX      = 90;    // 인디케이터 최대 높이(px)
  let ptrStartY = 0, ptrDeltaY = 0, ptrActive = false, ptrTriggered = false;

  const indicator = document.getElementById('ptrIndicator');
  const spinner   = document.getElementById('ptrSpinner');
  const ptrText   = document.getElementById('ptrText');

  function setPTRHeight(h) {
    indicator.style.height = h + 'px';
    // 화살표 회전: threshold 넘으면 180도
    const ratio = Math.min(h / PTR_THRESHOLD, 1);
    spinner.style.transform = `rotate(${ratio * 180}deg)`;
    ptrText.textContent = h >= PTR_THRESHOLD ? '놓으면 새로고침' : '당겨서 새로고침';
  }

  document.addEventListener('touchstart', e => {
    if (curView !== 0) return;  // 대시보드 탭에서만
    const view0 = document.getElementById('v0');
    if (view0.scrollTop > 0) return;  // 이미 스크롤된 상태면 무시
    ptrStartY   = e.touches[0].clientY;
    ptrDeltaY   = 0;
    ptrActive   = true;
    ptrTriggered = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!ptrActive) return;
    ptrDeltaY = e.touches[0].clientY - ptrStartY;
    if (ptrDeltaY <= 0) { ptrActive = false; setPTRHeight(0); return; }
    const h = Math.min(ptrDeltaY * 0.6, PTR_MAX);
    setPTRHeight(h);
    if (ptrDeltaY >= PTR_THRESHOLD) ptrTriggered = true;
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!ptrActive) return;
    ptrActive = false;
    if (ptrTriggered) {
      // 새로고침 실행
      spinner.style.transform = 'rotate(0deg)';
      ptrText.textContent = '새로고침 중...';
      indicator.style.height = '48px';
      indicator.style.transition = 'none';
      setTimeout(() => {
        location.reload();
      }, 400);
    } else {
      // 원위치
      indicator.style.transition = 'height 0.2s ease';
      setPTRHeight(0);
    }
  }, { passive: true });
})();

// ── 핀치줌 / 더블탭 확대 차단 (터치 전용) ──
const isTouchOnly = window.matchMedia('(pointer:coarse) and (max-width:699px)').matches;
if (isTouchOnly) {
  document.addEventListener('touchstart', e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  let lastTap = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}
