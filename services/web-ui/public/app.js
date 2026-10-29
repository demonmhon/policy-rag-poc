(() => {
  // Mode Switcher Elements
  const simpleModeBtn = document.getElementById('simpleModeBtn');
  const devModeBtn = document.getElementById('devModeBtn');

  // Simple Mode Elements
  const simpleAskForm = document.getElementById('simpleAskForm');
  const simpleQuestionInput = document.getElementById('simpleQuestionInput');
  const simpleSubmitBtn = document.getElementById('simpleSubmitBtn');
  const simpleChatStream = document.getElementById('simpleChatStream');
  const simpleWelcome = document.getElementById('simpleWelcome');

  // Developer Mode Elements
  const devAskForm = document.getElementById('devAskForm');
  const devDepartmentSelect = document.getElementById('devDepartmentSelect');
  const devTopKSelect = document.getElementById('devTopKSelect');
  const devQuestionInput = document.getElementById('devQuestionInput');
  const devQuestionHelp = document.getElementById('devQuestionHelp');
  const devCharCounter = document.getElementById('devCharCounter');
  const devAskSubmitBtn = document.getElementById('devAskSubmitBtn');
  const devClearBtn = document.getElementById('devClearBtn');
  const seedBtn = document.getElementById('seedBtn');

  const providerLabel = document.getElementById('providerLabel');
  const corpusCountLabel = document.getElementById('corpusCountLabel');

  const devResultSection = document.getElementById('devResultSection');
  const devRequestIdBadge = document.getElementById('devRequestIdBadge');
  const devStatusBadge = document.getElementById('devStatusBadge');
  const devGuardrailAlert = document.getElementById('devGuardrailAlert');
  const devGuardrailTitle = document.getElementById('devGuardrailTitle');
  const devGuardrailDesc = document.getElementById('devGuardrailDesc');
  const devSanitizedQuestionText = document.getElementById('devSanitizedQuestionText');
  const devAnswerBody = document.getElementById('devAnswerBody');

  const devTelTotalMs = document.getElementById('devTelTotalMs');
  const devTelBreakdownMs = document.getElementById('devTelBreakdownMs');
  const devTelTokens = document.getElementById('devTelTokens');
  const devTelModelSim = document.getElementById('devTelModelSim');

  const devCitationCountBadge = document.getElementById('devCitationCountBadge');
  const devCitationsList = document.getElementById('devCitationsList');

  const devToggleCorpusBtn = document.getElementById('devToggleCorpusBtn');
  const devCorpusTableWrapper = document.getElementById('devCorpusTableWrapper');
  const devCorpusTableBody = document.getElementById('devCorpusTableBody');

  // ==========================================
  // Mode Switcher Handling
  // ==========================================
  function setMode(mode) {
    if (mode === 'developer') {
      document.body.className = 'mode-developer';
      simpleModeBtn.classList.remove('active');
      simpleModeBtn.setAttribute('aria-selected', 'false');
      devModeBtn.classList.add('active');
      devModeBtn.setAttribute('aria-selected', 'true');
      localStorage.setItem('bank_policy_ui_mode', 'developer');
    } else {
      document.body.className = 'mode-simple';
      devModeBtn.classList.remove('active');
      devModeBtn.setAttribute('aria-selected', 'false');
      simpleModeBtn.classList.add('active');
      simpleModeBtn.setAttribute('aria-selected', 'true');
      localStorage.setItem('bank_policy_ui_mode', 'simple');
    }
  }

  simpleModeBtn.addEventListener('click', () => setMode('simple'));
  devModeBtn.addEventListener('click', () => setMode('developer'));

  const savedMode = localStorage.getItem('bank_policy_ui_mode') || 'simple';
  setMode(savedMode);

  // ==========================================
  // Auto-resizable Textarea Logic
  // ==========================================
  function autoResizeTextarea(el, minHeight = 40, maxHeight = 200) {
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
  }

  simpleQuestionInput.addEventListener('input', () => {
    autoResizeTextarea(simpleQuestionInput, 40, 200);
  });

  // Enter to send (Shift+Enter for newline)
  simpleQuestionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      simpleAskForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // Developer mode counter
  devQuestionInput.addEventListener('input', () => {
    const len = devQuestionInput.value.length;
    devCharCounter.textContent = `${len.toLocaleString()} / 1,000`;
    if (devQuestionInput.classList.contains('input-error') && devQuestionInput.value.trim().length > 0) {
      devQuestionInput.classList.remove('input-error');
      devQuestionHelp.classList.remove('error');
      devQuestionHelp.textContent =
        'ระบุคำถามความยาว 1–1,000 ตัวอักษร ระบบจะปิดบังเลขบัตรประชาชน เบอร์โทรศัพท์ และอีเมลโดยอัตโนมัติ';
    }
  });

  devClearBtn.addEventListener('click', () => {
    devQuestionInput.value = '';
    devDepartmentSelect.value = '';
    devCharCounter.textContent = '0 / 1,000';
    devQuestionInput.focus();
  });

  devToggleCorpusBtn.addEventListener('click', () => {
    devCorpusTableWrapper.classList.toggle('hidden');
  });

  // ==========================================
  // Simple Mode Chat Stream
  // ==========================================
  async function submitSimpleQuestion(questionText) {
    const trimmed = (questionText || '').trim();
    if (!trimmed) {
      simpleQuestionInput.focus();
      return;
    }

    if (simpleWelcome) {
      simpleWelcome.style.display = 'none';
    }

    // Append User Message Bubble
    appendChatMessage('user', trimmed);

    // Append Assistant Loading Bubble
    const loadingBubble = appendChatMessage('assistant', 'กำลังค้นคว้าและประมวลผลคำตอบจากระเบียบธนาคาร...', true);

    simpleSubmitBtn.disabled = true;
    simpleQuestionInput.disabled = true;

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          department: null,
          topK: 3
        })
      });

      const data = await res.json();
      loadingBubble.remove();

      if (!res.ok) {
        appendChatMessage('assistant', `⚠️ ขออภัย เกิดข้อผิดพลาด: ${data.error || 'ไม่สามารถติดต่อระบบได้'}`);
        return;
      }

      // Check guardrails for simple badge
      const guardrails = data.guardrails || {};
      let badgeHtml = '';
      let isRefused = false;

      if (data.status === 'refused' || guardrails.action === 'refused') {
        isRefused = true;
        badgeHtml = '<div class="msg-status-badge badge-refusal">🛡️ Banking Guardrail Refusal</div>';
      } else if (guardrails.piiRedacted) {
        badgeHtml = `<div class="msg-status-badge badge-pii">🔒 ปกปิดข้อมูลส่วนบุคคล (${(guardrails.piiTypes || []).join(', ')})</div>`;
      }

      appendChatMessage('assistant', `${badgeHtml}${data.answer}`, false, isRefused);

      // Keep developer view in sync so switching modes immediately reflects the result
      renderDeveloperResult(data);
      devQuestionInput.value = trimmed;
      devCharCounter.textContent = `${trimmed.length.toLocaleString()} / 1,000`;
    } catch (err) {
      loadingBubble.remove();
      appendChatMessage('assistant', `⚠️ ไม่สามารถเชื่อมต่อบริการได้: ${err.message}`);
    } finally {
      simpleSubmitBtn.disabled = false;
      simpleQuestionInput.disabled = false;
      simpleQuestionInput.value = '';
      autoResizeTextarea(simpleQuestionInput, 40, 200);
      simpleQuestionInput.focus();
    }
  }

  function appendChatMessage(sender, text, isLoading = false, isRefused = false) {
    const row = document.createElement('div');
    row.className = sender === 'user' ? 'chat-row user-row' : 'chat-row';

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender === 'user' ? 'user-bubble' : 'assistant-bubble'}${isRefused ? ' refused' : ''}`;

    if (isLoading) {
      bubble.style.fontStyle = 'italic';
      bubble.style.color = '#52667A';
    }

    bubble.innerHTML = text;
    row.appendChild(bubble);
    simpleChatStream.appendChild(row);

    // Auto-scroll to bottom
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return row;
  }

  simpleAskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSimpleQuestion(simpleQuestionInput.value);
  });

  // Simple Mode Sample Chips
  document.querySelectorAll('.simple-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-question') || '';
      submitSimpleQuestion(q);
    });
  });

  // ==========================================
  // Developer Mode Query Logic
  // ==========================================
  async function executeDeveloperQuery(question, department, topK) {
    const trimmed = (question || '').trim();
    if (!trimmed) {
      devQuestionInput.classList.add('input-error');
      devQuestionHelp.classList.add('error');
      devQuestionHelp.textContent = 'กรุณาระบุคำถามก่อนกดค้นหา (Field "question" cannot be empty)';
      devQuestionInput.focus();
      return;
    }

    devAskSubmitBtn.disabled = true;
    const originalBtnText = devAskSubmitBtn.textContent;
    devAskSubmitBtn.textContent = 'กำลังค้นคว้าและประมวลผลคำตอบ...';

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
        devQuestionInput.classList.add('input-error');
        devQuestionHelp.classList.add('error');
        devQuestionHelp.textContent = data.error || 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล';
        return;
      }

      renderDeveloperResult(data);
    } catch (err) {
      devQuestionInput.classList.add('input-error');
      devQuestionHelp.classList.add('error');
      devQuestionHelp.textContent = `ไม่สามารถเชื่อมต่อบริการ Query Service ได้: ${err.message}`;
    } finally {
      devAskSubmitBtn.disabled = false;
      devAskSubmitBtn.textContent = originalBtnText;
    }
  }

  function renderDeveloperResult(data) {
    devResultSection.classList.remove('hidden');
    devRequestIdBadge.textContent = `Request ID: ${data.requestId || '-'}`;
    devSanitizedQuestionText.textContent = data.question || '-';
    devAnswerBody.textContent = data.answer || '-';

    const guardrails = data.guardrails || {};
    if (data.status === 'refused' || guardrails.action === 'refused') {
      devStatusBadge.className = 'badge badge-orange';
      devStatusBadge.textContent = 'Guardrail Refused';
      devGuardrailAlert.classList.remove('hidden');
      devGuardrailTitle.textContent = `Banking Guardrail Blocked (${guardrails.category || 'refused'})`;
      devGuardrailDesc.textContent =
        guardrails.reason || 'คำถามนี้ถูกปฏิเสธตามหลักเกณฑ์ความปลอดภัยของธนาคาร';
    } else if (guardrails.piiRedacted || guardrails.action === 'redacted') {
      devStatusBadge.className = 'badge badge-orange';
      devStatusBadge.textContent = 'PII Redacted & Answered';
      devGuardrailAlert.classList.remove('hidden');
      devGuardrailTitle.textContent = `PII Redaction Active (${(guardrails.piiTypes || []).join(', ')})`;
      devGuardrailDesc.textContent =
        guardrails.reason || 'ระบบได้ทำการปกปิดข้อมูลส่วนบุคคล (PII) ก่อนส่งประมวลผลเรียบร้อยแล้ว';
    } else {
      devStatusBadge.className = 'badge badge-blue';
      devStatusBadge.textContent = 'Grounded Answer';
      devGuardrailAlert.classList.add('hidden');
    }

    // Telemetry
    const tel = data.telemetry || {};
    const lat = tel.latencyMs || {};
    const tok = tel.tokens || {};

    devTelTotalMs.textContent = lat.totalMs !== undefined ? `${lat.totalMs} ms` : '-';
    devTelBreakdownMs.textContent =
      lat.totalMs !== undefined
        ? `${lat.guardrailsMs} / ${lat.embeddingMs} / ${lat.retrievalMs} / ${lat.generationMs} ms`
        : '-';
    devTelTokens.textContent =
      tok.totalTokens !== undefined
        ? `${tok.promptTokens} + ${tok.completionTokens} = ${tok.totalTokens}`
        : '-';
    devTelModelSim.textContent = `${tel.provider || data.aiProvider || 'mock'} · sim ${(tel.maxSimilarity ?? 0).toFixed(4)}`;

    // Citations
    const citations = data.citations || [];
    devCitationCountBadge.textContent = `${citations.length} Chunks`;
    devCitationsList.innerHTML = '';

    if (citations.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-cell';
      emptyDiv.textContent =
        'ไม่มีเอกสารอ้างอิงที่แสดงผล (คำขอถูกคัดกรองโดย Guardrail หรืออยู่นอกขอบเขตนโยบายธนาคาร)';
      devCitationsList.appendChild(emptyDiv);
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
      devCitationsList.appendChild(card);
    });
  }

  devAskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    executeDeveloperQuery(devQuestionInput.value, devDepartmentSelect.value, devTopKSelect.value);
  });

  document.querySelectorAll('#devPolicyChips .chip, .chip-guardrail').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-question') || '';
      const dept = btn.getAttribute('data-dept') || '';
      devQuestionInput.value = q;
      devDepartmentSelect.value = dept;
      devCharCounter.textContent = `${q.length.toLocaleString()} / 1,000`;
      executeDeveloperQuery(q, dept, devTopKSelect.value);
    });
  });

  // ==========================================
  // Status and Corpus Table Loading
  // ==========================================
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
      devToggleCorpusBtn.textContent = `แสดง/ซ่อนรายการเอกสาร (${docs.length})`;

      renderCorpusTable(docs);
    } catch (err) {
      console.error('Status load error:', err);
    }
  }

  function renderCorpusTable(docs) {
    devCorpusTableBody.innerHTML = '';
    if (!docs || docs.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty-cell';
      td.textContent = 'ยังไม่มีเอกสารในระบบ กรุณากดปุ่ม Re-seed Corpus ด้านบน';
      tr.appendChild(td);
      devCorpusTableBody.appendChild(tr);
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
      devCorpusTableBody.appendChild(tr);
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

  loadSystemStatus();
})();
