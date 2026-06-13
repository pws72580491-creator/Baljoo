export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: '잘못된 요청' }), { status: 400 }); }

  const { mediaType, b64, isPdf, prompt } = body || {};
  if (!b64 || !prompt) {
    return new Response(JSON.stringify({ error: '필수 파라미터 누락' }), { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수 미설정' }), { status: 500 });
  }

  // 모델 자동 탐색
  let model = 'gemini-2.0-flash';
  try {
    const modelsResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (modelsResp.ok) {
      const md = await modelsResp.json();
      const names = (md.models || []).map(m => m.name.replace('models/', ''));
      const candidates = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash', 'gemini-pro'];
      model = candidates.find(c => names.includes(c)) || names.find(n => n.includes('flash')) || names[0] || model;
    }
  } catch (_) {}

  const reqBody = {
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: b64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1500 }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: err?.error?.message || response.statusText }), { status: response.status });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
