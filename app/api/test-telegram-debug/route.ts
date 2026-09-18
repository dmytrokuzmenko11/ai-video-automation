import { NextResponse } from "next/server";

function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

function safeChatInfo(message: {
  message_id?: number;
  chat?: {
    id?: number | string;
    type?: string;
    username?: string;
  };
}) {
  return {
    message_id: message.message_id ?? null,
    chat_id: message.chat?.id ?? null,
    chat_type: message.chat?.type ?? null,
    chat_username: message.chat?.username ?? null,
  };
}

export async function GET() {
  const token = getTelegramBotToken();

  if (!token) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN is missing" },
      { status: 500 }
    );
  }

  const baseUrl = `https://api.telegram.org/bot${token}`;
  const getMeResponse = await fetch(`${baseUrl}/getMe`);
  const getMeBody = await getMeResponse.json().catch(async () => ({
    raw: await getMeResponse.text().catch(() => ""),
  }));

  const getUpdatesResponse = await fetch(`${baseUrl}/getUpdates`);
  const getUpdatesBody = await getUpdatesResponse.json().catch(async () => ({
    raw: await getUpdatesResponse.text().catch(() => ""),
  }));

  const botInfo = getMeBody?.result
    ? {
        bot_id: getMeBody.result.id ?? null,
        bot_username: getMeBody.result.username ?? null,
      }
    : null;

  const updates = Array.isArray(getUpdatesBody?.result)
    ? getUpdatesBody.result.map((update: { update_id?: number; message?: { message_id?: number; chat?: { id?: number | string; type?: string; username?: string } } }) => ({
        update_id: update.update_id ?? null,
        ...(update.message ? safeChatInfo(update.message) : {}),
      }))
    : [];

  const payload = {
    getMe_ok: getMeResponse.ok,
    getUpdates_ok: getUpdatesResponse.ok,
    bot: botInfo,
    updates,
  };

  console.log("TELEGRAM DEBUG:", JSON.stringify(payload));

  return NextResponse.json(payload, {
    status: getMeResponse.ok && getUpdatesResponse.ok ? 200 : 500,
  });
}