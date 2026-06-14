export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mediaType, b64, isPdf, prompt } = req.body || {};
  if (!b64 || !prompt) {
    return res.status(400).json({ error: '필수 파라미터 누락' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수 미설정' });
  }

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
      return res.status(response.status).json({ error: err?.error?.message || response.statusText });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
