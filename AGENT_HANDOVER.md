# AI Agent Handover Document (AliExpress Optimizer V2.0)

**Date**: 2026-03-19
**Project Name**: 全球商品智能优化系统 V2.0 (AliExpress Product Optimizer)
**Frontend**: React + Vite + Tailwind (Hosted on Vercel)
**Backend**: Node.js + Express + PostgreSQL (Hosted on Railway)
**Primary User Persona**: Non-technical user managing cross-border e-commerce products. Prioritizes UI stability, strict adherence to business rules, and transparent explanations over abstract technical jargon.

---

## 1. Context & Architecture Shifts

This project originally started as a purely frontend React application (created via Gemini Build AI) where all LLM calls (Gemini) and API keys were executed and stored directly on the client side. 

**What we accomplished in the current session:**
1. **Frontend-Backend Decoupling**: We introduced a dedicated Node.js backend to hide API keys, manage database interactions (PostgreSQL), and handle complex server-side operations.
2. **Vercel Reverse Proxy**: The frontend uses `vercel.json` to proxy `/api/(.*)` requests to the Railway backend (`aliexpress-optimizer-v1-production.up.railway.app`).
3. **Authentication & Admin System**: 
   - Implemented JWT-based auth. 
   - Built a multi-tab Admin Panel in the frontend (`src/auth/AdminPanel.tsx`) for user management, usage tracking, and audit logs.
   - DB tables: `users`, `audit_log`, `jobs`, `usage_records`.

---

## 2. The Great "Model Migration" Experiment (And Reversion)

**Crucial context for the next Agent:**
The user wanted to reduce costs by migrating away from Gemini to cheaper domestic models via Volcengine Ark (Doubao, DeepSeek). 

**What happened:**
- We successfully integrated the Ark models.
- **The Result was unacceptable to the user.** The alternative models failed to consistently respect the strict formatting rules defined in the prompts:
  - Output length constraints were violated (e.g., SEO titles > 128 chars).
  - JSON structures were unstable (missing keys, nested arrays instead of objects), which caused our `zod` validation layers to crash the pipeline (500 errors).
  - Implicit requirements (like always returning optimization reasons) were ignored by the cheaper models.

**The Fix (Current State):**
- **WE REVERTED COMPLETELY TO GEMINI.**
- **Text Steps** (FactSheet, SEO, Marketing, Attributes, Description): Hardcoded to `gemini-3-flash-preview` on the backend.
- **Image Steps** (Remastering): Hardcoded to `gemini-2.5-flash-image`.
- **Strict Schemas Restored**: To prevent any structural jitter, we restored strict `responseSchema` (using `@google/genai` Type definitions) directly in the backend's Gemini API calls.

**Rule for Next Agent**: Do NOT attempt to swap the core Gemini models for cheaper alternatives without explicit, step-by-step parallel A/B testing. Quality and strict prompt adherence (especially JSON schema and length limits) are the highest priority.

---

## 3. Key Technical Implementations to Maintain

### Image Fetching (`/api/fetch-image`)
- **Problem**: The frontend failed to draw images to canvas from `dianxiaomi.com` and other external sources due to CORS and mixed-content blocking.
- **Solution**: We implemented `GET /api/fetch-image?url=...` on the backend. It fetches the image server-side (with headers spoofing) and pipes the buffer back to the frontend.
- **Note**: The backend strictly validates that the upstream returns an `image/*` MIME type to prevent passing XML/HTML error pages to the Gemini vision model.

### Error Handling in `apiFetch`
- The frontend `apiFetch` (`src/auth/api.ts`) is designed to handle both JSON and plain text error responses from the backend without throwing `JSON.parse` exceptions.

### Usage & Audit Logging
- Backend records every model call to `usage_records` (tokens, model used, missing fields).
- Frontend reports client-side events like `products.upload` and `products.export` to `audit_log`.

---

## 4. Immediate Next Steps / Roadmap

The user explicitly paused "cost reduction" efforts to focus on completing the **Admin Management System**.

**Pending Tasks for Next Agent:**
1. **Jobs Tracking**: The `jobs` table exists, but the frontend's batch optimization loop (`processProduct`) does not currently write start/progress/completion status to the `jobs` table. The admin panel "Tasks" tab is currently only showing upload/export events. Integrating the actual product processing queue into the `jobs` table is the next logical step.
2. **Cost Reduction (Without changing models)**: Implement caching (hash of input -> output) so identical product steps don't incur duplicate Gemini API charges.
3. **Quality Guardrails**: If occasional Gemini failures occur (e.g., SEO length violations), implement an automatic 1-retry loop in the backend before failing the step.

---
**Agent Persona Reminder**: The user is highly observant of output quality. When making changes, explicitly state *what* you are doing and assure them that the core optimization logic/prompts remain untouched.