import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function GET(request: Request) {
  try {
    console.log("[VERSIONS DIAG] env", {
      hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasAnon: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hasSecret: Boolean(process.env.SUPABASE_SECRET_KEY),
    });

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing taskId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("video_versions")
      .select("*")
      .eq("task_id", taskId)
      .order("version_number", { ascending: true });

    if (error) {
      console.error("[VERSIONS DIAG] supabase query error", {
        error,
        message: error.message,
        stack: error.stack,
        cause: (error as Error & { cause?: unknown }).cause,
        causeMessage: (error as Error & { cause?: { message?: string } }).cause?.message,
        causeCode: (error as Error & { cause?: { code?: string } }).cause?.code,
      });
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ versions: data });
  } catch (error) {
    console.error("[VERSIONS DIAG] caught error", {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined,
      causeMessage: error instanceof Error ? (error as Error & { cause?: { message?: string } }).cause?.message : undefined,
      causeCode: error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause?.code : undefined,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { taskId, scenes } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing taskId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: existingVersions, error: versionsError } =
      await supabase
        .from("video_versions")
        .select("version_number")
        .eq("task_id", taskId)
        .order("version_number", { ascending: false })
        .limit(1);

    if (versionsError) {
      return NextResponse.json(
        { error: versionsError.message },
        { status: 500 }
      );
    }

    const nextVersion =
      existingVersions && existingVersions.length > 0
        ? existingVersions[0].version_number + 1
        : 1;

    const { data, error } = await supabase
      .from("video_versions")
      .insert({
        task_id: taskId,
        version_number: nextVersion,
        scenes: scenes || [],
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ version: data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { versionId, scenes } = await request.json();

    if (!versionId) {
      return NextResponse.json(
        { error: "Missing versionId" },
        { status: 400 }
      );
    }

    console.log("[VERSIONS PATCH] request", {
      versionId,
      scenesCount: Array.isArray(scenes) ? scenes.length : null,
      hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSecret: Boolean(process.env.SUPABASE_SECRET_KEY),
    });

    const supabase = getSupabaseAdmin();

    const { data: existingVersion } = await supabase
      .from("video_versions")
      .select("id, task_id, version_number, scenes")
      .eq("id", versionId)
      .single();

    if (!existingVersion) {
      console.error("[VERSIONS PATCH] version lookup failed", { versionId });
    }

    const { data: task } = existingVersion
      ? await supabase
          .from("tasks")
          .select("video_url, duration")
          .eq("id", existingVersion.task_id)
          .single()
      : { data: null };

    if (!existingVersion) {
      return NextResponse.json(
        { error: "Version not found" },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("video_versions")
      .update({
        scenes: scenes || [],
      })
      .eq("id", versionId)
      .select()
      .single();

    if (error) {
      console.error("[VERSIONS PATCH] update failed", {
        versionId,
        error,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
        { status: error.code === "PGRST116" ? 404 : 500 }
      );
    }

    return NextResponse.json({ version: data });
  } catch (error) {
    console.error("[VERSIONS PATCH] caught error", {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
