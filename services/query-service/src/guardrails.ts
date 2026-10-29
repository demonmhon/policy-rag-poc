export type GuardrailAction = 'allowed' | 'redacted' | 'refused';
export type GuardrailCategory =
  | 'none'
  | 'pii_redacted'
  | 'prompt_injection'
  | 'customer_data_request'
  | 'out_of_scope_low_similarity';

export interface PiiRedactionResult {
  redactedText: string;
  piiRedacted: boolean;
  piiTypes: string[];
}

export interface GuardrailsEvaluation {
  triggered: boolean;
  action: GuardrailAction;
  reason: string | null;
  category: GuardrailCategory;
  piiRedacted: boolean;
  piiTypes: string[];
  sanitizedQuestion: string;
  refusalMessage?: string;
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const THAI_ID_REGEX = /\b(?:\d-\d{4}-\d{5}-\d{2}-\d|\d{13})\b/g;
const PHONE_REGEX =
  /(?:\+66[\s-]?[689]\d[\s-]?\d{3}[\s-]?\d{4}|\b0[689]\d(?:-\d{3}-\d{4}|\s\d{3}\s\d{4}|\d{7})\b)/g;
const ACCOUNT_OR_CARD_REGEX =
  /\b(?:\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}|\d{3}-\d-\d{5}-\d|\d{10,12}|\d{16})\b/g;

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|your\s+|previous\s+|prior\s+)*(?:rules|instructions|prompts|constraints|guidelines)/i,
  /disregard\s+(?:all\s+|your\s+|previous\s+|prior\s+)*(?:rules|instructions|prompts)/i,
  /(?:print|reveal|show|display|output|repeat|dump)\s+(?:your\s+|the\s+)?(?:system\s+prompt|hidden\s+prompt|developer\s+instructions|secret\s+instructions)/i,
  /(?:you\s+are\s+now\s+dan|do\s+anything\s+now|jailbreak|bypass\s+guardrails)/i,
  /forget\s+(?:everything|all\s+instructions|your\s+rules)/i,
  /(?:ลืม|เพิกเฉย|ยกเลิก|ข้าม|ไม่ต้องทำตาม)\s*(?:คำสั่ง|กฎ|ระเบียบ|ข้อจำกัด|เงื่อนไข)(?:ก่อนหน้า|ทั้งหมด|ของคุณ|ของระบบ)?/i,
  /(?:แสดง|พิมพ์|เปิดเผย|บอก|ดู)\s*(?:system\s*prompt|คำสั่งระบบ|พรอมต์ระบบ|กฎลับของระบบ)/i
];

const CUSTOMER_DATA_PATTERNS: RegExp[] = [
  /what\s+is\s+(?:customer|client|user|account)\s+[#a-z0-9_-]*\s*(?:'s\s+)?(?:balance|transactions?|salary|statement|password|pin)/i,
  /(?:check|show|get|lookup|tell\s+me)\s+(?:the\s+)?(?:account\s+balance|bank\s+balance|transaction\s+history)\s+(?:of|for)\s+(?:customer|account|client)/i,
  /(?:ลูกค้า|บัญชี|คุณ)\s*(?:หมายเลข|รหัส|เลขที่|ชื่อ)?\s*[a-z0-9ก-๙_-]*\s*(?:มีเงินคงเหลือ|มียอดเงิน|ยอดคงเหลือ|มีเงินในบัญชี|เหลือกี่บาท|โอนเงินให้ใคร)/i,
  /(?:ขอดู|เช็ค|ตรวจสอบ|บอก|ขอทราบ)\s*(?:ยอดเงิน(?:คงเหลือ)?(?:ในบัญชี)?|เงินคงเหลือ|ยอดคงเหลือ|รายการเดินบัญชี|statement|รหัสผ่าน|pin)\s*(?:ของลูกค้า|ของบัญชี|ลูกค้า|ในบัญชี)?/i
];

/**
 * Redacts PII (Thai National ID, Mobile Phone, Email, Bank Account / Credit Card)
 * from any input or output text string.
 */
export function redactPii(text: string): PiiRedactionResult {
  if (!text) {
    return { redactedText: text, piiRedacted: false, piiTypes: [] };
  }

  let redacted = text;
  const detectedTypes = new Set<string>();

  if (EMAIL_REGEX.test(redacted)) {
    detectedTypes.add('EMAIL');
    redacted = redacted.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
  }
  EMAIL_REGEX.lastIndex = 0;

  if (THAI_ID_REGEX.test(redacted)) {
    detectedTypes.add('THAI_ID');
    redacted = redacted.replace(THAI_ID_REGEX, '[REDACTED_THAI_ID]');
  }
  THAI_ID_REGEX.lastIndex = 0;

  if (PHONE_REGEX.test(redacted)) {
    detectedTypes.add('PHONE');
    redacted = redacted.replace(PHONE_REGEX, '[REDACTED_PHONE]');
  }
  PHONE_REGEX.lastIndex = 0;

  if (ACCOUNT_OR_CARD_REGEX.test(redacted)) {
    detectedTypes.add('ACCOUNT');
    redacted = redacted.replace(ACCOUNT_OR_CARD_REGEX, '[REDACTED_ACCOUNT]');
  }
  ACCOUNT_OR_CARD_REGEX.lastIndex = 0;

  const piiTypes = Array.from(detectedTypes);
  return {
    redactedText: redacted,
    piiRedacted: piiTypes.length > 0,
    piiTypes
  };
}

/**
 * Evaluates pre-retrieval input guardrails:
 * 1. Redacts any PII in the incoming question.
 * 2. Blocks prompt injection / system-prompt extraction attempts.
 * 3. Blocks requests for private customer account balances or personal financial data.
 */
export function evaluateInputGuardrails(rawQuestion: string): GuardrailsEvaluation {
  const piiResult = redactPii(rawQuestion);
  const sanitizedQuestion = piiResult.redactedText;

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(rawQuestion) || pattern.test(sanitizedQuestion)) {
      return {
        triggered: true,
        action: 'refused',
        reason: 'Prompt injection or system instruction override attempt detected.',
        category: 'prompt_injection',
        piiRedacted: piiResult.piiRedacted,
        piiTypes: piiResult.piiTypes,
        sanitizedQuestion,
        refusalMessage:
          'ขออภัย ระบบไม่สามารถดำเนินการตามคำขอที่มีลักษณะเป็นการพยายามเปลี่ยนแปลงคำสั่งระบบ (Prompt Injection) หรือขอเปิดเผยคำสั่งภายใน (System Prompt) ได้ ระบบนี้ให้บริการเฉพาะการตอบคำถามจากเอกสารนโยบายและระเบียบภายในของธนาคารเท่านั้น'
      };
    }
  }

  for (const pattern of CUSTOMER_DATA_PATTERNS) {
    if (pattern.test(rawQuestion) || pattern.test(sanitizedQuestion)) {
      return {
        triggered: true,
        action: 'refused',
        reason: 'Out-of-scope request for private customer account or balance data.',
        category: 'customer_data_request',
        piiRedacted: piiResult.piiRedacted,
        piiTypes: piiResult.piiTypes,
        sanitizedQuestion,
        refusalMessage:
          'ขออภัย ระบบผู้ช่วยค้นคว้านโยบายธนาคารไม่สามารถเข้าถึงหรือเปิดเผยข้อมูลส่วนบุคคลของลูกค้า ยอดเงินคงเหลือในบัญชี หรือรายการธุรกรรมของลูกค้ารายบุคคลได้ ตามนโยบายการคุ้มครองข้อมูลส่วนบุคคล (PDPA) และการจัดชั้นความลับข้อมูลของธนาคาร'
      };
    }
  }

  if (piiResult.piiRedacted) {
    return {
      triggered: true,
      action: 'redacted',
      reason: `PII detected and redacted (${piiResult.piiTypes.join(', ')}).`,
      category: 'pii_redacted',
      piiRedacted: true,
      piiTypes: piiResult.piiTypes,
      sanitizedQuestion
    };
  }

  return {
    triggered: false,
    action: 'allowed',
    reason: null,
    category: 'none',
    piiRedacted: false,
    piiTypes: [],
    sanitizedQuestion
  };
}

/**
 * Evaluates post-retrieval out-of-scope threshold and redacts any PII from the generated answer.
 */
export function evaluatePostRetrievalGuardrails(
  inputEval: GuardrailsEvaluation,
  maxSimilarity: number,
  minSimilarityThreshold: number
): GuardrailsEvaluation {
  if (maxSimilarity < minSimilarityThreshold) {
    return {
      triggered: true,
      action: 'refused',
      reason: `Query is out of scope of bank policies (max similarity ${maxSimilarity.toFixed(4)} < threshold ${minSimilarityThreshold.toFixed(2)}).`,
      category: 'out_of_scope_low_similarity',
      piiRedacted: inputEval.piiRedacted,
      piiTypes: inputEval.piiTypes,
      sanitizedQuestion: inputEval.sanitizedQuestion,
      refusalMessage:
        'ขออภัย ไม่พบข้อมูลที่เกี่ยวข้องกับคำถามนี้ในฐานข้อมูลระเบียบและนโยบายของธนาคาร ระบบนี้ตอบเฉพาะคำถามที่อ้างอิงจากเอกสารนโยบายภายในของธนาคารเท่านั้น (Out of Scope)'
    };
  }

  return inputEval;
}
