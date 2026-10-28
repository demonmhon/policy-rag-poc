import 'dotenv/config';
import path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';

export const app = express();

const PORT = Number(process.env.PORT || 3000);
const INGESTION_SERVICE_URL = process.env.INGESTION_SERVICE_URL || 'http://localhost:3001';
const QUERY_SERVICE_URL = process.env.QUERY_SERVICE_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'policy-web-ui',
    ingestionServiceUrl: INGESTION_SERVICE_URL,
    queryServiceUrl: QUERY_SERVICE_URL
  });
});

app.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const [ingHealthRes, queryHealthRes, docsRes] = await Promise.all([
      fetch(`${INGESTION_SERVICE_URL}/health`),
      fetch(`${QUERY_SERVICE_URL}/health`),
      fetch(`${INGESTION_SERVICE_URL}/api/v1/documents`)
    ]);

    const ingHealth = ingHealthRes.ok ? await ingHealthRes.json() : { status: 'error' };
    const queryHealth = queryHealthRes.ok ? await queryHealthRes.json() : { status: 'error' };
    const docsData = docsRes.ok
      ? ((await docsRes.json()) as { count?: number; documents?: unknown[] })
      : { count: 0, documents: [] };

    res.json({
      status: 'ok',
      ingestion: ingHealth,
      query: queryHealth,
      corpus: {
        count: docsData.count ?? 0,
        documents: docsData.documents ?? []
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ status: 'error', message });
  }
});

app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${QUERY_SERVICE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const payload = await upstream.json();
    res.status(upstream.status).json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ status: 'error', error: message });
  }
});

app.post('/api/seed', async (_req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${INGESTION_SERVICE_URL}/api/v1/documents/seed`, {
      method: 'POST'
    });
    const payload = await upstream.json();
    res.status(upstream.status).json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ status: 'error', error: message });
  }
});

app.get('/api/documents', async (_req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${INGESTION_SERVICE_URL}/api/v1/documents`);
    const payload = await upstream.json();
    res.status(upstream.status).json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ status: 'error', error: message });
  }
});

app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `[Web UI] Running on http://localhost:${PORT} (Query=${QUERY_SERVICE_URL}, Ingestion=${INGESTION_SERVICE_URL})`
    );
  });
}
