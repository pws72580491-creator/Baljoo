// ══════════════════════════════════════════════════════
// delivery.js  —  납품 리스트 사진 AI 자동 매칭
// ══════════════════════════════════════════════════════

function onDragDelivery(e, on) {
  e.preventDefault();
  document.getElementById('deliveryZone').classList.toggle('drag', on);
}
function onDropDelivery(e) {
  e.preventDefault();
  document.getElementById('deliveryZone').classList.remove('drag');
  handleDeliveryFiles(e.dataTransfer.files);
}

function setDelStatus(m)   { document.getElementById('delStatus').textContent = m; }
function setDelProgress(p) { document.getElementById('delProgBar').style.width = p + '%'; }

async function handleDeliveryFiles(files) {
  if (!files.length) return;
  if (!getGeminiKey()) { toast('⚠️ API 키를 먼저 입력해주세요'); return; }
  if (!orders.length)  { toast('⚠️ 등록된 발주 내역이 없습니다'); return; }

  document.getElementById('delProgWrap').style.display        = 'block';
  document.getElementById('del-result-section').style.display = 'none';
  setDelStatus('납품 리스트 분석 중...');
  setDelProgress(20);

  try {
    const parts = [];
    for (const f of files) {
      if (f.type === 'application/pdf') {
        const pages = await pdfToImages(f);
        pages.forEach(dataUrl => parts.push(imagePart(dataUrl)));
      } else {
        // 리사이즈 적용
        const dataUrl = await resizeImage(f, IMAGE_MAX_PX, IMAGE_QUALITY);
        parts.push(imagePart(dataUrl));
      }
    }
    setDelProgress(50);

    const orderSummary = orders
      .filter(o => o.deliveryStatus !== 'delivered')  // 미납품만 포함 (토큰 절약)
      .slice(0, 30)                                    // 최대 30건
      .map(o => ({
      id: o.id, ship: o.ship, docNo: o.docNo || '', poNo: o.poNo || '',
      date: o.date, total: o.total || 0, status: o.deliveryStatus || 'pending',
      items: (o.items || []).map(i => i.desc).join(', ')
    }));

    const prompt = `다음은 납품 확인서 또는 납품 리스트 이미지입니다.

⚠️ 중요: 반드시 **"이른아침"** 업체(공급자) 항목만 추출하세요.
"이른아침"이 공급자/납품처/발행처로 표기된 행 또는 섹션만 대상입니다.
다른 업체 항목은 무시하세요.

발주 목록 (JSON):
${JSON.stringify(orderSummary, null, 2)}

이미지에서 이른아침 항목의 선명, 서류번호, 발주번호, 날짜, 품목명을 추출하고
위 발주 목록에서 일치하는 항목의 id를 찾아주세요.

응답은 반드시 아래 JSON만, 코드블록 없이:
{"matched":[{"id":"발주ID","ship":"선명","reason":"매칭근거"}],"unmatched":["이른아침 항목이지만 미매칭"],"skipped_other_vendors":true,"summary":"이른아침 납품 요약 1-2줄"}

이른아침 항목 없으면 matched 빈 배열, summary에 '이른아침 항목 없음'.`;

    parts.unshift(textPart(prompt));
    setDelProgress(70);

    let txt = await callGemini(parts, 2000);

    // 1단계: 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // 2단계: { } 범위만 추출
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);

    console.log('[delivery] Gemini 원본 응답:', txt); // 디버그용

    let result;
    try {
      result = JSON.parse(txt);
    } catch (parseErr) {
      console.warn('[delivery] JSON 파싱 실패:', parseErr.message, '\n원본:', txt);
      // 파싱 실패 시 summary만 표시
      result = { matched: [], unmatched: [], skipped_other_vendors: false, summary: `AI 응답 파싱 오류 — 다시 시도해주세요. (${parseErr.message})` };
    }

    setDelProgress(90);
    renderDeliveryResult(result);
    setDelProgress(100);
    setDelStatus(`✅ 분석 완료 — ${result.matched?.length || 0}건 매칭됨`);

  } catch(err) {
    console.error('[delivery] 오류:', err);
    const msg = err.message === 'API_KEY_MISSING' ? '⚠️ API 키를 먼저 입력해주세요.' : '❌ ' + (err.message || '분석 실패');
    setDelStatus(msg);
    setDelProgress(0);
    document.getElementById('delProgWrap').style.display = 'none';
  }
}

function renderDeliveryResult(result) {
  const matched   = result.matched   || [];
  const unmatched = result.unmatched || [];
  const sec       = document.getElementById('del-result-section');
  sec.style.display = 'block';

  const matchedOrders = matched.map(m => {
    const order = orders.find(o => o.id === m.id);
    return order ? { ...m, order } : null;
  }).filter(Boolean);

  sec.innerHTML = `
    ${result.summary ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;padding:8px 10px;background:var(--bg);border-radius:8px;">📋 ${result.summary}</div>` : ''}
    ${matchedOrders.length ? `
      <div class="sdiv" style="margin-top:0;">이른아침 매칭된 발주 (${matchedOrders.length}건)</div>
      ${matchedOrders.map(m => `
        <div class="prev-card" style="border-left:3px solid var(--success);">
          <div class="prev-head" style="gap:6px;">
            <div style="flex:1;">
              <div class="prev-ship" style="font-size:13px;">${m.order.ship}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:2px;">${m.reason}</div>
            </div>
            <span class="badge" style="background:#dcfce7;color:#15803d;">${m.order.deliveryStatus === 'delivered' ? '✅ 이미 납품완료' : '미납품'}</span>
          </div>
          <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:12px;color:var(--muted);">${m.order.docNo || '-'} · ${m.order.date} · ${fmt(m.order.total)}</div>
            ${m.order.deliveryStatus !== 'delivered' ? `
              <button class="btn btn-success btn-sm" onclick="confirmDeliveryFromPhoto('${m.order.id}')">✅ 납품완료 처리</button>
            ` : `<span style="font-size:11px;color:var(--success);font-weight:700;">납품완료</span>`}
          </div>
        </div>
      `).join('')}
      ${matchedOrders.some(m => m.order.deliveryStatus !== 'delivered') ? `
        <button class="btn btn-success btn-block" style="margin-top:4px;"
          onclick="confirmAllDelivery(${JSON.stringify(matched.map(m => m.id))})">
          ✅ 매칭된 전체 납품완료 처리
        </button>
      ` : ''}
    ` : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px 0;">이른아침 항목이 없거나 발주 목록과 일치하는 항목을 찾지 못했습니다</div>'}
    ${result.skipped_other_vendors ? `<div style="font-size:11px;color:var(--muted);padding:4px 0;">ℹ️ 타 업체 항목은 자동으로 제외되었습니다</div>` : ''}
    ${unmatched.length ? `
      <div class="sdiv">목록 미매칭 항목</div>
      ${unmatched.map(u => `<div style="font-size:12px;color:var(--muted);padding:4px 0;">• ${u}</div>`).join('')}
    ` : ''}
  `;
}

function confirmDeliveryFromPhoto(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  o.deliveryStatus = 'delivered';
  o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
  save(); renderAll();
  document.querySelectorAll(`button[onclick="confirmDeliveryFromPhoto('${id}')"]`).forEach(btn => {
    btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
  });
  toast(`✅ ${o.ship} 납품완료 처리됨`);
}

function confirmAllDelivery(ids) {
  let cnt = 0;
  ids.forEach(id => {
    const o = orders.find(x => x.id === id);
    if (o && o.deliveryStatus !== 'delivered') {
      o.deliveryStatus = 'delivered';
      o.deliveryNote   = (o.deliveryNote ? o.deliveryNote + ' ' : '') + '[납품사진 자동확인]';
      cnt++;
    }
  });
  save(); renderAll();
  document.getElementById('del-result-section')?.querySelectorAll('.btn-success').forEach(btn => {
    btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
  });
  toast(`✅ ${cnt}건 납품완료 처리됨`);
}
