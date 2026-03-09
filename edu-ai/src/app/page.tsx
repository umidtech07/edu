"use client";

import { useEffect, useMemo, useState } from "react";

type Slide = {
  title: string;
  bullets: string[];
  image?: string | null;
  imageAlt?: string;
  imageSource?: "pexels" | "stability" | null;
  imageCredit?: string | null;
  youtubeVideoId?: string | null;
};

type Deck = {
  deckTitle?: string;
  slides?: Slide[];
};

export default function Home() {
  const [topic, setTopic] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [stabilityIdx, setStabilityIdx] = useState<number | null>(null);
  const [idx, setIdx] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");

  const [gradeLevel, setGradeLevel] = useState<number>(5);
  const [curriculum, setCurriculum] = useState<string>("Cambridge");

  // download state
  const [downloading, setDownloading] = useState(false);

  // per-slide pasted images (index → { dataUrl, credit })
  const [pastedImages, setPastedImages] = useState<Record<number, { dataUrl: string; credit: string }>>({});

  const slides = deck?.slides ?? [];
  const total = slides.length;
  const current = slides[idx];

  const pastedEntry = pastedImages[idx];
  const displayImage = pastedEntry?.dataUrl ?? current?.image ?? null;
  const imageCredit = pastedEntry?.credit ?? current?.imageCredit ?? null;

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

    // Rule 1: last 2 slides borrow first slide's image if imageless
    if (first?.image) {
      for (let i = lastTwoStart; i < n; i++) {
        if (!result[i].image) {
          result[i] = {
            ...result[i],
            image: first.image,
            imageAlt: first.imageAlt,
            imageSource: first.imageSource,
            imageCredit: first.imageCredit,
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
        .filter(({ i, s }) => !excluded.has(i) && !s.image);

      if (sources.length > 0 && targets.length > 0) {
        const kws = (slide: Slide) =>
          new Set(
            [slide.title, ...(slide.bullets ?? [])]
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
            if (overlap > bestScore) { bestScore = overlap; best = src; }
          }
          result[i] = {
            ...result[i],
            image: best.s.image,
            imageAlt: best.s.imageAlt ?? "",
            imageSource: best.s.imageSource,
            imageCredit: best.s.imageCredit,
          };
        });
      }
    }

    return result;
  }

  function patchSlide(index: number, patch: Partial<Slide>) {
    setDeck((prev) => {
      if (!prev?.slides) return prev;
      const slides = [...prev.slides];
      slides[index] = { ...slides[index], ...patch };
      return { ...prev, slides };
    });
  }

  async function generateLesson() {
    if (!topic.trim()) return;

    setLoading(true);
    setImagesLoading(false);
    setStabilityIdx(null);
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
        image: null,
        imageAlt: "",
        imageSource: null,
        imageCredit: null,
        youtubeVideoId: null,
      }));

      setDeck({ deckTitle, slides: initSlides });
      setIdx(0);
      setLoading(false);
      setImagesLoading(true);

      // ── Step 2: Images + YouTube in parallel ───────────────────────────────
      const visualSlides: Array<{ origIndex: number; title: string; bullets: string[]; imageQuery: string }> =
        rawSlides
          .map((s: any, i: number) => ({ ...s, origIndex: i }))
          .filter((s: any) => typeof s.imageQuery === "string" && s.imageQuery.trim());

      // Primary mode: max 1 real Pexels photo (only try first visual slide)
      const pexelTargets = isPrimary ? visualSlides.slice(0, 1) : visualSlides;

      // Start YouTube in parallel with images
      const youtubePromise = fetch("/api/generate/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      })
        .then((r) => (r.ok ? r.json() : { videoId: null }))
        .catch(() => ({ videoId: null }));

      // Pexels: all in parallel, stream each result as it arrives
      const pexelResults = await Promise.all(
        pexelTargets.map(async (slide) => {
          try {
            const res = await fetch("/api/generate/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageQuery: slide.imageQuery,
                title: slide.title,
                bullets: slide.bullets,
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

      // ── Step 3: Fill rules after Pexels ───────────────────────────────────
      setDeck((prev) =>
        prev ? { ...prev, slides: applyFillRules(prev.slides ?? []) } : prev
      );
      setImagesLoading(false); // Slides are ready — Stability runs in background

      // ── Step 4: Stability AI — fire and forget (max 1/deck) ───────────────
      const failedPexels = pexelResults.filter((r) => !r.hasImage);
      const aiCandidates = isPrimary
        ? [
            ...failedPexels,
            ...visualSlides
              .slice(1)
              .map((s) => ({ index: s.origIndex, hasImage: false })),
          ]
        : failedPexels;

      if (aiCandidates.length > 0) {
        const candidate = aiCandidates[0];
        const slide = rawSlides[candidate.index];
        setStabilityIdx(candidate.index);
        fetch("/api/generate/stability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: slide.title, bullets: slide.bullets }),
        })
          .then((res) => (res.ok ? res.json() : { image: null }))
          .then((data) => {
            setStabilityIdx(null);
            if (data.image) {
              setDeck((prev) => {
                if (!prev?.slides) return prev;
                // Don't overwrite a slide that was assigned a YouTube video
                if (prev.slides[candidate.index]?.youtubeVideoId) return prev;
                const slides = [...prev.slides];
                slides[candidate.index] = { ...slides[candidate.index], ...data };
                return { ...prev, slides: applyFillRules(slides) };
              });
            }
          })
          .catch((e) => {
            setStabilityIdx(null);
            console.error("Stability error:", e);
          });
      }

      // ── Step 5: YouTube ────────────────────────────────────────────────────
      const { videoId } = await youtubePromise;
      if (videoId) {
        setDeck((prev) => {
          if (!prev?.slides) return prev;
          const slides = [...prev.slides];
          const firstImageless = slides.findIndex((s) => !s.image);
          if (firstImageless !== -1) {
            slides[firstImageless] = {
              ...slides[firstImageless],
              youtubeVideoId: videoId,
            };
          }
          return { ...prev, slides };
        });
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
        alert(err?.error || "Export failed. Check console.");
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

  const progressLabel = useMemo(() => {
    if (!total) return "";
    return `${idx + 1} / ${total}`;
  }, [idx, total]);

  return (
    <main className="min-h-screen bg-zinc-50">
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div className="max-w-6xl mx-auto p-6 md:p-10">

        {/* Top bar */}
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">
              Canva-style Lesson Slides ✨
            </h1>

            {total ? (
              <div className="text-sm text-zinc-600">{progressLabel}</div>
            ) : null}
          </div>

          {/* Input */}
          <div className="rounded-2xl border bg-white shadow-sm p-4 md:p-6">

            <label className="text-sm font-semibold text-zinc-700">
              Topic
            </label>

            <div className="mt-2 flex flex-col md:flex-row gap-3">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., 🌋 Volcanoes / 🐍 Python basics"
                className="w-full rounded-xl border px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-black/10"
              />

              <button
                onClick={generateLesson}
                disabled={!topic.trim() || loading}
                className="rounded-xl bg-black text-white px-6 py-3 text-lg font-semibold disabled:opacity-50"
              >
                {loading ? "Writing slides…" : imagesLoading ? "Loading images…" : stabilityIdx !== null ? "AI image…" : "Generate"}
              </button>
            </div>

            <div className="mt-4 flex gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Grade</label>
                <select
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(Number(e.target.value))}
                  className="rounded-lg border px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-black/10"
                >
                  {[1,2,3,4,5,6,7,8,9,10,11].map((g) => (
                    <option key={g} value={g}>Grade {g}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Curriculum</label>
                <select
                  value={curriculum}
                  onChange={(e) => setCurriculum(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-black/10"
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
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-500">
              Tip: Use ← → arrow keys to change slides.
            </div>

          </div>
        </div>

        {/* Slide stage */}
        <div className="mt-8">
          {!total ? (
            <div className="rounded-3xl border bg-white shadow-sm p-10 text-center text-zinc-600">
              <div className="text-2xl font-bold">No slides yet 🙂</div>
              <div className="mt-2">
                Enter a topic and hit{" "}
                <span className="font-semibold">Generate</span>.
              </div>
            </div>
          ) : (
            <>
              {/* Deck title + Download buttons */}
              <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                {deck?.deckTitle ? (
                  <h2 className="text-xl md:text-2xl font-extrabold text-zinc-900">
                    {deck.deckTitle}
                  </h2>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => download("pdf")}
                    disabled={downloading}
                    className="rounded-xl bg-black text-white px-4 py-2 font-semibold disabled:opacity-60"
                  >
                    {downloading ? "Downloading…" : "Download"}
                  </button>
                </div>
              </div>

              {/* Slide container */}
              <div className="relative flex items-center gap-2">
                <button
                  onClick={prev}
                  disabled={!canPrev}
                  className="shrink-0 rounded-2xl bg-white px-3 py-3 shadow-sm border disabled:opacity-40"
                >
                  ⬅️
                </button>
                <div className="flex-1 aspect-video rounded-2xl overflow-hidden border bg-white shadow-sm flex flex-col">
                <div
                  key={idx}
                  className="flex flex-col flex-1 min-h-0"
                  style={{ animation: `slideIn${slideDir === "right" ? "Right" : "Left"} 0.22s ease-out` }}
                >

                  {/* Green header band */}
                  <div className="bg-green-800 flex items-center shrink-0" style={{ height: "15%" }}>
                    <div className="w-1.5 self-stretch bg-green-400 shrink-0" />
                    <input
                      key={idx}
                      defaultValue={current?.title}
                      onBlur={(e) => patchSlide(idx, { title: e.target.value || current?.title || "" })}
                      className="flex-1 px-5 text-base md:text-2xl font-bold text-white leading-tight bg-transparent border-0 outline-none focus:bg-white/10 rounded min-w-0"
                    />
                    <span className="shrink-0 pr-4 text-green-200 text-xs md:text-sm font-semibold">
                      {idx + 1}/{total}
                    </span>
                  </div>

                  {/* Content row */}
                  <div className="flex flex-1 min-h-0">

                    {/* Bullets column */}
                    <div className="flex-1 px-6 md:px-8 flex flex-col justify-center">
                      <ul className="space-y-1.5 md:space-y-3">
                        {(current?.bullets || []).map((b, i) => (
                          <li key={`${idx}-${i}`} className="flex items-start gap-2 md:gap-3">
                            <span className="mt-1.5 w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-600 shrink-0" />
                            <input
                              defaultValue={b}
                              onBlur={(e) => {
                                const newBullets = [...(current?.bullets || [])];
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
                              className="text-xs md:text-lg text-zinc-900 leading-snug bg-transparent border-0 outline-none focus:bg-zinc-100 rounded px-1 flex-1 min-w-0"
                            />
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => patchSlide(idx, { bullets: [...(current?.bullets || []), "New point"] })}
                        className="mt-2 self-start text-[10px] md:text-xs text-zinc-400 hover:text-green-700 font-medium"
                      >
                        + Add bullet
                      </button>
                    </div>

                    {/* Image column */}
                    <div className="w-[42%] p-2 md:p-3 flex flex-col bg-zinc-50 border-l border-zinc-100">
                      <div className="flex-1 flex items-center justify-center min-h-0">
                        {displayImage ? (
                          <div
                            className="relative w-full h-full group cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/30"
                            tabIndex={0}
                            onPaste={(e) => handleImagePaste(e, idx)}
                            title="Click here and paste to replace image (Ctrl+V)"
                          >
                            <img
                              src={displayImage}
                              alt={current?.imageAlt || ""}
                              className="w-full h-full object-contain rounded-xl"
                            />
                            <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/10 group-focus:bg-black/10 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity text-white text-xs font-semibold bg-black/50 px-2 py-1 rounded-lg">
                                Paste to replace (Ctrl+V)
                              </span>
                            </div>
                          </div>
                        ) : current?.youtubeVideoId ? (
                          <iframe
                            key={current.youtubeVideoId}
                            src={`https://www.youtube.com/embed/${current.youtubeVideoId}?rel=0`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full rounded-xl border-0"
                            title={current.title}
                          />
                        ) : imagesLoading || stabilityIdx === idx ? (
                          <div className="w-full h-full min-h-[80px] rounded-xl bg-zinc-200 animate-pulse flex items-center justify-center">
                            <span className="text-[10px] md:text-xs text-zinc-400 font-medium">
                              {stabilityIdx === idx ? "Generating AI image…" : "Loading image…"}
                            </span>
                          </div>
                        ) : (
                          <div
                            className="w-full h-full min-h-[80px] rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-100 flex flex-col items-center justify-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/20 hover:border-zinc-300 hover:bg-zinc-50 transition-colors"
                            tabIndex={0}
                            onPaste={(e) => handleImagePaste(e, idx)}
                            title="Click here and paste an image (Ctrl+V)"
                          >
                            <span className="text-2xl md:text-3xl select-none">💡</span>
                            <span className="text-[10px] md:text-xs font-medium text-zinc-400">Paste an image here if you want</span>
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
                          className="mt-1 shrink-0 text-[9px] text-zinc-500 text-right w-full rounded border border-zinc-200 bg-white px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-500/20"
                        />
                      ) : imageCredit ? (
                        <div className="mt-1 shrink-0 text-[9px] text-zinc-400 text-right leading-tight px-1 truncate">
                          {imageCredit}
                        </div>
                      ) : null}
                    </div>

                  </div>

                  {/* Footer */}
                  <div className="shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-zinc-100">
                    <span className="text-[10px] text-zinc-400">Lesson Maker</span>
                    <span className="hidden md:inline text-[10px] text-zinc-300">Use ← → to move</span>
                  </div>

                </div>{/* end animated wrapper */}
                </div>

                <button
                  onClick={next}
                  disabled={!canNext}
                  className="shrink-0 rounded-2xl bg-white px-3 py-3 shadow-sm border disabled:opacity-40"
                >
                  ➡️
                </button>

              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}