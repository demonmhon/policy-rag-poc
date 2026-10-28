import crypto from 'crypto';

const DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

export type AIProvider = 'mock' | 'gemini' | 'openai' | 'claude';
export type EmbeddingProvider = 'mock' | 'gemini' | 'openai';

export interface ChunkMetadata {
  title?: string;
  department?: string;
  version?: string;
  chunk_index?: number;
  total_chunks?: number;
  source_file?: string;
  [key: string]: unknown;
}

export interface RetrievedChunk {
  id: number | string;
  document_id: number;
  chunk_index: number;
  content: string;
  metadata?: ChunkMetadata;
  similarity: number | string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SynthesisResult {
  answer: string;
  provider: AIProvider;
  model: string;
  usage: TokenUsage;
}

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

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ClaudeMessagesResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
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

export function resolveAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER || 'mock').trim().toLowerCase();
  if (provider === 'gemini') return 'gemini';
  if (provider === 'openai') return 'openai';
  if (provider === 'claude' || provider === 'anthropic') return 'claude';
  return 'mock';
}

export function resolveEmbeddingProvider(): EmbeddingProvider {
  const explicit = (process.env.EMBEDDING_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (explicit === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (explicit === 'mock') return 'mock';

  const aiProvider = resolveAIProvider();
  if (aiProvider === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (aiProvider === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (aiProvider === 'claude') {
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'mock';
  }

  return 'mock';
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.5));
}

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

/**
 * Generates an answer strictly grounded in the retrieved chunks along with token usage telemetry.
 * Supports 'mock', 'gemini' (gemini-2.5-flash), 'openai' (gpt-4o-mini), and 'claude' (Anthropic Messages API).
 */
export async function synthesizeAnswerWithUsage(
  question: string,
  retrievedChunks: RetrievedChunk[]
): Promise<SynthesisResult> {
  const provider = resolveAIProvider();

  if (!retrievedChunks || retrievedChunks.length === 0) {
    const emptyAnswer = 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูลระเบียบบริษัท';
    const promptTokens = estimateTokens(question);
    const completionTokens = estimateTokens(emptyAnswer);
    return {
      answer: emptyAnswer,
      provider,
      model: `${provider}-no-context`,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      }
    };
  }

  const contextBlock = retrievedChunks
    .map(
      (c, idx) =>
        `[อ้างอิง #${idx + 1} | เอกสาร: ${c.metadata?.title || 'N/A'} | แผนก: ${c.metadata?.department || 'N/A'} | Chunk: ${c.chunk_index}]\n${c.content}`
    )
    .join('\n\n---\n\n');

  const systemInstruction = `คุณคือผู้ช่วยตอบคำถามเกี่ยวกับกฎระเบียบและนโยบายธนาคาร (Internal Bank Policy Assistant)
จงตอบคำถามเป็นภาษาไทยโดยอ้างอิงจากข้อมูลใน [Context] ที่ให้มาเท่านั้น ห้ามคาดเดาหรือแต่งเติมข้อมูลเองเด็ดขาด
หากไม่มีข้อมูลใน Context ให้ตอบว่า "ไม่พบข้อมูลในระเบียบที่ระบุ" พร้อมระบุชื่อเอกสารและหมายเลข Chunk อ้างอิงท้ายคำตอบเสมอ`;

  const userPrompt = `[Context]
${contextBlock}

[Question]
${question}`;

  const fallbackPromptTokens = estimateTokens(`${systemInstruction}\n${userPrompt}`);

  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini Generate API error: ${await response.text()}`);
    }
    const data = (await response.json()) as GeminiGenerateResponse;
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'ไม่สามารถสร้างคำตอบได้';
    const promptTokens = data.usageMetadata?.promptTokenCount ?? fallbackPromptTokens;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokens(answer);
    const totalTokens = data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;

    return {
      answer,
      provider: 'gemini',
      model,
      usage: { promptTokens, completionTokens, totalTokens }
    };
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI Chat API error: ${await response.text()}`);
    }
    const data = (await response.json()) as OpenAIChatResponse;
    const answer = data.choices?.[0]?.message?.content || 'ไม่สามารถสร้างคำตอบได้';
    const promptTokens = data.usage?.prompt_tokens ?? fallbackPromptTokens;
    const completionTokens = data.usage?.completion_tokens ?? estimateTokens(answer);
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    return {
      answer,
      provider: 'openai',
      model,
      usage: { promptTokens, completionTokens, totalTokens }
    };
  }

  if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.1,
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!response.ok) {
      throw new Error(`Claude Messages API error: ${await response.text()}`);
    }
    const data = (await response.json()) as ClaudeMessagesResponse;
    const answer =
      data.content?.find((part) => part.type === 'text')?.text || 'ไม่สามารถสร้างคำตอบได้';
    const promptTokens = data.usage?.input_tokens ?? fallbackPromptTokens;
    const completionTokens = data.usage?.output_tokens ?? estimateTokens(answer);
    const totalTokens = promptTokens + completionTokens;

    return {
      answer,
      provider: 'claude',
      model,
      usage: { promptTokens, completionTokens, totalTokens }
    };
  }

  // Fallback / Default Mock Synthesizer (works offline out-of-the-box)
  const topChunk = retrievedChunks[0];
  const secondarySameDoc = retrievedChunks
    .slice(1)
    .filter(
      (c) =>
        c.document_id === topChunk.document_id &&
        Number(c.similarity) >= Number(topChunk.similarity) - 0.18
    );

  const combinedSections = [topChunk, ...secondarySameDoc].map((c) => c.content).join('\n\n');

  const answer =
    `[สรุปคำตอบจากระบบ RAG (โหมดสาธิต Offline Mock)]\n` +
    `อ้างอิงจากเอกสาร "${topChunk.metadata?.title || 'เอกสารนโยบายธนาคาร'}" (หน่วยงาน: ${topChunk.metadata?.department || 'ทั่วไป'}):\n\n` +
    `${combinedSections}\n\n` +
    `📌 แหล่งอ้างอิง: ${topChunk.metadata?.title} (Chunk #${topChunk.chunk_index}, Similarity Score: ${Number(topChunk.similarity).toFixed(4)})`;

  const completionTokens = estimateTokens(answer);
  return {
    answer,
    provider: 'mock',
    model: 'mock-grounded-synthesizer-v1',
    usage: {
      promptTokens: fallbackPromptTokens,
      completionTokens,
      totalTokens: fallbackPromptTokens + completionTokens
    }
  };
}

/**
 * Generates an answer string strictly grounded in the retrieved chunks.
 */
export async function synthesizeAnswer(
  question: string,
  retrievedChunks: RetrievedChunk[]
): Promise<string> {
  const result = await synthesizeAnswerWithUsage(question, retrievedChunks);
  return result.answer;
}
