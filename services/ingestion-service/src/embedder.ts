import crypto from 'crypto';

const DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

export type AIProvider = 'mock' | 'gemini' | 'openai' | 'claude';
export type EmbeddingProvider = 'mock' | 'gemini' | 'openai';

interface GeminiEmbeddingResponse {
  embedding: {
    values: number[];
  };
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}

const STOP_SUBSTRINGS = new Set([
  'การ',
  'ของ',
  'และ',
  'ใน',
  'ที่',
  'ต้อง',
  'ให้',
  'หรือ',
  'เป็น',
  'ไม่',
  'ได้',
  'มี',
  'จาก',
  'ตาม',
  'โดย',
  'เพื่อ',
  'กับ',
  'ต่อ',
  'ทั้ง',
  'นี้',
  'นั้น',
  'หาก',
  'เมื่อ',
  'อย่าง',
  'ทุก',
  'ผ่าน',
  'เข้า',
  'ออก',
  'ขึ้น',
  'ไป',
  'มา',
  'อยู่',
  'จะ',
  'ซึ่ง',
  'แต่',
  'รวม',
  'ถึง',
  'ภายใน',
  'กำหนด',
  'ธนาคาร',
  'พนักงาน',
  'เจ้าหน้าที่',
  'บริษัท',
  'เอกสาร',
  'นโยบาย',
  'ระเบียบ',
  'หมวด',
  'รหัส',
  'เวอร์ชัน',
  'สถานะ',
  'บังคับใช้',
  'หน่วยงาน',
  'รับผิดชอบ',
  'ฝ่าย'
]);

/**
 * Resolves which embedding provider to use.
 * Supports explicit EMBEDDING_PROVIDER ('mock' | 'gemini' | 'openai') or falls back from AI_PROVIDER.
 * Note: When AI_PROVIDER='claude', Anthropic does not provide a native embedding endpoint,
 * so embeddings automatically use EMBEDDING_PROVIDER or available Gemini/OpenAI keys, or 'mock'.
 */
export function resolveEmbeddingProvider(): EmbeddingProvider {
  const explicit = (process.env.EMBEDDING_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (explicit === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (explicit === 'mock') return 'mock';

  const aiProvider = (process.env.AI_PROVIDER || 'mock').trim().toLowerCase();
  if (aiProvider === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (aiProvider === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (aiProvider === 'claude') {
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'mock';
  }

  return 'mock';
}

/**
 * Generates an embedding vector (768 dimensions by default) using Gemini, OpenAI,
 * or deterministic feature hashing (Mock mode with Thai character n-grams).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = resolveEmbeddingProvider();

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
    const data = (await response.json()) as GeminiEmbeddingResponse;
    return data.embedding.values;
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
    const data = (await response.json()) as OpenAIEmbeddingResponse;
    return data.data[0].embedding;
  }

  return createFeatureHashVector(text, DIMENSION);
}

/**
 * Deterministic 768-dim feature hashing vector tailored for mixed Thai & English bank policy text.
 */
export function createFeatureHashVector(text: string, dim = DIMENSION): number[] {
  const vec: number[] = new Array(dim).fill(0);
  const normalized = text
    .replace(/\[REDACTED_[A-Z_]+\]/gi, ' ')
    .toLowerCase()
    .replace(/,/g, '');
  const asciiAndNumTokens = normalized.match(/[a-z0-9]{2,}/g) || [];

  const addFeature = (feat: string, weight: number): void => {
    const hash = crypto.createHash('md5').update(feat).digest();
    const idx = hash.readUInt16BE(0) % dim;
    const sign = hash[2] % 2 === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  };

  for (const tok of asciiAndNumTokens) {
    addFeature(`tok:${tok}`, 2.5);
  }

  let thaiText = normalized.replace(/[a-z0-9\s\p{P}]+/gu, '');
  for (const stop of STOP_SUBSTRINGS) {
    thaiText = thaiText.split(stop).join(' ');
  }

  for (const segment of thaiText.split(/\s+/).filter(Boolean)) {
    for (let n = 3; n <= 5; n++) {
      for (let i = 0; i <= segment.length - n; i++) {
        const gram = segment.slice(i, i + n);
        if (!STOP_SUBSTRINGS.has(gram)) {
          addFeature(`g${n}:${gram}`, n === 3 ? 0.8 : 1.5);
        }
      }
    }
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}
