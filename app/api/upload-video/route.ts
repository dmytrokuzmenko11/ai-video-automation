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

    const { data: updatedTask, error } = await supabase
      .from('tasks')
      .update({
        video_url: videoUrl,
        status: 'in_progress',
      })
      .eq('id', taskId)
      .select();

    if (error) {
      console.error('Error updating task:', error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    console.log(`Running scene detection for video URL: ${videoUrl}`);

    const sceneDetectionResult = await detectScenes(videoUrl);

    console.log(
      'Detected scenes:',
      sceneDetectionResult.scenes
    );

    return NextResponse.json({
      data: updatedTask,
      scenes: sceneDetectionResult.scenes,
      message: 'Video uploaded and task status updated.',
    });
  } catch (error) {
    console.error('Upload video route error:', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
