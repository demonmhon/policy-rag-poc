import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import {
  generateEmbedding,
  resolveAIProvider,
  resolveEmbeddingProvider,
  synthesizeAnswerWithUsage,
  RetrievedChunk
} from './llm';
import {
  evaluateInputGuardrails,
  evaluatePostRetrievalGuardrails,
  redactPii,
  GuardrailAction,
  GuardrailCategory
} from './guardrails';

export const app = express();
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIN_SIMILARITY_THRESHOLD = parseFloat(process.env.MIN_SIMILARITY_THRESHOLD || '0.16');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

export interface AskRequestBody {
  question?: unknown;
  department?: unknown;
  topK?: unknown;
}

export interface CitationItem {
  chunkId: number;
  documentId: number;
  title: string;
  department: string;
  version: string;
  chunkIndex: number;
  similarity: number;
  excerpt: string;
}

export interface GuardrailsResponseBlock {
  triggered: boolean;
  action: GuardrailAction;
  reason: string | null;
  category: GuardrailCategory;
  piiRedacted: boolean;
  piiTypes: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  question: string;
  department: string | null;
  topK: number;
}

export function validateAskInput(body: AskRequestBody): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return {
      valid: false,
      errors: ['Request body must be a valid JSON object.'],
      question: '',
      department: null,
      topK: 3
    };
  }

  if (typeof body.question !== 'string') {
    errors.push('Field "question" is required and must be a string.');
  }

  const trimmedQuestion = typeof body.question === 'string' ? body.question.trim() : '';
  if (typeof body.question === 'string') {
    if (trimmedQuestion.length === 0) {
      errors.push('Field "question" cannot be empty.');
    } else if (trimmedQuestion.length > 1000) {
      errors.push('Field "question" must not exceed 1,000 characters.');
    }
  }

  let parsedTopK = 3;
  if (body.topK !== undefined && body.topK !== null && body.topK !== '') {
    const numTopK = Number(body.topK);
    if (!Number.isInteger(numTopK) || numTopK < 1 || numTopK > 10) {
      errors.push('Field "topK" must be an integer between 1 and 10.');
    } else {
      parsedTopK = numTopK;
    }
  }

  let normalizedDept: string | null = null;
  if (body.department !== undefined && body.department !== null) {
    if (typeof body.department !== 'string') {
      errors.push('Field "department" must be a string when provided.');
    } else {
      const trimmedDept = body.department.trim();
      if (trimmedDept.length > 100) {
        errors.push('Field "department" must not exceed 100 characters.');
      } else if (trimmedDept && trimmedDept.toLowerCase() !== 'all') {
        normalizedDept = trimmedDept;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    question: trimmedQuestion,
    department: normalizedDept,
    topK: parsedTopK
  };
}

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'policy-query-service',
      aiProvider: resolveAIProvider(),
      embeddingProvider: resolveEmbeddingProvider()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message });
  }
});

async function handleAskRequest(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const validation = validateAskInput(req.body as AskRequestBody);

  if (!validation.valid) {
    res.status(400).json({
      requestId,
      status: 'validation_error',
      error: validation.errors[0],
      details: validation.errors
    });
    return;
  }

  const { question: rawQuestion, department, topK } = validation;

  try {
    // 1. Pre-retrieval input guardrails (PII redaction, Prompt Injection, Customer Data Refusal)
    const inputGuard = evaluateInputGuardrails(rawQuestion);
    const sanitizedQuestion = inputGuard.sanitizedQuestion;

    if (inputGuard.action === 'refused') {
      const guardrails: GuardrailsResponseBlock = {
        triggered: true,
        action: 'refused',
        reason: inputGuard.reason,
        category: inputGuard.category,
        piiRedacted: inputGuard.piiRedacted,
        piiTypes: inputGuard.piiTypes
      };

      res.json({
        requestId,
        status: 'refused',
        question: sanitizedQuestion,
        departmentFilter: department,
        aiProvider: resolveAIProvider(),
        embeddingProvider: resolveEmbeddingProvider(),
        answer: inputGuard.refusalMessage,
        citations: [],
        guardrails
      });
      return;
    }

    // 2. Embed sanitized query & retrieve chunks from pgvector
    const queryEmbedding = await generateEmbedding(sanitizedQuestion);
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
        AND ($2::text IS NULL OR LOWER(d.department) = LOWER($2::text))
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $3::int
    `;

    const { rows: retrievedChunks } = await pool.query<RetrievedChunk>(sql, [
      vectorLiteral,
      department,
      topK
    ]);

    const maxSimilarity = retrievedChunks.length > 0 ? Number(retrievedChunks[0].similarity) : 0;

    // 3. Post-retrieval out-of-scope similarity threshold check
    const postGuard = evaluatePostRetrievalGuardrails(
      inputGuard,
      maxSimilarity,
      MIN_SIMILARITY_THRESHOLD
    );

    if (postGuard.action === 'refused') {
      const guardrails: GuardrailsResponseBlock = {
        triggered: true,
        action: 'refused',
        reason: postGuard.reason,
        category: postGuard.category,
        piiRedacted: postGuard.piiRedacted,
        piiTypes: postGuard.piiTypes
      };

      res.json({
        requestId,
        status: 'refused',
        question: sanitizedQuestion,
        departmentFilter: department,
        aiProvider: resolveAIProvider(),
        embeddingProvider: resolveEmbeddingProvider(),
        answer: postGuard.refusalMessage,
        citations: [],
        guardrails
      });
      return;
    }

    // 4. Synthesize grounded answer & run output PII redaction
    const synthesis = await synthesizeAnswerWithUsage(sanitizedQuestion, retrievedChunks);
    const outputPii = redactPii(synthesis.answer);

    const combinedPiiTypes = Array.from(new Set([...postGuard.piiTypes, ...outputPii.piiTypes]));
    const piiRedacted = postGuard.piiRedacted || outputPii.piiRedacted;

    const guardrails: GuardrailsResponseBlock = {
      triggered: piiRedacted,
      action: piiRedacted ? 'redacted' : 'allowed',
      reason: piiRedacted ? `PII detected and redacted (${combinedPiiTypes.join(', ')}).` : null,
      category: piiRedacted ? 'pii_redacted' : 'none',
      piiRedacted,
      piiTypes: combinedPiiTypes
    };

    const citations: CitationItem[] = retrievedChunks.map((chunk) => ({
      chunkId: Number(chunk.id),
      documentId: Number(chunk.document_id),
      title: String(chunk.metadata?.title || 'Untitled Policy'),
      department: String(chunk.metadata?.department || 'General'),
      version: String(chunk.metadata?.version || '1.0'),
      chunkIndex: Number(chunk.chunk_index),
      similarity: Number(Number(chunk.similarity).toFixed(4)),
      excerpt: chunk.content
    }));

    res.json({
      requestId,
      status: 'answered',
      question: sanitizedQuestion,
      departmentFilter: department,
      aiProvider: synthesis.provider,
      embeddingProvider: resolveEmbeddingProvider(),
      answer: outputPii.redactedText,
      citations,
      guardrails
    });
  } catch (err) {
    console.error('RAG query error:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      requestId,
      status: 'error',
      error: message
    });
  }
}

/**
 * POST /ask (Primary endpoint required by Core Task 3)
 * POST /api/v1/query (Backward-compatible alias)
 */
app.post('/ask', handleAskRequest);
app.post('/api/v1/query', handleAskRequest);

const PORT = process.env.PORT || 3002;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `[Query Service] Running on port ${PORT} (AI_PROVIDER=${resolveAIProvider()}, EMBEDDING_PROVIDER=${resolveEmbeddingProvider()})`
    );
  });
}
