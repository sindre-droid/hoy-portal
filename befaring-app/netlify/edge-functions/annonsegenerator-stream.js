// ── annonsegenerator-stream.js (Edge Function, Deno) ──────────────────────────
// Streaming-versjon av Anthropic-kallet i annonsegenerator.
//
// Hvorfor Edge Function:
//   Netlify klassiske Functions har 26s timeout maks. Sonnet 4.6 ved 16K
//   input + 1500-3000 output tokens tar 30-50 sek å fullføre — godt over
//   grensen. Streaming holder connection alive ved kontinuerlig å sende
//   tokens etter hvert som Anthropic genererer dem, og fjerner timeout-
//   problemet fundamentalt. Edge Functions har default 50s, kan utvides
//   til 5 min, og støtter native streaming via Web Streams API.
//
// Endpoint: POST /api/annonsegenerator-stream
// Request body: { messages: [{role, content}], deal_id?, boat_id? }
// Response: text/plain stream med ren tekst-delta + final marker
//
// Format: Hver chunk er plain text. Den siste linjen i streamen er en
// JSON-encoded metadata-blokk på formatet:
//   \n__META__:{"prompt_version":"2026-05-15.1"}\n
// Klienten skiller mellom tekst og metadata på denne markøren.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FALLBACK_PROMPT_VERSION = '2026-05-15.1';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Hent aktiv prompt fra Supabase. Hvis ingen aktiv rad med matching versjon
// finnes, fall tilbake til null (Edge Function har ikke tilgang til lokal
// fil — klassisk annonsegenerator.js holder fallback-versjonen).
async function getActivePromptFromSupabase(supabase) {
  try {
    const { data, error } = await supabase
      .from('annonsegenerator_prompts')
      .select('version, system_prompt, style_archive')
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    if (!data.system_prompt || data.system_prompt.startsWith('-- placeholder')) {
      return null;
    }

    return {
      version: data.version,
      system_prompt: data.system_prompt + (data.style_archive ? '\n\n' + data.style_archive : ''),
    };
  } catch (err) {
    console.error('getActivePromptFromSupabase failed:', err.message);
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonError(401, 'Unauthorized');
  }
  const jwt = parseJwt(authHeader.slice(7));
  if (!jwt?.email) {
    return jsonError(401, 'Invalid token');
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let messages;
  try {
    const body = await request.json();
    messages = body.messages;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, 'messages array required');
  }

  // ── Env ─────────────────────────────────────────────────────────────────
  const apiKey =
    Netlify.env.get('ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY');
  const supabaseUrl =
    Netlify.env.get('SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
  const supabaseKey =
    Netlify.env.get('SUPABASE_SERVICE_KEY') ||
    Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!apiKey) return jsonError(500, 'ANTHROPIC_API_KEY not configured');
  if (!supabaseUrl || !supabaseKey) {
    return jsonError(500, 'Supabase env vars not configured');
  }

  // ── Hent aktiv prompt ────────────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, supabaseKey);
  const activePrompt = await getActivePromptFromSupabase(supabase);

  if (!activePrompt) {
    return jsonError(
      503,
      'Ingen aktiv prompt funnet i Supabase. Klassisk /annonsegenerator må kalles først for å seede den fra lokal fil.'
    );
  }

  // ── Kall Anthropic med stream:true ───────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        // Prompt caching: stilarkivet cachet 5 min, store besparelser
        system: [
          {
            type: 'text',
            text: activePrompt.system_prompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      }),
    });
  } catch (err) {
    return jsonError(502, `Anthropic fetch failed: ${err.message}`);
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    return jsonError(upstream.status || 502, `Anthropic API error: ${errText}`);
  }

  // ── Konverter SSE-stream til ren tekst-stream ────────────────────────────
  // Anthropic streaming format: hver chunk er en SSE event som starter med
  // "event: ..." og deretter "data: {...}". Vi parser kun "content_block_delta"
  // events med text_delta og emitter teksten som ren plain text til klienten.
  // På slutten av streamen sender vi en __META__ marker med prompt_version.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Behold siste linje hvis den er ufullstendig
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]' || !data) continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            } catch (err) {
              // Stille ignorer malformerte SSE events
              console.error('SSE parse error:', err.message, data.slice(0, 100));
            }
          }
        }

        // Send metadata-marker på slutten
        const meta = `\n__META__:${JSON.stringify({ prompt_version: activePrompt.version })}\n`;
        controller.enqueue(encoder.encode(meta));
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

export const config = {
  path: '/api/annonsegenerator-stream',
};
