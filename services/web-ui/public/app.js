(() => {
  const askForm = document.getElementById('askForm');
  const departmentSelect = document.getElementById('departmentSelect');
  const topKSelect = document.getElementById('topKSelect');
  const questionInput = document.getElementById('questionInput');
  const questionHelp = document.getElementById('questionHelp');
  const charCounter = document.getElementById('charCounter');
  const askSubmitBtn = document.getElementById('askSubmitBtn');
  const clearBtn = document.getElementById('clearBtn');
  const seedBtn = document.getElementById('seedBtn');

  const providerLabel = document.getElementById('providerLabel');
  const corpusCountLabel = document.getElementById('corpusCountLabel');

  const resultSection = document.getElementById('resultSection');
  const requestIdBadge = document.getElementById('requestIdBadge');
  const statusBadge = document.getElementById('statusBadge');
  const guardrailAlert = document.getElementById('guardrailAlert');
  const guardrailTitle = document.getElementById('guardrailTitle');
  const guardrailDesc = document.getElementById('guardrailDesc');
  const sanitizedQuestionText = document.getElementById('sanitizedQuestionText');
  const answerBody = document.getElementById('answerBody');

  const telTotalMs = document.getElementById('telTotalMs');
  const telBreakdownMs = document.getElementById('telBreakdownMs');
  const telTokens = document.getElementById('telTokens');
  const telModelSim = document.getElementById('telModelSim');

  const citationCountBadge = document.getElementById('citationCountBadge');
  const citationsList = document.getElementById('citationsList');

  const toggleCorpusBtn = document.getElementById('toggleCorpusBtn');
  const corpusTableWrapper = document.getElementById('corpusTableWrapper');
  const corpusTableBody = document.getElementById('corpusTableBody');

  const defaultHelpText =
    'ระบุคำถามความยาว 1–1,000 ตัวอักษร ระบบจะปิดบังเลขบัตรประชาชน เบอร์โทรศัพท์ และอีเมลโดยอัตโนมัติ';

  function updateCharCounter() {
    const len = questionInput.value.length;
    charCounter.textContent = `${len.toLocaleString()} / 1,000`;
    if (questionInput.classList.contains('input-error') && questionInput.value.trim().length > 0) {
      questionInput.classList.remove('input-error');
      questionHelp.classList.remove('error');
      questionHelp.textContent = defaultHelpText;
    }
  }

  questionInput.addEventListener('input', updateCharCounter);

  clearBtn.addEventListener('click', () => {
    questionInput.value = '';
    departmentSelect.value = '';
    updateCharCounter();
    questionInput.focus();
  });

  toggleCorpusBtn.addEventListener('click', () => {
    corpusTableWrapper.classList.toggle('hidden');
  });

  async function loadSystemStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();

      const aiProvider = data.query?.aiProvider || 'mock';
      const embProvider = data.query?.embeddingProvider || 'mock';
      providerLabel.textContent = `AI: ${aiProvider} | Emb: ${embProvider}`;

      const docs = data.corpus?.documents || [];
      corpusCountLabel.textContent = `${docs.length} เอกสารนโยบาย`;
      toggleCorpusBtn.textContent = `แสดง/ซ่อนรายการเอกสาร (${docs.length})`;

      renderCorpusTable(docs);
    } catch (err) {
      console.error('Status load error:', err);
    }
  }

  function renderCorpusTable(docs) {
    corpusTableBody.innerHTML = '';
    if (!docs || docs.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty-cell';
      td.textContent = 'ยังไม่มีเอกสารในระบบ กรุณากดปุ่ม Re-seed Corpus ด้านบน';
      tr.appendChild(td);
      corpusTableBody.appendChild(tr);
      return;
    }

    for (const doc of docs) {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.textContent = `#${doc.id}`;

      const tdTitle = document.createElement('td');
      tdTitle.style.fontWeight = '600';
      tdTitle.style.color = '#002D63';
      tdTitle.textContent = doc.title;

      const tdDept = document.createElement('td');
      const deptSpan = document.createElement('span');
      deptSpan.className = 'meta-tag';
      deptSpan.textContent = doc.department;
      tdDept.appendChild(deptSpan);

      const tdVer = document.createElement('td');
      tdVer.textContent = doc.version;

      const tdChunks = document.createElement('td');
      tdChunks.textContent = `${doc.chunk_count} chunks`;

      tr.append(tdId, tdTitle, tdDept, tdVer, tdChunks);
      corpusTableBody.appendChild(tr);
    }
  }

  seedBtn.addEventListener('click', async () => {
    seedBtn.disabled = true;
    const prevText = seedBtn.textContent;
    seedBtn.textContent = 'Seeding 16 Docs...';
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Seed failed: ${res.status}`);
      }
      await loadSystemStatus();
      seedBtn.textContent = 'Seeded 16 Docs ✓';
      setTimeout(() => {
        seedBtn.textContent = prevText;
      }, 2000);
    } catch (err) {
      console.error(err);
      seedBtn.textContent = 'Seed Error';
      setTimeout(() => {
        seedBtn.textContent = prevText;
      }, 2000);
    } finally {
      seedBtn.disabled = false;
    }
  });

  async function executeQuery(question, department, topK) {
    const trimmed = (question || '').trim();
    if (!trimmed) {
      questionInput.classList.add('input-error');
      questionHelp.classList.add('error');
      questionHelp.textContent = 'กรุณาระบุคำถามก่อนกดค้นหา (Field "question" cannot be empty)';
      questionInput.focus();
      return;
    }

    askSubmitBtn.disabled = true;
    const originalBtnText = askSubmitBtn.textContent;
    askSubmitBtn.textContent = 'กำลังค้นคว้าและประมวลผลคำตอบ...';

    try {
      const payload = {
        question: trimmed,
        department: department || null,
        topK: Number(topK) || 3
      };

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        questionInput.classList.add('input-error');
        questionHelp.classList.add('error');
        questionHelp.textContent = data.error || 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล';
        return;
      }

      renderQueryResult(data);
    } catch (err) {
      questionInput.classList.add('input-error');
      questionHelp.classList.add('error');
      questionHelp.textContent = `ไม่สามารถเชื่อมต่อบริการ Query Service ได้: ${err.message}`;
    } finally {
      askSubmitBtn.disabled = false;
      askSubmitBtn.textContent = originalBtnText;
    }
  }

  function renderQueryResult(data) {
    resultSection.classList.remove('hidden');
    requestIdBadge.textContent = `Request ID: ${data.requestId || '-'}`;
    sanitizedQuestionText.textContent = data.question || '-';
    answerBody.textContent = data.answer || '-';

    const guardrails = data.guardrails || {};
    if (data.status === 'refused' || guardrails.action === 'refused') {
      statusBadge.className = 'badge badge-orange';
      statusBadge.textContent = 'Guardrail Refused';
      guardrailAlert.classList.remove('hidden');
      guardrailTitle.textContent = `Banking Guardrail Blocked (${guardrails.category || 'refused'})`;
      guardrailDesc.textContent =
        guardrails.reason || 'คำถามนี้ถูกปฏิเสธตามหลักเกณฑ์ความปลอดภัยของธนาคาร';
    } else if (guardrails.piiRedacted || guardrails.action === 'redacted') {
      statusBadge.className = 'badge badge-orange';
      statusBadge.textContent = 'PII Redacted & Answered';
      guardrailAlert.classList.remove('hidden');
      guardrailTitle.textContent = `PII Redaction Active (${(guardrails.piiTypes || []).join(', ')})`;
      guardrailDesc.textContent =
        guardrails.reason || 'ระบบได้ทำการปกปิดข้อมูลส่วนบุคคล (PII) ก่อนส่งประมวลผลเรียบร้อยแล้ว';
    } else {
      statusBadge.className = 'badge badge-blue';
      statusBadge.textContent = 'Grounded Answer';
      guardrailAlert.classList.add('hidden');
    }

    // Telemetry
    const tel = data.telemetry || {};
    const lat = tel.latencyMs || {};
    const tok = tel.tokens || {};

    telTotalMs.textContent = lat.totalMs !== undefined ? `${lat.totalMs} ms` : '-';
    telBreakdownMs.textContent =
      lat.totalMs !== undefined
        ? `${lat.guardrailsMs} / ${lat.embeddingMs} / ${lat.retrievalMs} / ${lat.generationMs} ms`
        : '-';
    telTokens.textContent =
      tok.totalTokens !== undefined
        ? `${tok.promptTokens} + ${tok.completionTokens} = ${tok.totalTokens}`
        : '-';
    telModelSim.textContent = `${tel.provider || data.aiProvider || 'mock'} · sim ${(tel.maxSimilarity ?? 0).toFixed(4)}`;

    // Citations
    const citations = data.citations || [];
    citationCountBadge.textContent = `${citations.length} Chunks`;
    citationsList.innerHTML = '';

    if (citations.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-cell';
      emptyDiv.textContent =
        'ไม่มีเอกสารอ้างอิงที่แสดงผล (คำขอถูกคัดกรองโดย Guardrail หรืออยู่นอกขอบเขตนโยบายธนาคาร)';
      citationsList.appendChild(emptyDiv);
      return;
    }

    citations.forEach((cit, idx) => {
      const card = document.createElement('div');
      card.className = 'citation-item';

      const top = document.createElement('div');
      top.className = 'citation-top';

      const title = document.createElement('h4');
      title.className = 'citation-title';
      title.textContent = `[#${idx + 1}] ${cit.title}`;

      top.appendChild(title);

      const metaRow = document.createElement('div');
      metaRow.className = 'citation-meta';

      const simTag = document.createElement('span');
      simTag.className = 'meta-tag meta-tag-sim';
      simTag.textContent = `Similarity: ${(Number(cit.similarity) * 100).toFixed(1)}% (${Number(cit.similarity).toFixed(4)})`;

      const deptTag = document.createElement('span');
      deptTag.className = 'meta-tag';
      deptTag.textContent = `แผนก: ${cit.department}`;

      const chunkTag = document.createElement('span');
      chunkTag.className = 'meta-tag';
      chunkTag.textContent = `Chunk #${cit.chunkIndex} · v${cit.version}`;

      metaRow.append(simTag, deptTag, chunkTag);

      const excerpt = document.createElement('div');
      excerpt.className = 'citation-excerpt';
      excerpt.textContent = cit.excerpt;

      card.append(top, metaRow, excerpt);
      citationsList.appendChild(card);
    });
  }

  askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    executeQuery(questionInput.value, departmentSelect.value, topKSelect.value);
  });

  document.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-question') || '';
      const dept = btn.getAttribute('data-dept') || '';
      questionInput.value = q;
      departmentSelect.value = dept;
      updateCharCounter();
      executeQuery(q, dept, topKSelect.value);
    });
  });

  loadSystemStatus();
})();
