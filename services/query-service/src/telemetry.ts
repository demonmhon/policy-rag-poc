import { performance } from 'perf_hooks';
import { TokenUsage } from './llm';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LatencyBreakdown {
  guardrailsMs: number;
  embeddingMs: number;
  retrievalMs: number;
  generationMs: number;
  totalMs: number;
}

export interface RequestTelemetry {
  latencyMs: LatencyBreakdown;
  tokens: TokenUsage;
  provider: string;
  model: string;
  embeddingProvider: string;
  retrievedChunksCount: number;
  maxSimilarity: number;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  requestId: string;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Emits a structured single-line JSON log entry for observability pipelines (ELK, Datadog, CloudWatch).
 */
export function logStructured(
  level: LogLevel,
  event: string,
  requestId: string,
  data: Record<string, unknown>,
  service = 'policy-query-service'
): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    requestId,
    event,
    data
  };

  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }

  return entry;
}

/**
 * High-resolution per-stage latency tracker using performance.now().
 */
export class RequestStageTimer {
  private readonly requestStart: number;
  private guardrailsMs = 0;
  private embeddingMs = 0;
  private retrievalMs = 0;
  private generationMs = 0;

  constructor() {
    this.requestStart = performance.now();
  }

  addGuardrailsTime(ms: number): void {
    this.guardrailsMs += ms;
  }

  setEmbeddingTime(ms: number): void {
    this.embeddingMs = ms;
  }

  setRetrievalTime(ms: number): void {
    this.retrievalMs = ms;
  }

  setGenerationTime(ms: number): void {
    this.generationMs = ms;
  }

  snapshot(): LatencyBreakdown {
    const totalMs = performance.now() - this.requestStart;
    return {
      guardrailsMs: Number(this.guardrailsMs.toFixed(2)),
      embeddingMs: Number(this.embeddingMs.toFixed(2)),
      retrievalMs: Number(this.retrievalMs.toFixed(2)),
      generationMs: Number(this.generationMs.toFixed(2)),
      totalMs: Number(totalMs.toFixed(2))
    };
  }
}

export function measureNow(): number {
  return performance.now();
}
