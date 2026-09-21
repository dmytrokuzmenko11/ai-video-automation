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
    <main className="min-h-screen bg-[#09090b] text-zinc-100 px-6 py-5 space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <h1 className="text-[24px] font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">Simple operational dashboard.</p>
        <Link href="/" className="mt-2 inline-flex text-sm text-emerald-400 hover:text-emerald-300">Back to board</Link>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
        <h2 className="text-[18px] font-medium text-zinc-300">Error filters</h2>
        <div className="flex flex-wrap gap-2">
          <input className="h-9 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/60" placeholder="stage" value={stage} onChange={(e) => setStage(e.target.value)} />
          <input className="h-9 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/60" placeholder="type" value={type} onChange={(e) => setType(e.target.value)} />
        </div>
      </section>

      {loading && <div className="text-sm text-zinc-400">Loading...</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
        <h2 className="text-[18px] font-medium text-zinc-300">Completed tasks by user</h2>
        <div className="space-y-2">
          {completedTasksByUser.map((row) => (
            <div key={`${row.userId ?? row.label}`} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm">
              <span className="text-zinc-200">{row.label}</span>
              <span className="text-zinc-400">{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
        <h2 className="text-[18px] font-medium text-zinc-300">Average render time</h2>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200">
          {averageRenderTimeMs === null ? "No render data yet" : `${(averageRenderTimeMs / 1000).toFixed(2)}s`}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
        <h2 className="text-[18px] font-medium text-zinc-300">Recent errors</h2>
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
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-left text-sm space-y-1 transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-zinc-300">
                <span className="shrink-0 pr-3 border-r border-zinc-700/80 text-zinc-400">
                  {row.timestamp}
                </span>
                <span className="shrink-0 pr-3 border-r border-zinc-700/80 text-zinc-400">
                  {row.stage}
                </span>
                <span className="shrink-0 pr-3 border-r border-zinc-700/80 text-zinc-400">
                  {row.error_type}
                </span>
                <span className="min-w-0 max-w-[45ch] pr-3 border-r border-zinc-700/80 truncate text-zinc-200">
                  {row.message.length > 90 ? `${row.message.slice(0, 90)}…` : row.message}
                </span>
                <span className="shrink-0 text-zinc-400">{row.task_id ?? "—"}</span>
              </div>
              {expandedErrorKey === `${row.timestamp}-${index}` && (
                <div className="mt-2 rounded-md border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-200 space-y-2">
                  <div>
                    <div className="mb-1 text-zinc-500">Full message</div>
                    <div className="whitespace-pre-wrap break-words">{row.message}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-zinc-500">Stack trace</div>
                    <div className="whitespace-pre-wrap break-words">{row.stack_trace ?? "—"}</div>
                  </div>
                  <div className="text-zinc-500">User: {row.user_id ?? "—"}</div>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}