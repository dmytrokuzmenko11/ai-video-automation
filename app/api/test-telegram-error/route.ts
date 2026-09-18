import { NextResponse } from "next/server";
import { getErrorMessage, getErrorStack, logError } from "@/lib/error-logger";
import { sendTelegramNotification } from "@/lib/telegram";

export async function GET() {
  const error = new Error("TEST: Telegram error alert");

  void logError({
    stage: "render",
    type: "critical_error_test",
    message: getErrorMessage(error),
    stackTrace: getErrorStack(error),
  });

  void sendTelegramNotification(
    "TEST: Telegram error alert\nStage: render\nThis is a temporary critical error test endpoint."
  );

  return NextResponse.json(
    { error: "TEST: Telegram error alert" },
    { status: 500 }
  );
}