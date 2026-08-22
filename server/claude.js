// Thin wrapper over the Claude Messages API. Uses Haiku by default to keep
// generation cost low — the audit/mockup task doesn't need a frontier model.
const MODEL = 'claude-haiku-4-5-20251001';

async function callClaude(userMessage, { system, maxTokens = 2000 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.status = 500;
    throw err;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Claude API request failed: ${res.status} ${body}`.slice(0, 500));
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return data.content.map((block) => block.text || '').join('');
}

module.exports = { callClaude };
