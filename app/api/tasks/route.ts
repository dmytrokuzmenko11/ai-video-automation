import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/client';
import { sendTelegramNotification } from '@/lib/telegram';

export async function POST(request: Request) {
  try {
    const { title, userId } = await request.json();

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const supabase = createClient();
    const { data: task, error } = await supabase
      .from('tasks')
      .insert([{ title, status: 'todo', user_id: userId || null, duration: 0 }])
      .select()
      .single();

    if (error) {
      console.error('Supabase Task Insert Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Сповіщення в Telegram
    try {
      await sendTelegramNotification(`🎬 <b>Нова задача створена!</b>\n\n<b>Назва:</b> ${title}\n<b>Статус:</b> Todo`);
    } catch (telegramErr) {
      console.error('Telegram Notify Error:', telegramErr);
    }

    return NextResponse.json(task);
  } catch (err: any) {
    console.error('API /api/tasks Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
