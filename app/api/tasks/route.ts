import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { sendTelegramNotification } from "@/lib/telegram";

function getSupabaseAdmin() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const { title, userId } = await request.json();

    if (!title) {
      return NextResponse.json(
        { error: "Missing title" },
        { status: 400 }
      );
    }

    const supabase = createClient();

    const { data: task, error } = await supabase
      .from("tasks")
      .insert([
        {
          title,
          status: "todo",
          user_id: userId || null,
          duration: 0,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase Task Insert Error:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    try {
      await sendTelegramNotification(
        `🎬 <b>Нова задача створена!</b>\n\n<b>Назва:</b> ${title}\n<b>Статус:</b> Todo`
      );
    } catch (telegramErr) {
      console.error("Telegram Notify Error:", telegramErr);
    }

    return NextResponse.json(task);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";

    console.error("API /api/tasks Error:", err);

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing taskId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId);

    if (error) {
      console.error("Supabase Task Delete Error:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      taskId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";

    console.error("API /api/tasks DELETE Error:", err);

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
