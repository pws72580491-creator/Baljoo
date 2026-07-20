// ══════════════════════════════════════════════════════
// helpers.js  —  순수 유틸리티 (DOM 의존 없음)
// ══════════════════════════════════════════════════════

// ── XSS 방어: HTML 이스케이프 ──
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

// ── ID 안전화 ──
// 발주 id는 AI가 업로드된 파일에서 추출한 서류번호(docNo)를 그대로 사용하는데,
// docNo는 신뢰할 수 없는 외부 텍스트라 HTML 속성이나 onclick="...('${id}')" 같은
// 인라인 이벤트 핸들러 문자열을 깨뜨릴 수 있는 문자(따옴표/꺾쇠괄호/백슬래시/개행)를
// 포함할 수 있다. id 생성 시점에 한 번만 제거해 모든 사용처를 원천적으로 보호한다.
function sanitizeId(str) {
  return String(str || '').replace(/[<>"'`\\\r\n]/g, '');
}

// ── 안전한 JSON 파싱 ──
function safeParse(txt, fallback = null) {
  try {
    return JSON.parse(txt);
  } catch (e) {
    console.warn('[safeParse] 파싱 실패:', e.message);
    return fallback;
  }
}

// ── 오늘 날짜 (YYYY-MM-DD, 로컬 기준) ──
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 포맷 ──
const fmt  = n => (n != null && n !== '') ? '₩' + Number(n).toLocaleString() : '-';
const fmtQ = i => i.qty ? `${Number(i.qty).toLocaleString()} ${displayUnit(i.unit) || ''}` : '-';

// ── 배지 HTML ──
const badge = c => {
  if (c === 'cruise') return '<span class="badge b-cruise">크루즈</span>';
  if (c === 'cargo')  return '<span class="badge b-cargo">카고</span>';
  if (c === 'return') return '<span class="badge b-returned">반품</span>';
  return '<span class="badge b-manual">직접입력</span>';
};

const statusBadge = s => {
  if (s === 'delivered') return '<span class="badge b-delivered">납품완료</span>';
  if (s === 'returned')  return '<span class="badge b-returned">반품</span>';
  if (s === 'cancelled') return '<span class="badge b-cancelled">🚫 발주취소</span>';
  return '<span class="badge b-pending">미납품</span>';
};

// ── 박스 계산 ──
function getBoxDivisor(unit) {
  if (!unit) return null;
  const u = String(unit).toLowerCase().trim().replace(/[^a-z]/g, '');

  // CTN / BOX / CASE / CARTON → qty = 박스 수 (1:1)
  if (u === 'ctn' || u === 'case' || u === 'carton' || u === 'box' || u === 'ct') return 1;

  // PKT / PKG / BAG / SACHET / POUCH (봉지) → 10봉지 = 1박스
  if (u === 'pkt' || u === 'pkg' || u === 'bag' || u === 'sachet' || u === 'pouch') return 10;

  // DOZ / DOZEN → 30doz = 1박스
  if (u.startsWith('doz') || u === 'dozen') return 30;

  // CS / PC / PCS / EA / PIECE → 360pcs = 1박스  (cs는 pcs와 동일 취급)
  if (u === 'cs' || u.startsWith('pc') || u === 'pcs' || u === 'ea' || u === 'each' || u === 'piece' || u === 'pieces') return 360;

  return null;
}

// 깐메추리알(절임/통조림) 여부 판단: BRINE/PEELED/깐 포함
function _isQuailBrine(item) {
  const d = String(item.desc || '').toUpperCase();
  return (d.includes('QUAIL') || d.includes('메추리')) &&
         (d.includes('BRINE') || d.includes('PEELED') || d.includes('깐') ||
          d.includes('PICKLED') || d.includes('SALTED'));
}

// 생메추리알 여부 판단 (QUAIL/메추리 포함, 단 깐메추리 제외)
function _isQuailEgg(item) {
  const d = String(item.desc || '').toUpperCase();
  const isQuail = d.includes('QUAIL') || d.includes('메추리');
  return isQuail && !_isQuailBrine(item);
}

function calcItemBoxCount(item) {
  // boxes 필드가 직접 있으면 우선 사용
  if (item.boxes != null && Number(item.boxes) > 0) return Number(item.boxes);

  // 단위가 box/ctn/case/carton이면 qty = 박스 수 (1:1) — 생메추리 포함 모든 품목
  const unitNorm = String(item.unit || '').toLowerCase().replace(/[^a-z]/g, '');
  const isBoxUnit = unitNorm === 'box' || unitNorm === 'ctn' || unitNorm === 'case' || unitNorm === 'carton' || unitNorm === 'ct';
  if (isBoxUnit) {
    return Number(item.qty) || 0;
  }

  // PKT/PKG/BAG/SACHET/POUCH 단위 — 10pkt = 1박스 (봉지 단위)
  const isPktUnit = unitNorm === 'pkt' || unitNorm === 'pkg' || unitNorm === 'bag'
                 || unitNorm === 'sachet' || unitNorm === 'pouch';
  if (isPktUnit) return (Number(item.qty) || 0) / 10;

  // 생메추리알 특별 처리: pcs → 480pcs=1박스 / doz → 40doz=1박스 (반품서 음수 qty도 처리)
  if (_isQuailEgg(item)) {
    const qty = Number(item.qty) || 0;
    if (qty !== 0) {
      const u = unitNorm;
      const isDoz = u.startsWith('doz') || u === 'dozen';
      return qty / (isDoz ? 40 : 480);
    }
  }

  // 일반 품목: desc에서 "NNN PCS/BOX" 또는 "NNN DOZ/BOX" 패턴 파싱
  // ⚠️ 반드시 품목의 실제 단위(unit)와 패턴이 가리키는 단위가 일치할 때만 적용.
  // 예) unit=doz(다스)인데 desc에 "360EA/BOX"라고 적혀있어도, 이는 낱개(EA) 기준
  // 정보라서 다스 수량(qty)을 그대로 나누면 12배 축소된 잘못된 값이 나옴
  // (2,100doz ÷ 360 = 5.8박스 — 잘못됨. 실제로는 30doz=360EA=1박스이므로 70박스가 맞음).
  if (!isBoxUnit && item.desc) {
    const isEaLikeUnit  = unitNorm === 'cs' || unitNorm.startsWith('pc') || unitNorm === 'pcs'
                        || unitNorm === 'ea' || unitNorm === 'each' || unitNorm === 'piece' || unitNorm === 'pieces';
    const isDozLikeUnit = unitNorm.startsWith('doz') || unitNorm === 'dozen';

    const mPcs = String(item.desc).match(/(\d+)\s*(?:PCS|EA)[\s\/]*(?:BOX|CTN|CS|CASE)/i);
    if (mPcs && isEaLikeUnit) {
      const perBox = Number(mPcs[1]);
      if (perBox > 0 && item.qty) return Number(item.qty) / perBox;
    }
    const mDoz = String(item.desc).match(/(\d+)\s*(?:DOZ|DOZEN)[\s\/]*(?:BOX|CTN|CS|CASE)/i);
    if (mDoz && isDozLikeUnit) {
      const perBox = Number(mDoz[1]);
      if (perBox > 0 && item.qty) return Number(item.qty) / perBox;
    }
  }

  const d = getBoxDivisor(item.unit);
  if (!d || !item.qty) return 0;
  return Number(item.qty) / d;
}

// 품목 설명(desc)에서 파싱한 "NNN DOZ/BOX" · "NNN PCS/BOX" 배수가 이 앱의
// 표준 배수(DOZ 30 / PCS·EA 360)와 3배 이상 차이나면 경고 메시지를 반환한다.
// AI가 원본 발주서 숫자를 잘못 읽었을 가능성(예: "30"→"300" 0 오인식)을
// 저장 전 미리보기 단계에서 사용자에게 알리기 위함 — 값을 임의로 고치지는 않음.
function _boxRatioWarning(item) {
  if (!item || !item.desc || _isQuailEgg(item)) return null;
  const unitNorm = String(item.unit || '').toLowerCase().replace(/[^a-z]/g, '');
  const isBoxUnit = unitNorm === 'box' || unitNorm === 'ctn' || unitNorm === 'case' || unitNorm === 'carton' || unitNorm === 'ct';
  if (isBoxUnit) return null;

  const isEaLikeUnit  = unitNorm === 'cs' || unitNorm.startsWith('pc') || unitNorm === 'pcs'
                      || unitNorm === 'ea' || unitNorm === 'each' || unitNorm === 'piece' || unitNorm === 'pieces';
  const isDozLikeUnit = unitNorm.startsWith('doz') || unitNorm === 'dozen';

  const mPcs = isEaLikeUnit  ? String(item.desc).match(/(\d+)\s*(?:PCS|EA)[\s\/]*(?:BOX|CTN|CS|CASE)/i)   : null;
  const mDoz = isDozLikeUnit ? String(item.desc).match(/(\d+)\s*(?:DOZ|DOZEN)[\s\/]*(?:BOX|CTN|CS|CASE)/i) : null;
  const m = mPcs || mDoz;
  if (!m) return null;

  const parsed   = Number(m[1]);
  const standard = getBoxDivisor(mPcs ? 'pcs' : 'doz'); // 360 or 30
  if (!parsed || !standard) return null;

  const ratio = parsed / standard;
  if (ratio >= 3 || ratio <= 1 / 3) {
    const unitLabel = mPcs ? '개' : '다스';
    return `⚠️ 품목설명 "${m[0]}" 인식 — 통상 박스당 ${standard}${unitLabel}인데 ${parsed}${unitLabel}로 읽혔습니다. 원본 발주서를 확인해주세요.`;
  }
  return null;
}

function formatBoxCount(bc) {
  if (!bc) return '0박스';
  return (bc % 1 === 0) ? `${bc}박스` : `${bc.toFixed(1)}박스`;
}

// pkt(봉지) 단위 품목용 표시: 박스 + 나머지 봉지
// 예) qty=25pkt → 2박스 5봉지 / qty=10pkt → 1박스 / qty=3pkt → 3봉지
function formatPktCount(qty) {
  const q = Number(qty) || 0;
  if (q === 0) return '0봉지';
  const sign  = q < 0 ? '-' : '';
  const abs   = Math.abs(q);
  const boxes = Math.floor(abs / 10);
  const pkts  = abs % 10;
  if (boxes > 0 && pkts > 0) return `${sign}${boxes}박스 ${pkts}봉지`;
  if (boxes > 0)              return `${sign}${boxes}박스`;
  return `${sign}${pkts}봉지`;
}

// 품목의 단위가 pkt 계열인지 판별
function _isPktUnit(unit) {
  const u = String(unit || '').toLowerCase().replace(/[^a-z]/g, '');
  return u === 'pkt' || u === 'pkg' || u === 'bag' || u === 'sachet' || u === 'pouch';
}

// 품목 박스 문자열 표시 (pkt 품목은 박스+봉지 혼합, 일반은 박스)
function formatItemBoxStr(item) {
  if (_isPktUnit(item.unit)) {
    const q = Number(item.qty) || 0;
    return q ? formatPktCount(q) : '';
  }
  const bc = calcItemBoxCount(item);
  return bc ? formatBoxCount(bc) : '';
}

// ctn/case/carton/box 단위는 화면에 'box'로 통일 표시
// pkt/pkg/bag 단위는 '봉지'로 통일 표시
function displayUnit(unit) {
  if (!unit) return '';
  const u = String(unit).toLowerCase().replace(/[^a-z]/g, '');
  if (u === 'ctn' || u === 'case' || u === 'carton' || u === 'ct') return 'box';
  if (u === 'pkt' || u === 'pkg' || u === 'bag' || u === 'sachet' || u === 'pouch') return '봉지';
  return unit; // pcs, doz 등은 그대로
}

function calcOrderBoxes(order) {
  return (order.items || []).reduce((s, i) => s + calcItemBoxCount(i), 0);
}

// ── 반품건 재고 처리 보정 ──
// "수동 반품처리"(isReturn=false, deliveryStatus='returned')는 원래 "납품완료 → 반품"
// 흐름을 전제로, 이미 나간 재고가 되돌아온 것으로 보고 박스 수를 마이너스로 잡는다.
// 그런데 상세 모달의 "반품 처리" 버튼은 미납품 상태에서도 눌러 곧바로 반품으로 전환할 수 있어
// (납품완료를 거친 적이 없으면 deliveredDate가 비어있음), 이 경우 실제로는 재고가 나간 적이
// 없는데도 "반품으로 돌아온 재고"로 잘못 가산되는 문제가 있었다.
// → 납품완료 이력 없이(=deliveredDate 없이) 바로 반품 처리된 건은 "phantom return"으로 보고
//    박스/재고 집계에서는 0으로 처리한다 (금액·표시는 그대로 유지, 재고 수치만 보정).
function _isPhantomReturn(o) {
  return o.deliveryStatus === 'returned' && !o.isReturn && !o.deliveredDate;
}

// 박스/재고 집계 전용 부호: 납품완료·업로드 반품서 = +1,
// 납품 이력이 있는 수동 반품 = -1, phantom 반품(납품 이력 없음) = 0
function _boxSign(o) {
  if (_isPhantomReturn(o)) return 0;
  return (o.deliveryStatus === 'returned' && !o.isReturn) ? -1 : 1;
}

// ── 실납품금액 계산 ──
function calcNetDelivery(order) {
  const total = order.total || 0;
  if (order.deliveryStatus === 'delivered') return total;
  if (order.deliveryStatus === 'returned') {
    // 업로드된 반품서(isReturn=true): total이 이미 음수
    if (order.isReturn) return total;
    // 수동 반품 처리: returnAmount는 양수, 음수로 반환
    return -(order.returnAmount ?? Math.abs(total));
  }
  // 발주취소(cancelled) 건은 항상 0 — 모든 집계에서 제외
  return 0;
}

// ── 발주서 중복 판정 (업로드 미리보기 등, 발주 1건 vs 저장된 전체 목록) ──
// v3.3.15: 서류번호(docNo) 또는 거래처발주번호(poNo)가 저장된 발주와 하나라도
// 같으면 중복으로 통일. 이전엔 docNo·poNo가 둘 다 없을 때 "선명+날짜 일치"를
// 예비 기준으로 썼는데, 선명은 더 이상 중복 판정에 쓰지 않기로 해서 제거함
// (그런 경우 비교할 기준이 없는 것으로 보고 중복 판정하지 않음).
// analyzer.js의 renderPreview()에서 이 함수 하나만 참조하도록 정리 —
// 이전엔 같은 조건식이 두 군데(카드별 뱃지 / 상단 건수 집계)에 따로 박혀 있어
// 기준을 바꿀 때 한쪽만 고치고 놓치기 쉬웠음.
//
// v3.3.16: 어느 필드(docNo/poNo)가 어떤 기존 발주와 겹쳤는지까지 반환하도록
// _findDupMatch()로 확장. 화면엔 서류번호만 보이는데 실제로는 안 보이는
// 거래처발주번호 쪽이 겹쳐서 중복 판정되는 경우, 사용자가 "왜 중복이라는데
// 서류번호로 검색하면 안 나오지?"라며 헷갈리는 문제가 있었음 — 매칭된
// 필드·값·상대 발주를 그대로 보여주면 바로 확인 가능해짐.
//
// v3.3.17: 발주일자 일치까지 조건에 추가, 반품서는 비교 대상(x)에서도 제외.
// 실사용 중 거래처가 서류번호·거래처발주번호를 재사용해 완전히 다른 날짜의
// 새 발주를 넣었는데도 "이미 등록됨"으로 잘못 뜨는 사례 발견— 번호가 같아도
// 발주일자가 다르면 별개 건으로 판단하도록 함. 또한 이전엔 x(비교 대상)에서
// 반품서를 걸러내지 않아서, 원본 발주와 그 반품서가 같은 서류번호를 공유할 때
// (반품서는 원본 번호를 그대로 참조) 배열 순서에 따라 반품서 쪽이 매칭되어
// 엉뚱한 상대가 표시되거나(안내문구) saveAll()에서 잘못 덮어써질 수 있었음.
function _findDupMatch(o) {
  if (o.isReturn) return null;
  const oDoc = (o.docNo || '').trim();
  const oPo  = (o.poNo  || '').trim();
  if (!oDoc && !oPo) return null;
  for (const x of orders) {
    if (x.isReturn) continue;         // 반품서는 원본 서류번호를 그대로 참조 — 비교 대상에서 제외
    if (x.date !== o.date) continue;  // 번호가 같아도 발주일자가 다르면 별개 건
    const xDoc = (x.docNo || '').trim();
    const xPo  = (x.poNo  || '').trim();
    if (oDoc && xDoc && xDoc === oDoc) return { order: x, field: 'docNo' };
    if (oPo  && xPo  && xPo  === oPo)  return { order: x, field: 'poNo'  };
  }
  return null;
}
function _isDupOfSaved(o) {
  return !!_findDupMatch(o);
}

// ── 서류번호·발주번호 중복 검사 (저장된 발주 전체 대상) ──
// 반품서(isReturn)는 원본 발주의 서류번호/발주번호를 그대로 참조하는 경우가 많아
// 중복 판정에서 제외한다 (업로드 미리보기 단계의 중복 판별과 동일한 기준 —
// analyzer.js의 _findDupMatch() 참고).
// v3.3.17: _findDupMatch()와 동일하게 발주일자까지 같아야 중복 그룹으로 묶이도록
// 키를 "번호|발주일자" 조합으로 변경 (번호 재사용에 대한 오탐 방지).
function _computeDupOrderIdSet() {
  const docMap = new Map(); // "docNo|date" -> [id, ...]
  const poMap  = new Map(); // "poNo|date"  -> [id, ...]
  orders.forEach(o => {
    if (o.isReturn) return;
    if (o.docNo) { const k = o.docNo + '|' + (o.date || ''); if (!docMap.has(k)) docMap.set(k, []); docMap.get(k).push(o.id); }
    if (o.poNo)  { const k = o.poNo  + '|' + (o.date || ''); if (!poMap.has(k))  poMap.set(k, []);  poMap.get(k).push(o.id); }
  });
  const dupIds = new Set();
  docMap.forEach(ids => { if (ids.length > 1) ids.forEach(id => dupIds.add(id)); });
  poMap.forEach(ids  => { if (ids.length > 1) ids.forEach(id => dupIds.add(id)); });
  return dupIds;
}

// ── 필터된 발주 목록 ──
// ── 정렬 상태: 'date_desc'|'date_asc'|'name_asc'|'name_desc' ──
let sortMode = 'date_desc';

function filtered() {
  const from = document.getElementById('fDateFrom')?.value || '';
  const to   = document.getElementById('fDateTo')?.value   || '';
  const isArchiveMode = statusMode === 'archived';
  const dupIds = dupOnlyMode ? _computeDupOrderIdSet() : null;
  const list = orders
    .filter(o => isArchiveMode ? !!o.archived : !o.archived)
    .filter(o => filterMode === 'all' || o.category === filterMode)
    .filter(o => isArchiveMode || statusMode === 'all' || o.deliveryStatus === statusMode)
    .filter(o => !searchQ || (o.ship + o.docNo + o.poNo).toLowerCase().includes(searchQ.toLowerCase()))
    .filter(o => !from || o.date >= from)
    .filter(o => !to   || o.date <= to)
    .filter(o => !dupOnlyMode || dupIds.has(o.id));

  list.sort((a, b) => {
    switch (sortMode) {
      case 'date_asc':  return a.date.localeCompare(b.date);
      case 'name_asc':  return (a.ship||'').localeCompare(b.ship||'');
      case 'name_desc': return (b.ship||'').localeCompare(a.ship||'');
      default:          return b.date.localeCompare(a.date); // date_desc
    }
  });
  return list;
}

// ── 토스트 ──
let toastTimer;
function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}
