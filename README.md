# Sipium Flash

AI-powered flashcard creation and English learning for Vietnamese students — IELTS, Academic
English and general vocabulary.

> Learn faster. Remember longer.

No login. No signup. Open the app, throw in anything you are learning — an article, a word list, a
screenshot of your notes — and Sipium Flash plans a deck, builds it card by card, and schedules your
reviews.

---

## What is in here

| Area | What it does |
| --- | --- |
| **Home** | Application dashboard: one composer, continue studying, recent decks, popular public decks, weak words |
| **Create** | Multimodal workspace: text, pasted word lists, articles, IELTS prompts, uploaded or pasted images |
| **Plan mode** | The AI reasons about what to build first. You read it, edit it, then approve it |
| **Build mode** | The AI executes the plan through a typed tool system, streaming real progress |
| **Deck editor** | Inline editing, reordering, AI actions per card, validation before publishing |
| **Study** | Progressive reveal, adaptive question types, curiosity layer, deterministic SRS |
| **Explore** | Public deck discovery with search, filters and copy-to-own |

---

## Architecture

```
Browser (Next.js / React)
        │  /api/*  (same-origin, proxied server-side)
        ▼
Next.js on Vercel ──── app/api/[...path]/route.ts
        │
        ▼
Replit API (Express + PostgreSQL)  ── server/
        │
        ▼
xKiro  ──►  MiniMax M3
```

* **Frontend** — Next.js 15 (App Router), React 18, TypeScript strict, plain CSS design system.
* **Backend** — Express + PostgreSQL. Runs standalone on Replit, or locally with zero setup.
* **Database** — PostgreSQL with migrations, foreign keys and indexes. Locally it falls back to an
  embedded PostgreSQL (PGlite, WASM) so `npm run dev` works with no install.
* **AI** — one server-side gateway. `xKiro` first, then `MiniMax M3` direct. Provider keys are read
  from environment variables on the server only; **they are never sent to the browser**.

### Local-first reliability

There is no account, so the browser is the source of truth while you work:

* Decks, drafts and pending reviews are stored in **IndexedDB** (with a localStorage fallback).
* Every edit is applied locally first, then pushed to the API. Failure marks the deck `Offline`
  instead of losing it.
* Reviews are applied locally with the same deterministic scheduler the server uses, then pushed;
  failures go to an outbox that flushes on reconnect.
* Refresh, crash or network loss never destroys work — the Create workspace restores its draft.

---

## Getting started

```bash
npm install
npm run dev           # Next.js on :3000 + API on :8787
```

Open <http://localhost:3000>. The database is created and migrated automatically.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Next.js dev server + API with reload |
| `npm run build` | Production build of the frontend |
| `npm run build:server` | Compile the API to `server/dist` |
| `npm start` | Run the built app (frontend + API) |
| `npm run typecheck` | TypeScript, frontend and API |
| `npm run db:migrate` | Apply migrations manually |

---

## Environment

Copy `.env.example` to `.env`. Nothing is required for local development.

| Variable | Purpose |
| --- | --- |
| `REPLIT_API_URL` | Where the Next.js proxy sends `/api/*`. Unset → local API on `127.0.0.1:8787` |
| `REPLIT_API_KEY` | Optional shared secret sent from Next.js to the API |
| `DATABASE_URL` | PostgreSQL connection string. Unset → embedded PostgreSQL in `.pgdata` |
| `XKIRO_API_KEY`, `XKIRO_BASE_URL`, `XKIRO_MODEL` | Primary AI provider (OpenAI-compatible) |
| `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL` | Direct MiniMax M3 provider |
| `AI_PROVIDER` | `auto` (default) \| `xkiro` \| `minimax` |
| `AI_VISION_MODEL` | Optional override for image understanding |
| `AI_ALLOW_OFFLINE_FALLBACK` | `true` (default) to run the offline engine when no key is set |
| `AI_RATE_LIMIT_PER_MIN`, `PUBLISH_RATE_LIMIT_PER_MIN`, `MAX_IMAGE_BYTES`, `MAX_BODY_BYTES` | Limits |

### About the offline engine

With no provider key the API reports `configured: false` (see `/api/health`) and uses a
deterministic engine built on a curated academic/IELTS vocabulary core. It is not a language model:
it produces real, structured cards from the built-in lexicon, and marks anything it cannot produce
honestly as needing enrichment instead of inventing it. The UI labels this state. Image
understanding genuinely requires a model, so it returns an explicit, actionable error.

---

## AI tool architecture

The model never touches the database. It can only call explicitly permitted tools that operate on an
in-memory workbench, and every argument is validated with zod before execution:

```
deck        create_deck, update_deck
card        create_flashcard, create_flashcards, update_flashcard, delete_flashcard,
            add_cards_to_deck, group_cards, reorder_cards
enrichment  enrich_word, generate_example, generate_collocations
analysis    analyze_image, extract_vocabulary
quality     validate_flashcard, find_duplicates, classify_difficulty, classify_ielts_relevance
quiz        generate_quiz, generate_review_question
```

`GET /api/ai/tools` returns the live registry with JSON Schemas. Every tool has a name, description,
JSON Schema, zod validation, typed output and error handling. Malformed model output is repaired
once, retried once with a stricter prompt, and otherwise surfaces as a retryable error — never as
corrupted data.

Prompt injection from pasted material is mitigated by: untrusted material is fenced and labelled as
data, system instructions are fixed, and tool arguments are validated server-side against a narrow
schema.

---

## Spaced repetition

`shared/srs.ts` implements a documented simplification of FSRS that is deterministic, dependency-free
and shared by the client (optimistic UI, offline study) and the server (source of truth):

```
R(t, S) = (1 + F·t/S)^C                      F = 19/81, C = -0.5
D' = clamp(D − w6·(g − 3), 1, 10)
S' = S · (1 + e^w8 · (11 − D) · S^−w9 · (e^(w10·(1−R)) − 1) · hardPenalty · easyBonus)
I  = S · (r^(1/C) − 1) / F                   ≈ S at r = 0.9
```

Study state (`ease`, `stability`, `intervalDays`, `nextReview`, `lapses`, …) is stored completely
separately from card content. AI complements the scheduler (contrast exercises, curiosity notes) and
never overrides it.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database, AI provider and configuration status |
| GET | `/api/ai/tools` | Live tool registry |
| POST | `/api/ai/plan` | Create an editable plan |
| POST | `/api/ai/build` | Execute a plan (`text/event-stream` for live progress) |
| POST | `/api/ai/image` | Understand an uploaded or pasted image |
| POST | `/api/ai/card-action` | One focused AI action on one card |
| POST | `/api/ai/curiosity` | Curiosity note for a card |
| GET/POST | `/api/decks`, `/api/decks/:id` | List, create, read, update, delete |
| PUT | `/api/decks/:id/cards` | Replace a deck's cards |
| POST | `/api/decks/:id/publish` | Validate and publish |
| POST | `/api/decks/:id/copy` | Fork a deck |
| GET | `/api/public/decks` | Search and filter public decks (paged) |
| GET | `/api/public/decks/:slug` | Public deck by slug |
| POST | `/api/public/decks/:id/copy` | Copy a public deck into your own |
| GET | `/api/study/queue` | Scheduler-ordered queue for a deck |
| POST | `/api/study/review` | Apply a review |
| GET | `/api/study/due`, `/study/weak`, `/study/history` | Dashboard and analytics |

---

## Deployment

**Frontend (Vercel)** — set `REPLIT_API_URL` (and optionally `REPLIT_API_KEY`), build with
`next build`. Everything else is client-side.

**Backend (Replit)** — run `npm run build:server && npm run start:api`, set `DATABASE_URL` and the
provider keys, and expose port `8787` (or `PORT`).

The browser only ever talks to the Next.js origin, so the Replit URL and all AI credentials stay out
of the client bundle.

---

## Project layout

```
app/                 Next.js App Router pages
  api/[...path]/     server-side proxy to the API
components/          shell, ui primitives, create, deck, study
lib/                 typed API client, local-first deck store, study store,
                     question engine, settings, IndexedDB, image helpers
server/src/          the API — routes, repos, AI gateway, tools, services, migrations
shared/              types, zod schemas and the SRS scheduler used by both sides
```

## Design notes

* Light by default, real dark mode, no SVG icon system, no gradients-as-a-style, no decorative
  hero sections.
* Motion is used only to communicate: reveal, correctness, progress, saving, loading.
* Keyboard accessible: `Space`/`Enter` to reveal and advance, `1–4` to grade, `Esc` to leave study.
* Works on desktop, tablet and mobile; study mode is distraction-free with large touch targets.
