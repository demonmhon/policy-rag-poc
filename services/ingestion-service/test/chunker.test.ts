import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/chunker';
import { parsePolicyMetadata } from '../src/pdfParser';

describe('Document Chunker (services/ingestion-service)', () => {
  it('returns empty array when text is empty or whitespace', () => {
    assert.deepStrictEqual(chunkText(''), []);
    assert.deepStrictEqual(chunkText('   \n\n\t  '), []);
  });

  it('preserves single paragraph within maxChunkSize', () => {
    const text = 'นโยบายการปฏิบัติงานด้านความปลอดภัยข้อมูลของธนาคารสำหรับพนักงานทุกคน';
    const chunks = chunkText(text, 500, 100);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], text);
  });

  it('splits multiple paragraphs by section boundaries', () => {
    const para1 = 'หมวดที่ 1: การยืนยันตัวตนพนักงานผ่านระบบ MFA และบัตรสมาร์ทการ์ดประจำตัว';
    const para2 = 'หมวดที่ 2: การเข้าถึงระบบสารสนเทศหลักของธนาคารต้องได้รับการอนุมัติล่วงหน้า';
    const fullText = `${para1}\n\n${para2}`;

    const chunks = chunkText(fullText, 80, 20);
    assert.ok(chunks.length >= 2, 'Should split into at least 2 chunks');
    assert.ok(chunks[0].includes('หมวดที่ 1'));
    assert.ok(chunks[1].includes('หมวดที่ 2'));
  });

  it('slices an oversized paragraph into overlapping chunks', () => {
    const longSentence = 'พนักงานประจำสาขาต้องปฏิบัติตามมาตรฐานการถือครองเงินสดอย่างเคร่งครัด ';
    const oversizedPara = longSentence.repeat(10); // ~700 chars
    const maxChunkSize = 150;
    const overlapSize = 30;

    const chunks = chunkText(oversizedPara, maxChunkSize, overlapSize);
    assert.ok(chunks.length > 1, 'Oversized paragraph must be divided into multiple chunks');

    for (const chunk of chunks) {
      assert.ok(
        chunk.length <= maxChunkSize,
        `Chunk length (${chunk.length}) must not exceed maxChunkSize (${maxChunkSize})`
      );
    }
  });

  it('correctly handles Thai bank policy section text with numbers and symbols', () => {
    const policyText = `## หมวดที่ 1: เกณฑ์วงเงินคู่ตรวจสอบ (Maker-Checker Limit)
การทำรายการโอนเงินระหว่างธนาคารที่มีมูลค่าเกิน 2,000,000 บาทขึ้นไป ต้องมีผู้ตรวจสอบและอนุมัติเสมอ

## หมวดที่ 2: วงเงินสูงสุดสำหรับผู้อำนวยการฝ่าย
ผู้อำนวยการฝ่ายสามารถอนุมัติวงเงินโอนสูงสุดไม่เกิน 50,000,000 บาทต่อรายการ`;

    const chunks = chunkText(policyText, 250, 40);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].includes('2,000,000 บาท'));
    assert.ok(chunks.some((c) => c.includes('50,000,000 บาท')));
  });
});

describe('Policy Metadata Parser (services/ingestion-service)', () => {
  it('extracts title, department, version, and document code from markdown', () => {
    const md = `# นโยบายการรู้จักลูกค้าและการตรวจสอบเพื่อทราบข้อเท็จจริง (KYC/CDD & EDD) (COMP-POL-2026-01)

- **รหัสเอกสาร:** COMP-POL-2026-01
- **หน่วยงานที่รับผิดชอบ:** Compliance (ฝ่ายกำกับการปฏิบัติตามกฎเกณฑ์)
- **เวอร์ชัน:** 2026.1
- **สถานะ:** บังคับใช้`;

    const meta = parsePolicyMetadata(md, 'default.md');
    assert.strictEqual(
      meta.title,
      'นโยบายการรู้จักลูกค้าและการตรวจสอบเพื่อทราบข้อเท็จจริง (KYC/CDD & EDD) (COMP-POL-2026-01)'
    );
    assert.strictEqual(meta.department, 'Compliance');
    assert.strictEqual(meta.version, '2026.1');
    assert.strictEqual(meta.code, 'COMP-POL-2026-01');
  });

  it('falls back to default values when headers are missing', () => {
    const raw = 'เนื้อหานโยบายทั่วไปโดยไม่มีหัวข้อ Markdown';
    const meta = parsePolicyMetadata(raw, 'fallback_filename.txt');
    assert.strictEqual(meta.title, 'fallback_filename.txt');
    assert.strictEqual(meta.department, 'General');
    assert.strictEqual(meta.version, '2026.1');
  });
});
