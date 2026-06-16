// ══════════════════════════════════════════════════════
// gemini.js  —  Google AI Studio 직접 호출 유틸
// ══════════════════════════════════════════════════════

const GEMINI_MODEL    = 'gemini-3.5-flash';       // 주 모델 (현재 최신 GA)
const GEMINI_MODEL_F2 = 'gemini-2.5-flash';       // 1차 폴백 (오늘부로 deprecated)
const GEMINI_MODEL_FB = 'gemini-3.1-flash-lite';  // 최종 폴백 (가장 안정적·저비용)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Gemini API 직접 호출 (이미지+텍스트 멀티모달) ──
async function callGemini(parts, maxTokens = 2000, model = GEMINI_MODEL, _retry = 0) {
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

  let resp = await fetch(
    `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  // 503 과부하 → 최대 3회 자동 재시도 (2초 → 4초 → 8초 간격)
  if (resp.status === 503 && _retry < 3) {
    const delay = (2 ** _retry) * 2000;
    console.warn(`[Gemini] 503 과부하, ${delay/1000}초 후 재시도 (${_retry + 1}/3)...`);
    await new Promise(r => setTimeout(r, delay));
    return callGemini(parts, maxTokens, model, _retry + 1);
  }

  // 모델 오류(404/deprecated/503 재시도 초과) → 단계적 폴백
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const errMsg  = errBody?.error?.message || '';
    const isFallbackable = resp.status === 404
      || resp.status === 503
      || errMsg.includes('not found')
      || errMsg.includes('deprecated');

    if (isFallbackable && model === GEMINI_MODEL) {
      console.warn('[Gemini] 2.5-flash 실패, gemini-3-flash로 폴백:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_F2, 0);
    }
    if (isFallbackable && model === GEMINI_MODEL_F2) {
      console.warn('[Gemini] gemini-3-flash 실패, 3.1-flash-lite로 폴백:', errMsg);
      return callGemini(parts, maxTokens, GEMINI_MODEL_FB, 0);
    }

    const msg = errBody?.error?.message || resp.statusText;
    if (resp.status === 400) throw new Error('요청 오류: ' + msg);
    if (resp.status === 401 || resp.status === 403) throw new Error('API 키가 올바르지 않습니다. 설정에서 확인해주세요.');
    if (resp.status === 429) throw new Error('요청 한도 초과 (무료 티어 분당 제한). 잠시 후 다시 시도하세요.');
    if (resp.status === 503) throw new Error('Gemini 서버 혼잡 (3회 재시도 후에도 실패). 잠시 후 다시 시도해주세요.');
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

// ── API 키 관리 ──
function getGeminiKey() {
  return localStorage.getItem('geminiApiKey') || '';
}

function saveGeminiKey() {
  const val = (document.getElementById('geminiKeyInput').value || '').trim();
  if (!val) { toast('⚠️ API 키를 입력해주세요'); return; }
  localStorage.setItem('geminiApiKey', val);
  toast('✅ API 키 저장 완료');
}

function loadGeminiKey() {
  const k = localStorage.getItem('geminiApiKey') || '';
  const el = document.getElementById('geminiKeyInput');
  if (el && k) el.value = k;
}

function toggleGeminiKeyVisibility() {
  const el = document.getElementById('geminiKeyInput');
  el.type = el.type === 'password' ? 'text' : 'password';
}

function resetGeminiKey() {
  if (!confirm('API 키를 삭제할까요?')) return;
  localStorage.removeItem('geminiApiKey');
  const el = document.getElementById('geminiKeyInput');
  if (el) { el.value = ''; el.type = 'password'; }
  toast('🗑️ API 키 초기화 완료');
}

// 구버전 호환
function loadApiKey() { loadGeminiKey(); }
