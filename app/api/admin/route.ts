import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TaskWithUser = {
  user_id: string | null;
};

type ErrorRow = {
  timestamp: string;
  stage: string;
  message: string;
  stack_trace: string | null;
  user_id: string | null;
  task_id: string | null;
};

function deriveErrorType(entry: ErrorRow): string {
  if (entry.stage === "upload") return "upload_error";
  if (entry.stage === "render") return "render_error";

  const stackTrace = entry.stack_trace || "";
  const message = entry.message || "";

  if (
    entry.stage === "ffmpeg" ||
    message.toLowerCase().includes("ffmpeg") ||
    stackTrace.toLowerCase().includes("ffmpeg")
  ) {
    return "ffmpeg_error";
  }

  return "unknown_error";
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage") || "";
    const type = searchParams.get("type") || "";

    const supabase = getSupabaseAdmin();
    const { data: usersData } = await supabase.auth.admin.listUsers();
    const userEmailById = new Map(
      (usersData.users || []).map((user) => [user.id, user.email ?? null])
    );

    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("user_id")
      .eq("status", "done");

    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const grouped = new Map<string, { userId: string | null; label: string; count: number }>();

    for (const task of (tasks ?? []) as TaskWithUser[]) {
      const userId = task.user_id ?? null;
      const email = userId ? userEmailById.get(userId) ?? null : null;
      const key = userId ?? email ?? "unknown";
      const label = email ?? userId ?? "Unknown user";

      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(key, { userId, label, count: 1 });
      }
    }

    const { data: versions, error: versionsError } = await supabase
      .from("video_versions")
      .select("render_started_at, render_completed_at")
      .not("render_started_at", "is", null)
      .not("render_completed_at", "is", null);

    if (versionsError) {
      return NextResponse.json({ error: versionsError.message }, { status: 500 });
    }

    const durationsMs = (versions ?? [])
      .map((version) => {
        const startedAt = version.render_started_at ? new Date(version.render_started_at).getTime() : NaN;
        const completedAt = version.render_completed_at ? new Date(version.render_completed_at).getTime() : NaN;
        if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
          return null;
        }
        return completedAt - startedAt;
      })
      .filter((value): value is number => value !== null);

    const averageRenderTimeMs = durationsMs.length
      ? Math.round(durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length)
      : null;

    const { data: errors, error: errorsError } = await supabase
      .from("error_logs")
      .select("timestamp, stage, message, stack_trace, user_id, task_id")
      .order("timestamp", { ascending: false })
      .limit(50);

    if (errorsError) {
      return NextResponse.json({ error: errorsError.message }, { status: 500 });
    }

    const filteredErrors = (errors ?? [])
      .map((entry) => ({
        ...entry,
        error_type: deriveErrorType(entry as ErrorRow),
      }))
      .filter((entry) => {
        if (stage && entry.stage !== stage) return false;
        if (type && entry.error_type !== type) return false;
        return true;
      });

    return NextResponse.json({
      completedTasksByUser: Array.from(grouped.values()).sort((a, b) => b.count - a.count),
      averageRenderTimeMs,
      recentErrors: filteredErrors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}