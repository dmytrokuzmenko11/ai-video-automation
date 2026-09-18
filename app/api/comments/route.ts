import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Reactions = Record<string, number>;

const DEFAULT_REACTIONS: Reactions = {
  "👍": 0,
  "❤️": 0,
  "😂": 0,
  "👀": 0,
  "🚀": 0,
};

const UKRAINIAN_NAMES = [
  "Олександр",
  "Андрій",
  "Дмитро",
  "Максим",
  "Артем",
  "Богдан",
  "Марія",
  "Олена",
  "Анна",
  "Софія",
];

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

function pickRandomAuthorName() {
  return UKRAINIAN_NAMES[
    Math.floor(Math.random() * UKRAINIAN_NAMES.length)
  ];
}

function normalizeReactions(reactions: unknown): Reactions {
  const base = { ...DEFAULT_REACTIONS };

  if (!reactions || typeof reactions !== "object") {
    return base;
  }

  for (const emoji of Object.keys(base)) {
    const value = (reactions as Record<string, unknown>)[emoji];
    base[emoji] = Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  return base;
}

function isMissingCommentsTableError(error: { message?: string } | null) {
  return Boolean(
    error?.message &&
      (error.message.includes("Could not find the table 'public.comments' in the schema cache") ||
        error.message.includes('relation "public.comments" does not exist') ||
        error.message.includes('relation "comments" does not exist'))
  );
}

function commentsTableHintResponse() {
  return NextResponse.json(
    {
      error:
        "Comments table is missing in Supabase. Apply the SQL below in Supabase SQL Editor to create public.comments.",
    },
    { status: 500 }
  );
}

function mapMissingTableToHint(error: { message?: string } | null) {
  return isMissingCommentsTableError(error)
    ? commentsTableHintResponse()
    : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("comments")
      .select("id, task_id, author_name, content, reactions, created_at, updated_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      comments: (data ?? []).map((comment) => ({
        ...comment,
        reactions: normalizeReactions((comment as { reactions?: unknown }).reactions),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { taskId, content } = await request.json();

    if (!taskId || !content?.trim()) {
      return NextResponse.json(
        { error: "Missing taskId or content" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("comments")
      .insert({
        task_id: taskId,
        author_name: pickRandomAuthorName(),
        content: content.trim(),
        reactions: DEFAULT_REACTIONS,
      })
      .select("id, task_id, author_name, content, reactions, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      comment: {
        ...data,
        reactions: normalizeReactions((data as { reactions?: unknown }).reactions),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { commentId, content, reactions } = await request.json();

    if (!commentId) {
      return NextResponse.json({ error: "Missing commentId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const updatePayload: Record<string, unknown> = {};

    if (typeof content === "string") {
      updatePayload.content = content.trim();
    }

    if (reactions) {
      updatePayload.reactions = normalizeReactions(reactions);
    }

    const { data, error } = await supabase
      .from("comments")
      .update(updatePayload)
      .eq("id", commentId)
      .select("id, task_id, author_name, content, reactions, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      comment: {
        ...data,
        reactions: normalizeReactions((data as { reactions?: unknown }).reactions),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get("commentId");

    if (!commentId) {
      return NextResponse.json({ error: "Missing commentId" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("comments").delete().eq("id", commentId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, commentId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}