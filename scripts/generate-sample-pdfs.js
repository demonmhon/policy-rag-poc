#!/usr/bin/env node
/**
 * Reproducible Synthetic Thai Bank Policy PDF Generator
 * Renders styled HTML policy documents using Noto Sans Thai / Prompt fonts
 * into real PDF documents with embedded font subsets via Headless Chrome.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '../sample-policies');

const PDF_POLICIES = [
  {
    filename: '14_remote_hybrid_work_policy.pdf',
    code: 'HR-POL-2026-03',
    department: 'HR (ฝ่ายทรัพยากรบุคคลและบริหารงานบุคคล)',
    version: '2026.1',
    title: 'นโยบายการปฏิบัติงานนอกสถานที่ (Hybrid Work) และการใช้เครือข่าย VPN (HR-POL-2026-03)',
    sections: [
      {
        heading: 'หมวดที่ 1: สิทธิและจำนวนวันปฏิบัติงานนอกสถานที่ (Hybrid Work Eligibility)',
        paragraphs: [
          'พนักงานประจำสังกัดหน่วยงานสำนักงานใหญ่และสายงานสนับสนุนที่ผ่านการทดลองงานครบ 120 วัน และมีผลการประเมินการปฏิบัติงานประจำปีในระดับดีขึ้นไป สามารถขออนุมัติปฏิบัติงานนอกสถานที่ (Work from Home / Hybrid Work) ได้ไม่เกิน 2 วันทำการต่อสัปดาห์ โดยต้องเข้าปฏิบัติงาน ณ อาคารสำนักงานใหญ่อย่างน้อย 3 วันทำการต่อสัปดาห์ ทั้งนี้ พนักงานที่ปฏิบัติงานประจำสาขา พนักงานรับ-จ่ายเงิน (Teller) และเจ้าหน้าที่ศูนย์บริการลูกค้าที่ต้องให้บริการหน้าเคาน์เตอร์ ไม่เข้าข่ายได้รับสิทธิตามนโยบายนี้'
        ]
      },
      {
        heading: 'หมวดที่ 2: มาตรฐานความปลอดภัยเครือข่ายและ Corporate Zero-Trust VPN',
        paragraphs: [
          'การเชื่อมต่อเข้าสู่ระบบเครือข่ายภายในของธนาคารจากภายนอกอาคารสำนักงาน พนักงานต้องใช้อุปกรณ์คอมพิวเตอร์พกพา (Corporate Laptop) ที่ธนาคารจัดสรรให้เท่านั้น และต้องเชื่อมต่อผ่านระบบ Corporate Zero-Trust VPN ควบคู่กับการยืนยันตัวตนหลายปัจจัย (MFA) ทุกครั้ง ห้ามใช้เครือข่าย Wi-Fi สาธารณะที่ไม่มีการเข้ารหัส (Public Wi-Fi เช่น ตามร้านกาแฟ โรงแรม หรือสนามบิน) ในการเข้าถึงฐานข้อมูลลูกค้าหรืออนุมัติรายการทางการเงินโดยเด็ดขาด หากมีความจำเป็นเร่งด่วนให้เชื่อมต่อผ่าน Personal Hotspot จากโทรศัพท์มือถือที่ตั้งรหัสผ่าน WPA3 เท่านั้น'
        ]
      },
      {
        heading: 'หมวดที่ 3: เวลาปฏิบัติงานหลักและการเรียกประชุมด่วน (Core Hours & Recall SLA)',
        paragraphs: [
          'พนักงานที่ปฏิบัติงานนอกสถานที่ต้องออนไลน์และพร้อมติดต่อสื่อสารผ่านระบบ Microsoft Teams และโทรศัพท์ตลอดช่วงเวลาปฏิบัติงานหลัก (Core Working Hours) คือตั้งแต่เวลา 08:30 น. ถึง 17:30 น. และต้องปฏิบัติตามหลักการหน้าจอปลอดภัย (Clear Screen) ไม่เปิดหน้าจอข้อมูลลูกค้าในพื้นที่สาธารณะ หากผู้บังคับบัญชาระดับผู้อำนวยการฝ่ายขึ้นไปเรียกประชุมด่วนหรือเกิดเหตุฉุกเฉิน พนักงานต้องสามารถเดินทางกลับเข้าปฏิบัติงาน ณ อาคารสำนักงานใหญ่ได้ภายใน 2 ชั่วโมง'
        ]
      }
    ]
  },
  {
    filename: '15_gifts_entertainment_anti_bribery.pdf',
    code: 'COMP-POL-2026-03',
    department: 'Compliance (ฝ่ายกำกับการปฏิบัติตามกฎเกณฑ์และธรรมาภิบาล)',
    version: '2026.1',
    title: 'นโยบายการรับ-ให้ของขวัญ ค่าเลี้ยงรับรอง และการต่อต้านการทุจริตคอร์รัปชัน (COMP-POL-2026-03)',
    sections: [
      {
        heading: 'หมวดที่ 1: หลักการงดรับของขวัญและเพดานมูลค่าของที่ระลึก (No Gift Policy & 3,000 THB Limit)',
        paragraphs: [
          'ธนาคารประกาศเจตนารมณ์ "งดรับ งดให้" ของขวัญและผลประโยชน์ทุกชนิดในทุกเทศกาล (No Gift Policy) เพื่อความโปร่งใสและป้องกันความขัดแย้งทางผลประโยชน์ ทั้งนี้ ในกรณีที่เป็นธรรมเนียมประเพณีทางธุรกิจและพนักงานไม่สามารถปฏิเสธได้ในทันที พนักงานสามารถรับของที่ระลึก สิ่งของตามเทศกาล หรือปฏิทินไดอารี่ ที่มีมูลค่าประเมินไม่เกิน 3,000 บาทต่อชิ้นต่อครั้ง โดยห้ามรับเงินสด เช็คของขวัญ บัตรกำนัลแทนเงินสด (Gift Voucher) ทองคำ หรือสินทรัพย์ดิจิทัล ไม่ว่าจะมีมูลค่าเท่าใดก็ตามโดยเด็ดขาด'
        ]
      },
      {
        heading: 'หมวดที่ 2: การขึ้นทะเบียนของขวัญและการจัดการสิ่งของที่เกินเกณฑ์ (Gift Registry SLA)',
        paragraphs: [
          'ในกรณีที่พนักงานได้รับของขวัญหรือสิ่งของตามเทศกาลที่มีมูลค่าประเมินเกินกว่า 3,000 บาท และไม่สามารถส่งคืนให้แก่ผู้มอบได้ในขณะนั้น พนักงานต้องรายงานต่อผู้บังคับบัญชาต้นสังกัดและทำการบันทึกขึ้นทะเบียนในระบบ Gift & Hospitality Registry ของฝ่ายกำกับการปฏิบัติตามกฎเกณฑ์ (Compliance) ภายใน 5 วันทำการ นับตั้งแต่วันที่ได้รับสิ่งของ พร้อมทั้งส่งมอบของขวัญดังกล่าวให้แก่ฝ่ายทรัพยากรบุคคลเพื่อนำไปใช้เป็นทรัพย์สินส่วนกลางของธนาคารหรือนำไปบริจาคเพื่อการกุศลในนามธนาคาร'
        ]
      },
      {
        heading: 'หมวดที่ 3: เพดานค่าเลี้ยงรับรองทางธุรกิจและการห้ามให้สินบนแก่เจ้าหน้าที่ของรัฐ',
        paragraphs: [
          'การจัดเลี้ยงรับรองลูกค้าหรือคู่ค้าทางธุรกิจ (Business Entertainment & Hospitality) ต้องมีวัตถุประสงค์ทางธุรกิจที่ชัดเจน ไม่ฟุ่มเฟือย และกำหนดเพดานค่าใช้จ่ายในการเลี้ยงรับรองไม่เกิน 2,000 บาทต่อคนต่อครั้ง โดยต้องได้รับอนุมัติจากผู้บริหารระดับผู้อำนวยการฝ่ายขึ้นไป ทั้งนี้ ธนาคารห้ามมิให้พนักงานทุกคนเสนอ ให้ หรือสัญญาว่าจะให้ทรัพย์สิน ของขวัญ ค่าเลี้ยงรับรอง หรือผลประโยชน์อื่นใดแก่เจ้าหน้าที่ของรัฐ (Public Officials) เพื่อจูงใจให้กระทำการหรือไม่กระทำการในตำแหน่งหน้าที่อันมิชอบด้วยกฎหมายทุกกรณี'
        ]
      }
    ]
  },
  {
    filename: '16_customer_complaint_handling.pdf',
    code: 'OPS-POL-2026-04',
    department: 'Operations (ฝ่ายบริหารคุณภาพบริการและศูนย์บริการลูกค้า)',
    version: '2026.1',
    title: 'ระเบียบการรับและแก้ไขเรื่องร้องเรียนของลูกค้าและกรอบเวลา SLA (OPS-POL-2026-04)',
    sections: [
      {
        heading: 'หมวดที่ 1: ช่องทางการรับเรื่องร้องเรียนและกรอบเวลาการตอบรับเบื้องต้น (Acknowledgement SLA)',
        paragraphs: [
          'ลูกค้าสามารถยื่นเรื่องร้องเรียนผ่านเคาน์เตอร์สาขาธนาคารทุกแห่ง ศูนย์บริการลูกค้าทางโทรศัพท์ (Contact Center โทร 02-000-9999) หรือช่องทางออนไลน์ของธนาคาร พนักงานผู้รับเรื่องร้องเรียนต้องบันทึกรายละเอียดลงในระบบบริหารจัดการเรื่องร้องเรียน (CRM Complaint Management System) ทันทีที่ได้รับแจ้ง และต้องจัดส่งข้อความแจ้งหมายเลขรับเรื่องหรือติดต่อกลับเพื่อยืนยันการรับเรื่องร้องเรียน (Acknowledgement) ให้ลูกค้าทราบภายใน 24 ชั่วโมง (หรือภายใน 1 วันทำการ)'
        ]
      },
      {
        heading: 'หมวดที่ 2: กรอบเวลาการตรวจสอบและแก้ไขเรื่องร้องเรียนตามระดับความเร่งด่วน (Resolution SLA)',
        paragraphs: [
          'ธนาคารกำหนดกรอบระยะเวลามาตรฐาน (SLA) ในการตรวจสอบข้อเท็จจริงและแจ้งผลการแก้ไขปัญหาให้ลูกค้าทราบ ดังนี้',
          '1. เรื่องร้องเรียนทั่วไป (เช่น คุณภาพการให้บริการของพนักงานสาขา หรือการสอบถามค่าธรรมเนียมทั่วไป): ต้องดำเนินการตรวจสอบและแจ้งผลการแก้ไขให้ลูกค้าทราบภายใน 7 วันทำการ',
          '2. เรื่องร้องเรียนด้านธุรกรรมทางการเงินผิดพลาด (เช่น ตู้ ATM/CDM ตัดบัญชีแต่ไม่ได้รับเงินสด หรือการโอนเงินปลายทางไม่ได้รับเงิน): ต้องตรวจสอบกระทบยอดและปรับปรุงคืนเงินเข้าบัญชีลูกค้าภายใน 3 วันทำการ',
          '3. เรื่องร้องเรียนกรณีภัยทุจริตทางการเงินออนไลน์หรือบัญชีถูกถอนเงินโดยไม่ได้รับอนุญาต (Fraud / Unauthorized Transaction): พนักงานต้องดำเนินการระงับบัญชีหรืออายัดช่องทางอิเล็กทรอนิกส์ชั่วคราวทันทีภายใน 15 นาที นับตั้งแต่ได้รับแจ้งจากลูกค้า และต้องสรุปผลการสอบสวนแจ้งลูกค้าภายใน 15 วันทำการ ตามหลักเกณฑ์ของธนาคารแห่งประเทศไทย'
        ]
      },
      {
        heading: 'หมวดที่ 3: การติดตามความคืบหน้าและการรายงานเรื่องร้องเรียนผ่าน ธปท. (Escalation Rules)',
        paragraphs: [
          'ในกรณีที่เรื่องร้องเรียนมีความซับซ้อนและไม่สามารถดำเนินการให้แล้วเสร็จภายในกรอบเวลา SLA ที่กำหนดในหมวดที่ 2 หน่วยงานผู้รับผิดชอบต้องแจ้งความคืบหน้าให้ลูกค้าทราบเป็นระยะทุกๆ 5 วันทำการ จนกว่าเรื่องจะยุติ สำหรับกรณีที่เป็นเรื่องร้องเรียนซึ่งส่งผ่านมาจากศูนย์คุ้มครองผู้ใช้บริการทางการเงิน (ศคง.) ธนาคารแห่งประเทศไทย ต้องยกระดับ (Escalate) ให้ฝ่ายกำกับการปฏิบัติตามกฎเกณฑ์ (Compliance) ร่วมตรวจสอบและจัดทำหนังสือชี้แจงส่งต่อ ธปท. ภายในเวลาที่กำหนดอย่างเคร่งครัด'
        ]
      }
    ]
  }
];

function buildHtml(policy) {
  const sectionsHtml = policy.sections
    .map(
      (sec) => `
      <div class="section">
        <h2>${sec.heading}</h2>
        ${sec.paragraphs.map((p) => `<p>${p}</p>`).join('\n')}
      </div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${policy.title}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 18mm 18mm 18mm;
    }
    html, body {
      font-family: 'Prompt', 'Noto Sans Thai', sans-serif;
      background-color: #FFFFFF;
      color: #000000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      line-height: 1.65;
      font-size: 13.5px;
      margin: 0;
      padding: 0;
    }
    .header-bar {
      border-bottom: 3px solid #002D63;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .bank-badge {
      color: #0050F0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    h1 {
      color: #002D63;
      font-size: 19px;
      font-weight: 700;
      margin: 0 0 10px 0;
      line-height: 1.4;
    }
    .meta-box {
      background: #EFF7FC;
      border: 1px solid #C1E0F6;
      border-left: 4px solid #0050F0;
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 12.5px;
    }
    .meta-box ul {
      margin: 0;
      padding-left: 18px;
    }
    .meta-box li {
      margin: 2px 0;
    }
    .section {
      margin-bottom: 18px;
    }
    h2 {
      color: #002D63;
      font-size: 15px;
      font-weight: 700;
      border-bottom: 1px solid #C1E0F6;
      padding-bottom: 4px;
      margin: 0 0 8px 0;
    }
    p {
      margin: 0 0 8px 0;
      text-align: justify;
    }
    .footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid #C1E0F6;
      font-size: 11px;
      color: #4A5568;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="bank-badge">เอกสารนโยบายภายในธนาคาร (Synthetic Bank Policy Corpus)</div>
    <h1>${policy.title}</h1>
  </div>

  <div class="meta-box">
    <ul>
      <li><strong>รหัสเอกสาร:</strong> ${policy.code}</li>
      <li><strong>หน่วยงานที่รับผิดชอบ:</strong> ${policy.department}</li>
      <li><strong>เวอร์ชัน:</strong> ${policy.version}</li>
      <li><strong>สถานะ:</strong> บังคับใช้</li>
    </ul>
  </div>

  ${sectionsHtml}

  <div class="footer">
    <span>รหัสเอกสาร: ${policy.code} (เวอร์ชัน ${policy.version})</span>
    <span>ชั้นความลับ: ใช้ภายในองค์กร (Internal Use Only)</span>
  </div>
</body>
</html>`;
}

function findChromeBinary() {
  const candidates = ['google-chrome', 'chromium', 'chromium-browser'];
  for (const bin of candidates) {
    try {
      const resolved = execFileSync('which', [bin], { encoding: 'utf8' }).trim();
      if (resolved) return resolved;
    } catch (_) {
      // continue
    }
  }
  throw new Error('Could not find google-chrome or chromium binary for PDF generation.');
}

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const chromeBin = findChromeBinary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-pdf-'));

  try {
    for (const policy of PDF_POLICIES) {
      const htmlPath = path.join(tmpDir, `${policy.code}.html`);
      const outPath = path.join(OUTPUT_DIR, policy.filename);
      fs.writeFileSync(htmlPath, buildHtml(policy), 'utf8');

      execFileSync(
        chromeBin,
        [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--no-pdf-header-footer',
          `--print-to-pdf=${outPath}`,
          `file://${htmlPath}`
        ],
        { stdio: 'ignore' }
      );

      const stat = fs.statSync(outPath);
      console.log(`Generated ${policy.filename} (${stat.size} bytes)`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = { PDF_POLICIES, buildHtml };
