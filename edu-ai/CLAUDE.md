# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
```

No test suite exists yet.

## Required Environment Variables

```
OPENAI_API_KEY
PEXELS_API_KEY
STABILITY_API_KEY
UNSPLASH_ACCESS_KEY   # optional — Unsplash image search (hotlinking required, attribution shown)
PIXABAY_API_KEY       # optional — Pixabay image search (images proxied server-side as base64)
YOUTUBE_API_KEY       # optional — YouTube Data API v3; enables video embeds on no-image slides
```

Create a `.env.local` file at the project root with these keys before running.

## Architecture

This is a **single-page Next.js app** (App Router) with no auth. All UI lives in one file (`src/app/page.tsx`). The backend is three serverless API routes.

### Core Data Flow

1. User submits topic + grade (1–8) from `page.tsx`
2. `POST /api/generate` runs the full pipeline server-side:
   - Calls **OpenAI** `gpt-4.1-mini` to produce a JSON deck (`deckTitle` + slides with `title`, `bullets`, `imageQuery`)
   - For each slide that needs an image, tries **Pexels** first (real photo, scored by keyword match against slide title/bullets via `lib/image-match.ts`)
   - Falls back to **Stability AI** cartoon illustration if Pexels score < 2 — capped at **1 AI image per deck**
3. Returns enriched slides to the client (`image` is a URL or base64 data URI)

### Grade Modes

- **Grades 1–4** (`primaryMode = true`): 5 slides, max 1 Pexels photo + max 1 AI image
- **Grades 5–8**: 8 slides, ~2–3 Pexels photos, 1 AI image fallback

### Export Routes

Both exporters (`/api/export/pptx`, `/api/export/pdf`) receive the full deck JSON, fetch images server-side, and stream a binary file back.

- **PPTX** uses `pptxgenjs` — images embedded as base64 data URIs
- **PDF** uses `pdf-lib` — images embedded as raw JPG/PNG bytes; layout is hand-coded with absolute coordinates (960×540 pt, 16:9)

### Key Files

| File | Purpose |
|---|---|
| `src/app/page.tsx` | All client UI — state, slide viewer, grade picker, download |
| `src/app/api/generate/route.ts` | Full AI + image pipeline |
| `src/lib/image-match.ts` | Keyword scoring to pick the best Pexels photo |
| `src/lib/stability.ts` | Stability AI image generation (returns base64 data URI) |
| `src/lib/image-prompts.ts` | Builds cartoon-style prompts for Stability AI |

### Slide Type Schema

```ts
// What OpenAI returns per slide
{ title: string; bullets: string[]; imageQuery: string | null }

// What the API returns to the client
{ title: string; bullets: string[]; image: string | null; imageAlt: string; imageSource: "pexels" | "stability" | null; youtubeVideoId: string | null }
```

### No Auth

There is currently no authentication, middleware, or session handling. The app is fully public.
