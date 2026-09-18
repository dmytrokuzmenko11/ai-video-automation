import { NextResponse } from "next/server";
import { getErrorMessage, getErrorStack, logError } from "@/lib/error-logger";
import { sendTelegramNotification } from "@/lib/telegram";

export async function GET() {
  console.log("TEST ROUTE START");

  const error = new Error("TEST: Telegram error alert");

  await logError({
    stage: "render",
    type: "critical_error_test",
    message: getErrorMessage(error),
    stackTrace: getErrorStack(error),
  });

  console.log("BEFORE TELEGRAM");

  await sendTelegramNotification(
    "TEST: Telegram error alert\nStage: render\nThis is a temporary critical error test endpoint."
  );

  console.log("AFTER TELEGRAM");
  console.log("TEST ROUTE END");

  return NextResponse.json(
    { error: "TEST: Telegram error alert" },
    { status: 500 }
  );
}