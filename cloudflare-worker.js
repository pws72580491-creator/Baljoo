// ══════════════════════════════════════════════════════
// Cloudflare Worker — Gemini API 프록시
// 배포: workers.cloudflare.com
// 환경변수: GEMINI_API_KEY (Cloudflare 대시보드에서 설정)
// ══════════════════════════════════════════════════════

const GEMINI_MODEL   = 'gemini-2.5-flash-lite-preview-06-17';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 허용할 출처 (본인 Vercel 도메인으로 변경)
const ALLOWED_ORIGINS = [
  'https://your-app.vercel.app',   // ← 실제 도메인으로 교체
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

    // CORS 프리플라이트
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(isAllowed ? origin : ''),
      });
    }

    // POST만 허용
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 허용되지 않은 출처 차단
    if (!isAllowed) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body    = await request.json();
      const apiKey  = env.GEMINI_API_KEY;

      if (!apiKey) {
        return jsonResp({ error: 'GEMINI_API_KEY not configured' }, 500, origin);
      }

      // OpenRouter 형식 → Gemini 형식 변환
      const geminiBody = convertToGemini(body);

      const geminiResp = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(geminiBody),
      });

      const geminiData = await geminiResp.json();

      if (!geminiResp.ok) {
        return jsonResp({ error: geminiData?.error?.message || 'Gemini API 오류', details: geminiData }, geminiResp.status, origin);
      }

      // Gemini 형식 → OpenRouter 형식으로 변환 (앱 코드 변경 최소화)
      const converted = convertFromGemini(geminiData);
      return jsonResp(converted, 200, origin);

    } catch (err) {
      return jsonResp({ error: err.message || '서버 오류' }, 500, origin);
    }
  }
};

// ── OpenRouter 메시지 형식 → Gemini contents 변환 ──
function convertToGemini(body) {
  const messages = body.messages || [];
  const parts    = [];

  messages.forEach(msg => {
    const content = msg.content;
    if (typeof content === 'string') {
      parts.push({ text: content });
    } else if (Array.isArray(content)) {
      content.forEach(c => {
        if (c.type === 'text') {
          parts.push({ text: c.text });
        } else if (c.type === 'image_url') {
          const url = c.image_url?.url || '';
          if (url.startsWith('data:')) {
            // base64 인라인 이미지
            const [meta, data] = url.split(',');
            const mimeType = meta.split(':')[1].split(';')[0];
            parts.push({ inline_data: { mime_type: mimeType, data } });
          }
        }
      });
    }
  });

  return {
    contents: [{ parts }],
    generationConfig: {
      temperature:     body.temperature ?? 0,
      maxOutputTokens: body.max_tokens  ?? 1000,
    },
  };
}

// ── Gemini 응답 → OpenRouter 형식 변환 ──
function convertFromGemini(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    choices: [{
      message: { role: 'assistant', content: text },
      finish_reason: data?.candidates?.[0]?.finishReason || 'stop',
    }],
    usage: data?.usageMetadata || {},
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResp(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}
