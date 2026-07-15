// ══════════════════════════════════════════════════════
// gemini.js  —  Google AI Studio 직접 호출 유틸
// ══════════════════════════════════════════════════════

const GEMINI_MODEL    = 'gemini-2.5-flash';        // 주 모델 (현재 최신 GA)
const GEMINI_MODEL_F2 = 'gemini-2.0-flash';        // 1차 폴백
const GEMINI_MODEL_FB = 'gemini-1.5-flash';        // 최종 폴백 (가장 안정적·저비용)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Gemini API 직접 호출 (이미지+텍스트 멀티모달) ──
async function callGemini(parts, maxTokens = 2000, model = GEMINI_MODEL, _retry = 0, _keyRetry = 0) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('API_KEY_MISSING');

  // 이미지 파트 크기 검증 (4MB base64 ≈ 3MB 실제)
  for (const p of parts) {
    if (p.inline_data && p.inline_data.data.length > 5_000_000) {
      throw new Error('이미지 크기 초과 (5MB 이하로 줄여주세요)');
    }
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
  };

  let resp;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
    resp = await fetch(
      `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
    );
    clearTimeout(timeout);
  } catch (networkErr) {
    // Failed to fetch / 타임아웃 / 네트워크 오류 → 다음 키로 교체 후 재시도
    const isTimeout = networkErr.name === 'AbortError';
    console.warn(`[Gemini] ${isTimeout ? '타임아웃(30초)' : '네트워크 오류'}: ${networkErr.message}`);
    const keys = getGeminiKeys();
    if (_keyRetry < keys.length - 1) {
      rotateGeminiKey();
      console.warn(`[Gemini] 키 ${_keyRetry + 2}로 교체 후 재시도`);
      await new Promise(r => setTimeout(r, 2000));
      return callGemini(parts, maxTokens, model, _retry, _keyRetry + 1);
    }
    // 모든 키 순환 완료 → 6초 대기 후 키1로 재시도
    if (_retry < 1) {
      _keyIndex = 0;
      console.warn('[Gemini] 모든 키 순환 완료 → 6초 대기 후 키1로 재시도');
      await new Promise(r => setTimeout(r, 6000));
      return callGemini(parts, maxTokens, model, _retry + 1, 0);
    }
    // 모델 폴백
    if (model === GEMINI_MODEL)    return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0);
    if (model === GEMINI_MODEL_F2) return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0);
    throw new Error('네트워크 오류 — 인터넷 연결을 확인하거나 잠시 후 다시 시도해주세요.');
  }

  // 429(한도초과) / 503(과부하) → 다음 키로 교체 후 재시도
  if (resp.status === 429 || resp.status === 503) {
    const keys = getGeminiKeys();
    if (_keyRetry < keys.length - 1) {
      rotateGeminiKey();
      console.warn(`[Gemini] ${resp.status} → 키 ${_keyIndex + 1}로 교체 후 재시도 (${_keyRetry + 1}회)`);
      await new Promise(r => setTimeout(r, 2000));
      return callGemini(parts, maxTokens, model, _retry, _keyRetry + 1);
    }
    // 모든 키 소진 → 키1로 재시도.
    // 429(분당 한도초과)는 한도 리셋을 기다려야 하므로 6초/12초로 느리게,
    // 503(서버 과부하)은 키 문제가 아니라 일시적 과부하이므로 2초/4초로 빠르게 재시도한다.
    if (_retry < 2) {
      _keyIndex = 0;
      const delay = resp.status === 429 ? (2 ** _retry) * 6000 : (2 ** _retry) * 2000;
      console.warn(`[Gemini] 모든 키 ${resp.status} → ${delay/1000}초 대기 후 키1로 재시도 (${_retry + 1}/2)`);
      await new Promise(r => setTimeout(r, delay));
      return callGemini(parts, maxTokens, model, _retry + 1, 0);
    }
  }

  // 모델 오류(404/deprecated) → 단계적 모델 폴백
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const errMsg  = errBody?.error?.message || '';
    const isFallbackable = resp.status === 404
      || errMsg.includes('not found')
      || errMsg.includes('deprecated');

    if (isFallbackable && model === GEMINI_MODEL) {
      console.warn('[Gemini] 주 모델 실패, 폴백1로 교체:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0, 0);
    }
    if (isFallbackable && model === GEMINI_MODEL_F2) {
      console.warn('[Gemini] 폴백1 실패, 폴백2로 교체:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0, 0);
    }

    const msg = errBody?.error?.message || resp.statusText;
    if (resp.status === 400) throw new Error('요청 오류: ' + msg);
    if (resp.status === 401 || resp.status === 403) throw new Error('API 키가 올바르지 않습니다. 설정에서 확인해주세요.');
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

  const text = candidate?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('AI 응답 없음 — 이미지 형식을 확인하거나 다시 시도해주세요.');
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
  let saved = 0;
  [1,2,3,4].forEach(i => {
    const val = (document.getElementById(`geminiKey${i}`)?.value || '').trim();
    if (val) { localStorage.setItem(`geminiApiKey${i}`, val); saved++; }
    else localStorage.removeItem(`geminiApiKey${i}`);
  });
  if (!saved) { toast('⚠️ 키를 1개 이상 입력해주세요'); return; }
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


