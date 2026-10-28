# Enterprise Policy Q&A — RAG Microservices Demo (Node.js + Docker + pgvector)

โปรเจกต์ต้นแบบ (Proof-of-Concept) ระบบถาม-ตอบกฎระเบียบและนโยบายภายในบริษัทด้วยสถาปัตยกรรม **RAG (Retrieval-Augmented Generation)** พัฒนาด้วย **Node.js (Express)**, **PostgreSQL (`pgvector`)** และ **Docker Compose**

---

## โครงสร้างสถาปัตยกรรม (Architecture)

```
policy-rag-microservices/
├── docker-compose.yml          # Orchestrate Postgres (pgvector), Adminer, Ingestion & Query Services
├── .env.example                # ตัวอย่างไฟล์ตั้งค่า Environment Variables
├── db/
│   └── init.sql                # สร้าง Extension vector, ตารางเอกสาร, Chunks และ HNSW Index
├── sample-policies/            # เอกสารระเบียบบริษัทตัวอย่าง (HR & IT Security)
│   ├── hr_medical_policy.md
│   └── it_security_policy.md
└── services/
    ├── ingestion-service/      # Port 3001: รับเอกสาร, หั่น Chunk, แปลงเป็น Vector และบันทึกลง DB
    └── query-service/          # Port 3002: รับคำถาม, ค้นหา Top-K Chunks (Cosine Similarity) และสังเคราะห์คำตอบ
```

### จุดเด่นของ Demo ชุดนี้
1. **Zero-Config Offline Demo (`AI_PROVIDER=mock`):** สามารถรันทดสอบ Flow ของ RAG และ Vector Search บน `pgvector` ได้ทันทีโดยไม่ต้องใช้ API Key (ใช้ Deterministic Feature-Hashing N-gram Vector 768 มิติที่รองรับทั้งภาษาไทยและอังกฤษ)
2. **Production AI Ready (`gemini` / `openai`):** เพียงสลับค่า `AI_PROVIDER=gemini` หรือ `openai` และใส่ API Key ใน `.env` ระบบจะเปลี่ยนไปเรียก Embedding API และ LLM จริงทันที
3. **Metadata & Department Filtering:** รองรับการกรองสิทธิ์หรือแผนก (`HR`, `IT`) ในระดับ SQL Vector Search

---

## วิธีเริ่มต้นใช้งาน (Quick Start)

### 1. รันระบบด้วย Docker Compose
```bash
cp .env.example .env
docker compose up --build -d
```

ตรวจสอบสถานะของแต่ละ Service:
* **Ingestion Service:** `http://localhost:3001/health`
* **Query Service:** `http://localhost:3002/health`
* **Adminer (Database UI):** `http://localhost:8080` (System: `PostgreSQL`, Server: `postgres`, User: `postgres`, Pass: `postgres`, DB: `policy_rag`)

---

### 2. นำเข้าเอกสารนโยบายตัวอย่างเข้าสู่ Corpus (Seed Sample Policies)
ยิงคำสั่งเพื่อนำเข้าไฟล์ระเบียบ HR และ IT Security จากโฟลเดอร์ `sample-policies/`:

```bash
curl -X POST http://localhost:3001/api/v1/documents/seed
```

ตรวจสอบรายการเอกสารในระบบ:
```bash
curl http://localhost:3001/api/v1/documents
```

---

### 3. ทดสอบถาม-ตอบระเบียบบริษัท (RAG Query)

#### ตัวอย่างที่ 1: ถามเรื่องสิทธิเบิกค่าทำฟันและตัดแว่น (HR)
```bash
curl -X POST http://localhost:3002/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "พนักงานเบิกค่าทำฟันและตัดแว่นสายตาได้ไม่เกินกี่บาทต่อปี",
    "department": "HR",
    "topK": 2
  }'
```

#### ตัวอย่างที่ 2: ถามเรื่องการใช้ Public AI Chatbot และการตั้งรหัสผ่าน (IT)
```bash
curl -X POST http://localhost:3002/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "สามารถนำ Source Code บริษัทไปถาม Public AI ได้หรือไม่",
    "department": "IT",
    "topK": 2
  }'
```

---

### 4. การเพิ่มเอกสารระเบียบใหม่ด้วยตนเอง (Custom Ingestion)

**แบบส่ง JSON Text:**
```bash
curl -X POST http://localhost:3001/api/v1/documents/text \
  -H "Content-Type: application/json" \
  -d '{
    "title": "ระเบียบการเบิกค่าเดินทางไปปฏิบัติงานต่างจังหวัด (FIN-2026-01)",
    "department": "Finance",
    "version": "1.0",
    "content": "พนักงานที่ใช้รถยนต์ส่วนตัวในการเดินทางไปปฏิบัติงานนอกสถานที่ สามารถเบิกค่าน้ำมันชดเชยได้ในอัตรา 6 บาทต่อกิโลเมตร และค่าที่พักตามจ่ายจริงไม่เกิน 1,800 บาทต่อคืน"
  }'
```

**แบบอัปโหลดไฟล์ (`.md` หรือ `.txt`):**
```bash
curl -X POST http://localhost:3001/api/v1/documents/upload \
  -F "file=@./sample-policies/hr_medical_policy.md" \
  -F "title=ระเบียบสวัสดิการฉบับอัปเดต" \
  -F "department=HR"
```
