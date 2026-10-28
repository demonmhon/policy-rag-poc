const crypto = require('crypto');

const DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

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

  return createFeatureHashVector(text, DIMENSION);
}

function createFeatureHashVector(text, dim) {
  const vec = new Array(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

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

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

/**
 * Generates an answer strictly grounded in the retrieved chunks
 */
async function synthesizeAnswer(question, retrievedChunks) {
  const provider = (process.env.AI_PROVIDER || 'mock').toLowerCase();

  if (!retrievedChunks || retrievedChunks.length === 0) {
    return 'ไม่พบข้อมูลที่เกี่ยวข้องในฐานข้อมูลระเบียบบริษัท';
  }

  const contextBlock = retrievedChunks
    .map(
      (c, idx) =>
        `[อ้างอิง #${idx + 1} | เอกสาร: ${c.metadata?.title || 'N/A'} | แผนก: ${c.metadata?.department || 'N/A'} | Chunk: ${c.chunk_index}]\n${c.content}`
    )
    .join('\n\n---\n\n');

  const systemInstruction = `คุณคือผู้ช่วยตอบคำถามเกี่ยวกับกฎระเบียบและนโยบายบริษัท (Internal Policy Assistant)
จงตอบคำถามโดยอ้างอิงจากข้อมูลใน [Context] ที่ให้มาเท่านั้น ห้ามคาดเดาหรือแต่งเติมข้อมูลเองเด็ดขาด
หากไม่มีข้อมูลใน Context ให้ตอบว่า "ไม่พบข้อมูลในระเบียบที่ระบุ" พร้อมระบุชื่อเอกสารอ้างอิงท้ายคำตอบเสมอ`;

  const userPrompt = `[Context]
${contextBlock}

[Question]
${question}`;

  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
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
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'ไม่สามารถสร้างคำตอบได้';
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'ไม่สามารถสร้างคำตอบได้';
  }

  // Fallback / Default Mock Synthesizer (works offline out-of-the-box)
  const topChunk = retrievedChunks[0];
  return (
    `[สรุปคำตอบจากระบบ RAG (โหมดสาธิต Offline Mock)]\n` +
    `จากระเบียบ "${topChunk.metadata?.title || 'เอกสารบริษัท'}" (แผนก ${topChunk.metadata?.department || 'ทั่วไป'}):\n\n` +
    `${topChunk.content}\n\n` +
    `📌 แหล่งอ้างอิง: ${topChunk.metadata?.title} (Chunk #${topChunk.chunk_index}, Similarity Score: ${Number(topChunk.similarity).toFixed(4)})`
  );
}

module.exports = { generateEmbedding, synthesizeAnswer };
