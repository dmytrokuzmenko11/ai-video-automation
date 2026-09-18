import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { detectScenes } from "@/lib/scene-detection";
import { getErrorMessage, getErrorStack, logError } from "@/lib/error-logger";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const { taskId, videoUrl } = await request.json();

    if (!taskId || !videoUrl) {
      return NextResponse.json(
        { error: "Missing taskId or videoUrl" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    await supabase
      .from("tasks")
      .update({
        video_url: videoUrl,
        status: "in_progress",
      })
      .eq("id", taskId);

    console.log(
      `Running scene detection for video URL: ${videoUrl}`
    );

    const sceneDetectionResult = await detectScenes(videoUrl);

    console.log(
      `Detected ${sceneDetectionResult.scenes.length} scenes`
    );

    const duration =
      sceneDetectionResult.scenes.length > 0
        ? sceneDetectionResult.scenes[
            sceneDetectionResult.scenes.length - 1
          ].end
        : 0;

    const { error: taskUpdateError } = await supabase
      .from("tasks")
      .update({
        scenes: sceneDetectionResult.scenes,
        duration,
        status: "in_progress",
      })
      .eq("id", taskId);

    if (taskUpdateError) {
      return NextResponse.json(
        { error: taskUpdateError.message },
        { status: 500 }
      );
    }

    const { data: existingVersion, error: existingVersionError } =
      await supabase
        .from("video_versions")
        .select("*")
        .eq("task_id", taskId)
        .eq("version_number", 1)
        .maybeSingle();

    if (existingVersionError) {
      return NextResponse.json(
        { error: existingVersionError.message },
        { status: 500 }
      );
    }

    let version = existingVersion;

    if (!version) {
      const { data: newVersion, error: versionError } =
        await supabase
          .from("video_versions")
          .insert({
            task_id: taskId,
            version_number: 1,
            scenes: sceneDetectionResult.scenes,
          })
          .select()
          .single();

      if (versionError) {
        console.error(
          "Error creating V1:",
          versionError
        );

        return NextResponse.json(
          { error: versionError.message },
          { status: 500 }
        );
      }

      version = newVersion;
    }

    const { data: finalTask, error: finalTaskError } =
      await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

    if (finalTaskError) {
      return NextResponse.json(
        { error: finalTaskError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: finalTask,
      scenes: sceneDetectionResult.scenes,
      version,
      message: "Video processed successfully.",
    });
  } catch (error) {
    console.error("Upload video route error:", error);

    const message = getErrorMessage(error);

    const taskId =
      error instanceof Error && "taskId" in error
        ? (error as { taskId?: string }).taskId ?? null
        : null;

    void logError({
      stage: "upload",
      type: "upload_error",
      message,
      stackTrace: getErrorStack(error),
      taskId,
    });

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
