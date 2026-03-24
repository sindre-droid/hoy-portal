// ── annonsegenerator.js ────────────────────────────────────────────────────────
// POST { messages: [{role, content}] } → AI-generated boat listing response
// Uses Anthropic Claude API with HoY system prompt + style archive
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = require('./annonsegenerator-prompt');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch { return null; }
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const token = authHeader.slice(7);
  const jwt = parseJwt(token);
  if (!jwt || !jwt.email) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let messages;
  try {
    ({ messages } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'messages array required' }) };
  }

  // ── Call Anthropic API ────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Failed to reach Anthropic API', detail: err.message }) };
  }

  if (!response.ok) {
    const errBody = await response.text();
    return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: 'Anthropic API error', detail: errBody }) };
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text ?? '';

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  };
};
