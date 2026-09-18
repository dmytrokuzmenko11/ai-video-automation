import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { detectScenes } from '@/lib/scene-detection';

export async function POST(request: Request) {
  try {
    const { taskId, videoUrl } = await request.json();

    if (!taskId || !videoUrl) {
      return NextResponse.json(
        { error: 'Missing taskId or videoUrl' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase
      .from('tasks')
      .update({
        video_url: videoUrl,
        status: 'in_progress',
      })
      .eq('id', taskId);

    console.log(`Running scene detection for video URL: ${videoUrl}`);

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

    const { data: finalTask, error: updateError } = await supabase
      .from('tasks')
      .update({
        scenes: sceneDetectionResult.scenes,
        duration,
        status: 'review',
      })
      .eq('id', taskId)
      .select()
      .single();

    if (updateError) {
      console.error('Error saving scenes:', updateError);

      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: finalTask,
      scenes: sceneDetectionResult.scenes,
      message: 'Video processed successfully.',
    });
  } catch (error) {
    console.error('Upload video route error:', error);

    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
