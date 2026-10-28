import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { chunkText } from './chunker';
import { generateEmbedding } from './embedder';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

export interface IngestDocumentInput {
  title: string;
  department: string;
  version?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface IngestDocumentResult {
  documentId: number;
  title: string;
  department: string;
  chunksCount: number;
}

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'policy-ingestion-service',
      aiProvider: process.env.AI_PROVIDER || 'mock'
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message });
  }
});

/**
 * Core helper to ingest a document and its chunks
 */
async function ingestDocument({
  title,
  department,
  version = '1.0',
  content,
  metadata = {}
}: IngestDocumentInput): Promise<IngestDocumentResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const docRes = await client.query<{ id: number }>(
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
app.post('/api/v1/documents/text', async (req: Request, res: Response) => {
  try {
    const {
      title,
      department = 'General',
      version = '1.0',
      content,
      metadata = {}
    } = req.body as Partial<IngestDocumentInput>;

    if (!title || !content) {
      res.status(400).json({ error: 'Both title and content are required.' });
      return;
    }
    const result = await ingestDocument({ title, department, version, content, metadata });
    res.status(201).json({ message: 'Policy document ingested successfully', data: result });
  } catch (err) {
    console.error('Ingest text error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/v1/documents/upload
 * Upload a .txt or .md file via multipart/form-data
 */
app.post('/api/v1/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Please upload a file field named "file".' });
      return;
    }
    const content = req.file.buffer.toString('utf-8');
    const body = req.body as Record<string, string | undefined>;
    const title = body.title || req.file.originalname;
    const department = body.department || 'General';
    const version = body.version || '1.0';

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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/v1/documents/seed
 * Loads sample company policies from /app/sample-policies into PostgreSQL
 */
app.post('/api/v1/documents/seed', async (_req: Request, res: Response) => {
  try {
    const sampleDir = path.join(__dirname, '../sample-policies');
    const fallbackDir = '/app/sample-policies';
    const targetDir = fs.existsSync(fallbackDir) ? fallbackDir : sampleDir;

    const files = fs
      .readdirSync(targetDir)
      .filter((f) => f.endsWith('.md'))
      .sort();

    const results: IngestDocumentResult[] = [];
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const deptMatch = content.match(/หน่วยงานที่รับผิดชอบ:\*\*\s*([A-Za-z]+)/);
      const versionMatch = content.match(/เวอร์ชัน:\*\*\s*([0-9.]+)/);

      const ingested = await ingestDocument({
        title: titleMatch ? titleMatch[1].trim() : file,
        department: deptMatch ? deptMatch[1].trim() : 'General',
        version: versionMatch ? versionMatch[1].trim() : '2026.1',
        content,
        metadata: { source_file: file }
      });
      results.push(ingested);
    }

    res.json({ message: 'Sample policies seeded successfully', seeded: results });
  } catch (err) {
    console.error('Seed error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/v1/documents
 * List all indexed policy documents
 */
app.get('/api/v1/documents', async (_req: Request, res: Response) => {
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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(
    `[Ingestion Service] Running on port ${PORT} (AI_PROVIDER=${process.env.AI_PROVIDER || 'mock'})`
  );
});
