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

// ── 납품 사진 처리 진입점 ──
async function handleDeliveryFiles(files) {
  if (!files.length) return;
  const apiKey = (document.getElementById('geminiKey').value || '').trim();
  if (!apiKey)        { toast('⚠️ OpenRouter API Key를 먼저 입력해주세요'); return; }
  if (!orders.length) { toast('⚠️ 등록된 발주 내역이 없습니다'); return; }

  document.getElementById('delProgWrap').style.display     = 'block';
  document.getElementById('del-result-section').style.display = 'none';
  setDelStatus('납품 리스트 분석 중...');
  setDelProgress(20);

  try {
    // 파일 → 이미지 콘텐츠 변환
    const imageContents = [];
    for (const f of files) {
      if (f.type === 'application/pdf') {
        const pages = await pdfToImages(f);
        pages.forEach(dataUrl => { imageContents.push({ type: 'image_url', image_url: { url: dataUrl } }); });
      } else {
        const b64 = await toB64(f);
        imageContents.push({ type: 'image_url', image_url: { url: `data:${f.type || 'image/jpeg'};base64,${b64}` } });
      }
    }
    setDelProgress(50);

    // 발주 목록 요약 (AI 매칭용)
    const orderSummary = orders.map(o => ({
      id:     o.id,
      ship:   o.ship,
      docNo:  o.docNo  || '',
      poNo:   o.poNo   || '',
      date:   o.date,
      total:  o.total  || 0,
      status: o.deliveryStatus || 'pending',
      items:  (o.items || []).map(i => i.desc).join(', ')
    }));

    const prompt = `다음은 납품 확인서 또는 납품 리스트 이미지입니다.
아래 발주 목록과 매칭하여 납품된 항목을 찾아주세요.

발주 목록 (JSON):
${JSON.stringify(orderSummary, null, 2)}

이미지에서 납품된 선명(선박명), 서류번호, 발주번호, 날짜, 품목명 등을 추출하고
위 발주 목록에서 일치하는 항목의 id를 찾아주세요.

응답은 반드시 아래 JSON 형식으로만, 코드블록 없이 순수 JSON만 출력:
{
  "matched": [
    {"id":"발주ID", "ship":"선명", "reason":"매칭근거(서류번호/선명/품목 등)"}
  ],
  "unmatched": ["발주목록에 없는 납품 항목 설명"],
  "summary": "납품 리스트 전체 요약 1-2줄"
}

매칭이 전혀 없으면 matched는 빈 배열로.`;

    const content = [{ type: 'text', text: prompt }, ...imageContents];
    setDelProgress(70);

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content }], temperature: 0, max_tokens: 2000 })
    });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(`[${resp.status}] ${err?.error?.message || resp.statusText}`); }
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'API 오류');

    let txt = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) txt = txt.slice(s, e + 1);
    const result = JSON.parse(txt);

    setDelProgress(90);
    renderDeliveryResult(result);
    setDelProgress(100);
    setDelStatus(`✅ 분석 완료 — ${result.matched?.length || 0}건 매칭됨`);

  } catch(err) {
    console.error('[delivery] 납품 분석 오류:', err);
    setDelStatus('❌ ' + (err.message || '분석 실패'));
    setDelProgress(0);
    document.getElementById('delProgWrap').style.display = 'none';
  }
}

// ── 매칭 결과 렌더 ──
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
      <div class="sdiv" style="margin-top:0;">매칭된 발주 (${matchedOrders.length}건)</div>
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
    ` : '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px 0;">발주 목록에서 일치하는 항목을 찾지 못했습니다</div>'}
    ${unmatched.length ? `
      <div class="sdiv">목록 미매칭 항목</div>
      ${unmatched.map(u => `<div style="font-size:12px;color:var(--muted);padding:4px 0;">• ${u}</div>`).join('')}
    ` : ''}
  `;
}

// ── 개별 납품완료 처리 ──
function confirmDeliveryFromPhoto(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  o.deliveryStatus = 'delivered';
  o.deliveryNote   = (o.deliveryNote || '') + (o.deliveryNote ? ' ' : '') + '[납품사진 자동확인]';
  save();
  renderAll();
  document.querySelectorAll(`button[onclick="confirmDeliveryFromPhoto('${id}')"]`).forEach(btn => {
    btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
  });
  toast(`✅ ${o.ship} 납품완료 처리됨`);
}

// ── 전체 일괄 납품완료 처리 ──
function confirmAllDelivery(ids) {
  let cnt = 0;
  ids.forEach(id => {
    const o = orders.find(x => x.id === id);
    if (o && o.deliveryStatus !== 'delivered') {
      o.deliveryStatus = 'delivered';
      o.deliveryNote   = (o.deliveryNote || '') + (o.deliveryNote ? ' ' : '') + '[납품사진 자동확인]';
      cnt++;
    }
  });
  save();
  renderAll();
  const sec = document.getElementById('del-result-section');
  if (sec) {
    sec.querySelectorAll('.btn-success').forEach(btn => {
      btn.textContent = '✅ 납품완료'; btn.disabled = true; btn.style.opacity = '0.6';
    });
  }
  toast(`✅ ${cnt}건 납품완료 처리됨`);
}
