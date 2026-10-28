require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { generateEmbedding, synthesizeAnswer } = require('./llm');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'policy-query-service', aiProvider: process.env.AI_PROVIDER || 'mock' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/query
 * Body: { "question": "...", "department": "HR", "topK": 3 }
 */
app.post('/api/v1/query', async (req, res) => {
  try {
    const { question, department = null, topK = 3 } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Field "question" is required.' });
    }

    const queryEmbedding = await generateEmbedding(question);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const sql = `
      SELECT 
        c.id,
        c.document_id,
        c.chunk_index,
        c.content,
        c.metadata,
        1 - (c.embedding <=> $1::vector) AS similarity
      FROM document_chunks c
      JOIN policy_documents d ON d.id = c.document_id
      WHERE d.is_active = TRUE
        AND ($2::text IS NULL OR d.department = $2::text)
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $3::int
    `;

    const { rows: retrievedChunks } = await pool.query(sql, [
      vectorLiteral,
      department,
      Math.min(Math.max(parseInt(topK, 10) || 3, 1), 10)
    ]);

    const answer = await synthesizeAnswer(question, retrievedChunks);

    res.json({
      question,
      departmentFilter: department,
      aiProvider: process.env.AI_PROVIDER || 'mock',
      answer,
      citations: retrievedChunks.map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.document_id,
        title: chunk.metadata?.title,
        department: chunk.metadata?.department,
        version: chunk.metadata?.version,
        chunkIndex: chunk.chunk_index,
        similarity: Number(Number(chunk.similarity).toFixed(4)),
        excerpt: chunk.content
      }))
    });
  } catch (err) {
    console.error('RAG query error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`[Query Service] Running on port ${PORT} (AI_PROVIDER=${process.env.AI_PROVIDER || 'mock'})`);
});
