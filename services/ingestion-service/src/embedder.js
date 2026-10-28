const crypto = require('crypto');

const DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

/**
 * Generates a deterministic semantic-like mock vector for local demo without API keys,
 * or calls Gemini / OpenAI Embedding API when configured.
 */
async function generateEmbedding(text) {
  const provider = (process.env.AI_PROVIDER || 'mock').toLowerCase();

  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: DIMENSION
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini Embedding API error: ${await response.text()}`);
    }
    const data = await response.json();
    return data.embedding.values;
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: DIMENSION
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI Embedding API error: ${await response.text()}`);
    }
    const data = await response.json();
    return data.data[0].embedding;
  }

  // Fallback / Default: Feature-hashing deterministic vector (Mock mode)
  return createFeatureHashVector(text, DIMENSION);
}

function createFeatureHashVector(text, dim) {
  const vec = new Array(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Also include character 3-grams for Thai word overlap resilience in mock mode
  const ngrams = [];
  const compact = text.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 2; i++) {
    ngrams.push(compact.slice(i, i + 3));
  }

  const allFeatures = [...tokens, ...ngrams];
  for (const token of allFeatures) {
    const hash = crypto.createHash('md5').update(token).digest();
    const idx = hash.readUInt16BE(0) % dim;
    const sign = (hash[2] % 2 === 0) ? 1 : -1;
    vec[idx] += sign * 1.0;
  }

  // L2 Normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

module.exports = { generateEmbedding };
