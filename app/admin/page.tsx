"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompletedTaskGroup = {
  userId: string | null;
  label: string;
  count: number;
};

type ErrorLog = {
  timestamp: string;
  stage: string;
  error_type: string;
  message: string;
  stack_trace: string | null;
  user_id: string | null;
  task_id: string | null;
};

export default function AdminPage() {
  const [stage, setStage] = useState("");
  const [type, setType] = useState("");
  const [completedTasksByUser, setCompletedTasksByUser] = useState<CompletedTaskGroup[]>([]);
  const [averageRenderTimeMs, setAverageRenderTimeMs] = useState<number | null>(null);
  const [recentErrors, setRecentErrors] = useState<ErrorLog[]>([]);
  const [expandedErrorKey, setExpandedErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (stage) params.set("stage", stage);
        if (type) params.set("type", type);

        const res = await fetch(`/api/admin?${params.toString()}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load admin data");
        }

        setCompletedTasksByUser(data.completedTasksByUser || []);
        setAverageRenderTimeMs(data.averageRenderTimeMs ?? null);
        setRecentErrors(data.recentErrors || []);
        setExpandedErrorKey(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [stage, type]);

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-slate-400 mt-2">Simple operational dashboard.</p>
        <Link href="/" className="inline-block mt-3 text-sky-400 underline">Back to Kanban</Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Error filters</h2>
        <div className="flex flex-wrap gap-3">
          <input className="bg-slate-800 border border-slate-700 rounded px-3 py-2" placeholder="stage" value={stage} onChange={(e) => setStage(e.target.value)} />
          <input className="bg-slate-800 border border-slate-700 rounded px-3 py-2" placeholder="type" value={type} onChange={(e) => setType(e.target.value)} />
        </div>
      </section>

      {loading && <div>Loading...</div>}
      {error && <div className="text-red-400">{error}</div>}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Completed tasks by user</h2>
        <div className="space-y-2">
          {completedTasksByUser.map((row) => (
            <div key={`${row.userId ?? row.label}`} className="bg-slate-800 rounded p-3 flex justify-between">
              <span>{row.label}</span>
              <span>{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Average render time</h2>
        <div className="bg-slate-800 rounded p-3">
          {averageRenderTimeMs === null ? "No render data yet" : `${(averageRenderTimeMs / 1000).toFixed(2)}s`}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent errors</h2>
        <div className="space-y-2">
          {recentErrors.map((row, index) => (
            <button
              type="button"
              key={`${row.timestamp}-${index}`}
              onClick={() =>
                setExpandedErrorKey((current) =>
                  current === `${row.timestamp}-${index}` ? null : `${row.timestamp}-${index}`
                )
              }
              className="w-full bg-slate-800 rounded px-3 py-2 text-left text-sm space-y-1"
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-slate-300">
                <span className="shrink-0 pr-4 border-r border-slate-600/60">
                  {row.timestamp}
                </span>
                <span className="shrink-0 pr-4 border-r border-slate-600/60">
                  {row.stage}
                </span>
                <span className="shrink-0 pr-4 border-r border-slate-600/60">
                  {row.error_type}
                </span>
                <span className="min-w-0 max-w-[45ch] pr-4 border-r border-slate-600/60 truncate">
                  {row.message.length > 90 ? `${row.message.slice(0, 90)}…` : row.message}
                </span>
                <span className="shrink-0">{row.task_id ?? "—"}</span>
              </div>
              {expandedErrorKey === `${row.timestamp}-${index}` && (
                <div className="mt-2 rounded bg-slate-900/70 p-3 text-xs text-slate-200 space-y-2">
                  <div>
                    <div className="text-slate-400 mb-1">Full message</div>
                    <div className="whitespace-pre-wrap break-words">{row.message}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 mb-1">Stack trace</div>
                    <div className="whitespace-pre-wrap break-words">{row.stack_trace ?? "—"}</div>
                  </div>
                  <div className="text-slate-400">User: {row.user_id ?? "—"}</div>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}