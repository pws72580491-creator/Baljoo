// ══════════════════════════════════════════════════════
// analyzer.js  —  발주서 파일 업로드 · AI 자동 분석
// ══════════════════════════════════════════════════════

let pendingOrders = [];
const PDF_MAX_PAGES = 5;
const IMAGE_MAX_PX  = 1024;   // 리사이즈 한계 (px) — 발주서는 1024로 충분
const IMAGE_QUALITY = 0.75;   // JPEG 품질 — 속도 우선

// ── v3.3.34: 선명(船名) 인식 보조 — AI가 선명을 놓치거나 오인식하는 경우가 있어,
// 기존 발주 데이터에 실제로 존재하는 선명을 (1) AI 프롬프트에 참고 목록으로 제공하고,
// (2) AI 응답을 그 목록과 대조해 1~2글자 오탈자 수준이면 자동 보정한다.
// 하드코딩된 선명 목록이 아니라 이 앱에 실제로 쌓인 orders 데이터에서 만들기 때문에
// 거래처가 바뀌어도 별도 유지보수가 필요 없음.

// 최근/자주 등장하는 선명일수록 프롬프트에서 먼저 참고되도록 빈도순 정렬 + 상한(150개)으로
// 컷 — 목록이 너무 길면 프롬프트만 늘어나고 오히려 인식 정확도에 도움이 안 됨.
function _buildShipMasterList(maxCount = 150) {
  const freq = new Map();
  (orders || []).forEach(o => {
    const s = (o.ship || '').trim();
    if (s) freq.set(s, (freq.get(s) || 0) + 1);
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(e => e[0]);
}

// 두 문자열 사이의 Levenshtein(편집) 거리
function _levenshtein(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

// 두 선명에 포함된 숫자 부분이 같은지 확인. "동해1호"↔"동해2호"처럼 배 번호만 다른
// 경우는 오탈자가 아니라 완전히 다른 배이므로, 숫자가 다르면 절대 자동 보정하지 않음.
function _shipDigitsMatch(a, b) {
  const da = (a.match(/\d+/g) || []).join('');
  const db = (b.match(/\d+/g) || []).join('');
  return da === db;
}

// AI가 인식한 선명(rawShip)을 마스터 목록과 대조해 오탈자 수준이면 자동 보정.
// docNo/poNo와 동일한 원칙 — 애매하면(후보 여러 개 동점) 절대 보정하지 않고 원본 유지.
// 잘못 보정하는 것이 안 보정하는 것보다 더 위험함.
function _correctShipName(rawShip, masterList) {
  const trimmed = (rawShip || '').trim();
  if (!trimmed || !masterList || masterList.length === 0) {
    return { ship: trimmed, corrected: false };
  }

  const normInput = _normShipKey(trimmed);
  // 정규화 기준(괄호 제거·공백 정리·대문자화)으로 이미 마스터 목록과 일치하면 그대로 사용
  if (masterList.some(m => _normShipKey(m) === normInput)) {
    return { ship: trimmed, corrected: false };
  }

  const threshold = trimmed.length <= 6 ? 1 : 2;   // 짧은 이름은 더 엄격하게
  const candidates = [];
  masterList.forEach(m => {
    const normMaster = _normShipKey(m);
    const dist = _levenshtein(normInput, normMaster);
    if (dist > 0 && dist <= threshold && _shipDigitsMatch(normInput, normMaster)) {
      candidates.push({ ship: m, dist });
    }
  });

  if (candidates.length === 0) return { ship: trimmed, corrected: false };
  candidates.sort((a, b) => a.dist - b.dist);
  const minDist = candidates[0].dist;
  const bestCandidates = candidates.filter(c => c.dist === minDist);
  if (bestCandidates.length > 1) return { ship: trimmed, corrected: false }; // 동점 후보 → 보정 보류

  return { ship: bestCandidates[0].ship, corrected: true, original: trimmed };
}

function onDrag(e, on) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.toggle('drag', on);
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag');
  handleFiles(e.dataTransfer.files);
}

async function handleFiles(files) {
  if (!files.length) return;
  if (!getGeminiKey()) { setStatus('⚠️ API 키를 먼저 입력해주세요.'); return; }
  pendingOrders = [];
  document.getElementById('prev-section').style.display = 'none';
  document.getElementById('prev-cards').innerHTML       = '';
  document.getElementById('progWrap').style.display     = 'block';
  setStatus('파일 분석 중...');

  const all = [];
  for (const f of files) {
    if (f.name.endsWith('.zip')) {
      setStatus('ZIP 압축 해제 중...');
      const zip = await JSZip.loadAsync(f);
      for (const [n, e] of Object.entries(zip.files)) {
        if (!e.dir && (n.endsWith('.pdf') || /\.(jpg|jpeg|png|webp)$/i.test(n))) {
          const blob = await e.async('blob');
          all.push(new File([blob], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }));
        }
      }
    } else {
      all.push(f);
    }
  }

  // 백그라운드 처리 유지 시작 (화면 꺼짐·앱 전환 대응)
  await BG.start();

  const failedFiles = [];
  for (let i = 0; i < all.length; i++) {
    setProgress(Math.round(((i + 0.5) / all.length) * 100));
    setStatus(`분석 중 ${i + 1}/${all.length}: ${all[i].name} (백그라운드 처리 중)`);
    try { await analyzeFile(all[i]); }
    catch(e) {
      console.warn('[handleFiles] 파일 실패, 다음 파일로 계속:', all[i].name, e.message);
      failedFiles.push(all[i].name);
    }
  }

  await BG.end();

  setProgress(100);
  if (pendingOrders.length > 0) {
    renderPreview();
    document.getElementById('prev-section').style.display = 'block';
    const failMsg = failedFiles.length ? ` (실패 ${failedFiles.length}건: ${failedFiles.join(', ')})` : '';
    setStatus(`✅ ${pendingOrders.length}건 분석 완료. 확인 후 저장하세요.${failMsg}`);
  } else {
    setStatus('❌ 발주서 데이터를 찾지 못했습니다. API 키와 파일 형식을 확인하세요.');
  }
}

async function analyzeFile(file) {
  try {
    // v3.3.34: 기존 발주 데이터에 실제로 쌓인 선명들을 AI 인식 참고 목록으로 제공
    // (선명 인식 실패·오인식 보완용). 하드코딩 없이 orders에서 매번 동적으로 구성.
    const shipMaster = _buildShipMasterList();
    const shipHintText = shipMaster.length > 0
      ? `\nship(선명) 인식 참고 — 이 앱에 이미 등록된 거래처(선명) 목록입니다. 문서의 글자가
  흐릿하거나 애매하면 이 목록 중 가장 유사한 것을 우선 참고하세요. 목록에 없는 새 거래처라면
  이 목록을 무시하고 문서에 보이는 그대로 적으세요(목록에 억지로 끼워 맞추지 말 것):
  [${shipMaster.join(', ')}]\n`
      : '';

    const prompt = `이 문서를 분석해 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만 출력:
{"docNo":"","date":"YYYY-MM-DD","delivery":"YYYY-MM-DD","ship":"","poNo":"","category":"cruise","isReturn":false,"items":[{"desc":"","code":"","qty":0,"unit":"pcs","price":0,"amount":0}],"total":0}
규칙:
- date/delivery=YYYY-MM-DD, category=cruise또는cargo
- isReturn: 문서가 반품서(RETURN, CREDIT NOTE, 반품, 수량/금액이 음수)이면 true, 일반 발주서이면 false
- 반품서인 경우 qty와 amount, total은 반드시 음수(-)로 표기
docNo·poNo 추출 규칙(중요 — 이 두 값은 발주 식별에 반드시 필요하니 문서 전체를 꼼꼼히 살펴볼 것):
- docNo(서류번호): 문서에 "서류번호"·"Document No."·"문서번호"로 표시된, 이 문서 자체의 고유
  식별 번호. 보통 문서 상단(제목 근처 또는 우측 상단)에 위치.
- poNo(거래처발주번호): 거래처(선사/발주처)가 자체적으로 부여한 주문번호. "거래처발주번호"·
  "발주번호"·"P/O No."·"PO NO"·"Order No."·"주문번호" 등으로 표시됨. 문서 상단 또는 선명 근처에
  위치하는 경우가 많으며, 슬래시(/)나 하이픈(-)이 섞인 영숫자 조합인 경우가 많음.
- docNo와 poNo는 서로 다른 값이니 절대 혼동하거나 같은 값을 넣지 말 것.
- 문서에 이 라벨들이 명확하게 보이지 않으면, 절대로 다른 번호(예: 전화번호·팩스번호·페이지
  번호·품목 코드 등)로 대체하거나 추측해서 채우지 말고 반드시 빈 문자열("")로 둘 것.
  빈 값이 실제로 없는 것보다, 잘못 추측한 값이 훨씬 더 문제가 됨.
${shipHintText}unit 선택 기준(중요):
- 수량 단위가 DOZ·DOZEN·다스 → unit="doz" (절대 cs/ctn으로 쓰지 말것)
- 수량 단위가 CS·CTN·BOX·CASE·박스 → unit="ctn"
- 수량 단위가 PCS·EA·낱개 → unit="pcs"
- 수량 단위가 PKT·PKG·BAG·SACHET·POUCH·봉지·봉·팩 → unit="pkt"
- 그 외: kg/l/btl 중 해당하는 것`;

    const parts = [textPart(prompt)];
    if (file.type === 'application/pdf') {
      const pages = await pdfToImages(file);
      pages.forEach(dataUrl => parts.push(imagePart(dataUrl)));
    } else {
      // 이미지 리사이즈 후 전송 (대용량 오류 방지)
      const dataUrl = await resizeImage(file, IMAGE_MAX_PX, IMAGE_QUALITY);
      parts.push(imagePart(dataUrl));
    }

    let txt = await callGemini(parts, 4000);

    // 코드블록 제거 후 { } 범위만 추출
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);

    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (parseErr) {
      // JSON이 잘린 경우 복구 시도
      try {
        let fixed = txt;
        // 열린 배열/객체 닫기
        const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
        const openb = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
        // 마지막 불완전한 항목 제거 (쉼표로 끝나는 경우)
        fixed = fixed.replace(/,\s*$/, '');
        for (let i = 0; i < opens; i++) fixed += ']';
        for (let i = 0; i < openb; i++) fixed += '}';
        parsed = JSON.parse(fixed);
        console.warn('[analyzer] JSON 복구 성공');
      } catch (e2) {
        console.warn('[analyzer] JSON 파싱 실패:', parseErr.message, '\n원본:', txt);
        throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요. (' + parseErr.message + ')');
      }
    }
    // 반품서 판별: AI가 isReturn 반환 OR total이 음수 OR 모든 items qty가 음수
    const aiIsReturn  = !!parsed.isReturn;
    const totalNeg    = (parsed.total || 0) < 0;
    const allQtyNeg   = (parsed.items || []).length > 0 && (parsed.items || []).every(i => (i.qty || 0) < 0);
    const isReturnDoc = aiIsReturn || totalNeg || allQtyNeg;

    if (isReturnDoc) {
      // 반품서: 고유 id 부여 (원본 발주서와 분리), deliveryStatus='returned'로 저장
      parsed.id             = 'RET-' + (sanitizeId(parsed.docNo) || Date.now()) + '-' + Date.now();
      parsed.isReturn       = true;
      parsed.deliveryStatus = 'returned';
      parsed._retMig        = true;  // 생성 시점에 이미 올바른 상태이므로 이후 자동 보정 대상에서 제외
      // total/amount 음수 보정 (AI가 양수로 반환한 경우 강제 음수화)
      if ((parsed.total || 0) > 0) parsed.total = -Math.abs(parsed.total);
      (parsed.items || []).forEach(i => {
        if ((i.qty    || 0) > 0) i.qty    = -Math.abs(i.qty);
        if ((i.amount || 0) > 0) i.amount = -Math.abs(i.amount);
      });
      parsed.returnAmount = Math.abs(parsed.total);
      parsed.returnedDate = parsed.date || '';
    } else {
      // v3.3.17: id를 서류번호만으로 만들면, 거래처가 서류번호를 재사용해 만든
      // "완전히 다른 날짜의 새 발주"가 기존 발주와 같은 id를 갖게 되어 저장 시
      // 조용히 무시되는 문제가 있었음(방금 _findDupMatch에 추가한 발주일자 조건과
      // 어긋남) — 서류번호+발주일자 조합으로 id를 만들어 이 둘을 맞춤.
      const _docNoTrim = (parsed.docNo || '').trim();
      parsed.id = _docNoTrim
        ? (sanitizeId(_docNoTrim + '_' + (parsed.date || '')) || ('UP-' + Date.now()))
        : ('UP-' + Date.now());
      parsed.isReturn       = false;
      parsed.deliveryStatus = 'pending';
      parsed.returnAmount   = 0;
    }
    parsed.source        = 'upload';
    parsed.fileName      = file.name;
    parsed.category      = parsed.category || 'cargo';
    parsed.deliveredDate = '';
    parsed.returnedDate  = parsed.returnedDate || '';
    parsed.cancelledDate = '';
    parsed.updatedAt     = Date.now();
    // v3.3.34: 마스터 목록과 대조해 오탈자 수준이면 자동 보정 (애매하면 보정 안 함)
    if ((parsed.ship || '').trim()) {
      const shipCorrection = _correctShipName(parsed.ship, shipMaster);
      if (shipCorrection.corrected) {
        parsed._shipAutoCorrected = true;
        parsed._shipOriginalOcr   = shipCorrection.original;
        parsed.ship               = shipCorrection.ship;
      }
    }
    // 선명 누락 플래그
    parsed._shipMissing  = !parsed.ship || !parsed.ship.trim();
    pendingOrders.push(parsed);

  } catch(e) {
    console.error('[analyzer] 분석 오류:', e);
    const msg = e.message === 'API_KEY_MISSING' ? '⚠️ API 키를 먼저 입력해주세요.' : '❌ ' + (e.message || '분석 실패');
    setStatus(msg);
    throw e;
  }
}

// ── 이미지 리사이즈 (Canvas 활용, 대용량 이미지 → API 오류 방지) ──
function resizeImage(file, maxPx, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w <= maxPx && h <= maxPx) {
        // 리사이즈 불필요 → 원본 base64 그대로
        const r = new FileReader();
        r.onload  = () => res(r.result);
        r.onerror = () => rej(new Error('read fail'));
        r.readAsDataURL(file);
        return;
      }
      const ratio = Math.min(maxPx / w, maxPx / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      res(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

async function pdfToImages(file) {
  if (!window.pdfjsLib) throw new Error('PDF 렌더링 라이브러리 로드 실패');
  const buf    = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buf }).promise;
  const n      = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const images = [];
  for (let i = 1; i <= n; i++) {
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.8 });
    // 최대 크기 제한 (API 오류 방지)
    const scale    = Math.min(1.2, IMAGE_MAX_PX / Math.max(viewport.width, viewport.height));
    const vp2      = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = vp2.width;
    canvas.height  = vp2.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp2 }).promise;
    images.push(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
  }
  return images;
}

function renderPreview() {
  document.getElementById('prev-cards').innerHTML = pendingOrders.map((o, idx) => {
    // 반품서는 중복 판별 대상에서 완전히 제외
    const isReturnDoc  = !!o.isReturn;
    const shipMissing  = !!o._shipMissing;
    const dupMatch = _findDupMatch(o);
    const isDup = !!dupMatch;

    // v3.3.16: 중복 사유(어느 필드가 기존 어떤 발주와 겹쳤는지)를 사람이 읽을 수 있게 구성
    const dupFieldLabel = dupMatch ? (dupMatch.field === 'docNo' ? '서류번호' : '거래처발주번호') : '';
    const dupValue      = dupMatch ? (dupMatch.field === 'docNo' ? dupMatch.order.docNo : dupMatch.order.poNo) : '';
    const dupShip       = dupMatch ? (dupMatch.order.ship || '선명없음') : '';

    // 뱃지: 반품서 / 선명누락 / 중복 / 신규
    const statusBadgeHtml = isReturnDoc
      ? `<span class="badge b-returned" style="margin-left:4px;">↩️ 반품서</span>`
      : shipMissing
        ? `<span class="badge" style="background:#fee2e2;color:#991b1b;margin-left:4px;">⚠️ 선명 누락</span>`
        : isDup
          ? `<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:4px;" title="${escapeHtml(dupFieldLabel)}(${escapeHtml(dupValue)})가 '${escapeHtml(dupShip)}' 발주와 동일">⚠️ 중복</span>`
          : `<span class="badge" style="background:#dcfce7;color:#15803d;margin-left:4px;">신규</span>`;

    // 카드 테두리: 반품서=빨강, 선명누락=주황-빨강, 중복=노랑, 신규=기본
    const cardStyle = isReturnDoc
      ? 'border:2px solid #dc2626;background:#fff5f5;'
      : shipMissing
        ? 'border:2px solid #f97316;background:#fff7ed;'
        : isDup
          ? 'border:2px solid #f59e0b;background:#fffbeb;'
          : '';

    // 안내 메시지 — 중복인 경우 어느 필드가 어떤 기존 발주와 겹쳤는지 구체적으로 표시
    const infoMsg = isReturnDoc
      ? `<div style="font-size:11px;color:#991b1b;background:#fee2e2;border-radius:6px;padding:5px 8px;grid-column:1/-1;">↩️ 반품서로 인식되었습니다. 기존 발주서는 유지되고 반품 내역으로 별도 추가됩니다.</div>`
      : shipMissing
        ? `<div style="font-size:11px;color:#9a3412;background:#ffedd5;border-radius:6px;padding:5px 8px;grid-column:1/-1;">⚠️ AI가 선명을 인식하지 못했습니다. 저장 전 선명을 직접 확인하거나 수정 후 저장하세요.</div>`
        : isDup
          ? `<div style="font-size:11px;color:#92400e;background:#fde68a;border-radius:6px;padding:5px 8px;grid-column:1/-1;">⚠️ <b>${escapeHtml(dupFieldLabel)}</b>(${escapeHtml(dupValue)})가 기존 발주 "<b>${escapeHtml(dupShip)}</b>"와 동일합니다. 제거하거나 저장 시 기존 데이터를 덮어씁니다.</div>`
          : '';

    const totalStyle = isReturnDoc ? 'color:#dc2626;font-weight:700;' : '';
    // 선명 입력창 — 선명 누락/오인식 시 이 자리에서 바로 수정 후 전체 저장 가능
    const shipInputHtml = `<input type="text" class="prev-ship" id="pship-${idx}"
      value="${escapeHtml(o.ship || '')}" placeholder="선명 입력" enterkeyhint="done"
      onchange="updatePendingShip(${idx}, this.value)"
      style="border:${shipMissing ? '1.5px solid #f97316' : '1px solid transparent'};
             border-radius:6px;padding:2px 6px;margin:-2px -6px;min-width:0;
             background:${shipMissing ? '#fff7ed' : 'transparent'};
             color:${shipMissing ? '#f97316' : 'inherit'};
             font-family:inherit;
             font-style:${shipMissing ? 'italic' : 'normal'};">`;
    // v3.3.34: 선명이 마스터 목록 기준으로 자동 보정된 경우, 원래 AI가 읽은 값을
    // 툴팁으로 보여줘 사용자가 한 번 더 확인할 수 있도록 함
    const shipCorrectedTag = o._shipAutoCorrected
      ? `<span title="AI 인식 원본: ${escapeHtml(o._shipOriginalOcr || '')} → 자동 보정됨"
          style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;
                 border-radius:4px;padding:1px 5px;margin-left:2px;white-space:nowrap;flex-shrink:0;">🔧보정</span>`
      : '';
    // v3.3.29: 서류번호·거래처발주번호도 AI가 놓치거나 잘못 읽는 경우가 있어,
    // 선명과 동일하게 이 자리에서 바로 확인·수정할 수 있도록 입력창으로 변경
    // (거래처발주번호는 기존엔 미리보기에 아예 표시되지 않았음)
    const docNoMissing = !(o.docNo || '').trim();
    const poNoMissing  = !(o.poNo  || '').trim();
    const docNoInputHtml = `<input type="text" class="prev-docno" id="pdocno-${idx}"
      value="${escapeHtml(o.docNo || '')}" placeholder="서류번호 없음 — 확인 필요" enterkeyhint="done"
      onchange="updatePendingDocNo(${idx}, this.value)"
      style="border:${docNoMissing ? '1.5px solid #f97316' : '1px solid transparent'};
             border-radius:4px;padding:1px 4px;margin:-1px -4px;width:100%;box-sizing:border-box;
             background:${docNoMissing ? '#fff7ed' : 'transparent'};
             color:${docNoMissing ? '#f97316' : 'inherit'};
             font-family:inherit;font-size:inherit;
             font-style:${docNoMissing ? 'italic' : 'normal'};">`;
    const poNoInputHtml = `<input type="text" class="prev-pono" id="ppono-${idx}"
      value="${escapeHtml(o.poNo || '')}" placeholder="발주번호 없음 — 확인 필요" enterkeyhint="done"
      onchange="updatePendingPoNo(${idx}, this.value)"
      style="border:${poNoMissing ? '1.5px solid #f97316' : '1px solid transparent'};
             border-radius:4px;padding:1px 4px;margin:-1px -4px;width:100%;box-sizing:border-box;
             background:${poNoMissing ? '#fff7ed' : 'transparent'};
             color:${poNoMissing ? '#f97316' : 'inherit'};
             font-family:inherit;font-size:inherit;
             font-style:${poNoMissing ? 'italic' : 'normal'};">`;

    return `
    <div class="prev-card" id="pcard-${idx}" style="${cardStyle}">
      <div class="prev-head">
        ${shipInputHtml}${shipCorrectedTag}
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${badge(o.category)}${statusBadgeHtml}
          <button onclick="removePending(${idx})" style="background:#fee2e2;border:none;border-radius:6px;color:#dc2626;font-size:12px;font-weight:700;padding:3px 8px;cursor:pointer;flex-shrink:0;">✕ 제거</button>
        </div>
      </div>
      <div class="prev-meta">
        <div><span class="pm-label">서류번호</span>${docNoInputHtml}</div>
        <div><span class="pm-label">발주번호</span>${poNoInputHtml}</div>
        <div><span class="pm-label">발주일자</span>${escapeHtml(o.date) || '-'}</div>
        <div><span class="pm-label">납기일자</span>${escapeHtml(o.delivery) || '-'}</div>
        <div><span class="pm-label">총액</span><strong style="${totalStyle}">${fmt(o.total)}</strong></div>
        ${infoMsg}
      </div>
      <table class="prev-table">
        <thead><tr><th>품목</th><th>수량</th><th>박스</th><th>단가</th><th>금액</th></tr></thead>
        <tbody>
          ${(o.items || []).map(i => {
            const boxWarn = _boxRatioWarning(i);
            return `<tr>
            <td>${escapeHtml(i.desc) || '-'}</td>
            <td style="font-family:monospace;${(i.qty||0)<0?'color:#dc2626;':''}">${fmtQ(i)}</td>
            <td style="font-family:monospace;${(i.qty||0)<0?'color:#dc2626;':''}${boxWarn ? 'color:#c2410c;font-weight:700;background:#fff7ed;' : ''}"${boxWarn ? ` title="${escapeHtml(boxWarn)}"` : ''}>${formatBoxCount(calcItemBoxCount(i))}${boxWarn ? ' ⚠️' : ''}</td>
            <td style="font-family:monospace;">${i.price ? '\u20a9' + Number(i.price).toLocaleString() : '-'}</td>
            <td style="font-family:monospace;font-weight:700;${(i.amount||0)<0?'color:#dc2626;':''}">${i.amount ? '\u20a9' + Number(i.amount).toLocaleString() : '-'}</td>
          </tr>${boxWarn ? `<tr><td colspan="5" style="font-size:10px;color:#9a3412;background:#ffedd5;padding:5px 8px;">${escapeHtml(boxWarn)}</td></tr>` : ''}`;
          }).join('')}
          <tr class="total-row">
            <td colspan="3">TOTAL</td>
            <td colspan="2" style="${isReturnDoc?'color:#dc2626;':''}">${fmt(o.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }).join('');

  // 상태 메시지 — 선명누락 / 중복 / 반품서 건수 표시
  const shipMissingCnt = pendingOrders.filter(o => o._shipMissing).length;
  const dupCnt = pendingOrders.filter(o => _isDupOfSaved(o)).length;
  const retCnt = pendingOrders.filter(o => o.isReturn).length;
  const parts  = [];
  if (shipMissingCnt > 0) parts.push(`🚢 선명 누락 ${shipMissingCnt}건`);
  if (dupCnt > 0)         parts.push(`⚠️ 중복 ${dupCnt}건`);
  if (retCnt > 0)         parts.push(`↩️ 반품서 ${retCnt}건`);
  if (parts.length > 0) {
    setStatus(`📋 ${pendingOrders.length}건 확인 중 — ${parts.join(' · ')}. 확인 후 저장하세요.`);
  } else {
    setStatus(`✅ ${pendingOrders.length}건 분석 완료. 확인 후 저장하세요.`);
  }
}

// 미리보기 카드에서 선명을 직접 입력/수정했을 때 반영 (AI가 선명을 인식 못한 경우 등)
function updatePendingShip(idx, val) {
  if (!pendingOrders[idx]) return;
  const trimmed = String(val || '').trim();
  pendingOrders[idx].ship = trimmed;
  pendingOrders[idx]._shipMissing = !trimmed;
  renderPreview();
}

// v3.3.29: 서류번호·발주번호도 미리보기에서 바로 수정 가능 — 중복 판정(_findDupMatch)이
// 두 값 모두를 사용하므로, 값이 바뀌면 중복 배지도 다시 계산되도록 전체 재렌더링
function updatePendingDocNo(idx, val) {
  if (!pendingOrders[idx]) return;
  pendingOrders[idx].docNo = String(val || '').trim();
  renderPreview();
}

function updatePendingPoNo(idx, val) {
  if (!pendingOrders[idx]) return;
  pendingOrders[idx].poNo = String(val || '').trim();
  renderPreview();
}

function removePending(idx) {
  pendingOrders.splice(idx, 1);
  if (pendingOrders.length === 0) {
    document.getElementById('prev-section').style.display = 'none';
    setStatus('분석 결과가 없습니다. 파일을 다시 업로드해주세요.');
  } else {
    renderPreview();
    setStatus(`📋 ${pendingOrders.length}건 확인 중. 확인 후 저장하세요.`);
  }
}

function saveAll() {
  let added = 0, updated = 0, returnAdded = 0;
  pendingOrders.forEach(newOrder => {
    // 반품서: 항상 신규 추가 (기존 발주서 덮어쓰기 금지)
    if (newOrder.isReturn) {
      orders.push({ ...newOrder, updatedAt: Date.now() });
      returnAdded++;
      return;
    }
    // 일반 발주서: 미리보기 중복 판정(_findDupMatch)과 동일한 기준으로 겹치는
    // 기존 건을 찾아 업데이트, 없으면 신규 추가. 이전엔 서류번호만 보고 찾아서
    // 거래처가 서류번호를 재사용해 만든 완전히 다른(날짜가 다른) 새 발주를
    // 저장할 때 기존 건 데이터를 통째로 덮어써버릴 위험이 있었음 — 이제 미리보기와
    // 완전히 같은 로직(날짜까지 일치해야 동일 건)을 타므로 그 위험이 없음.
    const match = _findDupMatch(newOrder);
    if (match) {
      const idx  = orders.indexOf(match.order);
      const prev = orders[idx];
      // v3.3.32: 재분석 시 newOrder.items가 통째로 새 배열이라 기존 품목의 부분납품
      // 진행량(deliveredBoxes)이 사라지던 문제 수정. 품목 개수가 그대로면 같은 순서로
      // 대응된다고 보고 진행량을 이어받는다(개수가 바뀌면 안전하게 매칭할 기준이 없어
      // 이어받지 않되, 아래에서 deliveryStatus를 재계산해 모순을 방지).
      // v3.3.33: 같은 조건으로 날짜별 배송 이력(deliveryEvents)도 함께 이어받는다.
      if (prev.items && newOrder.items && prev.items.length === newOrder.items.length) {
        newOrder.items.forEach((it, i) => {
          if (prev.items[i] && prev.items[i].deliveredBoxes) it.deliveredBoxes = prev.items[i].deliveredBoxes;
        });
        if (Array.isArray(prev.deliveryEvents) && prev.deliveryEvents.length) {
          newOrder.deliveryEvents = prev.deliveryEvents.map(ev => ({ date: ev.date, perItem: { ...ev.perItem } }));
        }
      }
      orders[idx] = {
        ...newOrder,
        id:             prev.id,              // 병합해도 원래 발주의 id는 유지(재분석해도 안 바뀌게)
        deliveryStatus: prev.deliveryStatus,
        deliveryNote:   prev.deliveryNote,
        returnAmount:   prev.returnAmount,
        partialAmount:  prev.partialAmount,
        deliveredDate:  prev.deliveredDate,   // 재분석으로 납품일자가 초기화되는 것 방지
        returnedDate:   prev.returnedDate,    // 반품일자도 동일하게 보존
        cancelledDate:  prev.cancelledDate,   // 발주취소일자도 동일하게 보존
        archived:       prev.archived,        // 재분석으로 보관 상태가 풀리는 것 방지
        updatedAt:      Date.now()
      };
      // v3.3.32: 부분납품 상태였다면 재분석된 품목 기준으로 상태 재확인
      // (품목 개수가 바뀌어 진행량을 이어받지 못한 경우 등 → 미납품으로 파생될 수 있음)
      if (orders[idx].deliveryStatus === 'partial') {
        const derivedStatus = _deriveDeliveryStatusFromItems(orders[idx]);
        orders[idx].deliveryStatus = derivedStatus;
        if (derivedStatus === 'pending') {
          orders[idx].deliveredDate = '';
          _clearDeliveryEvents(orders[idx]); // v3.3.33
        }
      }
      updated++; return;
    }
    if (!orders.find(x => x.id === newOrder.id)) { orders.push({ ...newOrder, updatedAt: Date.now() }); added++; }
  });
  save();
  clearPrev();
  const msg = [
    added       ? `✅ ${added}건 신규 추가`    : '',
    updated     ? `🔄 ${updated}건 업데이트`   : '',
    returnAdded ? `↩️ ${returnAdded}건 반품 등록` : '',
  ].filter(Boolean).join(' · ');
  toast(msg || '저장 완료');
  renderAll();
  setStatus('✅ 저장 완료. 다음 발주서를 등록해주세요.');
}

function clearPrev() {
  pendingOrders = [];
  document.getElementById('prev-section').style.display = 'none';
  document.getElementById('progWrap').style.display     = 'none';
  setStatus('');
  const input = document.getElementById('fileInput');
  if (input) input.value = '';  // 같은 파일 재선택 가능하도록 초기화
}

function setProgress(p) { document.getElementById('progBar').style.width = p + '%'; }
function setStatus(m)   { document.getElementById('upStatus').textContent = m; }
