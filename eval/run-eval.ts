import fs from 'fs';
import path from 'path';

export interface EvalTestCase {
  id: string;
  category: 'grounded' | 'adversarial' | 'out_of_scope';
  question: string;
  department: string | null;
  expectedPolicy: string | null;
  expectedStatus: 'answered' | 'refused';
  groundingKeywords: Array<string | string[]>;
  expectedGuardrailCategory?: string;
  description: string;
}

export interface EvalResultRow {
  id: string;
  category: string;
  questionExcerpt: string;
  retrievalPass: boolean;
  groundedPass: boolean;
  guardrailPass: boolean;
  latencyMs: number;
  tokens: number;
  overallPass: boolean;
  details: string;
}

const QUERY_SERVICE_URL = process.env.QUERY_SERVICE_URL || 'http://localhost:3002';

async function main(): Promise<void> {
  const datasetPath = path.join(__dirname, 'dataset.json');
  if (!fs.existsSync(datasetPath)) {
    console.error(`Evaluation dataset not found at ${datasetPath}`);
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as EvalTestCase[];

  console.log(`\n================================================================================`);
  console.log(`🏦 BANK POLICY ASSISTANT RAG — AUTOMATED EVALUATION HARNESS`);
  console.log(`Target Service: ${QUERY_SERVICE_URL}/ask`);
  console.log(`Dataset Size:   ${dataset.length} Questions (10 Grounded + 3 Adversarial/Out-of-Scope)`);
  console.log(`Timestamp:      ${new Date().toISOString()}`);
  console.log(`================================================================================\n`);

  // Ensure query service is reachable
  try {
    const healthRes = await fetch(`${QUERY_SERVICE_URL}/health`);
    if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
    const health = (await healthRes.json()) as { aiProvider?: string; embeddingProvider?: string };
    console.log(`Connected to Query Service! (AI: ${health.aiProvider}, Embeddings: ${health.embeddingProvider})\n`);
  } catch (err) {
    console.error(`ERROR: Query service unreachable at ${QUERY_SERVICE_URL}/health`);
    console.error(`Make sure the service is running (e.g., docker compose up -d)`);
    process.exit(1);
  }

  const results: EvalResultRow[] = [];
  let totalLatency = 0;
  let totalTokens = 0;

  for (const item of dataset) {
    const startTime = performance.now();
    let res: Response;
    try {
      res = await fetch(`${QUERY_SERVICE_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: item.question,
          department: item.department,
          topK: 3
        })
      });
    } catch (fetchErr) {
      const errMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      results.push({
        id: item.id,
        category: item.category,
        questionExcerpt: item.question.slice(0, 32) + '...',
        retrievalPass: false,
        groundedPass: false,
        guardrailPass: false,
        latencyMs: 0,
        tokens: 0,
        overallPass: false,
        details: `Fetch Error: ${errMessage}`
      });
      continue;
    }

    const elapsed = performance.now() - startTime;
    const data = (await res.json()) as {
      status?: string;
      answer?: string;
      citations?: Array<{ title?: string; similarity?: number }>;
      guardrails?: { action?: string; category?: string; reason?: string };
      telemetry?: {
        latencyMs?: { totalMs?: number };
        tokens?: { totalTokens?: number };
      };
    };

    const latency = data.telemetry?.latencyMs?.totalMs ?? Number(elapsed.toFixed(2));
    const tokens = data.telemetry?.tokens?.totalTokens ?? 0;
    totalLatency += latency;
    totalTokens += tokens;

    let retrievalPass = true;
    let groundedPass = true;
    let guardrailPass = true;
    const failureReasons: string[] = [];

    if (item.category === 'grounded') {
      // 1. Must be answered
      if (data.status !== 'answered') {
        groundedPass = false;
        failureReasons.push(`Expected status 'answered', got '${data.status}'`);
      }

      // 2. Retrieval check: must return citations and top citation should match expected policy
      const citations = data.citations || [];
      if (citations.length === 0) {
        retrievalPass = false;
        failureReasons.push('No citations returned');
      } else if (item.expectedPolicy) {
        const topTitle = citations[0].title || '';
        const hasExpected = citations.some((c) => (c.title || '').includes(item.expectedPolicy!));
        if (!hasExpected) {
          retrievalPass = false;
          failureReasons.push(`Expected citation matching '${item.expectedPolicy}', got '${topTitle}'`);
        }
      }

      // 3. Groundedness check: answer must contain required facts / numbers
      const answer = data.answer || '';
      for (const kw of item.groundingKeywords) {
        if (Array.isArray(kw)) {
          const matched = kw.some((opt) => answer.toLowerCase().includes(opt.toLowerCase()));
          if (!matched) {
            groundedPass = false;
            failureReasons.push(`Answer missing any of [${kw.join(', ')}]`);
          }
        } else {
          if (!answer.toLowerCase().includes(kw.toLowerCase())) {
            groundedPass = false;
            failureReasons.push(`Answer missing keyword '${kw}'`);
          }
        }
      }
    } else {
      // Adversarial / Out of Scope: must be refused
      retrievalPass = (data.citations || []).length === 0;
      if (!retrievalPass) {
        failureReasons.push(`Expected 0 citations on refusal, got ${data.citations?.length}`);
      }

      if (data.status !== 'refused' || data.guardrails?.action !== 'refused') {
        guardrailPass = false;
        failureReasons.push(`Expected refusal, got status '${data.status}' / action '${data.guardrails?.action}'`);
      }

      if (
        item.expectedGuardrailCategory &&
        data.guardrails?.category !== item.expectedGuardrailCategory
      ) {
        guardrailPass = false;
        failureReasons.push(
          `Expected guardrail '${item.expectedGuardrailCategory}', got '${data.guardrails?.category}'`
        );
      }

      groundedPass = true; // Not applicable for refusal
    }

    const overallPass = retrievalPass && groundedPass && guardrailPass;
    results.push({
      id: item.id,
      category: item.category,
      questionExcerpt: item.question.length > 36 ? item.question.slice(0, 36) + '...' : item.question,
      retrievalPass,
      groundedPass,
      guardrailPass,
      latencyMs: latency,
      tokens,
      overallPass,
      details: failureReasons.length > 0 ? failureReasons.join('; ') : 'OK'
    });
  }

  // Print Formatted Table
  console.log(
    `┌──────┬──────────────┬────────────────────────────────────────┬───────────┬──────────┬───────────┬────────────┬────────┬────────┐`
  );
  console.log(
    `│ ID   │ Category     │ Question Excerpt                       │ Retrieval │ Grounded │ Guardrail │ Latency    │ Tokens │ Result │`
  );
  console.log(
    `├──────┼──────────────┼────────────────────────────────────────┼───────────┼──────────┼───────────┼────────────┼────────┼────────┤`
  );

  for (const r of results) {
    const id = r.id.padEnd(4);
    const cat = r.category.padEnd(12);
    // Visual pad for Thai/English mixed strings
    const qRaw = r.questionExcerpt;
    const qPad = qRaw.padEnd(Math.max(qRaw.length, 38));
    const ret = (r.retrievalPass ? '  PASS ' : '  FAIL ').padEnd(9);
    const grd = (r.groundedPass ? '  PASS ' : '  FAIL ').padEnd(8);
    const grdRail = (r.guardrailPass ? '   PASS  ' : '   FAIL  ').padEnd(9);
    const lat = `${r.latencyMs.toFixed(0)} ms`.padStart(8);
    const tok = `${r.tokens}`.padStart(6);
    const result = r.overallPass ? '  PASS  ' : '  FAIL  ';

    console.log(
      `│ ${id} │ ${cat} │ ${qPad} │ ${ret} │ ${grd} │ ${grdRail} │ ${lat}   │ ${tok} │${result}│`
    );
  }

  console.log(
    `└──────┴──────────────┴────────────────────────────────────────┴───────────┴──────────┴───────────┴────────────┴────────┴────────┘\n`
  );

  // Compute Metrics
  const total = results.length;
  const passedCount = results.filter((r) => r.overallPass).length;
  const retrievalPassCount = results.filter((r) => r.retrievalPass).length;
  const groundedPassCount = results.filter((r) => r.groundedPass).length;
  const guardrailPassCount = results.filter((r) => r.guardrailPass).length;

  const avgLatency = (totalLatency / total).toFixed(2);
  const avgTokens = Math.round(totalTokens / total);
  const passRate = ((passedCount / total) * 100).toFixed(1);

  console.log(`📊 EVALUATION SUMMARY SCORECARD:`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`  • Overall Benchmark Score:     ${passedCount} / ${total} passed (${passRate}%)`);
  console.log(`  • Retrieval Accuracy:          ${retrievalPassCount} / ${total} (${((retrievalPassCount / total) * 100).toFixed(1)}%)`);
  console.log(`  • Groundedness / Correctness:  ${groundedPassCount} / ${total} (${((groundedPassCount / total) * 100).toFixed(1)}%)`);
  console.log(`  • Guardrail Refusal Accuracy:  ${guardrailPassCount} / ${total} (${((guardrailPassCount / total) * 100).toFixed(1)}%)`);
  console.log(`  • Average Latency:             ${avgLatency} ms`);
  console.log(`  • Average Tokens / Request:    ${avgTokens} tokens`);
  console.log(`--------------------------------------------------------------------------------\n`);

  if (passedCount < total) {
    console.log(`⚠️ Some evaluation test cases failed:`);
    for (const r of results) {
      if (!r.overallPass) {
        console.log(`  - [${r.id}] ${r.category}: ${r.details}`);
      }
    }
    console.log('');
    process.exit(1);
  } else {
    console.log(`🎉 ALL ${total} EVALUATION TEST CASES PASSED WITH 100% BENCHMARK SCORE!\n`);
  }
}

main().catch((err) => {
  console.error('Fatal eval harness error:', err);
  process.exit(1);
});
