// ══════════════════════════════════════════════════════
// gemini.js  —  Google AI Studio 직접 호출 유틸
// ══════════════════════════════════════════════════════

// v3.3.70: 기존 세 모델이 전부 서비스 종료됨 — gemini-1.5-flash·gemini-2.0-flash는 이미 완전
// 종료, gemini-2.5-flash는 2026-10-16 종료 예정이라 다시 걸리기 전에 Gemini 3 계열로 교체.
// (2.5-flash를 폴백에도 넣지 않은 이유: 넣어봤자 10월 중순부터는 어차피 죽는 모델이라 의미 없음)
const GEMINI_MODEL    = 'gemini-3.5-flash';        // 주 모델 — 2.5-flash 후속 격인 가성비 모델 (Stable)
const GEMINI_MODEL_F2 = 'gemini-3.6-flash';        // 1차 폴백 — 상위 세대, 멀티모달 추론 강화 (Stable)
const GEMINI_MODEL_FB = 'gemini-3.5-flash-lite';   // 최종 폴백 — 가장 가볍고 저렴 (Stable)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Gemini API 직접 호출 (이미지+텍스트 멀티모달) ──
// v3.3.86: 시도별 모델·상태·소요시간 기록 — 인식이 느릴 때 원인(대기/재시도/응답지연)을 분리해서 보기 위함
function _gemLogPush(model, status, t0) {
  const ms = Math.round(performance.now() - t0);
  if (Array.isArray(window._gemLog)) window._gemLog.push({ model, status, ms });
  AppLog.add('api_end', { model, status, ms });
}
// v3.3.95: 재시도/폴백해도 결과가 같은 오류(잘못된 요청·키 오류·이미지 초과)는 fatal 표시 —
// 동시(헤지) 요청이 이런 오류에서 불필요하게 두 번째 모델을 또 호출하지 않도록 한다.
function _gemFatal(msg) { const e = new Error(msg); e.fatal = true; return e; }
// v3.3.95: 모델이 thinkingConfig(thinkingLevel)를 지원하지 않아 400을 돌려주면 그 모델은 이후 생각 설정 없이 호출
const _gemNoThinking = new Set();
async function callGemini(parts, maxTokens = 2000, model = GEMINI_MODEL, _retry = 0, _keyRetry = 0, _signal = null) {
  if (_signal && _signal.aborted) throw new Error('HEDGE_ABORTED');   // v3.3.90: 동시 요청에서 상대가 먼저 끝난 경우
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('API_KEY_MISSING');

  // 이미지 파트 크기 검증 (4MB base64 ≈ 3MB 실제)
  for (const p of parts) {
    if (p.inline_data && p.inline_data.data.length > 5_000_000) {
      throw _gemFatal('이미지 크기 초과 (5MB 이하로 줄여주세요)');
    }
  }

  // v3.3.71: Gemini 3.x는 기본 생각(thinking) 단계가 medium이라 코딩·에이전트급으로 오래
  // 생각한 뒤 답함 — 단순 이미지 판독·매칭엔 과함(체감 지연의 주 원인). low로 낮춰 필요한
  // 만큼만 생각하게 함(정확도 때문에 완전히 끄는 minimal은 사용 안 함). temperature 등
  // 구세대 샘플링 파라미터는 Gemini 3 계열에서 권장하지 않아 제거.
  const body = {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' }
  };
  if (!_gemNoThinking.has(model)) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('인터넷에 연결되어 있지 않습니다.');
  let resp;
  const _t0 = performance.now();
  const bodyStr = JSON.stringify(body);
  AppLog.add('api_start', { model, key: _keyIndex + 1, retry: _retry, keyRetry: _keyRetry, reqKB: Math.round(bodyStr.length / 1024), maxTokens, parts: parts.length });
  // 응답이 오래 걸릴 때 앱이 멈추거나 종료돼도 "몇 초째 기다리는 중이었는지" 남도록 10초마다 기록
  const hb = setInterval(() => AppLog.add('api_wait', { model, sec: Math.round((performance.now() - _t0) / 1000) }), 10000);
  try {
    const controller = new AbortController();
    if (_signal) _signal.addEventListener('abort', () => controller.abort(), { once: true });
    const timeout = setTimeout(() => controller.abort(), 40000); // 40초 타임아웃
    // v3.3.95: API 키를 URL 쿼리(?key=) 대신 헤더로 전달 — 주소창·확장 프로그램·프록시/브라우저 로그·리퍼러에 키가 남지 않게 함
    resp = await fetch(
      `${GEMINI_API_BASE}/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: bodyStr, signal: controller.signal }
    );
    clearTimeout(timeout);
    clearInterval(hb);
  } catch (networkErr) {
    clearInterval(hb);
    if (_signal && _signal.aborted) throw new Error('HEDGE_ABORTED');
    AppLog.add('api_net', { model, name: networkErr.name, msg: String(networkErr.message || '').slice(0, 120), online: navigator.onLine });
    // Failed to fetch / 타임아웃 / 네트워크 오류 → 다음 키로 교체 후 재시도
    const isTimeout = networkErr.name === 'AbortError';
    _gemLogPush(model, isTimeout ? '타임아웃' : '네트워크', _t0);
    console.warn(`[Gemini] ${isTimeout ? '타임아웃(40초)' : '네트워크 오류'}: ${networkErr.message}`);
    // v3.3.86: 타임아웃은 서버가 느린 것이라 키를 바꿔도 같은 증상이 반복되므로(키마다 50초씩 더 대기) 바로 다음 모델로 전환
    if (isTimeout) {
      if (model === GEMINI_MODEL)    return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0, _signal);
      if (model === GEMINI_MODEL_F2) return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, _signal);
      throw new Error('AI 응답 시간 초과 — 서버가 느립니다. 잠시 후 다시 시도해주세요.');
    }
    const keys = getGeminiKeys();
    if (_keyRetry < keys.length - 1) {
      rotateGeminiKey();
      console.warn(`[Gemini] 키 ${_keyRetry + 2}로 교체 후 재시도`);
      await new Promise(r => setTimeout(r, 2000));
      return callGemini(parts, maxTokens, model, _retry, _keyRetry + 1, _signal);
    }
    // 모든 키 순환 완료 → 6초 대기 후 키1로 재시도
    if (_retry < 1) {
      _keyIndex = 0;
      console.warn('[Gemini] 모든 키 순환 완료 → 6초 대기 후 키1로 재시도');
      await new Promise(r => setTimeout(r, 6000));
      return callGemini(parts, maxTokens, model, _retry + 1, 0, _signal);
    }
    // 모델 폴백
    if (model === GEMINI_MODEL)    return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0, _signal);
    if (model === GEMINI_MODEL_F2) return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, _signal);
    throw new Error('네트워크 오류 — 인터넷 연결을 확인하거나 잠시 후 다시 시도해주세요.');
  }

  _gemLogPush(model, resp.status, _t0);
  // 429(한도초과) / 503(과부하) → 다음 키로 교체 후 재시도
  if ([429, 500, 502, 503, 504].includes(resp.status)) {
    const keys = getGeminiKeys();
    { const _eb = await resp.clone().json().catch(() => null);   // 429는 어떤 한도(분당/일일/프로젝트)에 걸렸는지 메시지에 나옴
      AppLog.add('api_retry', { model, status: resp.status, retry: _retry, keyRetry: _keyRetry, msg: String((_eb && _eb.error && _eb.error.message) || '').slice(0, 240) }); }
    // v3.3.86: 5xx(서버 과부하·오류)는 키 문제가 아니라 모델 쪽 문제 — 키를 돌려도 같은 결과라 같은 모델로 1회만 재시도하고 바로 다음 모델로 전환
    if (resp.status !== 429) {
      if (_retry < 1) {
        console.warn(`[Gemini] ${resp.status} → 2초 후 같은 모델로 1회 재시도`);
        await new Promise(r => setTimeout(r, 2000));
        return callGemini(parts, maxTokens, model, _retry + 1, _keyRetry, _signal);
      }
      if (model === GEMINI_MODEL)    return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0, _signal);
      if (model === GEMINI_MODEL_F2) return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, _signal);
    }
    if (resp.status === 429 && _keyRetry < keys.length - 1) {
      rotateGeminiKey();
      console.warn(`[Gemini] ${resp.status} → 키 ${_keyIndex + 1}로 교체 후 재시도 (${_keyRetry + 1}회)`);
      await new Promise(r => setTimeout(r, resp.status === 429 ? 300 : 2000));  // 429는 즉시 응답하는 한도 오류라 길게 기다릴 필요 없음
      return callGemini(parts, maxTokens, model, _retry, _keyRetry + 1, _signal);
    }
    // v3.3.86: 모든 키가 429면 한도는 모델별로 따로 관리되므로 6초·12초 기다리지 말고 바로 다음 모델로
    if (resp.status === 429 && model !== GEMINI_MODEL_FB) {
      const next = model === GEMINI_MODEL ? GEMINI_MODEL_F2 : GEMINI_MODEL_FB;
      console.warn(`[Gemini] 모든 키 429 → 대기 없이 ${next}로 즉시 전환`);
      return callGemini(parts, maxTokens, next, 0, 0, _signal);
    }
    // 모든 키 소진 → 키1로 재시도.
    // 429(분당 한도초과)는 한도 리셋을 기다려야 하므로 6초/12초로 느리게,
    // 503(서버 과부하)은 키 문제가 아니라 일시적 과부하이므로 2초/4초로 빠르게 재시도한다.
    if (_retry < 2) {
      _keyIndex = 0;
      const delay = resp.status === 429 ? (2 ** _retry) * 6000 : (2 ** _retry) * 2000;
      console.warn(`[Gemini] 모든 키 ${resp.status} → ${delay/1000}초 대기 후 키1로 재시도 (${_retry + 1}/2)`);
      await new Promise(r => setTimeout(r, delay));
      return callGemini(parts, maxTokens, model, _retry + 1, 0, _signal);
    }
    // v3.3.73: [버그 수정] 재시도까지 다 썼는데도 429/503이면, 예전엔 여기서 바로 아래 공통
    // 오류 처리로 빠져 폴백 없이 실패 처리됐음 — 404 때와 똑같이 다음 모델로 넘어가야 함.
    // (한도는 모델별로 따로 관리되므로, 주 모델 한도가 찼어도 폴백 모델은 남아있을 수 있음)
    if (model === GEMINI_MODEL) {
      console.warn(`[Gemini] 주 모델 ${resp.status} 소진, 폴백1로 교체`);
      return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0, _signal);
    }
    if (model === GEMINI_MODEL_F2) {
      console.warn(`[Gemini] 폴백1 ${resp.status} 소진, 폴백2로 교체`);
      return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, _signal);
    }
    // 최종 폴백 모델까지 소진 → 아래 공통 오류 처리로 진행해 안내 메시지 표시
  }

  // 모델 오류(404/deprecated) → 단계적 모델 폴백
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const errMsg  = errBody?.error?.message || '';
    AppLog.add('api_error', { model, status: resp.status, msg: errMsg.slice(0, 240) });
    // v3.3.95: 400 중 "이 모델은 thinkingLevel을 지원하지 않음"이면 생각 설정만 빼고 같은 모델로 재시도
    if (resp.status === 400 && /thinking/i.test(errMsg) && !_gemNoThinking.has(model)) {
      _gemNoThinking.add(model);
      console.warn(`[Gemini] ${model}: thinkingConfig 미지원 → 생각 설정 없이 재시도:`, errMsg);
      return callGemini(parts, maxTokens, model, _retry, _keyRetry, _signal);
    }
    // v3.3.95: 키 자체가 잘못된 경우(400 'API key not valid' / 401 / 403)는 다른 키가 있으면 교체해서 재시도
    const _badKey = (resp.status === 400 && /api key not valid|api_key_invalid/i.test(errMsg)) || resp.status === 401 || resp.status === 403;
    if (_badKey) {
      const keys = getGeminiKeys();
      if (_keyRetry < keys.length - 1) {
        rotateGeminiKey();
        console.warn(`[Gemini] 키 오류(${resp.status}) → 키 ${_keyIndex + 1}로 교체 후 재시도`);
        return callGemini(parts, maxTokens, model, _retry, _keyRetry + 1, _signal);
      }
    }
    // v3.3.95: 예전엔 메시지에 'not found'만 들어 있어도 모델 오류로 간주해 폴백했다(예: 'Requested entity was not found'류
    // 다른 오류까지 포함). 상태 404 이거나 모델·지원 여부를 직접 가리키는 메시지일 때만 폴백한다.
    const isFallbackable = resp.status === 404
      || /models?\/[^\s]+ (?:is )?not found|model[^.]{0,60}not found|not supported for generateContent|deprecated/i.test(errMsg);

    if (isFallbackable && model === GEMINI_MODEL) {
      console.warn('[Gemini] 주 모델 실패, 폴백1로 교체:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0, _signal);
    }
    if (isFallbackable && model === GEMINI_MODEL_F2) {
      console.warn('[Gemini] 폴백1 실패, 폴백2로 교체:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, _signal);
    }

    if (_badKey) throw _gemFatal('API 키가 올바르지 않습니다. 설정에서 확인해주세요.');   // v3.3.95: 400 'API key not valid'도 동일 안내
    const msg = errBody?.error?.message || resp.statusText;
    // v3.3.70: 최종 폴백 모델까지 404/not found면 Google이 모델을 또 교체했을 가능성이 큼 —
    // 원본 오류를 감추지 않되, 원인을 바로 알 수 있게 안내를 덧붙인다.
    if (isFallbackable) throw new Error(`AI 모델을 찾을 수 없습니다 — Google이 모델을 변경했을 수 있어요, js/gemini.js의 모델명 확인 필요. (${msg})`);
    if (resp.status === 400) throw _gemFatal('요청 오류: ' + msg);
    if (resp.status === 401 || resp.status === 403) throw _gemFatal('API 키가 올바르지 않습니다. 설정에서 확인해주세요.');
    if (resp.status === 429) throw new Error('모든 키 한도 초과. 잠시 후 다시 시도하세요.');
    if (resp.status === 503) throw new Error('Gemini 서버 혼잡. 잠시 후 다시 시도해주세요.');
    throw new Error(`[${resp.status}] ${msg}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'Gemini 오류');

  // 안전 차단 감지
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') throw new Error('이미지가 안전 필터에 차단되었습니다.');
  if (candidate?.finishReason === 'RECITATION') throw new Error('응답 생성 실패 (RECITATION). 다시 시도해주세요.');

  window._geminiLastFinish = candidate?.finishReason || '';  // v3.3.68: 응답 잘림(MAX_TOKENS) 감지용
  // v3.3.72: parts[0]만 읽으면 Gemini 3.x처럼 응답이 여러 파트(생각 요약·서명 파트 등)로
  // 나뉠 때 빈 문자열이 될 수 있어, thought가 아닌 텍스트 파트를 모두 이어 붙인다.
  const respParts = candidate?.content?.parts || [];
  const text = respParts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  { const u = data.usageMetadata || {};   // thoughts = 생각(thinking) 토큰 — 많으면 그만큼 응답이 느려짐
    AppLog.add('api_ok', { model, finish: candidate?.finishReason, promptTok: u.promptTokenCount, outTok: u.candidatesTokenCount, thoughtTok: u.thoughtsTokenCount, totalTok: u.totalTokenCount, textLen: text.length, respParts: respParts.length }); }
  if (!text) {
    const block = data?.promptFeedback?.blockReason;
    const fr = candidate?.finishReason;
    if (block) throw new Error(`AI 요청이 차단되었습니다 (${block}).`);
    if (fr === 'MAX_TOKENS') throw new Error('AI 응답이 비어 있습니다 — 출력 한도(MAX_TOKENS)에서 잘렸습니다. 다시 시도해주세요.');
    throw new Error(`AI 응답 없음 (종료사유: ${fr || '없음'}) — 이미지 형식을 확인하거나 다시 시도해주세요.`);
  }
  return text;
}

// ── 텍스트 파트 ──
function textPart(text) {
  return { text };
}

// ── 이미지 파트 (base64 dataURL) ──
function imagePart(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  const mimeType = meta.split(':')[1].split(';')[0];
  return { inline_data: { mime_type: mimeType, data } };
}

// ── API 키 관리 (최대 4개 자동 교체) ──
const KEY_STORE = ['geminiApiKey1','geminiApiKey2','geminiApiKey3','geminiApiKey4'];
let _keyIndex = 0; // 현재 사용 중인 키 인덱스

function getGeminiKeys() {
  return KEY_STORE.map(k => localStorage.getItem(k) || '').filter(k => k);
}

function getGeminiKey() {
  const keys = getGeminiKeys();
  if (!keys.length) return '';
  return keys[_keyIndex % keys.length];
}

function rotateGeminiKey() {
  const keys = getGeminiKeys();
  if (keys.length <= 1) return false;
  _keyIndex = (_keyIndex + 1) % keys.length;
  console.warn(`[Gemini] 키 교체 → 키 ${_keyIndex + 1} 사용 중`);
  return true;
}

function saveGeminiKeys() {
  const vals = [1,2,3,4].map(i => (document.getElementById(`geminiKey${i}`)?.value || '').trim());
  const saved = vals.filter(Boolean).length;
  if (!saved) { toast('⚠️ 키를 1개 이상 입력해주세요 (기존 키는 유지됩니다)'); return; }
  vals.forEach((v, k) => { if (v) localStorage.setItem(`geminiApiKey${k + 1}`, v); else localStorage.removeItem(`geminiApiKey${k + 1}`); });
  _keyIndex = 0;
  toast(`✅ API 키 ${saved}개 저장 완료`);
}

function loadGeminiKeys() {
  [1,2,3,4].forEach(i => {
    const k = localStorage.getItem(`geminiApiKey${i}`) || '';
    const el = document.getElementById(`geminiKey${i}`);
    if (el && k) el.value = k;
  });
}

function toggleKeyVis(i) {
  const el = document.getElementById(`geminiKey${i}`);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

function resetGeminiKeys() {
  if (!confirm('API 키를 모두 삭제할까요?')) return;
  KEY_STORE.forEach(k => localStorage.removeItem(k));
  [1,2,3,4].forEach(i => {
    const el = document.getElementById(`geminiKey${i}`);
    if (el) { el.value = ''; el.type = 'password'; }
  });
  _keyIndex = 0;
  toast('🗑️ API 키 초기화 완료');
}

// 구버전 단일 키 마이그레이션
function migrateOldKey() {
  const old = localStorage.getItem('geminiApiKey');
  if (old && !localStorage.getItem('geminiApiKey1')) {
    localStorage.setItem('geminiApiKey1', old);
    localStorage.removeItem('geminiApiKey');
    console.log('[migration] 기존 키 → 키1로 이동');
  }
}

// ══════════════════════════════════════════════════════
// v3.3.90: 동시(헤지) 요청 — 주 모델이 GEMINI_HEDGE_MS 안에 응답하지 않으면 경량 모델에 같은 요청을 동시에 보내
// 먼저 오는 쪽을 사용하고 나머지는 취소한다. (주 모델이 과부하로 40~50초씩 멈추는 구간에서 대기시간을 크게 줄임)
// ══════════════════════════════════════════════════════
const GEMINI_HEDGE_MS = 5000;   // v3.3.92: 8→5초 (주 모델이 정상일 때 응답이 2.4~3.9초였고, 느린 시간대엔 17~50초 — 로그 기준)
// v3.3.94: 작업 종류별 설정. 납품 리스트 매칭은 이미지가 크고 출력도 길어 정상 응답도 5초를 넘기 쉽고,
// 경량 모델이 먼저 이기면 잘못된 발주 id를 돌려주는 일이 반복돼(v3.3.91~92) 대기를 길게 잡고 "즉시 동시 모드"는 쓰지 않는다.
// 발주서 인식(doc)과 납품 리스트(del)는 연속 패배 기록도 따로 관리해 서로의 모드를 바꾸지 않게 한다.
const GEMINI_HEDGE_KINDS = {
  doc: { delayMs: GEMINI_HEDGE_MS, immediate: true,  stateKey: 'baljuGemHedge_v1' },
  del: { delayMs: 15000,           immediate: false, stateKey: 'baljuGemHedge_del_v1' }
};
function _gemHedgeCfg(kind) { return GEMINI_HEDGE_KINDS[kind] || GEMINI_HEDGE_KINDS.doc; }
// 최근 동시 요청에서 주 모델이 연속 2번 졌다면 느린 시간대로 보고, 10분 동안은 기다리지 않고 처음부터 둘 다 보낸다(10분 뒤 다시 확인)
function _gemHedgeState(cfg) { try { return JSON.parse(localStorage.getItem(cfg.stateKey) || '{}') || {}; } catch (e) { return {}; } }
function _gemHedgeDelay(cfg) { cfg = cfg || _gemHedgeCfg('doc'); if (!cfg.immediate) return cfg.delayMs; const s = _gemHedgeState(cfg); return (s.until && Date.now() < s.until) ? 0 : cfg.delayMs; }
function _gemHedgeNote(primaryLost, cfg) {
  cfg = cfg || _gemHedgeCfg('doc');
  if (!cfg.immediate) return;   // 즉시 동시 모드를 쓰지 않는 작업은 기록할 상태가 없음
  const s = _gemHedgeState(cfg);
  if (s.until && Date.now() >= s.until) { s.until = 0; s.streak = 0; }
  if (s.until) return;   // 즉시 동시 모드 중에는 상태 유지
  s.streak = primaryLost ? (s.streak || 0) + 1 : 0;
  if (s.streak >= 2) { s.until = Date.now() + 10 * 60000; s.streak = 0; }
  try { localStorage.setItem(cfg.stateKey, JSON.stringify(s)); } catch (e) {}
}
// opts.kind: 'doc'(기본, 발주서 인식) | 'del'(납품 리스트 매칭). opts.delayMs는 테스트용 덮어쓰기.
function callGeminiHedged(parts, maxTokens = 2000, opts = {}) {
  const cfg = _gemHedgeCfg(opts.kind);
  const cA = new AbortController(), cB = new AbortController();
  const _hDelay = (typeof opts.delayMs === 'number' && cfg.immediate === false) ? opts.delayMs : _gemHedgeDelay(cfg);
  return new Promise((resolve, reject) => {
    let settled = false, running = 1, started = false, lastErr = null, timer = null, aFailed = false;
    const win = (who, text) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      (who === 'A' ? cB : cA).abort();
      const model = who === 'A' ? GEMINI_MODEL : GEMINI_MODEL_FB;
      window._gemWinner = model + (started ? ' (동시 요청)' : '');
      AppLog.add('hedge_win', { kind: opts.kind || 'doc', who, model, hedged: started, aFailed });
      // v3.3.94: 주 모델이 "에러로 실패"해서 B가 이긴 경우는 느림이 아니므로 연속 패배로 세지 않는다
      // (429 한도 상황에서 즉시 동시 모드가 켜져 호출량이 두 배가 되는 것을 막음)
      if (!aFailed) _gemHedgeNote(who === 'B' && started, cfg);
      resolve(text);
    };
    const lose = (who, e) => {
      if (settled) return;
      running--; lastErr = e;
      if (who === 'A') aFailed = true;
      if (e && (e.message === 'API_KEY_MISSING' || e.fatal)) { settled = true; clearTimeout(timer); cA.abort(); cB.abort(); return reject(e); }
      if (who === 'A' && !started) { clearTimeout(timer); startB(); return; }   // 주 모델이 먼저 실패하면 기다리지 않고 바로 경량 모델 시도
      if (running <= 0) { settled = true; reject(lastErr); }
    };
    const startB = () => {
      if (started || settled) return;
      started = true; running++;
      AppLog.add('hedge_start', { kind: opts.kind || 'doc', afterMs: _hDelay, mode: _hDelay === 0 ? '즉시(최근 주 모델 지연)' : (aFailed ? '주 모델 실패 후' : '대기 후'), model: GEMINI_MODEL_FB });
      callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0, cB.signal).then(t => win('B', t), e => lose('B', e));
    };
    callGemini(parts, maxTokens, GEMINI_MODEL, 0, 0, cA.signal).then(t => win('A', t), e => lose('A', e));
    if (_hDelay === 0) startB(); else timer = setTimeout(startB, _hDelay);
  });
}
