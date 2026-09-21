import { createClient } from "@supabase/supabase-js";

type ErrorLoggerPayload = {
  stage: "upload" | "ffmpeg" | "render" | string;
  type: string;
  message: string;
  stackTrace?: string | null;
  userId?: string | null;
  taskId?: string | null;
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function logError({
  stage,
  type,
  message,
  stackTrace = null,
  userId = null,
  taskId = null,
}: ErrorLoggerPayload): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    await supabase.from("error_logs").insert({
      stage,
      type,
      message,
      stack_trace: stackTrace,
      user_id: userId,
      task_id: taskId,
    });
  } catch (error) {
    console.error("Failed to write error log:", error);
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getErrorStack(error: unknown): string | null {
  return error instanceof Error ? error.stack ?? null : null;
}