"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function styleSvgForSlide(svgString: string, slide: { title: string; bullets?: string[]; content?: string | null }): string {
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
        el.getAttribute("y") ?? el.querySelector("tspan")?.getAttribute("y") ?? "999"
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
      } else if (slideTitle.includes(labelText) || labelText.includes(slideTitle)) {
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
  imageSource?: "pexels" | "unsplash" | "pixabay" | "stability" | "diagram" | null;
  imageCredit?: string | null;
  /** Clickable URL for attribution (Unsplash requires a link; null for other sources) */
  imageCreditUrl?: string | null;
  youtubeVideoId?: string | null;
  visualType?: "photo" | "diagram" | null;
};

type Deck = {
  deckTitle?: string;
  slides?: Slide[];
};

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);

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
  const [stabilityIdx, setStabilityIdx] = useState<number | null>(null);
  const [diagramLoadingSlides, setDiagramLoadingSlides] = useState<Set<number>>(new Set());
  const [sharedDiagramSvg, setSharedDiagramSvg] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");

  const [gradeLevel, setGradeLevel] = useState<number>(5);
  const [curriculum, setCurriculum] = useState<string>("Cambridge");
  const [materialType, setMaterialType] = useState<"slides" | "activity" | "both">("slides");

  // activity sheet state
  const [activityLoading, setActivityLoading] = useState(false);

  // download state
  const [downloading, setDownloading] = useState(false);

  // per-slide pasted images (index → { dataUrl, credit })
  const [pastedImages, setPastedImages] = useState<
    Record<number, { dataUrl: string; credit: string }>
  >({});

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

  function applyFillRules(slides: Slide[]): Slide[] {
    const result = [...slides];
    const n = result.length;
    if (n < 2) return result;

    const lastTwoStart = Math.max(0, n - 2);
    const first = result[0];

    // Rule 1: last 2 slides borrow first slide's image if imageless (skip video slides)
    if (first?.image) {
      for (let i = lastTwoStart; i < n; i++) {
        if (!result[i].image && !result[i].youtubeVideoId) {
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
          ({ i, s }) => !excluded.has(i) && !s.image && !s.youtubeVideoId
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

  async function generateActivity(topicStr: string) {
    setActivityLoading(true);
    try {
      const actRes = await fetch("/api/generate/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topicStr, grade: gradeLevel, curriculum, deckTitle: deck?.deckTitle ?? topicStr }),
      });
      if (!actRes.ok) throw new Error("Activity generation failed");
      const actData = await actRes.json();

      const docxRes = await fetch("/api/export/activity-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...actData, topic: topicStr, grade: gradeLevel, deckTitle: deck?.deckTitle ?? topicStr }),
      });
      if (!docxRes.ok) throw new Error("Activity export failed");

      const blob = await docxRes.blob();
      const url = window.URL.createObjectURL(blob);
      const title = (actData.sheetTitle || topicStr).replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_");
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

    try {
      // ── Step 1: OpenAI text (~2–3 s) — show slides immediately ────────────
      const textRes = await fetch("/api/generate/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          slideCount: 8,
          grade: gradeLevel,
          primaryMode: gradeLevel <= 4,
          curriculum,
        }),
      });

      if (!textRes.ok) throw new Error("Text generation failed");
      const { deckTitle, slides: rawSlides, isPrimary } = await textRes.json();

      const initSlides: Slide[] = rawSlides.map((s: any) => ({
        title: s.title ?? "",
        bullets: s.bullets ?? [],
        content: s.content ?? null,
        image: null,
        imageAlt: "",
        imageSource: null,
        imageCredit: null,
        imageCreditUrl: null,
        youtubeVideoId: null,
        visualType: s.visualType ?? null,
      }));

      setDeck({ deckTitle, slides: initSlides });
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
      }> = rawSlides
        .map((s: any, i: number) => ({ ...s, origIndex: i }))
        .filter(
          (s: any) => typeof s.imageQuery === "string" && s.imageQuery.trim()
        );

      // Rule 1: Slide 0 always gets a pexels/unsplash photo with general meaning.
      // If the AI gave slide 0 a diagram visualType or no imageQuery, inject it as a photo slide.
      const slide0InVisual = visualSlides.some((s) => s.origIndex === 0);
      if (!slide0InVisual && rawSlides[0]) {
        const s0 = rawSlides[0];
        visualSlides = [
          {
            origIndex: 0,
            title: s0.title ?? "",
            bullets: s0.bullets ?? [],
            content: s0.content ?? null,
            imageQuery: deckTitle,
            visualType: "photo",
          },
          ...visualSlides,
        ];
      }

      // Rule 3: Diagram slides at most 2 — exclude slide 0 (always photo)
      const intentDiagramSlides = visualSlides.filter(
        (s) => s.visualType === "diagram" && s.origIndex !== 0
      );
      // Rule 2: Photo slides — slide 0 always here; other slides follow their visualType
      const photoSlides = visualSlides.filter(
        (s) => s.origIndex === 0 || s.visualType !== "diagram"
      );

      // ── Step 3: Diagram slides — fire ONE shared call in background ─────
      // Track state for sharing between step 3 and step 7
      let diagramFetchFired = false;
      let diagramFetchDone = false;
      let diagramFetchResult: any = null;
      const pendingDiagramIndices = new Set<number>();

      function fireDiagramFetch() {
        diagramFetchFired = true;
        fetch("/api/generate/diagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deckTitle,
            slides: rawSlides.map((s: any) => ({
              title: s.title,
              bullets: s.bullets ?? [],
              content: s.content ?? null,
            })),
          }),
        })
          .then((res) => (res.ok ? res.json() : { image: null }))
          .then((data) => {
            diagramFetchDone = true;
            diagramFetchResult = data;
            if (data.image) {
              try {
                const b64 = (data.image as string).split(",")[1] ?? "";
                setSharedDiagramSvg(atob(b64));
              } catch {}
              setDeck((prev) => {
                if (!prev?.slides) return prev;
                const slides = [...prev.slides];
                pendingDiagramIndices.forEach((i) => {
                  slides[i] = {
                    ...slides[i],
                    image: data.image,
                    imageSource: "diagram",
                    imageAlt: data.imageAlt ?? "Diagram",
                    imageCredit: data.imageCredit ?? "AI-generated diagram",
                  };
                });
                return { ...prev, slides };
              });
            }
          })
          .catch(() => { diagramFetchDone = true; })
          .finally(() =>
            setDiagramLoadingSlides(new Set())
          );
      }

      const cappedDiagramSlides = intentDiagramSlides.slice(0, 2);
      if (cappedDiagramSlides.length > 0) {
        cappedDiagramSlides.forEach((s) => pendingDiagramIndices.add(s.origIndex));
        setDiagramLoadingSlides(new Set(cappedDiagramSlides.map((s) => s.origIndex)));
        fireDiagramFetch();
      }

      // ── Step 4: Pexels / Unsplash / Pixabay for photo slides ─────────────
      // Always reserve the last photo slide (non-slide-0) for Stability so it
      // always gets an AI image. If all photo slides are slide 0, don't reserve.
      const nonFirstPhotoSlides = photoSlides.filter((s) => s.origIndex !== 0);
      const stabilityReserved =
        nonFirstPhotoSlides.length > 0
          ? nonFirstPhotoSlides[nonFirstPhotoSlides.length - 1]
          : null;
      const stabilityTargetIdx: number | null =
        stabilityReserved?.origIndex ?? null;

      // Exclude the reserved Stability slide from Pexels/Unsplash/Pixabay search
      const pexelTargets = isPrimary
        ? photoSlides.slice(0, 1)
        : photoSlides.filter((s) => s.origIndex !== stabilityTargetIdx);

      const pexelResults = await Promise.all(
        pexelTargets.map(async (slide) => {
          try {
            const res = await fetch("/api/generate/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                // Rule 1: slide 0 uses deckTitle as general-meaning query
                imageQuery: slide.origIndex === 0 ? deckTitle : slide.imageQuery,
                title: slide.origIndex === 0 ? deckTitle : slide.title,
                bullets: slide.origIndex === 0
                  ? []
                  : slide.bullets?.length
                  ? slide.bullets
                  : slide.content
                  ? slide.content.split(/[.!?]+/).filter(Boolean)
                  : [],
                // Slide 0 accepts any photo (minScore: 0)
                ...(slide.origIndex === 0 ? { minScore: 0 } : {}),
              }),
            });
            const data = res.ok ? await res.json() : { image: null };
            if (data.image) patchSlide(slide.origIndex, data);
            return { index: slide.origIndex, hasImage: !!data.image };
          } catch {
            return { index: slide.origIndex, hasImage: false };
          }
        })
      );

      // ── Step 5: Note which slides got real photos ──────────────────────────
      const pexelImageIndices = new Set(
        pexelResults.filter((r) => r.hasImage).map((r) => r.index)
      );

      // Apply fill-rules after Pexels
      setDeck((prev) =>
        prev ? { ...prev, slides: applyFillRules(prev.slides ?? []) } : prev
      );
      setImagesLoading(false); // Slides are ready — background tasks run below

      // ── Step 6: Stability AI (one photo slide) ────────────────────────────
      let stabilityFinalIdx: number | null = null;
      if (stabilityTargetIdx !== null) {
        const stIdx = stabilityTargetIdx;
        stabilityFinalIdx = stIdx;
        setStabilityIdx(stIdx);
        await fetch("/api/generate/stability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: rawSlides[stIdx].title,
            bullets: rawSlides[stIdx].bullets,
          }),
        })
          .then((res) => (res.ok ? res.json() : { image: null }))
          .then((data) => {
            setStabilityIdx(null);
            if (data.image) {
              setDeck((prev) => {
                if (!prev?.slides) return prev;
                const slides = [...prev.slides];
                slides[stIdx] = { ...slides[stIdx], ...data };
                return { ...prev, slides: applyFillRules(slides) };
              });
            }
          })
          .catch((e) => {
            setStabilityIdx(null);
            console.error("Stability error:", e);
          });
      }

      // ── Step 7: Diagram fallback for photo slides that got no image (skip slide 0) ─
      const coveredByPhotos = new Set([
        ...pexelImageIndices,
        ...(stabilityFinalIdx !== null ? [stabilityFinalIdx] : []),
      ]);
      const diagramFallbackSlides = photoSlides
        .filter((s) => s.origIndex > 0 && !coveredByPhotos.has(s.origIndex))
        .slice(0, 2); // Cap at 2 diagram fallback slides

      if (diagramFallbackSlides.length > 0) {
        diagramFallbackSlides.forEach((s) => pendingDiagramIndices.add(s.origIndex));
        setDiagramLoadingSlides((prev) => {
          const next = new Set(prev);
          diagramFallbackSlides.forEach((s) => next.add(s.origIndex));
          return next;
        });

        if (!diagramFetchFired) {
          // No call made yet in step 3 — fire it now
          fireDiagramFetch();
        } else if (diagramFetchDone && diagramFetchResult?.image) {
          // Call already resolved — patch fallback slides immediately
          const data = diagramFetchResult;
          setDeck((prev) => {
            if (!prev?.slides) return prev;
            const slides = [...prev.slides];
            diagramFallbackSlides.forEach((s) => {
              slides[s.origIndex] = {
                ...slides[s.origIndex],
                image: data.image,
                imageSource: "diagram",
                imageAlt: data.imageAlt ?? "Diagram",
                imageCredit: data.imageCredit ?? "AI-generated diagram",
              };
            });
            return { ...prev, slides };
          });
          setDiagramLoadingSlides(new Set());
        }
        // else: call in-flight — pendingDiagramIndices already updated, will be patched on resolve
      }

      // ── Activity sheet (both mode) — fire in background ───────────────────
      if (materialType === "both") {
        generateActivity(topic);
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
      const exportDeck = {
        ...deck,
        slides: deck.slides!.map((s, i) => {
          const pasted = pastedImages[i];
          return {
            ...s,
            image: pasted?.dataUrl ?? s.image ?? null,
            imageCredit: pasted?.credit ?? s.imageCredit ?? null,
            imageSource: pasted ? null : s.imageSource,
          };
        }),
      };

      const res = await fetch(`/api/export/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportDeck),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Export failed:", err);
        alert(err?.details || err?.error || `Download failed (${res.status}). Please try again.`);
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

      <div className="max-w-6xl mx-auto p-5 md:p-8">
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
                    { value: "both", label: "Both" },
                  ] as const
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setMaterialType(value)}
                    className="rounded-lg px-3 py-1.5 text-sm font-black transition-all"
                    style={{
                      background: materialType === value ? "#166534" : "#ffffff",
                      color: materialType === value ? "#ffffff" : "#374151",
                      border: `3px solid ${materialType === value ? "#14532d" : "#d1d5db"}`,
                      boxShadow: materialType === value ? "3px 3px 0 rgb(48,47,45)" : "2px 2px 0 #d1d5db",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {materialType !== "slides" && (
                <p className="mt-1 text-xs font-bold" style={{ color: "#6b7280" }}>
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
                {/* Prev */}
                <button
                  onClick={prev}
                  disabled={!canPrev}
                  className="comic-nav-btn shrink-0 rounded-xl px-4 py-4 font-black text-xl transition-all disabled:opacity-20"
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
                  className="flex-1 aspect-video rounded-2xl overflow-hidden flex flex-col"
                  style={{
                    background: "#ffffff",
                    border: "3px solid rgb(48, 47, 45)",
                    boxShadow: "8px 8px 0 #fbbf24",
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
                        background: "#166534",
                        borderBottom: "3px solid #14532d",
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

                    {/* Content row */}
                    <div className="flex flex-1 min-h-0">
                      {/* Text content */}
                      <div
                        className="flex-1 px-5 md:px-7 py-4 flex flex-col overflow-hidden items-center"
                        style={{ background: "#ffffff" }}
                      >
                        {current?.content != null ? (
                          /* Upper grades: editable paragraph */
                          <div className="flex flex-col justify-center flex-1 w-full overflow-hidden">
                            <textarea
                              key={`content-${idx}`}
                              defaultValue={current.content}
                              onBlur={(e) => {
                                const trimmed = e.target.value.trim();
                                if (trimmed) patchSlide(idx, { content: trimmed });
                              }}
                              className="text-sm md:text-base leading-relaxed bg-transparent border-0 outline-none w-full resize-none text-center"
                              style={{ color: "#111827", fieldSizing: "content" as never }}
                            />
                          </div>
                        ) : (
                          /* Primary grades: bullet list */
                          <div className="flex flex-col justify-center flex-1 overflow-y-auto">
                            <ul className="space-y-1.5 md:space-y-3">
                              {(current?.bullets || []).map((b, i) => (
                                <li
                                  key={`${idx}-${i}`}
                                  className="flex items-start gap-2 md:gap-3"
                                >
                                  <span
                                    className="mt-1.5 shrink-0 font-black text-base md:text-xl leading-none"
                                    style={{ color: "#166534" }}
                                  >
                                    ▸
                                  </span>
                                  <textarea
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
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    rows={1}
                                    className="text-xs md:text-base leading-snug bg-transparent border-0 outline-none flex-1 min-w-0 font-bold resize-none overflow-hidden"
                                    style={{ color: "#111827", fieldSizing: "content" as never }}
                                  />
                                </li>
                              ))}
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
                                color: "#166534",
                                border: "2px solid #166534",
                              }}
                            >
                              + Add bullet
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Image column */}
                      <div
                        className={`${!pastedEntry && current?.imageSource === "diagram" ? "w-[62%]" : "w-[42%]"} p-2 md:p-3 flex flex-col`}
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
                              {!pastedEntry && current?.imageSource === "diagram" ? (
                                <div
                                  className="w-full h-full flex items-center justify-center overflow-hidden rounded-lg [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:max-h-full"
                                  style={{ border: "2px solid #e2e8f0" }}
                                  dangerouslySetInnerHTML={{
                                    __html: styledDiagramSvg ?? (() => {
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
                            </div>
                          ) : imagesLoading || stabilityIdx === idx || diagramLoadingSlides.has(idx) ? (
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
                                  : stabilityIdx === idx
                                  ? "Generating AI image…"
                                  : "Loading image…"}
                              </span>
                            </div>
                          ) : (
                            <div
                              className="w-full h-full min-h-[80px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer focus:outline-none"
                              style={{
                                borderColor: "#d1d5db",
                                background: "#f9fafb",
                              }}
                              tabIndex={0}
                              onPaste={(e) => handleImagePaste(e, idx)}
                              title="Click here and paste an image (Ctrl+V)"
                            >
                              <span className="text-2xl md:text-3xl select-none">
                                💡
                              </span>
                              <span
                                className="text-[10px] md:text-xs font-black"
                                style={{ color: "#9ca3af" }}
                              >
                                Paste image here
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
                                [idx]: { ...prev[idx], credit: e.target.value },
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
                    </div>

                    {/* Footer */}
                    <div
                      className="shrink-0 flex items-center justify-between px-5 py-1.5"
                      style={{
                        borderTop: "3px solid #14532d",
                        background: "#166534",
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

                {/* Next */}
                <button
                  onClick={next}
                  disabled={!canNext}
                  className="comic-nav-btn shrink-0 rounded-xl px-4 py-4 font-black text-xl transition-all disabled:opacity-20"
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
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
      </a>
    </main>
  );
}
