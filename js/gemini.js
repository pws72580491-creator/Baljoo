// ══════════════════════════════════════════════════════
// gemini.js  —  Google AI Studio 직접 호출 유틸
// ══════════════════════════════════════════════════════

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Gemini API 직접 호출 (이미지+텍스트 멀티모달) ──
async function callGemini(parts, maxTokens = 1000) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('API_KEY_MISSING');

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
  };

  const resp = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || resp.statusText;
    throw new Error(`[${resp.status}] ${msg}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || 'Gemini 오류');

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('AI 응답 없음');
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
