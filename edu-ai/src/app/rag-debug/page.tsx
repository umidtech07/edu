"use client";

import { useState } from "react";

interface Lesson {
  lessonNumber: number;
  title: string;
  chapter: string;
  content: string;
  score: number;
}

interface DebugResult {
  meta: {
    topic: string;
    grade: number;
    topK: number;
    elapsedMs: number;
    lessonsFound: number;
    ragError: string | null;
    neo4jConfigured: boolean;
  };
  lessons: Lesson[];
  rawContext: string | null;
  compressedContext: string | null;
  promptSnippet: string;
}

export default function RagDebugPage() {
  const [topic, setTopic] = useState("");
  const [grade, setGrade] = useState(5);
  const [topK, setTopK] = useState(3);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"lessons" | "context" | "prompt">("lessons");

  async function run() {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/debug/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, grade, topK }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed");
      } else {
        setResult(data);
        setActiveTab("lessons");
      }
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  const scoreColor = (score: number) => {
    if (score >= 0.85) return "#22c55e";
    if (score >= 0.7) return "#eab308";
    return "#ef4444";
  };

  return (
    <div style={{ fontFamily: "monospace", padding: "32px", maxWidth: "900px", margin: "0 auto", background: "#0f0f0f", minHeight: "100vh", color: "#e5e5e5" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px", color: "#fff" }}>RAG Pipeline Inspector</h1>
      <p style={{ fontSize: "13px", color: "#888", marginBottom: "28px" }}>
        See exactly what curriculum data is retrieved from Neo4j and what gets passed to OpenAI.
      </p>

      {/* Input form */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "24px" }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Topic (e.g. water cycle, photosynthesis)"
          style={{
            flex: 1, minWidth: "260px", padding: "10px 14px", borderRadius: "6px",
            border: "1px solid #333", background: "#1a1a1a", color: "#fff", fontSize: "14px",
            outline: "none",
          }}
        />
        <select
          value={grade}
          onChange={(e) => setGrade(Number(e.target.value))}
          style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #333", background: "#1a1a1a", color: "#fff", fontSize: "14px" }}
        >
          {[1,2,3,4,5,6,7,8].map((g) => (
            <option key={g} value={g}>Grade {g}</option>
          ))}
        </select>
        <select
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #333", background: "#1a1a1a", color: "#fff", fontSize: "14px" }}
        >
          {[1,2,3,5,8].map((k) => (
            <option key={k} value={k}>Top {k}</option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading || !topic.trim()}
          style={{
            padding: "10px 22px", borderRadius: "6px", border: "none",
            background: loading ? "#333" : "#4f46e5", color: "#fff", fontSize: "14px",
            cursor: loading ? "not-allowed" : "pointer", fontWeight: 600,
          }}
        >
          {loading ? "Searching..." : "Run"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#3b0000", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "12px 16px", color: "#fca5a5", marginBottom: "20px", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Meta bar */}
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "12px 16px", marginBottom: "20px", fontSize: "12px" }}>
            <Stat label="Lessons found" value={String(result.meta.lessonsFound)} highlight={result.meta.lessonsFound > 0} />
            <Stat label="Elapsed" value={`${result.meta.elapsedMs}ms`} />
            <Stat label="Neo4j configured" value={result.meta.neo4jConfigured ? "yes" : "NO"} highlight={result.meta.neo4jConfigured} warn={!result.meta.neo4jConfigured} />
            <Stat label="Grade" value={String(result.meta.grade)} />
            <Stat label="Top-K" value={String(result.meta.topK)} />
            {result.meta.ragError && (
              <Stat label="Error" value={result.meta.ragError} warn />
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #2a2a2a", marginBottom: "0" }}>
            {(["lessons", "context", "prompt"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "8px 18px", background: "transparent", border: "none",
                  borderBottom: activeTab === tab ? "2px solid #4f46e5" : "2px solid transparent",
                  color: activeTab === tab ? "#fff" : "#888", cursor: "pointer", fontSize: "13px",
                  fontFamily: "monospace", textTransform: "capitalize",
                }}
              >
                {tab === "lessons" ? `Lessons (${result.lessons.length})` : tab === "context" ? "Context" : "Prompt Snippet"}
              </button>
            ))}
          </div>

          <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "20px" }}>

            {activeTab === "lessons" && (
              result.lessons.length === 0 ? (
                <p style={{ color: "#666", fontSize: "13px" }}>
                  No lessons returned.{" "}
                  {!result.meta.neo4jConfigured
                    ? "Neo4j env vars (NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD) are not set."
                    : result.meta.ragError
                    ? `Error: ${result.meta.ragError}`
                    : "The vector index may be empty, or no results matched the grade filter."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {result.lessons.map((lesson, i) => (
                    <div key={i} style={{ border: "1px solid #2a2a2a", borderRadius: "6px", padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div>
                          <span style={{ fontSize: "11px", color: "#888" }}>#{lesson.lessonNumber} · {lesson.chapter}</span>
                          <h3 style={{ margin: "2px 0 0", fontSize: "15px", color: "#fff" }}>{lesson.title}</h3>
                        </div>
                        <span style={{
                          fontSize: "13px", fontWeight: 700, color: scoreColor(lesson.score),
                          background: "#0f0f0f", padding: "3px 10px", borderRadius: "20px", border: `1px solid ${scoreColor(lesson.score)}`,
                          whiteSpace: "nowrap", marginLeft: "12px",
                        }}>
                          score {lesson.score.toFixed(4)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: "13px", color: "#bbb", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                        {lesson.content}
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}

            {activeTab === "context" && (
              <div>
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "11px", color: "#4f46e5", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                    Compressed context (injected into prompt)
                  </div>
                  <pre style={{ margin: 0, fontSize: "12px", color: "#a3e635", whiteSpace: "pre-wrap", lineHeight: "1.7", background: "#0f0f0f", padding: "12px", borderRadius: "6px", border: "1px solid #1e2a0a" }}>
                    {result.compressedContext ?? "(empty — nothing will be injected into the OpenAI prompt)"}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                    Raw context (old 400-char truncation, for comparison)
                  </div>
                  <pre style={{ margin: 0, fontSize: "12px", color: "#666", whiteSpace: "pre-wrap", lineHeight: "1.7", background: "#0f0f0f", padding: "12px", borderRadius: "6px", border: "1px solid #222" }}>
                    {result.rawContext ?? "(empty)"}
                  </pre>
                </div>
              </div>
            )}

            {activeTab === "prompt" && (
              <pre style={{ margin: 0, fontSize: "12px", color: "#bbb", whiteSpace: "pre-wrap", lineHeight: "1.7" }}>
                {result.promptSnippet}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div>
      <span style={{ color: "#555" }}>{label}: </span>
      <span style={{ color: warn ? "#ef4444" : highlight ? "#22c55e" : "#d4d4d4", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
