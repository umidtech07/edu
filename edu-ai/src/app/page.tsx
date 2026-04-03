"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getFirebaseAuth, googleProvider } from "@/lib/firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { trackEvent } from "@/lib/track";

/** Parse **bold**, *italic*, __bold__, _italic_, ~~strike~~ inline markers + \n line breaks into React nodes */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Order matters: **bold** before *italic*, ~~strike~~ standalone
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*|_(.+?)_)/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      const raw = text.slice(last, m.index);
      raw.split("\n").forEach((line, i) => {
        if (i > 0) parts.push(<br key={k++} />);
        if (line) parts.push(line);
      });
    }
    if (m[2] !== undefined)
      parts.push(<strong key={k++} style={{ fontWeight: 700 }}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      parts.push(<strong key={k++} style={{ fontWeight: 700 }}>{m[3]}</strong>);
    else if (m[4] !== undefined)
      parts.push(<s key={k++}>{m[4]}</s>);
    else if (m[5] !== undefined)
      parts.push(<em key={k++}>{m[5]}</em>);
    else if (m[6] !== undefined)
      parts.push(<em key={k++}>{m[6]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const raw = text.slice(last);
    raw.split("\n").forEach((line, i) => {
      if (i > 0) parts.push(<br key={k++} />);
      if (line) parts.push(line);
    });
  }
  return parts.length ? parts : text;
}

function styleSvgForSlide(
  svgString: string,
  slide: { title: string; bullets?: string[]; content?: string | null }
): string {
  if (typeof window === "undefined") return svgString;
  const slideTitle = slide.title.toLowerCase().trim();
  // Include 3+ char words so short words like "sun", "air" are captured
  const keywords = new Set(
    [slide.title, ...(slide.bullets ?? []), slide.content ?? ""]
      .join(" ")
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2)
  );
  try {
    const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
    if (doc.querySelector("parsererror")) return svgString;
    const textEls = Array.from(doc.querySelectorAll("text"));
    // Skip title bar (y < 50)
    const labelEls = textEls.filter((el) => {
      const y = parseFloat(
        el.getAttribute("y") ??
          el.querySelector("tspan")?.getAttribute("y") ??
          "999"
      );
      return y >= 50;
    });
    const scored = labelEls.map((el) => {
      const labelText = (el.textContent ?? "").toLowerCase().trim();
      const words = labelText.split(/\W+/).filter((w) => w.length > 2);
      let score = words.filter((w) => keywords.has(w)).length;
      // Strong bonus for near-exact match with slide title — prevents false ties
      if (labelText === slideTitle) {
        score += 10;
      } else if (
        slideTitle.includes(labelText) ||
        labelText.includes(slideTitle)
      ) {
        score += 5;
      }
      return { el, score };
    });
    const maxScore = Math.max(...scored.map((s) => s.score), 0);
    if (maxScore === 0) return svgString;
    scored.forEach(({ el, score }) => {
      if (score === maxScore) {
        el.setAttribute("fill", "#16a34a");
        el.setAttribute("font-weight", "bold");
        const fs = parseFloat(el.getAttribute("font-size") ?? "13");
        el.setAttribute("font-size", String(Math.round(fs * 1.15)));
      } else {
        el.setAttribute("opacity", "0.4");
      }
    });
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch {
    return svgString;
  }
}

type Slide = {
  title: string;
  bullets: string[];
  content?: string | null;
  image?: string | null;
  imageAlt?: string;
  imageSource?:
    | "pexels"
    | "unsplash"
    | "pixabay"
    | "stability"
    | "diagram"
    | null;
  imageCredit?: string | null;
  /** Clickable URL for attribution (Unsplash requires a link; null for other sources) */
  imageCreditUrl?: string | null;
  youtubeVideoId?: string | null;
  visualType?: "photo" | "diagram" | null;
  /** Whether the imageQuery is a literal search term or a metaphorical scene description */
  imageStrategy?: "literal" | "metaphor" | null;
  slideType?:
    | "intro"
    | "explanation"
    | "example"
    | "fact"
    | "comparison"
    | "columns"
    | "reflection"
    | "question"
    | "quiz"
    | "recap"
    | null;
  /** Optional second image for comparison slides (Side B image) */
  imageB?: string | null;
  imageBSource?:
    | "pexels"
    | "unsplash"
    | "pixabay"
    | "stability"
    | "diagram"
    | null;
  imageBCredit?: string | null;
  /** Comparison slide: distinct label and content for each side */
  sideALabel?: string | null;
  sideBLabel?: string | null;
  sideABullets?: string[] | null;
  sideBBullets?: string[] | null;
  sideAContent?: string | null;
  sideBContent?: string | null;
  /** Columns slide: visual card grid */
  columns?: Array<{
    label: string;
    description: string;
    imageQuery?: string | null;
    image?: string | null;
    imageAlt?: string;
    imageSource?: "pexels" | "unsplash" | "pixabay" | "stability" | null;
    imageCredit?: string | null;
  }> | null;
};

type Deck = {
  deckTitle?: string;
  slides?: Slide[];
  topicType?: string;
};

/** Compress a base64 data URI to JPEG at reduced size to keep export payloads small. */
async function compressDataUrl(
  dataUrl: string,
  maxDim = 1200,
  quality = 0.75
): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl; // URL — no action needed
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback: send as-is
    img.src = dataUrl;
  });
}

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  useEffect(() => {
    const authInstance = getFirebaseAuth();
    if (!authInstance) return;
    return onAuthStateChanged(authInstance, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const visited = localStorage.getItem("cipher_visited");
      if (visited) setShowLanding(false);
    }
  }, []);

  function enterApp() {
    localStorage.setItem("cipher_visited", "1");
    setShowLanding(false);
  }

  const [topic, setTopic] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [stabilitySlides, setStabilitySlides] = useState<Set<number>>(new Set());
  const [stabilityColKeys, setStabilityColKeys] = useState<Set<string>>(new Set());
  const [diagramLoadingSlides, setDiagramLoadingSlides] = useState<Set<number>>(
    new Set()
  );
  const [sharedDiagramSvg, setSharedDiagramSvg] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");

  const [gradeLevel, setGradeLevel] = useState<number>(5);
  const [curriculum, setCurriculum] = useState<string>("Cambridge");
  const [materialType, setMaterialType] = useState<
    "slides" | "activity" | "full"
  >("full");

  // activity sheet state
  const [activityLoading, setActivityLoading] = useState(false);

  // download state
  const [downloading, setDownloading] = useState(false);

  // per-slide pasted images (index → { dataUrl, credit })
  const [pastedImages, setPastedImages] = useState<
    Record<number, { dataUrl: string; credit: string }>
  >({});

  // debug panel state (only populated when running on localhost)
  const [debugInfo, setDebugInfo] = useState<null | {
    topicStructure: { topicType: string; structureItems: string[] };
    ragLessons: Array<{ lessonNumber: number; title: string; chapter: string; content: string; score: number }>;
    ragContext: string | null;
    prompt: string;
    rawCompletion: string;
  }>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTab, setDebugTab] = useState<"rag" | "prompt" | "deck">("prompt");
  // tracks which bullet is in edit mode: "<slideIdx>-<bulletIdx>"
  const [editingBullet, setEditingBullet] = useState<string | null>(null);
  // tracks which slide's content paragraph is being edited
  const [editingContent, setEditingContent] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // responsive breakpoint for inline-style-driven layouts
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const slides = deck?.slides ?? [];
  const total = slides.length;
  const current = slides[idx];

  const pastedEntry = pastedImages[idx];
  const displayImage = pastedEntry?.dataUrl ?? current?.image ?? null;
  const imageCredit = pastedEntry?.credit ?? current?.imageCredit ?? null;
  const imageCreditUrl = pastedEntry ? null : current?.imageCreditUrl ?? null;

  const styledDiagramSvg = useMemo(() => {
    if (!sharedDiagramSvg || current?.imageSource !== "diagram") return null;
    return styleSvgForSlide(sharedDiagramSvg, current);
  }, [sharedDiagramSvg, idx, current]);

  const canPrev = idx > 0;
  const canNext = idx < total - 1;

  function prev() {
    setSlideDir("left");
    setIdx((i) => Math.max(0, i - 1));
  }

  function next() {
    setSlideDir("right");
    setIdx((i) => Math.min(total - 1, i + 1));
  }

  // Keyboard navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!total) return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [total]);

  // Title-based fallback for detecting no-image slides when slideType is null/unrecognized.
  // Covers English, Uzbek Latin, Russian Cyrillic, and Uzbek Cyrillic equivalents of
  // quiz / true-false / reflection / recap / review slide types.
  const NO_IMG_TITLE_RE =
    /\b(quiz|true[\s/_-]?(?:or[\s/_-]?)?false|reflect(?:ion)?|recap|review|viktorina|xulosa|takrorlash|mulohaza|fikrlash)\b|викторин[аы]|тест(?![а-яёА-ЯЁ])|размышлени[еяй]|рефлекси[ия]|повторени[еяй]|хулоса|такрорлаш|мулоҳаза|фикрлаш/i;

  function applyFillRules(slides: Slide[]): Slide[] {
    const result = [...slides];
    const n = result.length;
    if (n < 2) return result;

    const lastTwoStart = Math.max(0, n - 2);
    const first = result[0];

    const isNoImageType = (s: Slide) =>
      s.slideType
        ? ["reflection", "question", "quiz", "recap"].includes(s.slideType)
        : NO_IMG_TITLE_RE.test(s.title ?? "");

    // Rule 1: last 2 slides borrow first slide's image if imageless (skip video slides)
    if (first?.image) {
      for (let i = lastTwoStart; i < n; i++) {
        if (
          !isNoImageType(result[i]) &&
          !result[i].image &&
          !result[i].youtubeVideoId
        ) {
          result[i] = {
            ...result[i],
            image: first.image,
            imageAlt: first.imageAlt,
            imageSource: first.imageSource,
            imageCredit: first.imageCredit,
            imageCreditUrl: first.imageCreditUrl,
          };
        }
      }
    }

    // Rule 2: fill up to 2 mid-deck imageless slides from best-matching image slide
    const totalImages = result.filter((s) => s.image).length;
    if (totalImages < 5) {
      const excluded = new Set([0, lastTwoStart, lastTwoStart + 1]);
      const sources = result
        .map((s, i) => ({ s, i }))
        .filter(({ i, s }) => !excluded.has(i) && !!s.image);
      const targets = result
        .map((s, i) => ({ s, i }))
        .filter(
          ({ i, s }) =>
            !excluded.has(i) &&
            !s.image &&
            !s.youtubeVideoId &&
            !isNoImageType(s)
        );

      if (sources.length > 0 && targets.length > 0) {
        const kws = (slide: Slide) =>
          new Set(
            [slide.title, ...(slide.bullets ?? []), slide.content ?? ""]
              .join(" ")
              .toLowerCase()
              .split(/\W+/)
              .filter((w) => w.length > 3)
          );
        targets.slice(0, 2).forEach(({ s: slide, i }) => {
          let best = sources[0];
          let bestScore = 0;
          const kw = kws(slide);
          for (const src of sources) {
            const overlap = [...kws(src.s)].filter((w) => kw.has(w)).length;
            if (overlap > bestScore) {
              bestScore = overlap;
              best = src;
            }
          }
          result[i] = {
            ...result[i],
            image: best.s.image,
            imageAlt: best.s.imageAlt ?? "",
            imageSource: best.s.imageSource,
            imageCredit: best.s.imageCredit,
            imageCreditUrl: best.s.imageCreditUrl,
          };
        });
      }
    }

    // Rule 3 (primary only): all remaining imageless non-quiz slides get slide 0's image
    if (gradeLevel <= 4 && first?.image) {
      for (let i = 1; i < n; i++) {
        if (
          !isNoImageType(result[i]) &&
          !result[i].image &&
          !result[i].youtubeVideoId
        ) {
          result[i] = {
            ...result[i],
            image: first.image,
            imageAlt: first.imageAlt,
            imageSource: first.imageSource,
            imageCredit: first.imageCredit,
            imageCreditUrl: first.imageCreditUrl,
          };
        }
      }
    }

    // Absolute guard: quiz / true-false / reflection / question slides must never have images
    // Uses isNoImageType so null-slideType slides caught by title regex are also protected
    for (let i = 0; i < n; i++) {
      if (
        isNoImageType(result[i]) &&
        (result[i].image || result[i].youtubeVideoId)
      ) {
        result[i] = {
          ...result[i],
          image: null,
          imageSource: null,
          imageAlt: "",
          imageCredit: null,
          imageCreditUrl: null,
          youtubeVideoId: null,
        };
      }
    }

    return result;
  }

  function patchSlide(index: number, patch: Partial<Slide>, applyFill = false) {
    setDeck((prev) => {
      if (!prev?.slides) return prev;
      const slides = [...prev.slides];
      slides[index] = { ...slides[index], ...patch };
      return { ...prev, slides: applyFill ? applyFillRules(slides) : slides };
    });
  }

  async function generateActivity(
    topicStr: string,
    deckSlides?: Slide[],
    deckTopicType?: string
  ) {
    setActivityLoading(true);
    try {
      // Strip image data before sending to keep payload small
      const slidePayload = deckSlides?.map((s) => ({
        title: s.title,
        bullets: s.bullets,
        content: s.content ?? null,
        slideType: s.slideType ?? null,
        sideALabel: s.sideALabel ?? null,
        sideBLabel: s.sideBLabel ?? null,
        sideABullets: s.sideABullets ?? null,
        sideBBullets: s.sideBBullets ?? null,
        sideAContent: s.sideAContent ?? null,
        sideBContent: s.sideBContent ?? null,
      }));
      const actRes = await fetch("/api/generate/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicStr,
          grade: gradeLevel,
          curriculum,
          deckTitle: deck?.deckTitle ?? topicStr,
          slides: slidePayload ?? null,
          topicType: deckTopicType ?? null,
        }),
      });
      if (!actRes.ok) {
        const errData = await actRes.json().catch(() => ({}));
        throw new Error(`Activity generation failed: ${errData?.error ?? actRes.status}`);
      }
      const actData = await actRes.json();

      const docxRes = await fetch("/api/export/activity-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...actData,
          topic: topicStr,
          grade: gradeLevel,
          deckTitle: deck?.deckTitle ?? topicStr,
        }),
      });
      if (!docxRes.ok) throw new Error("Activity export failed");

      const blob = await docxRes.blob();
      const url = window.URL.createObjectURL(blob);
      const title = (actData.sheetTitle || topicStr)
        .replace(/[^a-z0-9-_ ]/gi, "")
        .trim()
        .replace(/\s+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}_activity.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Activity sheet error:", e);
      alert("Activity sheet generation failed. Check console.");
    } finally {
      setActivityLoading(false);
    }
  }

  async function generateLesson() {
    if (!topic.trim()) return;
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }

    // Activity-only mode: just generate + download the sheet, skip slides
    if (materialType === "activity") {
      setDeck(null);
      setIdx(0);
      setPastedImages({});
      await generateActivity(topic);
      return;
    }

    setLoading(true);
    setImagesLoading(false);
    setDiagramLoadingSlides(new Set());
    setSharedDiagramSvg(null);
    setDeck(null);
    setIdx(0);
    setPastedImages({});
    setDebugInfo(null);
    setDebugOpen(false);

    try {
      // ── Step 1: OpenAI text (~2–3 s) — show slides immediately ────────────
      const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
      const textRes = await fetch("/api/generate/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          slideCount: 10,
          grade: gradeLevel,
          primaryMode: gradeLevel <= 4,
          curriculum,
          debug: isLocalhost,
        }),
      });

      if (!textRes.ok) throw new Error("Text generation failed");
      const textData = await textRes.json();
      const { deckTitle, englishDeckTitle, slides: rawSlides, topicType: deckTopicType } = textData;
      if (isLocalhost && textData._debug) {
        setDebugInfo(textData._debug);
        setDebugOpen(true);
        setDebugTab("rag");
      }
      // Use the English-translated title for stock photo searches (slide 0 imageQuery)
      const imageSearchDeckTitle: string = englishDeckTitle ?? deckTitle;

      const initSlides: Slide[] = rawSlides.map((s: any) => ({
        title: s.title ?? "",
        bullets: s.bullets ?? [],
        content: s.content || null,
        image: null,
        imageAlt: "",
        imageSource: null,
        imageCredit: null,
        imageCreditUrl: null,
        youtubeVideoId: null,
        visualType: s.visualType ?? null,
        imageStrategy: s.imageStrategy ?? null,
        slideType: s.slideType ?? null,
        sideALabel: s.sideALabel ?? null,
        sideBLabel: s.sideBLabel ?? null,
        sideABullets: s.sideABullets ?? null,
        sideBBullets: s.sideBBullets ?? null,
        sideAContent: s.sideAContent ?? null,
        sideBContent: s.sideBContent ?? null,
        columns: Array.isArray(s.columns) ? s.columns.map((c: any) => ({
          label: c.label ?? "",
          description: c.description ?? "",
          imageQuery: c.imageQuery ?? null,
          image: null,
          imageAlt: "",
          imageSource: null,
          imageCredit: null,
        })) : null,
      }));

      setDeck({ deckTitle, slides: initSlides, topicType: deckTopicType ?? undefined });
      setIdx(0);
      setLoading(false);
      setImagesLoading(true);

      // ── Step 2: Split visual slides by intended visual type ──────────────
      let visualSlides: Array<{
        origIndex: number;
        title: string;
        bullets: string[];
        content?: string | null;
        imageQuery: string;
        visualType: "photo" | "diagram" | null;
        imageStrategy?: "literal" | "metaphor" | null;
        slideType?: string | null;
      }> = rawSlides
        .map((s: any, i: number) => ({ ...s, origIndex: i }))
        .filter(
          (s: any) =>
            typeof s.imageQuery === "string" &&
            s.imageQuery.trim() &&
            !(
              s.slideType &&
              ["reflection", "question", "quiz", "recap", "columns"].includes(s.slideType)
            ) &&
            !NO_IMG_TITLE_RE.test(s.title ?? "")
        );

      // Rule 1: Slide 0 always gets a pexels/unsplash photo with general meaning.
      // If the AI gave slide 0 a diagram visualType or no imageQuery, inject it as a photo slide.
      // Skip if slide 0 is a no-image type (quiz, reflection, question, recap).
      const NO_IMAGE_TYPES = ["reflection", "question", "quiz", "recap", "columns"];
      const slide0IsNoImageType =
        rawSlides[0]?.slideType &&
        NO_IMAGE_TYPES.includes(rawSlides[0].slideType);
      const slide0InVisual = visualSlides.some((s) => s.origIndex === 0);
      if (!slide0InVisual && rawSlides[0] && !slide0IsNoImageType) {
        const s0 = rawSlides[0];
        visualSlides = [
          {
            origIndex: 0,
            title: s0.title ?? "",
            bullets: s0.bullets ?? [],
            content: s0.content ?? null,
            imageQuery: imageSearchDeckTitle,
            visualType: "photo",
          },
          ...visualSlides,
        ];
      }

      // All visual slides use photo sources (Pexels/Stability); diagram generation is disabled.
      const photoSlides = visualSlides;

      // ── Step 4: Pexels / Unsplash / Pixabay for photo slides ─────────────
      // Run Pexels/Unsplash/Pixabay for all photo slides first (primary + secondary).
      // The Stability AI slot is discovered *after* results arrive based on which
      // slide failed or is most abstract.
      const pexelTargets = photoSlides;

      const pexelResults = await Promise.all(
        pexelTargets.map(async (slide) => {
          try {
            const res = await fetch("/api/generate/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                // Rule 1: slide 0 uses English-translated deckTitle as general-meaning query
                imageQuery:
                  slide.origIndex === 0 ? imageSearchDeckTitle : slide.imageQuery,
                title: slide.origIndex === 0 ? imageSearchDeckTitle : slide.title,
                bullets:
                  slide.origIndex === 0
                    ? []
                    : slide.bullets?.length
                    ? slide.bullets
                    : slide.content
                    ? slide.content.split(/[.!?]+/).filter(Boolean)
                    : [],
                // imageStrategy guides semantic scoring: metaphor slides get richer scene-based queries
                imageStrategy:
                  slide.origIndex === 0
                    ? "literal"
                    : slide.imageStrategy ?? null,
                deckTitle,
              }),
            });
            const data = res.ok ? await res.json() : { image: null };
            if (data.image) patchSlide(slide.origIndex, data);
            return {
              index: slide.origIndex,
              hasImage: !!data.image,
              data: data.image ? data : null,
            };
          } catch {
            return { index: slide.origIndex, hasImage: false, data: null };
          }
        })
      );

      // ── Step 4b: Fetch images for each column in "columns" slides ────────────
      const columnsSlides = rawSlides
        .map((s: any, i: number) => ({ ...s, origIndex: i }))
        .filter((s: any) => s.slideType === "columns" && Array.isArray(s.columns) && s.columns.length > 0);

      await Promise.all(
        columnsSlides.map(async (slide: any) => {
          const colImages = await Promise.all(
            (slide.columns as any[]).map(async (col: any) => {
              if (!col.imageQuery) return { image: null };
              try {
                const res = await fetch("/api/generate/image", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    imageQuery: col.imageQuery,
                    title: col.label ?? "",
                    bullets: col.description ? [col.description] : [],
                    deckTitle,
                  }),
                });
                return res.ok ? await res.json() : { image: null };
              } catch {
                return { image: null };
              }
            })
          );
          // Patch Pexels results immediately
          setDeck((prev) => {
            if (!prev?.slides) return prev;
            const slides = [...prev.slides];
            const s = { ...slides[slide.origIndex] };
            if (Array.isArray(s.columns)) {
              s.columns = s.columns.map((col, ci) => ({
                ...col,
                image: colImages[ci]?.image ?? null,
                imageAlt: colImages[ci]?.imageAlt ?? "",
                imageSource: colImages[ci]?.imageSource ?? null,
                imageCredit: colImages[ci]?.imageCredit ?? null,
              }));
            }
            slides[slide.origIndex] = s;
            return { ...prev, slides };
          });

          // Stability fallback for any column that got no Pexels image
          await Promise.all(
            (slide.columns as any[]).map(async (col: any, ci: number) => {
              if (colImages[ci]?.image) return; // already has an image
              const colKey = `${slide.origIndex}:${ci}`;
              setStabilityColKeys((prev) => new Set([...prev, colKey]));
              try {
                const res = await fetch("/api/generate/stability", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: col.label ?? "",
                    bullets: col.description ? [col.description] : [],
                    deckTitle,
                  }),
                });
                const data = res.ok ? await res.json() : { image: null };
                if (data.image) {
                  setDeck((prev) => {
                    if (!prev?.slides) return prev;
                    const slides = [...prev.slides];
                    const s = { ...slides[slide.origIndex] };
                    if (Array.isArray(s.columns)) {
                      s.columns = s.columns.map((c, i) =>
                        i === ci
                          ? { ...c, image: data.image, imageAlt: data.imageAlt ?? "", imageSource: data.imageSource ?? null, imageCredit: data.imageCredit ?? null }
                          : c
                      );
                    }
                    slides[slide.origIndex] = s;
                    return { ...prev, slides };
                  });
                }
              } catch {
                // ignore — column stays imageless
              } finally {
                setStabilityColKeys((prev) => {
                  const next = new Set(prev);
                  next.delete(colKey);
                  return next;
                });
              }
            })
          );
        })
      );

      // ── Step 5: Note which slides got real photos ──────────────────────────
      const pexelImageIndices = new Set(
        pexelResults.filter((r) => r.hasImage).map((r) => r.index)
      );

      // If slide 0 got no image, borrow from the first other slide that did
      if (!pexelImageIndices.has(0)) {
        const donor = pexelResults.find(
          (r) => r.index !== 0 && r.hasImage && r.data
        );
        if (donor?.data) {
          patchSlide(0, donor.data);
          pexelImageIndices.add(0);
        }
      }

      // Apply fill-rules after Pexels
      setDeck((prev) =>
        prev ? { ...prev, slides: applyFillRules(prev.slides ?? []) } : prev
      );
      setImagesLoading(false); // Slides are ready — background tasks run below

      if (user) {
        trackEvent(user, "deck_generated", {
          topic,
          grade: gradeLevel,
          curriculum,
          slideCount: rawSlides.length,
          deckTitle,
        });
      }

      // ── Step 6: Stability AI for ALL imageless non-exception slides ──────────
      // Every slide that didn't get a Pexels image (and isn't quiz/reflection/question/recap/columns)
      // gets its own unique AI-generated image.
      {
        const imagelessTargets = (rawSlides as any[])
          .map((s: any, i: number) => ({ ...s, origIndex: i }))
          .filter(
            (s: any) =>
              !NO_IMAGE_TYPES.includes(s.slideType ?? "") &&
              !NO_IMG_TITLE_RE.test(s.title ?? "") &&
              !pexelImageIndices.has(s.origIndex)
          );

        if (imagelessTargets.length > 0) {
          setStabilitySlides(new Set(imagelessTargets.map((s: any) => s.origIndex as number)));
          await Promise.all(
            imagelessTargets.map(async (s: any) => {
              const stIdx = s.origIndex as number;
              try {
                const res = await fetch("/api/generate/stability", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: s.title,
                    bullets: s.bullets,
                    imageQuery: s.imageQuery ?? null,
                    imageStrategy: s.imageStrategy ?? null,
                    deckTitle,
                  }),
                });
                const data = res.ok ? await res.json() : { image: null };
                if (data.image) {
                  setDeck((prev) => {
                    if (!prev?.slides) return prev;
                    const slides = [...prev.slides];
                    slides[stIdx] = { ...slides[stIdx], ...data };
                    return { ...prev, slides: applyFillRules(slides) };
                  });
                }
              } catch (e) {
                console.error("Stability error:", e);
              } finally {
                setStabilitySlides((prev) => {
                  const next = new Set(prev);
                  next.delete(stIdx);
                  return next;
                });
              }
            })
          );
        }
      }

      // Diagram generation is disabled; Steps 7 and 8 removed.

      // ── Activity sheet (both mode) — fire in background ───────────────────
      if (materialType === "full") {
        generateActivity(topic, initSlides, deckTopicType ?? undefined);
      }
    } finally {
      setLoading(false);
      setImagesLoading(false);
    }
  }

  async function download(kind: "pdf") {
    if (!deck?.slides?.length) return;

    setDownloading(true);

    try {
      const compressedSlides = await Promise.all(
        deck.slides!.map(async (s, i) => {
          const pasted = pastedImages[i];
          const rawImage = pasted?.dataUrl ?? s.image ?? null;
          const rawImageB = s.imageB ?? null;
          return {
            ...s,
            image: rawImage ? await compressDataUrl(rawImage) : null,
            imageB: rawImageB ? await compressDataUrl(rawImageB) : null,
            imageCredit: pasted?.credit ?? s.imageCredit ?? null,
            imageSource: pasted ? null : s.imageSource,
          };
        })
      );
      const exportDeck = { ...deck, slides: compressedSlides };

      const res = await fetch(`/api/export/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportDeck),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Export failed:", err);
        alert(
          err?.details ||
            err?.error ||
            `Download failed (${res.status}). Please try again.`
        );
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const title = (deck.deckTitle || "lesson")
        .replace(/[^a-z0-9-_ ]/gi, "")
        .trim()
        .replace(/\s+/g, "_");

      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);

      if (user) {
        trackEvent(user, "pdf_exported", {
          topic: deck.deckTitle,
          slideCount: deck.slides?.length ?? 0,
        });
      }
    } finally {
      setDownloading(false);
    }
  }

  function handleImagePaste(e: React.ClipboardEvent, slideIdx: number) {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const credit = "Unknown source — please add credit";
        const reader = new FileReader();
        reader.onload = (ev) => {
          setPastedImages((prev) => ({
            ...prev,
            [slideIdx]: { dataUrl: ev.target?.result as string, credit },
          }));
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  }

  const deckRef = useRef<HTMLDivElement>(null);

  // Smooth-scroll to the deck when slides first appear
  const hasDeck = total > 0;
  useEffect(() => {
    if (hasDeck) {
      deckRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [hasDeck]);

  const progressLabel = useMemo(() => {
    if (!total) return "";
    return `${idx + 1} / ${total}`;
  }, [idx, total]);

  // ── Slide-type-driven styling ─────────────────────────────────────────────
  const slideType = current?.slideType ?? null;
  const isColumnsSlide =
    slideType === "columns" ||
    (slideType == null && Array.isArray(current?.columns) && (current?.columns?.length ?? 0) > 0);
  // Defense-in-depth: if sideA/sideB fields are present, treat as comparison regardless of slideType
  const isComparisonSlide =
    !isColumnsSlide &&
    (slideType === "comparison" ||
    !!(current?.sideALabel || current?.sideAContent || current?.sideABullets));
  const isNoImageSlide = slideType
    ? ["reflection", "question", "quiz", "recap"].includes(slideType)
    : NO_IMG_TITLE_RE.test(current?.title ?? "");

  const headerBg = "#166534";
  const headerBorderBg = "#14532d";
  const cardShadow = "8px 8px 0 #fbbf24";
  const contentBg = "#ffffff";
  const contentTextColor = "#111827";
  const bulletAccentColor = "#166534";

  const slideTypeLabels: Record<string, string> = {
    reflection: "💭 Reflect",
    question: "❓ Question",
    quiz: "📝 Quiz",
    recap: "📋 Recap",
    comparison: "⚖️ Compare",
    columns: "🗂️ Grid",
    fact: "⭐ Fact",
    example: "💡 Example",
    intro: "📖 Intro",
    explanation: "🔍 Explain",
  };
  const slideTypeLabel = isColumnsSlide
    ? "🗂️ Grid"
    : isComparisonSlide
    ? "⚖️ Compare"
    : slideType
    ? slideTypeLabels[slideType] ?? null
    : null;

  // Comparison layout: use sideA/sideB fields when present, else split bullets or content in half
  const compBullets = current?.bullets ?? [];
  const compMid = Math.ceil(compBullets.length / 2);
  const compLeftBullets = current?.sideABullets?.length
    ? current.sideABullets
    : compBullets.slice(0, compMid);
  const compRightBullets = current?.sideBBullets?.length
    ? current.sideBBullets
    : compBullets.slice(compMid);
  // Final fallback: split content field in half when all sideA/B data is missing
  const _compContentSentences = (current?.content ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const _compContentMid = Math.ceil(_compContentSentences.length / 2);
  const compLeftContent =
    current?.sideAContent ??
    (current?.sideABullets?.length ? current.sideABullets.join("\n") : null) ??
    (compLeftBullets.length > 0 ? compLeftBullets.join("\n") : null) ??
    _compContentSentences.slice(0, _compContentMid).join(" ") ??
    "";
  const compRightContent =
    current?.sideBContent ??
    (current?.sideBBullets?.length ? current.sideBBullets.join("\n") : null) ??
    (compRightBullets.length > 0 ? compRightBullets.join("\n") : null) ??
    _compContentSentences.slice(_compContentMid).join(" ") ??
    "";

  if (showLanding) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6"
        style={{ background: "#f4f6f9" }}
      >
        <style>{`
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .landing-fade { animation: fadeUp 0.5s ease-out both; }
          .landing-fade-2 { animation: fadeUp 0.5s ease-out 0.15s both; }
          .landing-fade-3 { animation: fadeUp 0.5s ease-out 0.3s both; }
          .landing-fade-4 { animation: fadeUp 0.5s ease-out 0.45s both; }
          .landing-btn:active { transform: translate(3px, 3px); box-shadow: none !important; }
        `}</style>

        {/* Card */}
        <div
          className="w-full max-w-xl rounded-3xl p-10 md:p-14 flex flex-col items-center text-center"
          style={{
            background: "#ffffff",
            border: "3px solid rgb(48,47,45)",
            boxShadow: "8px 8px 0 rgb(48,47,45)",
          }}
        >
          {/* Logo */}
          <div
            className="landing-fade inline-flex items-center gap-2 px-5 py-2 rounded-xl mb-8"
            style={{
              background: "#166534",
              border: "3px solid #14532d",
              boxShadow: "4px 4px 0 rgb(48,47,45)",
            }}
          >
            <span
              className="text-2xl md:text-3xl font-black"
              style={{ color: "#ffffff", letterSpacing: "-0.5px" }}
            >
              Classory<span style={{ color: "#fde68a" }}>AI</span>
            </span>
          </div>

          <h1
            className="landing-fade-2 text-3xl md:text-4xl font-black leading-tight"
            style={{ color: "#111827" }}
          >
            Create teaching resources{" "}
            <span style={{ color: "#166534" }}>easily</span>.
          </h1>

          <p
            className="landing-fade-3 mt-4 text-base md:text-lg font-bold"
            style={{ color: "#6b7280" }}
          >
            Generate beautiful slide decks for any topic and grade level —
            powered by AI, in seconds.
          </p>

          {/* Feature pills */}
          <div className="landing-fade-3 mt-6 flex flex-wrap gap-2 justify-center">
            {[
              "📚 Curriculum-aligned",
              "🖼 Auto images",
              "📄 PDF export",
              "✏️ Activity Sheets",
            ].map((f) => (
              <span
                key={f}
                className="text-xs font-black px-3 py-1.5 rounded-lg"
                style={{
                  background: "#f0fdf4",
                  color: "#166534",
                  border: "2px solid #bbf7d0",
                }}
              >
                {f}
              </span>
            ))}
          </div>

          <button
            onClick={enterApp}
            className="landing-fade-4 landing-btn mt-10 rounded-2xl px-10 py-4 text-xl font-black transition-all"
            style={{
              background: "#166534",
              color: "#ffffff",
              border: "3px solid #14532d",
              boxShadow: "5px 5px 0 rgb(48,47,45)",
              cursor: "pointer",
            }}
          >
            Generate a Slide Deck ✦
          </button>

          <p
            className="landing-fade-4 mt-4 text-xs font-bold"
            style={{ color: "#9ca3af" }}
          >
            No sign-up required
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f4f6f9" }}>
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .comic-input::placeholder { color: #6b7280; }
        .comic-select option { background: #ffffff; color: #111827; }
        .comic-btn:active { transform: translate(3px, 3px); box-shadow: none !important; }
        .comic-nav-btn:active { transform: translate(2px, 2px); box-shadow: none !important; }
      `}</style>

      <div className="max-w-6xl mx-auto p-3 md:p-8">
        {/* ── Top bar ── */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Logo */}
            <div
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl"
              style={{
                background: "#166534",
                border: "3px solid #14532d",
                boxShadow: "4px 4px 0 rgb(48, 47, 45)",
              }}
            >
              <span
                className="text-2xl md:text-3xl font-black"
                style={{ color: "#ffffff", letterSpacing: "-0.5px" }}
              >
                Classory <span style={{ color: "#fde68a" }}>AI</span>
              </span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {total ? (
                <div
                  className="text-sm font-black px-4 py-1.5 rounded-lg"
                  style={{
                    background: "#ffffff",
                    color: "#111827",
                    border: "3px solid rgb(48, 47, 45)",
                    boxShadow: "3px 3px 0 rgb(48, 47, 45)",
                  }}
                >
                  {progressLabel}
                </div>
              ) : null}

              {user ? (
                <div className="flex items-center gap-2">
                  {user.photoURL && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.photoURL}
                      alt={user.displayName ?? ""}
                      className="w-8 h-8 rounded-full"
                      style={{ border: "2px solid rgb(48,47,45)" }}
                    />
                  )}
                  <button
                    onClick={() => {
                      const a = getFirebaseAuth();
                      if (a) signOut(a);
                    }}
                    className="text-xs font-black px-3 py-1.5 rounded-lg"
                    style={{
                      background: "#ffffff",
                      color: "#374151",
                      border: "2px solid rgb(48,47,45)",
                      boxShadow: "2px 2px 0 rgb(48,47,45)",
                      cursor: "pointer",
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const a = getFirebaseAuth();
                    if (a) signInWithPopup(a, googleProvider);
                  }}
                  className="text-sm font-black px-4 py-1.5 rounded-lg"
                  style={{
                    background: "#166534",
                    color: "#ffffff",
                    border: "3px solid #14532d",
                    boxShadow: "3px 3px 0 rgb(48,47,45)",
                    cursor: "pointer",
                  }}
                >
                  Sign in with Google
                </button>
              )}
            </div>
          </div>

          {/* ── Input panel ── */}
          <div
            className="rounded-2xl p-4 md:p-6"
            style={{
              background: "#ffffff",
              border: "3px solid rgb(48, 47, 45)",
              boxShadow: "6px 6px 0 rgb(48, 47, 45)",
            }}
          >
            <label
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: "#374151" }}
            >
              Topic
            </label>

            <div className="mt-2 flex flex-col md:flex-row gap-3">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topic.trim() && !loading)
                    generateLesson();
                }}
                placeholder="e.g., 🌋 Volcanoes / Regular vs Irregular Verbs "
                className="comic-input w-full rounded-xl px-4 py-3 text-lg font-bold outline-none"
                style={{
                  background: "#f9fafb",
                  border: "3px solid #d1d5db",
                  color: "#111827",
                  boxShadow: "inset 2px 2px 0 #e5e7eb",
                }}
              />

              <button
                onClick={generateLesson}
                disabled={!topic.trim() || loading || activityLoading}
                className="comic-btn shrink-0 rounded-xl px-6 py-3 text-lg font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "#166534",
                  color: "#ffffff",
                  border: "3px solid #14532d",
                  boxShadow: "4px 4px 0 rgb(48, 47, 45)",
                  cursor: "pointer",
                }}
              >
                {loading
                  ? "Writing slides…"
                  : imagesLoading
                  ? "Loading images…"
                  : activityLoading
                  ? "Making worksheet…"
                  : "Generate ✦"}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-6">
              <div className="flex gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-black uppercase tracking-widest"
                    style={{ color: "#374151" }}
                  >
                    Grade
                  </label>
                  <select
                    value={gradeLevel}
                    onChange={(e) => setGradeLevel(Number(e.target.value))}
                    className="comic-select rounded-lg px-3 py-2 text-sm font-bold outline-none"
                    style={{
                      background: "#ffffff",
                      border: "3px solid #d1d5db",
                      color: "#111827",
                      boxShadow: "3px 3px 0 #9ca3af",
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-black uppercase tracking-widest"
                    style={{ color: "#374151" }}
                  >
                    Curriculum
                  </label>
                  <select
                    value={curriculum}
                    onChange={(e) => setCurriculum(e.target.value)}
                    className="comic-select rounded-lg px-3 py-2 text-sm font-bold outline-none"
                    style={{
                      background: "#ffffff",
                      border: "3px solid #d1d5db",
                      color: "#111827",
                      boxShadow: "3px 3px 0 #9ca3af",
                    }}
                  >
                    {[
                      "Cambridge",
                      "O'zbekiston DTS",
                      "Pearson",
                      "IB (International Baccalaureate)",
                      "Common Core",
                      "CBSE",
                      "NCERT",
                      "Montessori",
                      "Australian (ACARA)",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Material type selector */}
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs font-black uppercase tracking-widest"
                  style={{ color: "#374151" }}
                >
                  Generate
                </label>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { value: "slides", label: "Slide Deck" },
                      { value: "activity", label: "✏️ Activity Sheet" },
                      { value: "full", label: "Full" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setMaterialType(value)}
                      className="rounded-lg px-3 py-1.5 text-sm font-black transition-all"
                      style={{
                        background:
                          materialType === value ? "#166534" : "#ffffff",
                        color: materialType === value ? "#ffffff" : "#374151",
                        border: `3px solid ${
                          materialType === value ? "#14532d" : "#d1d5db"
                        }`,
                        boxShadow:
                          materialType === value
                            ? "3px 3px 0 rgb(48,47,45)"
                            : "2px 2px 0 #d1d5db",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {materialType !== "slides" && (
                  <p
                    className="mt-1 text-xs font-bold"
                    style={{ color: "#6b7280" }}
                  >
                    Activity sheet downloads as a .docx file automatically.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Slide stage ── */}
        <div ref={deckRef} className="mt-8">
          {!total ? (
            <div
              className="rounded-2xl p-12 text-center"
              style={{
                background: "#ffffff",
                border: "3px solid rgb(48, 47, 45)",
                boxShadow: "6px 6px 0 rgb(48, 47, 45)",
              }}
            >
              <div className="text-5xl mb-4">📚</div>
              <div className="text-2xl font-black" style={{ color: "#111827" }}>
                No slides yet
              </div>
              <div className="mt-2 font-bold" style={{ color: "#6b7280" }}>
                Enter a topic and hit{" "}
                <span className="font-black" style={{ color: "#166534" }}>
                  Generate ✦
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Deck title + Download */}
              <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                {deck?.deckTitle ? (
                  <h2
                    className="text-xl md:text-2xl font-black px-4 py-1.5 rounded-xl"
                    style={{
                      background: "#166534",
                      color: "#ffffff",
                      border: "3px solid #14532d",
                      boxShadow: "4px 4px 0 rgb(48, 47, 45)",
                    }}
                  >
                    {deck.deckTitle}
                  </h2>
                ) : (
                  <div />
                )}

                <button
                  onClick={() => download("pdf")}
                  disabled={downloading}
                  className="comic-btn rounded-xl px-4 py-2 font-black transition-all disabled:opacity-40"
                  style={{
                    background: "#ffffff",
                    color: "#111827",
                    border: "3px solid rgb(48, 47, 45)",
                    boxShadow: "4px 4px 0 rgb(48, 47, 45)",
                  }}
                >
                  {downloading ? "Downloading…" : "⬇ PDF"}
                </button>
              </div>

              {/* Slide container */}
              <div className="relative flex items-center gap-3">
                {/* Prev — desktop only */}
                <button
                  onClick={prev}
                  disabled={!canPrev}
                  className="hidden md:flex comic-nav-btn shrink-0 rounded-xl px-4 py-4 font-black text-xl transition-all disabled:opacity-20"
                  style={{
                    background: "#166534",
                    color: "#ffffff",
                    border: "3px solid #14532d",
                    boxShadow: "4px 4px 0 rgb(48, 47, 45)",
                  }}
                >
                  ←
                </button>

                {/* Slide card */}
                <div
                  className="w-full aspect-[3/4] sm:aspect-[4/3] md:flex-1 md:aspect-video rounded-2xl overflow-hidden flex flex-col"
                  style={{
                    background: "#ffffff",
                    border: "3px solid rgb(48, 47, 45)",
                    boxShadow: cardShadow,
                  }}
                >
                  <div
                    key={idx}
                    className="flex flex-col flex-1 min-h-0"
                    style={{
                      animation: `slideIn${
                        slideDir === "right" ? "Right" : "Left"
                      } 0.22s ease-out`,
                    }}
                  >
                    {/* Header band */}
                    <div
                      className="flex items-center shrink-0"
                      style={{
                        height: "15%",
                        background: headerBg,
                        borderBottom: `3px solid ${headerBorderBg}`,
                      }}
                    >
                      <div
                        className="w-2 self-stretch shrink-0"
                        style={{ background: "rgb(48, 47, 45)" }}
                      />
                      <input
                        key={idx}
                        defaultValue={current?.title}
                        onBlur={(e) =>
                          patchSlide(idx, {
                            title: e.target.value || current?.title || "",
                          })
                        }
                        className="flex-1 px-4 text-base md:text-2xl font-black leading-tight bg-transparent border-0 outline-none min-w-0"
                        style={{ color: "#ffffff" }}
                      />
                      {slideTypeLabel && (
                        <span
                          className="shrink-0 text-[10px] md:text-xs font-black px-2 py-0.5 rounded-lg mr-1 select-none"
                          style={{
                            background: "rgba(255,255,255,0.2)",
                            color: "#ffffff",
                          }}
                        >
                          {slideTypeLabel}
                        </span>
                      )}
                      <span
                        className="shrink-0 pr-4 text-xs md:text-sm font-black px-2 py-0.5 rounded-lg mr-2"
                        style={{
                          background: "rgb(48, 47, 45)",
                          color: "#ffffff",
                        }}
                      >
                        {idx + 1}/{total}
                      </span>
                    </div>

                    {/* Content row — layout varies by slide type */}
                    {isColumnsSlide && current?.columns?.length ? (
                      /* ── COLUMNS: visual card grid (image + label + description) ── */
                      <div
                        className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden"
                        style={{ background: contentBg }}
                      >
                        {(current.columns ?? []).map((col, colIdx) => (
                          <div
                            key={colIdx}
                            className="shrink-0 md:flex-1 flex flex-col"
                            style={{
                              borderBottom: isMobile
                                ? colIdx < (current.columns?.length ?? 1) - 1
                                  ? "3px solid #e2e8f0"
                                  : "none"
                                : "none",
                              borderRight: !isMobile
                                ? colIdx < (current.columns?.length ?? 1) - 1
                                  ? "3px solid #e2e8f0"
                                  : "none"
                                : "none",
                            }}
                          >
                            {/* Column image */}
                            {col.image || imagesLoading || stabilityColKeys.has(`${idx}:${colIdx}`) ? (
                            <div
                              className="shrink-0 relative overflow-hidden group"
                              style={{
                                height: isMobile ? "180px" : "52%",
                                borderBottom: "2px solid #e2e8f0",
                                background: "#f8fafc",
                              }}
                              tabIndex={0}
                              title="Click here and paste to replace image (Ctrl+V)"
                              onPaste={(e) => {
                                for (const item of Array.from(e.clipboardData?.items ?? [])) {
                                  if (item.type.startsWith("image/")) {
                                    const file = item.getAsFile();
                                    if (!file) continue;
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                      patchSlide(idx, {
                                        columns: (current.columns ?? []).map((c, ci) =>
                                          ci === colIdx
                                            ? { ...c, image: ev.target?.result as string, imageCredit: "Pasted image" }
                                            : c
                                        ),
                                      });
                                    };
                                    reader.readAsDataURL(file);
                                    e.preventDefault();
                                    return;
                                  }
                                }
                              }}
                            >
                              {col.image ? (
                                <>
                                  <img
                                    src={col.image}
                                    alt={col.imageAlt || col.label}
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                                    <span
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-black px-2 py-0.5 rounded-lg"
                                      style={{ color: "#ffffff", background: "#166534" }}
                                    >
                                      Paste to replace (Ctrl+V)
                                    </span>
                                  </div>
                                  {/* Remove column image button */}
                                  <button
                                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full text-[10px] font-black leading-none"
                                    style={{
                                      width: 18,
                                      height: 18,
                                      background: "#dc2626",
                                      color: "#fff",
                                      border: "2px solid #fff",
                                      zIndex: 20,
                                    }}
                                    title="Remove image"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      patchSlide(idx, {
                                        columns: (current.columns ?? []).map((c, ci) =>
                                          ci === colIdx ? { ...c, image: null, imageCredit: undefined } : c
                                        ),
                                      });
                                    }}
                                  >
                                    ×
                                  </button>
                                </>
                              ) : (
                                <div
                                  className="w-full h-full flex items-center justify-center animate-pulse"
                                  style={{ background: "#f1f5f9" }}
                                >
                                  <span
                                    className="text-[9px] font-black"
                                    style={{ color: "#94a3b8" }}
                                  >
                                    {stabilityColKeys.has(`${idx}:${colIdx}`) ? "Generating AI image…" : "Loading…"}
                                  </span>
                                </div>
                              )}
                              {col.imageCredit && (
                                <div
                                  className="absolute bottom-0 right-0 px-1.5 py-0.5 text-[8px] font-bold rounded-tl"
                                  style={{
                                    color: "#166534",
                                    background: "rgba(255,255,255,0.85)",
                                  }}
                                >
                                  {col.imageCredit}
                                </div>
                              )}
                            </div>
                            ) : null}
                            {/* Column label + description */}
                            <div className="flex-1 relative flex flex-col items-center justify-center px-3 py-3 text-center gap-1 overflow-hidden">
                              {/* Paste image button — shown when no image */}
                              {!col.image && !imagesLoading && !stabilityColKeys.has(`${idx}:${colIdx}`) && (
                                <div
                                  className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-lg cursor-pointer text-[9px] font-black select-none"
                                  style={{
                                    background: "#f1f5f9",
                                    border: "1.5px dashed #cbd5e1",
                                    color: "#94a3b8",
                                  }}
                                  tabIndex={0}
                                  title="Click here and paste an image (Ctrl+V)"
                                  onPaste={(e) => {
                                    for (const item of Array.from(e.clipboardData?.items ?? [])) {
                                      if (item.type.startsWith("image/")) {
                                        const file = item.getAsFile();
                                        if (!file) continue;
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          patchSlide(idx, {
                                            columns: (current.columns ?? []).map((c, ci) =>
                                              ci === colIdx
                                                ? { ...c, image: ev.target?.result as string, imageCredit: "Pasted image" }
                                                : c
                                            ),
                                          });
                                        };
                                        reader.readAsDataURL(file);
                                        e.preventDefault();
                                        return;
                                      }
                                    }
                                  }}
                                >
                                  <span>📎</span>
                                  <span>Paste image</span>
                                </div>
                              )}
                              <input
                                key={`col-label-${idx}-${colIdx}`}
                                defaultValue={col.label}
                                onBlur={(e) => {
                                  const val = e.target.value.trim() || col.label;
                                  patchSlide(idx, {
                                    columns: (current.columns ?? []).map((c, ci) =>
                                      ci === colIdx ? { ...c, label: val } : c
                                    ),
                                  });
                                }}
                                className="font-black text-xs md:text-sm leading-tight bg-transparent border-0 outline-none w-full text-center resize-none"
                                style={{ color: "#166534" }}
                              />
                              {editingKey === `${idx}-col-${colIdx}` ? (
                                <textarea
                                  autoFocus
                                  key={`col-desc-${idx}-${colIdx}`}
                                  defaultValue={col.description}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim() || col.description;
                                    patchSlide(idx, {
                                      columns: (current.columns ?? []).map((c, ci) =>
                                        ci === colIdx ? { ...c, description: val } : c
                                      ),
                                    });
                                    setEditingKey(null);
                                  }}
                                  onKeyDown={(e) => { if (e.key === "Escape") setEditingKey(null); }}
                                  rows={2}
                                  className="text-[10px] md:text-xs leading-snug bg-transparent border-0 outline-none w-full text-center resize-none"
                                  style={{
                                    color: contentTextColor,
                                    fieldSizing: "content" as never,
                                  }}
                                />
                              ) : (
                                <div
                                  className="text-[10px] md:text-xs leading-snug w-full text-center cursor-text select-text"
                                  style={{ color: contentTextColor, minHeight: "1.5rem" }}
                                  onClick={() => setEditingKey(`${idx}-col-${colIdx}`)}
                                >
                                  {renderInline(col.description)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : isComparisonSlide ? (
                      /* ── COMPARISON: two-column split, image(s) inside columns ── */
                      <div
                        className="flex-1 flex flex-col min-h-0"
                        style={{ background: contentBg }}
                      >
                        {/* If one image (no imageB): show it spanning full width between headers and text */}
                        {!current?.imageB &&
                          (displayImage ||
                            imagesLoading ||
                            stabilitySlides.has(idx) ||
                            diagramLoadingSlides.has(idx)) && (
                            <div
                              className="shrink-0 relative overflow-hidden group"
                              style={{
                                height: "38%",
                                borderBottom: "3px solid #e2e8f0",
                                background: "#f8fafc",
                              }}
                              tabIndex={0}
                              onPaste={(e) => handleImagePaste(e, idx)}
                            >
                              {displayImage ? (
                                !pastedEntry &&
                                current?.imageSource === "diagram" ? (
                                  <div
                                    className="w-full h-full flex items-center justify-center [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-full overflow-hidden"
                                    dangerouslySetInnerHTML={{
                                      __html:
                                        styledDiagramSvg ??
                                        (() => {
                                          try {
                                            const b64 =
                                              displayImage.split(",")[1];
                                            return b64 ? atob(b64) : "";
                                          } catch {
                                            return "";
                                          }
                                        })(),
                                    }}
                                  />
                                ) : (
                                  <img
                                    src={displayImage}
                                    alt={current?.imageAlt || ""}
                                    className="w-full h-full object-cover"
                                  />
                                )
                              ) : (
                                <div
                                  className="w-full h-full flex items-center justify-center animate-pulse"
                                  style={{ background: "#f1f5f9" }}
                                >
                                  <span
                                    className="text-[10px] md:text-xs font-black"
                                    style={{ color: "#94a3b8" }}
                                  >
                                    {diagramLoadingSlides.has(idx)
                                      ? "Generating diagram…"
                                      : stabilitySlides.has(idx)
                                      ? "Generating AI image…"
                                      : "Loading image…"}
                                  </span>
                                </div>
                              )}
                              {displayImage && (
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                                  <span
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black px-2 py-0.5 rounded-lg"
                                    style={{ color: "#ffffff", background: "#166534" }}
                                  >
                                    Paste to replace (Ctrl+V)
                                  </span>
                                </div>
                              )}
                              {imageCredit && (
                                <div
                                  className="absolute bottom-0 right-0 px-2 py-0.5 text-[9px] font-bold rounded-tl"
                                  style={{
                                    color: "#166534",
                                    background: "rgba(255,255,255,0.85)",
                                  }}
                                >
                                  {imageCredit}
                                </div>
                              )}
                            </div>
                          )}
                        {/* Two-column comparison */}
                        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
                          {/* Side A */}
                          <div
                            className="flex-1 flex flex-col overflow-hidden"
                            style={{
                              borderRight: isMobile ? "none" : "4px solid rgb(48,47,45)",
                              borderBottom: isMobile ? "4px solid rgb(48,47,45)" : "none",
                            }}
                          >
                            <div
                              className="shrink-0 flex items-center px-4 py-1 text-[10px] md:text-xs font-black uppercase tracking-wider"
                              style={{
                                background: "#166534",
                                color: "#fff",
                                borderBottom: "2px solid #14532d",
                              }}
                            >
                              <span className="mr-1">◀</span>
                              <input
                                key={`sideA-label-${idx}`}
                                defaultValue={current?.sideALabel ?? "Side A"}
                                onBlur={(e) =>
                                  patchSlide(idx, { sideALabel: e.target.value.trim() || "Side A" })
                                }
                                className="bg-transparent border-0 outline-none flex-1 min-w-0 font-black uppercase tracking-wider text-[10px] md:text-xs"
                                style={{ color: "#fff" }}
                              />
                            </div>
                            {/* Side A image (only when imageB exists — two-image layout) */}
                            {current?.imageB && displayImage && (
                              <div
                                className="shrink-0 relative overflow-hidden group"
                                style={{
                                  height: isMobile ? "160px" : "38%",
                                  borderBottom: "2px solid #e2e8f0",
                                }}
                                tabIndex={0}
                                onPaste={(e) => handleImagePaste(e, idx)}
                              >
                                <img
                                  src={displayImage}
                                  alt={current?.imageAlt || ""}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                                  <span
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black px-2 py-0.5 rounded-lg"
                                    style={{ color: "#ffffff", background: "#166534" }}
                                  >
                                    Paste to replace (Ctrl+V)
                                  </span>
                                </div>
                                {imageCredit && (
                                  <div
                                    className="absolute bottom-0 right-0 px-2 py-0.5 text-[9px] font-bold rounded-tl"
                                    style={{
                                      color: "#166534",
                                      background: "rgba(255,255,255,0.85)",
                                    }}
                                  >
                                    {imageCredit}
                                  </div>
                                )}
                              </div>
                            )}
                            <div
                              className="flex-1 px-3 py-2 overflow-y-auto"
                              style={{ background: "#f0fdf4" }}
                            >
                              {editingKey === `${idx}-sideA` ? (
                                <textarea
                                  autoFocus
                                  key={`comp-left-${idx}`}
                                  defaultValue={compLeftContent}
                                  onBlur={(e) => {
                                    patchSlide(idx, { sideAContent: e.target.value });
                                    setEditingKey(null);
                                  }}
                                  onKeyDown={(e) => { if (e.key === "Escape") setEditingKey(null); }}
                                  className="text-xs md:text-sm leading-relaxed bg-transparent border-0 outline-none w-full resize-none"
                                  style={{
                                    color: contentTextColor,
                                    fieldSizing: "content" as never,
                                  }}
                                />
                              ) : (
                                <div
                                  className="text-xs md:text-sm leading-relaxed w-full cursor-text select-text"
                                  style={{ color: contentTextColor, minHeight: "3rem" }}
                                  onClick={() => setEditingKey(`${idx}-sideA`)}
                                >
                                  {renderInline(compLeftContent)}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Side B */}
                          <div className="flex-1 flex flex-col overflow-hidden">
                            <div
                              className="shrink-0 flex items-center px-4 py-1 text-[10px] md:text-xs font-black uppercase tracking-wider"
                              style={{
                                background: "#14532d",
                                color: "#fff",
                                borderBottom: "2px solid #14532d",
                              }}
                            >
                              <input
                                key={`sideB-label-${idx}`}
                                defaultValue={current?.sideBLabel ?? "Side B"}
                                onBlur={(e) =>
                                  patchSlide(idx, { sideBLabel: e.target.value.trim() || "Side B" })
                                }
                                className="bg-transparent border-0 outline-none flex-1 min-w-0 font-black uppercase tracking-wider text-[10px] md:text-xs"
                                style={{ color: "#fff" }}
                              />
                              <span className="ml-1">▶</span>
                            </div>
                            {/* Side B image (only when imageB exists — two-image layout) */}
                            {current?.imageB && (
                              <div
                                className="shrink-0 relative overflow-hidden group"
                                style={{
                                  height: isMobile ? "160px" : "38%",
                                  borderBottom: "2px solid #e2e8f0",
                                }}
                                tabIndex={0}
                                onPaste={(e) => {
                                  for (const item of Array.from(e.clipboardData?.items ?? [])) {
                                    if (item.type.startsWith("image/")) {
                                      const file = item.getAsFile();
                                      if (!file) continue;
                                      const reader = new FileReader();
                                      reader.onload = (ev) => {
                                        patchSlide(idx, {
                                          imageB: ev.target?.result as string,
                                          imageBCredit: "Pasted image",
                                        });
                                      };
                                      reader.readAsDataURL(file);
                                      e.preventDefault();
                                      return;
                                    }
                                  }
                                }}
                              >
                                <img
                                  src={current.imageB}
                                  alt={current?.imageAlt || ""}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                                  <span
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black px-2 py-0.5 rounded-lg"
                                    style={{ color: "#ffffff", background: "#166534" }}
                                  >
                                    Paste to replace (Ctrl+V)
                                  </span>
                                </div>
                                {current?.imageBCredit && (
                                  <div
                                    className="absolute bottom-0 right-0 px-2 py-0.5 text-[9px] font-bold rounded-tl"
                                    style={{
                                      color: "#166534",
                                      background: "rgba(255,255,255,0.85)",
                                    }}
                                  >
                                    {current.imageBCredit}
                                  </div>
                                )}
                              </div>
                            )}
                            <div
                              className="flex-1 px-3 py-2 overflow-y-auto"
                              style={{ background: "#ffffff" }}
                            >
                              {editingKey === `${idx}-sideB` ? (
                                <textarea
                                  autoFocus
                                  key={`comp-right-${idx}`}
                                  defaultValue={compRightContent}
                                  onBlur={(e) => {
                                    patchSlide(idx, { sideBContent: e.target.value });
                                    setEditingKey(null);
                                  }}
                                  onKeyDown={(e) => { if (e.key === "Escape") setEditingKey(null); }}
                                  className="text-xs md:text-sm leading-relaxed bg-transparent border-0 outline-none w-full resize-none"
                                  style={{
                                    color: contentTextColor,
                                    fieldSizing: "content" as never,
                                  }}
                                />
                              ) : (
                                <div
                                  className="text-xs md:text-sm leading-relaxed w-full cursor-text select-text"
                                  style={{ color: contentTextColor, minHeight: "3rem" }}
                                  onClick={() => setEditingKey(`${idx}-sideB`)}
                                >
                                  {renderInline(compRightContent)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : slideType === "fact" ? (
                      /* ── FACT: image at top, text content below ─────────────── */
                      <div
                        className="flex-1 flex flex-col min-h-0"
                        style={{ background: contentBg }}
                      >
                        {/* Image top */}
                        <div
                          className="shrink-0 relative overflow-hidden group"
                          style={{
                            height: "45%",
                            borderBottom: "3px solid #e2e8f0",
                            background: "#f8fafc",
                          }}
                          tabIndex={0}
                          onPaste={(e) => handleImagePaste(e, idx)}
                        >
                          {displayImage ? (
                            !pastedEntry &&
                            current?.imageSource === "diagram" ? (
                              <div
                                className="w-full h-full flex items-center justify-center [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-full overflow-hidden"
                                dangerouslySetInnerHTML={{
                                  __html:
                                    styledDiagramSvg ??
                                    (() => {
                                      try {
                                        const b64 = displayImage.split(",")[1];
                                        return b64 ? atob(b64) : "";
                                      } catch {
                                        return "";
                                      }
                                    })(),
                                }}
                              />
                            ) : (
                              <img
                                src={displayImage}
                                alt={current?.imageAlt || ""}
                                className="w-full h-full object-cover"
                              />
                            )
                          ) : imagesLoading ||
                            stabilitySlides.has(idx) ||
                            diagramLoadingSlides.has(idx) ? (
                            <div
                              className="w-full h-full flex items-center justify-center animate-pulse"
                              style={{ background: "#f1f5f9" }}
                            >
                              <span
                                className="text-[10px] md:text-xs font-black"
                                style={{ color: "#94a3b8" }}
                              >
                                {diagramLoadingSlides.has(idx)
                                  ? "Generating diagram…"
                                  : stabilitySlides.has(idx)
                                  ? "Generating AI image…"
                                  : "Loading image…"}
                              </span>
                            </div>
                          ) : (
                            <div
                              className="w-full h-full flex flex-col items-center justify-center gap-1 cursor-pointer"
                              style={{
                                background: "#f9fafb",
                                border: "2px dashed #d1d5db",
                              }}
                              tabIndex={0}
                              onPaste={(e) => handleImagePaste(e, idx)}
                            >
                              <span className="text-2xl select-none">💡</span>
                              <span
                                className="text-[10px] font-black"
                                style={{ color: "#9ca3af" }}
                              >
                                Paste image here
                              </span>
                            </div>
                          )}
                          {displayImage && (
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                              <span
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black px-2 py-0.5 rounded-lg"
                                style={{ color: "#ffffff", background: "#166534" }}
                              >
                                Paste to replace (Ctrl+V)
                              </span>
                            </div>
                          )}
                          {imageCredit && (
                            <div
                              className="absolute bottom-0 right-0 px-2 py-0.5 text-[9px] font-bold rounded-tl"
                              style={{
                                color: "#166534",
                                background: "rgba(255,255,255,0.85)",
                              }}
                            >
                              {imageCredit}
                            </div>
                          )}
                        </div>
                        {/* Text below */}
                        <div className="flex-1 px-5 md:px-7 py-3 overflow-y-auto flex flex-col justify-center">
                          {current?.content != null ? (
                            editingContent === idx ? (
                              <textarea
                                autoFocus
                                key={`content-edit-${idx}`}
                                defaultValue={current.content}
                                onBlur={(e) => {
                                  const t = e.target.value.trim();
                                  if (t) patchSlide(idx, { content: t });
                                  setEditingContent(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") setEditingContent(null);
                                }}
                                className="text-sm md:text-base leading-relaxed bg-transparent border-0 outline-none w-full resize-none text-center"
                                style={{
                                  color: contentTextColor,
                                  fieldSizing: "content" as never,
                                  minHeight: "5rem",
                                }}
                              />
                            ) : (
                              <div
                                className="text-sm md:text-base leading-relaxed w-full text-center cursor-text select-text"
                                style={{ color: contentTextColor, minHeight: "5rem" }}
                                onClick={() => setEditingContent(idx)}
                              >
                                {renderInline(current.content)}
                              </div>
                            )
                          ) : (
                            <div className="flex flex-col">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                {(current?.bullets || []).map((b, i) => {
                                  const editKey = `col-${idx}-${i}`;
                                  const isEditing = editingBullet === editKey;
                                  const numberedMatch = b.match(/^(\d+)[.)]\s+([\s\S]*)$/);
                                  const marker = numberedMatch ? `${numberedMatch[1]}.` : "•";
                                  const displayText = numberedMatch ? numberedMatch[2] : b;
                                  return (
                                    <div
                                      key={editKey}
                                      className="flex items-start gap-1.5"
                                    >
                                      <span
                                        className="mt-0.5 shrink-0 font-black text-sm leading-snug"
                                        style={{ color: bulletAccentColor }}
                                      >
                                        {marker}
                                      </span>
                                      {isEditing ? (
                                        <textarea
                                          autoFocus
                                          defaultValue={b}
                                          onBlur={(e) => {
                                            const nb = [...(current?.bullets || [])];
                                            const t = e.target.value.trim();
                                            if (t) { nb[i] = t; } else { nb.splice(i, 1); }
                                            patchSlide(idx, { bullets: nb });
                                            setEditingBullet(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                            if (e.key === "Escape") setEditingBullet(null);
                                          }}
                                          rows={1}
                                          className="text-xs md:text-sm leading-snug bg-transparent border-0 outline-none flex-1 min-w-0 resize-none overflow-hidden"
                                          style={{ color: contentTextColor, fieldSizing: "content" as never }}
                                        />
                                      ) : (
                                        <div
                                          className="text-xs md:text-sm leading-snug flex-1 cursor-text select-text"
                                          style={{ color: contentTextColor }}
                                          onClick={() => setEditingBullet(editKey)}
                                        >
                                          {renderInline(displayText)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                onClick={() =>
                                  patchSlide(idx, {
                                    bullets: [
                                      ...(current?.bullets || []),
                                      "New point",
                                    ],
                                  })
                                }
                                className="mt-2 self-start text-[10px] md:text-xs font-black px-2 py-0.5 rounded transition-all"
                                style={{
                                  color: bulletAccentColor,
                                  border: `2px solid ${bulletAccentColor}`,
                                }}
                              >
                                + Add bullet
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* ── STANDARD layout: text left, image sidebar right ─────── */
                      <div className="flex flex-1 min-h-0">
                        {/* Text content */}
                        <div
                          className="relative flex-1 px-3 md:px-7 py-3 md:py-4 flex flex-col overflow-hidden items-center"
                          style={{ background: contentBg }}
                        >
                          {/* Paste image button — small floating btn at right edge when no image */}
                          {!isNoImageSlide && !displayImage && !imagesLoading && !stabilitySlides.has(idx) && !diagramLoadingSlides.has(idx) && (
                            <div
                              className="absolute right-2 top-1/2 -translate-y-1/2 z-10"
                              tabIndex={0}
                              onPaste={(e) => handleImagePaste(e, idx)}
                              title="Click here and paste an image (Ctrl+V)"
                            >
                              <div
                                className="flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer text-[9px] font-black select-none"
                                style={{
                                  background: "#f1f5f9",
                                  border: "1.5px dashed #cbd5e1",
                                  color: "#94a3b8",
                                }}
                              >
                                <span>📎</span>
                                <span>Paste image</span>
                              </div>
                            </div>
                          )}
                          {current?.content != null ? (
                            /* Upper grades: editable paragraph */
                            <div className="flex flex-col justify-center flex-1 w-full overflow-hidden">
                              {editingContent === idx ? (
                                <textarea
                                  autoFocus
                                  key={`content-edit-${idx}`}
                                  defaultValue={current.content}
                                  onBlur={(e) => {
                                    patchSlide(idx, { content: e.target.value });
                                    setEditingContent(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") setEditingContent(null);
                                  }}
                                  placeholder="Type here…"
                                  className="text-sm md:text-base leading-relaxed bg-transparent border-0 outline-none w-full resize-none text-center"
                                  style={{
                                    color: contentTextColor,
                                    fieldSizing: "content" as never,
                                    minHeight: "5rem",
                                  }}
                                />
                              ) : (
                                <div
                                  className="text-sm md:text-base leading-relaxed w-full text-center cursor-text select-text"
                                  style={{ color: contentTextColor, minHeight: "5rem" }}
                                  onClick={() => setEditingContent(idx)}
                                >
                                  {renderInline(current.content)}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Primary grades: bullet list */
                            <div
                              className={`flex flex-col justify-center flex-1 overflow-y-auto ${
                                isNoImageSlide ? "max-w-lg mx-auto w-full" : ""
                              }`}
                            >
                              {isNoImageSlide &&
                                (current?.bullets || []).length === 0 && (
                                  <textarea
                                    key={`noimgplaceholder-${idx}`}
                                    placeholder="Write your response here…"
                                    className="text-sm md:text-base leading-relaxed bg-transparent border-0 outline-none w-full resize-none text-center"
                                    style={{
                                      color: contentTextColor,
                                      minHeight: "5rem",
                                    }}
                                    onBlur={(e) => {
                                      const t = e.target.value.trim();
                                      if (t) patchSlide(idx, { bullets: [t] });
                                    }}
                                  />
                                )}
                              <ul className="space-y-1.5 md:space-y-3">
                                {(current?.bullets || []).map((b, i) => {
                                  const editKey = `${idx}-${i}`;
                                  const isEditing = editingBullet === editKey;
                                  const numberedMatch = b.match(/^(\d+)[.)]\s+([\s\S]*)$/);
                                  const marker = numberedMatch
                                    ? `${numberedMatch[1]}.`
                                    : "•";
                                  const displayText = numberedMatch ? numberedMatch[2] : b;
                                  return (
                                    <li
                                      key={editKey}
                                      className="flex items-start gap-2 md:gap-3"
                                    >
                                      <span
                                        className="mt-0.5 shrink-0 font-black text-base md:text-lg leading-snug"
                                        style={{ color: bulletAccentColor }}
                                      >
                                        {marker}
                                      </span>
                                      {isEditing ? (
                                        <textarea
                                          autoFocus
                                          defaultValue={b}
                                          onBlur={(e) => {
                                            const newBullets = [
                                              ...(current?.bullets || []),
                                            ];
                                            const trimmed = e.target.value.trim();
                                            if (trimmed) {
                                              newBullets[i] = trimmed;
                                            } else {
                                              newBullets.splice(i, 1);
                                            }
                                            patchSlide(idx, { bullets: newBullets });
                                            setEditingBullet(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              e.currentTarget.blur();
                                            if (e.key === "Escape")
                                              setEditingBullet(null);
                                          }}
                                          rows={1}
                                          className="text-xs md:text-base leading-snug bg-transparent border-0 outline-none flex-1 min-w-0 resize-none overflow-hidden"
                                          style={{
                                            color: contentTextColor,
                                            fieldSizing: "content" as never,
                                            fontWeight: 400,
                                          }}
                                        />
                                      ) : (
                                        <div
                                          className="text-xs md:text-base leading-snug flex-1 cursor-text select-text"
                                          style={{ color: contentTextColor }}
                                          onClick={() => setEditingBullet(editKey)}
                                        >
                                          {renderInline(displayText)}
                                        </div>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                              <button
                                onClick={() =>
                                  patchSlide(idx, {
                                    bullets: [
                                      ...(current?.bullets || []),
                                      "New point",
                                    ],
                                  })
                                }
                                className="mt-2 self-start text-[10px] md:text-xs font-black px-2 py-0.5 rounded transition-all"
                                style={{
                                  color: bulletAccentColor,
                                  border: `2px solid ${bulletAccentColor}`,
                                }}
                              >
                                + Add bullet
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Image column — hidden for reflection/question/quiz/recap slides */}
                        {!isNoImageSlide && (
                          displayImage || imagesLoading || stabilitySlides.has(idx) || diagramLoadingSlides.has(idx) ? (
                          <div
                            className={`${
                              !pastedEntry && current?.imageSource === "diagram"
                                ? "w-[62%]"
                                : "w-[42%]"
                            } p-2 md:p-3 flex flex-col`}
                            style={{
                              background: "#f8fafc",
                              borderLeft: "3px solid #e2e8f0",
                            }}
                          >
                            <div className="flex-1 flex items-center justify-center min-h-0">
                              {displayImage ? (
                                <div
                                  className="relative w-full h-full group cursor-pointer focus:outline-none"
                                  tabIndex={0}
                                  onPaste={(e) => handleImagePaste(e, idx)}
                                  title="Click here and paste to replace image (Ctrl+V)"
                                >
                                  {!pastedEntry &&
                                  current?.imageSource === "diagram" ? (
                                    <div
                                      className="w-full h-full flex items-center justify-center overflow-hidden rounded-lg [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:max-h-full"
                                      style={{ border: "2px solid #e2e8f0" }}
                                      dangerouslySetInnerHTML={{
                                        __html:
                                          styledDiagramSvg ??
                                          (() => {
                                            try {
                                              const b64 =
                                                displayImage.split(",")[1];
                                              return b64 ? atob(b64) : "";
                                            } catch {
                                              return "";
                                            }
                                          })(),
                                      }}
                                    />
                                  ) : (
                                    <img
                                      src={displayImage}
                                      alt={current?.imageAlt || ""}
                                      className="w-full h-full object-contain rounded-lg"
                                      style={{ border: "2px solid #e2e8f0" }}
                                    />
                                  )}
                                  <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                                    <span
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-black px-2 py-1 rounded-lg"
                                      style={{
                                        color: "#ffffff",
                                        background: "#166534",
                                        border: "2px solid #e2e8f0",
                                      }}
                                    >
                                      Paste to replace (Ctrl+V)
                                    </span>
                                  </div>
                                  {/* Remove image button */}
                                  <button
                                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full text-[10px] font-black leading-none"
                                    style={{
                                      width: 18,
                                      height: 18,
                                      background: "#dc2626",
                                      color: "#fff",
                                      border: "2px solid #fff",
                                      zIndex: 20,
                                    }}
                                    title="Remove image"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (pastedEntry) {
                                        setPastedImages((prev) => {
                                          const next = { ...prev };
                                          delete next[idx];
                                          return next;
                                        });
                                      } else {
                                        patchSlide(idx, { image: null, imageSource: null, imageCredit: null, imageCreditUrl: null });
                                      }
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <div
                                  className="w-full h-full min-h-[80px] rounded-lg animate-pulse flex items-center justify-center"
                                  style={{
                                    background: "#f1f5f9",
                                    border: "2px dashed #cbd5e1",
                                  }}
                                >
                                  <span
                                    className="text-[10px] md:text-xs font-black"
                                    style={{ color: "#94a3b8" }}
                                  >
                                    {diagramLoadingSlides.has(idx)
                                      ? "Generating diagram…"
                                      : stabilitySlides.has(idx)
                                      ? "Generating AI image…"
                                      : "Loading image…"}
                                  </span>
                                </div>
                              )}
                            </div>

                            {pastedEntry ? (
                              <input
                                type="text"
                                value={pastedEntry.credit}
                                onChange={(e) =>
                                  setPastedImages((prev) => ({
                                    ...prev,
                                    [idx]: {
                                      ...prev[idx],
                                      credit: e.target.value,
                                    },
                                  }))
                                }
                                className="mt-1 shrink-0 text-[9px] text-right w-full rounded px-1.5 py-0.5 focus:outline-none font-bold"
                                style={{
                                  background: "#ffffff",
                                  border: "2px solid #e2e8f0",
                                  color: "#166534",
                                }}
                              />
                            ) : imageCredit ? (
                              imageCreditUrl ? (
                                <a
                                  href={imageCreditUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 shrink-0 text-[9px] text-right leading-tight px-1 truncate font-bold block"
                                  style={{ color: "#166534" }}
                                >
                                  {imageCredit}
                                </a>
                              ) : (
                                <div
                                  className="mt-1 shrink-0 text-[9px] text-right leading-tight px-1 truncate font-bold"
                                  style={{ color: "#166534" }}
                                >
                                  {imageCredit}
                                </div>
                              )
                            ) : null}
                          </div>
                          ) : null
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div
                      className="shrink-0 flex items-center justify-between px-5 py-1.5"
                      style={{
                        borderTop: `3px solid ${headerBorderBg}`,
                        background: headerBg,
                      }}
                    >
                      <span
                        className="text-[10px] font-bold italic"
                        style={{ color: "#bbf7d0", opacity: 0.75 }}
                      >
                        AI can make mistakes.
                      </span>

                      <span
                        className="hidden md:inline text-[10px] font-bold"
                        style={{ color: "#bbf7d0" }}
                      >
                        Use ← → to move
                      </span>
                    </div>
                  </div>
                </div>

                {/* Next — desktop only */}
                <button
                  onClick={next}
                  disabled={!canNext}
                  className="hidden md:flex comic-nav-btn shrink-0 rounded-xl px-4 py-4 font-black text-xl transition-all disabled:opacity-20"
                  style={{
                    background: "#166534",
                    color: "#ffffff",
                    border: "3px solid #14532d",
                    boxShadow: "4px 4px 0 rgb(48, 47, 45)",
                  }}
                >
                  →
                </button>
              </div>

              {/* Mobile nav bar — shown only on small screens */}
              <div className="flex md:hidden items-center justify-between mt-3 gap-2">
                <button
                  onClick={prev}
                  disabled={!canPrev}
                  className="flex-1 rounded-xl py-3 font-black text-lg transition-all disabled:opacity-20"
                  style={{
                    background: "#166534",
                    color: "#ffffff",
                    border: "3px solid #14532d",
                    boxShadow: "3px 3px 0 rgb(48, 47, 45)",
                  }}
                >
                  ←
                </button>
                <span
                  className="shrink-0 px-4 py-2 rounded-xl font-black text-sm"
                  style={{
                    background: "rgb(48,47,45)",
                    color: "#ffffff",
                    border: "3px solid rgb(48,47,45)",
                  }}
                >
                  {idx + 1} / {total}
                </span>
                <button
                  onClick={next}
                  disabled={!canNext}
                  className="flex-1 rounded-xl py-3 font-black text-lg transition-all disabled:opacity-20"
                  style={{
                    background: "#166534",
                    color: "#ffffff",
                    border: "3px solid #14532d",
                    boxShadow: "3px 3px 0 rgb(48, 47, 45)",
                  }}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <a
        href="https://t.me/umidtech"
        target="_blank"
        rel="noopener noreferrer"
        title="Contact"
        className="fixed bottom-4 right-4 flex items-center justify-center rounded-full transition-transform hover:scale-110"
        style={{
          width: 44,
          height: 44,
          background: "#166534",
          border: "3px solid #14532d",
          boxShadow: "3px 3px 0 rgb(48, 47, 45)",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
      </a>

      {/* Login required modal */}
      {showLoginPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => setShowLoginPrompt(false)}
        >
          <div
            className="rounded-2xl p-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4"
            style={{
              background: "#fff",
              border: "3px solid #166534",
              boxShadow: "6px 6px 0 rgb(48,47,45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl">🔒</div>
            <h2
              className="text-xl font-black text-center"
              style={{ color: "#166534" }}
            >
              Sign in to Generate
            </h2>
            <p
              className="text-sm font-bold text-center"
              style={{ color: "#6b7280" }}
            >
              Sign in with Google to create your lesson slide deck.
            </p>
            <button
              onClick={() => {
                const a = getFirebaseAuth();
                if (a)
                  signInWithPopup(a, googleProvider).then(() =>
                    setShowLoginPrompt(false)
                  );
              }}
              className="w-full rounded-xl px-6 py-3 text-base font-black transition-all"
              style={{
                background: "#166534",
                color: "#fff",
                border: "3px solid #14532d",
                boxShadow: "4px 4px 0 rgb(48,47,45)",
                cursor: "pointer",
              }}
            >
              Sign in with Google
            </button>
            <button
              onClick={() => setShowLoginPrompt(false)}
              className="text-sm font-bold"
              style={{ color: "#9ca3af" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Dev debug panel (localhost only) ─────────────────────────────── */}
      {debugInfo && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "#0f172a",
            color: "#e2e8f0",
            fontFamily: "monospace",
            fontSize: "12px",
            maxHeight: debugOpen ? "50vh" : "36px",
            transition: "max-height 0.2s ease",
            overflow: "hidden",
            borderTop: "2px solid #334155",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 12px",
              background: "#1e293b",
              borderBottom: debugOpen ? "1px solid #334155" : "none",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onClick={() => setDebugOpen((o) => !o)}
          >
            <span style={{ color: "#22d3ee", fontWeight: "bold" }}>DEV</span>
            <span style={{ color: "#94a3b8" }}>
              {debugInfo.topicStructure.topicType} · {debugInfo.topicStructure.structureItems.length} structure items · {debugInfo.ragLessons.length} RAG lessons
            </span>
            <span style={{ marginLeft: "auto", color: "#64748b" }}>{debugOpen ? "▼ collapse" : "▲ expand"}</span>
          </div>

          {/* Tabs */}
          {debugOpen && (
            <div style={{ display: "flex", gap: 0, background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0 }}>
              {(["rag", "prompt", "deck"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDebugTab(tab)}
                  style={{
                    padding: "5px 16px",
                    background: debugTab === tab ? "#0f172a" : "transparent",
                    color: debugTab === tab ? "#22d3ee" : "#94a3b8",
                    border: "none",
                    borderBottom: debugTab === tab ? "2px solid #22d3ee" : "2px solid transparent",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    fontWeight: debugTab === tab ? "bold" : "normal",
                  }}
                >
                  {tab === "rag" ? `RAG (${debugInfo.ragLessons.length})` : tab === "prompt" ? "Prompt" : "Deck JSON"}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          {debugOpen && (
            <div style={{ overflow: "auto", padding: "12px", flex: 1 }}>
              {debugTab === "rag" && (
                <div>
                  <div style={{ color: "#94a3b8", marginBottom: "8px" }}>
                    Topic type: <span style={{ color: "#fbbf24" }}>{debugInfo.topicStructure.topicType}</span>
                    {debugInfo.topicStructure.structureItems.length > 0 && (
                      <span> · Items: <span style={{ color: "#a3e635" }}>{debugInfo.topicStructure.structureItems.join(", ")}</span></span>
                    )}
                  </div>
                  {debugInfo.ragLessons.length === 0 ? (
                    <div style={{ color: "#64748b" }}>No RAG lessons retrieved (Neo4j not configured or topic not in curriculum).</div>
                  ) : (
                    debugInfo.ragLessons.map((l, i) => (
                      <div key={i} style={{ marginBottom: "10px", borderLeft: "2px solid #334155", paddingLeft: "10px" }}>
                        <div style={{ color: "#22d3ee" }}>Dars {l.lessonNumber}: {l.title}</div>
                        <div style={{ color: "#64748b" }}>{l.chapter} · score: {l.score.toFixed(4)}</div>
                        <div style={{ color: "#cbd5e1", marginTop: "4px", whiteSpace: "pre-wrap" }}>{l.content}</div>
                      </div>
                    ))
                  )}
                  {debugInfo.ragContext && (
                    <div style={{ marginTop: "12px", borderTop: "1px solid #334155", paddingTop: "8px" }}>
                      <div style={{ color: "#94a3b8", marginBottom: "4px" }}>Compressed context injected into prompt:</div>
                      <pre style={{ whiteSpace: "pre-wrap", color: "#a3e635" }}>{debugInfo.ragContext}</pre>
                    </div>
                  )}
                </div>
              )}
              {debugTab === "prompt" && (
                <pre style={{ whiteSpace: "pre-wrap", color: "#e2e8f0" }}>{debugInfo.prompt}</pre>
              )}
              {debugTab === "deck" && (
                <pre style={{ whiteSpace: "pre-wrap", color: "#e2e8f0" }}>{debugInfo.rawCompletion}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
