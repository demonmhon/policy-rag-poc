require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { chunkText } = require('./chunker');
const { generateEmbedding } = require('./embedder');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'policy-ingestion-service', aiProvider: process.env.AI_PROVIDER || 'mock' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * Core helper to ingest a document and its chunks
 */
async function ingestDocument({ title, department, version = '1.0', content, metadata = {} }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const docRes = await client.query(
      `INSERT INTO policy_documents (title, department, version)
       VALUES ($1, $2, $3) RETURNING id`,
      [title, department, version]
    );
    const documentId = docRes.rows[0].id;

    const chunks = chunkText(content, 450, 80);
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const embedding = await generateEmbedding(chunkContent);
      const vectorLiteral = `[${embedding.join(',')}]`;

      const chunkMeta = {
        ...metadata,
        department,
        title,
        version,
        chunk_index: i + 1,
        total_chunks: chunks.length
      };

      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [documentId, i + 1, chunkContent, JSON.stringify(chunkMeta), vectorLiteral]
      );
    }

    await client.query('COMMIT');
    return { documentId, title, department, chunksCount: chunks.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/v1/documents/text
 * Ingest raw policy text via JSON payload
 */
app.post('/api/v1/documents/text', async (req, res) => {
  try {
    const { title, department = 'General', version = '1.0', content, metadata = {} } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Both title and content are required.' });
    }
    const result = await ingestDocument({ title, department, version, content, metadata });
    res.status(201).json({ message: 'Policy document ingested successfully', data: result });
  } catch (err) {
    console.error('Ingest text error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/documents/upload
 * Upload a .txt or .md file via multipart/form-data
 */
app.post('/api/v1/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a file field named "file".' });
    }
    const content = req.file.buffer.toString('utf-8');
    const title = req.body.title || req.file.originalname;
    const department = req.body.department || 'General';
    const version = req.body.version || '1.0';

    const result = await ingestDocument({
      title,
      department,
      version,
      content,
      metadata: { filename: req.file.originalname }
    });
    res.status(201).json({ message: 'File uploaded and ingested successfully', data: result });
  } catch (err) {
    console.error('Upload ingest error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/documents/seed
 * Loads sample company policies from /app/sample-policies into PostgreSQL
 */
app.post('/api/v1/documents/seed', async (req, res) => {
  try {
    const sampleDir = path.join(__dirname, '../sample-policies');
    const fallbackDir = '/app/sample-policies';
    const targetDir = fs.existsSync(fallbackDir) ? fallbackDir : sampleDir;

    const samples = [
      {
        file: 'hr_medical_policy.md',
        title: 'ระเบียบสวัสดิการค่ารักษาพยาบาลและตรวจสุขภาพประจำปี (HR-POL-2026-01)',
        department: 'HR',
        version: '2026.1'
      },
      {
        file: 'it_security_policy.md',
        title: 'นโยบายความมั่นคงปลอดภัยทางสารสนเทศและการใช้งานอุปกรณ์ (IT-SEC-2026-02)',
        department: 'IT',
        version: '2026.2'
      }
    ];

    const results = [];
    for (const item of samples) {
      const filePath = path.join(targetDir, item.file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ingested = await ingestDocument({
          title: item.title,
          department: item.department,
          version: item.version,
          content,
          metadata: { source_file: item.file }
        });
        results.push(ingested);
      }
    }

    res.json({ message: 'Sample policies seeded successfully', seeded: results });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/documents
 * List all indexed policy documents
 */
app.get('/api/v1/documents', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.title, d.department, d.version, d.is_active, d.created_at,
             COUNT(c.id)::int AS chunk_count
      FROM policy_documents d
      LEFT JOIN document_chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `);
    res.json({ documents: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Ingestion Service] Running on port ${PORT} (AI_PROVIDER=${process.env.AI_PROVIDER || 'mock'})`);
});
