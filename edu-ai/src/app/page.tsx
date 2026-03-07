"use client";

import { useEffect, useMemo, useState } from "react";

type Slide = {
  title: string;
  bullets: string[];
  image?: string | null;
  imageAlt?: string;
};

type Deck = {
  deckTitle?: string;
  slides?: Slide[];
};

export default function Home() {
  const [topic, setTopic] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);

  // NEW: grade selector
  const [gradeLevel, setGradeLevel] = useState<number>(5);

  // download state
  const [downloading, setDownloading] = useState<null | "pptx" | "pdf">(null);

  const slides = deck?.slides ?? [];
  const total = slides.length;
  const current = slides[idx];

  const canPrev = idx > 0;
  const canNext = idx < total - 1;

  function prev() {
    setIdx((i) => Math.max(0, i - 1));
  }

  function next() {
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

  async function generateLesson() {
    if (!topic.trim()) return;

    setLoading(true);
    setDeck(null);
    setIdx(0);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        // UPDATED: send grade + primaryMode
        body: JSON.stringify({
          topic,
          slideCount: 8,
          grade: gradeLevel,
          primaryMode: gradeLevel <= 4
        })
      });

      const data = await res.json();
      setDeck(data);
      setIdx(0);
    } finally {
      setLoading(false);
    }
  }

  async function download(kind: "pptx" | "pdf") {
    if (!deck?.slides?.length) return;

    setDownloading(kind);

    try {
      const res = await fetch(`/api/export/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deck),
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
      setDownloading(null);
    }
  }

  const progressLabel = useMemo(() => {
    if (!total) return "";
    return `${idx + 1} / ${total}`;
  }, [idx, total]);

  return (
    <main className="min-h-screen bg-zinc-50">
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
                {loading ? "Generating…" : "Generate"}
              </button>
            </div>

            {/* NEW: Grade selector */}
            <div className="mt-4 flex gap-2 flex-wrap">
              {[1,2,3,4,5,6,7,8].map((g)=>(
                <button
                  key={g}
                  onClick={()=>setGradeLevel(g)}
                  className={`px-3 py-1 rounded-lg border text-sm ${
                    gradeLevel===g
                      ? "bg-black text-white"
                      : "bg-white"
                  }`}
                >
                  Grade {g}
                </button>
              ))}
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
                    onClick={() => download("pptx")}
                    disabled={downloading !== null}
                    className="rounded-xl bg-black text-white px-4 py-2 font-semibold disabled:opacity-60"
                  >
                    {downloading === "pptx" ? "Downloading…" : "Download PPTX"}
                  </button>

                  <button
                    onClick={() => download("pdf")}
                    disabled={downloading !== null}
                    className="rounded-xl border bg-white px-4 py-2 font-semibold disabled:opacity-60"
                  >
                    {downloading === "pdf" ? "Downloading…" : "Download PDF"}
                  </button>
                </div>
              </div>

              {/* Slide container */}
              <div className="relative">
                <div className="w-full aspect-video rounded-3xl overflow-hidden border bg-white shadow-sm">
                  <div className="h-full p-8 md:p-12 flex flex-col">

                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-3xl md:text-5xl font-black leading-tight text-zinc-900">
                        {current?.title}
                      </h3>

                      <div className="shrink-0 rounded-full border bg-white px-3 py-1 text-sm font-semibold text-zinc-700">
                        {idx + 1}/{total}
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 flex-1">

                      {/* Bullets */}
                      <div className="rounded-3xl border bg-zinc-50 p-6 md:p-7">
                        <div className="text-sm font-semibold text-zinc-600">
                          Key points ✅
                        </div>

                        <ul className="mt-4 space-y-3 text-lg md:text-2xl leading-snug text-zinc-900">
                          {(current?.bullets || []).map((b, i) => (
                            <li key={i} className="flex gap-3">
                              <span>👉</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Image */}
                      <div className="rounded-3xl border bg-white p-4 md:p-5 flex items-center justify-center">
                        {current?.image ? (
                          <img
                            src={current.image}
                            alt={current.imageAlt || ""}
                            className="w-full h-full max-h-[420px] object-cover rounded-2xl"
                          />
                        ) : (
                          <div className="w-full h-full rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-500 text-lg">
                            Reflection slide 💡
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between text-xs md:text-sm text-zinc-500">
                      <span>Made with AI ✨</span>
                      <span className="hidden md:inline">Use ← → to move</span>
                    </div>

                  </div>
                </div>

                {/* Prev/Next */}
                <button
                  onClick={prev}
                  disabled={!canPrev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-2xl bg-white px-4 py-3 shadow-sm border disabled:opacity-40"
                >
                  ⬅️
                </button>

                <button
                  onClick={next}
                  disabled={!canNext}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-2xl bg-white px-4 py-3 shadow-sm border disabled:opacity-40"
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