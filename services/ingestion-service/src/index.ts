import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { chunkText } from './chunker';
import { generateEmbedding, resolveEmbeddingProvider } from './embedder';
import { extractTextFromPdfBuffer, parsePolicyMetadata } from './pdfParser';

export const app = express();
const upload = multer({ storage: multer.memoryStorage() });
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

export interface IngestDocumentInput {
  title: string;
  department: string;
  version?: string;
  content: string;
  metadata?: Record<string, unknown>;
  replaceExisting?: boolean;
}

export interface IngestDocumentResult {
  documentId: number;
  title: string;
  department: string;
  version: string;
  format: string;
  chunksCount: number;
}

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'policy-ingestion-service',
      aiProvider: process.env.AI_PROVIDER || 'mock',
      embeddingProvider: resolveEmbeddingProvider()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message });
  }
});

/**
 * Core helper to ingest a document and its chunks idempotently into PostgreSQL + pgvector.
 */
export async function ingestDocument({
  title,
  department,
  version = '1.0',
  content,
  metadata = {},
  replaceExisting = true
}: IngestDocumentInput): Promise<IngestDocumentResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (replaceExisting) {
      await client.query('DELETE FROM policy_documents WHERE title = $1', [title]);
    }

    const docRes = await client.query<{ id: number }>(
      `INSERT INTO policy_documents (title, department, version)
       VALUES ($1, $2, $3) RETURNING id`,
      [title, department, version]
    );
    const documentId = docRes.rows[0].id;

    const chunks = chunkText(content, 1150, 150);
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const textToEmbed = `${title}\n${chunkContent}`;
      const embedding = await generateEmbedding(textToEmbed);
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
    const format = typeof metadata.format === 'string' ? metadata.format : 'text';
    return {
      documentId,
      title,
      department,
      version,
      format,
      chunksCount: chunks.length
    };
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
      department,
      version,
      content,
      metadata = {}
    } = req.body as Partial<IngestDocumentInput>;

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Field "title" is required and must be a non-empty string.' });
      return;
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      res
        .status(400)
        .json({ error: 'Field "content" is required and must be a non-empty string.' });
      return;
    }

    const parsedMeta = parsePolicyMetadata(content, title.trim());
    const result = await ingestDocument({
      title: title.trim(),
      department: department?.trim() || parsedMeta.department || 'General',
      version: version?.trim() || parsedMeta.version || '1.0',
      content: content.trim(),
      metadata: { ...metadata, format: 'text' },
      replaceExisting: true
    });
    res.status(201).json({ message: 'Policy document ingested successfully', data: result });
  } catch (err) {
    console.error('Ingest text error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/v1/documents/upload
 * Upload a .txt, .md, or .pdf file via multipart/form-data
 */
app.post('/api/v1/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Please upload a file field named "file".' });
      return;
    }

    const originalName = req.file.originalname || 'uploaded_policy';
    const ext = path.extname(originalName).toLowerCase();
    const allowedExts = ['.md', '.txt', '.pdf'];
    if (ext && !allowedExts.includes(ext)) {
      res.status(400).json({
        error: `Unsupported file extension "${ext}". Allowed formats: .md, .txt, .pdf`
      });
      return;
    }

    const isPdf =
      ext === '.pdf' ||
      req.file.mimetype === 'application/pdf' ||
      req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';

    const content = isPdf
      ? extractTextFromPdfBuffer(req.file.buffer)
      : req.file.buffer.toString('utf-8');

    if (!content.trim()) {
      res.status(400).json({ error: 'Uploaded file contains no extractable text.' });
      return;
    }

    const parsedMeta = parsePolicyMetadata(content, originalName);
    const body = req.body as Record<string, string | undefined>;
    const title = body.title?.trim() || parsedMeta.title || originalName;
    const department = body.department?.trim() || parsedMeta.department || 'General';
    const version = body.version?.trim() || parsedMeta.version || '1.0';

    const result = await ingestDocument({
      title,
      department,
      version,
      content,
      metadata: {
        source_file: originalName,
        format: isPdf ? 'pdf' : ext.replace('.', '') || 'text',
        ...(parsedMeta.code ? { code: parsedMeta.code } : {})
      },
      replaceExisting: true
    });
    res.status(201).json({ message: 'File uploaded and ingested successfully', data: result });
  } catch (err) {
    console.error('Upload ingest error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

function resolveSamplePoliciesDir(): string {
  const candidates = [
    '/app/sample-policies',
    path.join(__dirname, '../../../sample-policies'),
    path.join(__dirname, '../../sample-policies'),
    path.join(__dirname, '../sample-policies')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return candidates[0];
}

/**
 * POST /api/v1/documents/seed
 * Idempotently loads all synthetic Thai bank policies (.md, .txt, .pdf) from sample-policies/ into PostgreSQL
 */
app.post('/api/v1/documents/seed', async (_req: Request, res: Response) => {
  try {
    const targetDir = resolveSamplePoliciesDir();
    const files = fs
      .readdirSync(targetDir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.pdf'))
      .sort();

    // Reset and seed all 16 policies deterministically (IDs 1..16)
    await pool.query('TRUNCATE TABLE document_chunks, policy_documents RESTART IDENTITY CASCADE');
    const results: IngestDocumentResult[] = [];
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const ext = path.extname(file).toLowerCase();
      const isPdf = ext === '.pdf';

      const content = isPdf
        ? extractTextFromPdfBuffer(fs.readFileSync(filePath))
        : fs.readFileSync(filePath, 'utf-8');

      const parsedMeta = parsePolicyMetadata(content, file);

      const ingested = await ingestDocument({
        title: parsedMeta.title,
        department: parsedMeta.department,
        version: parsedMeta.version,
        content,
        metadata: {
          source_file: file,
          format: isPdf ? 'pdf' : ext.replace('.', ''),
          ...(parsedMeta.code ? { code: parsedMeta.code } : {})
        },
        replaceExisting: true
      });
      results.push(ingested);
    }

    const totalChunks = results.reduce((sum, item) => sum + item.chunksCount, 0);
    res.json({
      message: 'Sample policies seeded successfully',
      count: results.length,
      totalChunks,
      seeded: results
    });
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
      ORDER BY d.id ASC
    `);
    res.json({ count: rows.length, documents: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `[Ingestion Service] Running on port ${PORT} (AI_PROVIDER=${process.env.AI_PROVIDER || 'mock'}, EMBEDDING_PROVIDER=${resolveEmbeddingProvider()})`
    );
  });
}
