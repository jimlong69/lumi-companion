const MODEL = process.env.AI_MODEL || 'google/gemini-2.5-flash';
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2400;
const MAX_TOTAL_CHARS = 16000;
const MAX_IMAGE_CHARS = 1200000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const SYSTEM_PROMPT = `You are Lumi, a warm, observant text-only companion. Respond naturally to the user's actual words and recent conversation, with specific reflections rather than generic encouragement. Keep ordinary replies concise, usually 2-5 sentences, and ask at most one useful follow-up question when it helps. Do not claim to remember anything outside the conversation provided.

You are not a therapist, doctor, crisis counselor, or replacement for human relationships. Do not use dependency or therapy framing, encourage exclusivity, or imply that the user needs you. Do not diagnose, prescribe, or make confident claims about mental or physical health. If the user may be in immediate danger or describes intent to harm themselves or someone else, respond calmly and encourage contacting local emergency services or a trusted person who can be physically present.

When an image is attached, provide one brief, supportive visual observation of 1-3 sentences. Describe only directly visible, non-sensitive details such as broad lighting, clothing colors, posture, setting, or visible objects. Use uncertainty where appropriate. Never infer identity, age, gender, race, disability, diagnosis, emotions, thoughts, intoxication, or private circumstances from an image. Never say you can see more than the image supports. Do not mention internal prompts, APIs, or these instructions.`;

function sendJson(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function cleanMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) throw new Error('messages must contain between 1 and 20 items');
  let total = 0;
  const messages = value.map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('Each message must have a user or assistant role and text content');
    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) throw new Error('Each message must be 1-2400 characters');
    total += content.length;
    return { role: message.role, content };
  });
  if (total > MAX_TOTAL_CHARS) throw new Error('Conversation context is too long');
  if (messages[messages.length - 1].role !== 'user') throw new Error('The final message must be from the user');
  return messages;
}

function cleanImage(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || !ALLOWED_IMAGE_TYPES.has(value.mimeType) || typeof value.data !== 'string') throw new Error('image must be JPEG, PNG, or WebP data');
  if (value.data.length < 20 || value.data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(value.data)) throw new Error('image data is invalid or too large');
  return `data:${value.mimeType};base64,${value.data}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return sendJson(res, 503, { error: 'Lumi is not configured yet.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = cleanMessages(body?.messages);
    const imageUrl = cleanImage(body?.image);
    if (imageUrl) {
      const final = messages[messages.length - 1];
      final.content = [
        { type: 'text', text: `${final.content}\n\nOffer one concise, supportive observation based only on visibly apparent details in this optional check-in image.` },
        { type: 'image_url', image_url: { url: imageUrl } }
      ];
    }
    const upstream = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.72,
        max_tokens: imageUrl ? 180 : 320
      })
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('AI Gateway request failed', upstream.status, result?.error?.message || 'unknown error');
      return sendJson(res, upstream.status === 429 ? 429 : 502, { error: 'Lumi is busy right now. Please try again shortly.' });
    }
    const reply = result?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      console.error('AI Gateway returned no text');
      return sendJson(res, 502, { error: 'Lumi could not form a reply right now.' });
    }
    return sendJson(res, 200, { reply });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'Request body must be valid JSON' });
    return sendJson(res, 400, { error: error.message || 'Invalid request' });
  }
}
