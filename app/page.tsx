"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface Scene {
  start: number;
  end: number;
  duration: number;
}

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  video_url?: string;
  duration?: number;
  scenes?: Scene[];
}

interface VideoVersion {
  id: string;
  task_id: string;
  version_number: number;
  scenes: Scene[];
  render_url?: string | null;
  created_at: string;
}

interface CommentItem {
  id: string;
  task_id: string;
  author_name: string;
  content: string;
  reactions?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function normalizeScenes(scenes: Scene[]): Scene[] {
  return scenes.map((scene) => ({
    start: Number(scene.start.toFixed(3)),
    end: Number(scene.end.toFixed(3)),
    duration: Number((scene.end - scene.start).toFixed(3)),
  }));
}


function SceneThumbnail({
  videoUrl,
  timestamp,
}: {
  videoUrl: string;
  timestamp: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    let cancelled = false;

    const captureFrame = () => {
      if (cancelled) return;

      if (
        !video.videoWidth ||
        !video.videoHeight
      ) {
        return;
      }

      const canvasWidth = 80;
      const canvasHeight = Math.round(
        canvasWidth *
          (video.videoHeight / video.videoWidth)
      );

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const context = canvas.getContext("2d");

      if (!context) return;

      context.clearRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      context.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        0,
        0,
        canvasWidth,
        canvasHeight
      );
    };

    const handleMetadata = () => {
      if (!Number.isFinite(video.duration)) {
        return;
      }

      const safeTimestamp = Math.min(
        Math.max(timestamp, 0),
        Math.max(video.duration - 0.05, 0)
      );

      video.currentTime = safeTimestamp;
    };

    const handleSeeked = () => {
      captureFrame();
    };

    video.addEventListener(
      "loadedmetadata",
      handleMetadata
    );

    video.addEventListener(
      "seeked",
      handleSeeked
    );

    video.load();

    return () => {
      cancelled = true;

      video.removeEventListener(
        "loadedmetadata",
        handleMetadata
      );

      video.removeEventListener(
        "seeked",
        handleSeeked
      );
    };
  }, [videoUrl, timestamp]);

  return (
    <div className="w-[60px] shrink-0 self-stretch bg-black border-r border-slate-600 flex items-start">
      <video
        ref={videoRef}
        src={videoUrl}
        crossOrigin="anonymous"
        muted
        playsInline
        preload="metadata"
        className="hidden"
      />

      <canvas
        ref={canvasRef}
        className="block w-[60px] h-auto"
      />
    </div>
  );
}

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskDraft, setSelectedTaskDraft] = useState<Task | null>(null);
  const [taskCloseConfirmOpen, setTaskCloseConfirmOpen] = useState(false);

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [activeVersion, setActiveVersion] =
    useState<VideoVersion | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const [draggedSceneIndex, setDraggedSceneIndex] =
    useState<number | null>(null);

  const [savingScenes, setSavingScenes] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [renderingVersion, setRenderingVersion] = useState(false);
  const [renderPlaybackTime, setRenderPlaybackTime] = useState(0);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [commentReactionLoadingId, setCommentReactionLoadingId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const renderVideoRef = useRef<HTMLVideoElement | null>(null);

  const supabase = createClient();

  async function handleDownloadRender() {
    if (!activeVersion?.render_url) return;

    const downloadUrl = activeVersion.render_url;
    const fileName = `video-v${activeVersion.version_number}.mp4`;

    try {
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to download render video: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = fileName;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 0);
    } catch (error) {
      console.error("Download render error:", error);
      window.open(downloadUrl, "_self");
    }
  }

  async function fetchComments(taskId: string) {
    const res = await fetch(`/api/comments?taskId=${encodeURIComponent(taskId)}`);
    const result = await res.json();

    if (!res.ok) {
      console.error("Fetch comments error:", result.error);
      return;
    }

    setComments((result.comments || []) as CommentItem[]);
  }

  function resetCommentState() {
    setComments([]);
    setCommentDraft("");
    setCommentLoading(false);
    setEditingCommentId(null);
    setEditingCommentDraft("");
    setCommentReactionLoadingId(null);
  }

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
      }

      await fetchTasks();
    }

    init();
  }, []);

  async function fetchTasks() {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Fetch tasks error:", error);
    } else if (data) {
      setTasks(data as Task[]);
    }
  }

  async function fetchVersions(
    taskId: string,
    fallbackScenes?: Scene[]
  ) {
    try {
      const res = await fetch(
        `/api/versions?taskId=${encodeURIComponent(taskId)}`
      );

      const result = await res.json();

      if (!res.ok) {
        console.error("Fetch versions error:", result.error);
        return;
      }

      let loadedVersions = (result.versions || []) as VideoVersion[];

      if (
        loadedVersions.length === 0 &&
        fallbackScenes &&
        fallbackScenes.length > 0
      ) {
        const createRes = await fetch("/api/versions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId,
            scenes: fallbackScenes,
          }),
        });

        const createResult = await createRes.json();

        if (!createRes.ok) {
          console.error(
            "Create initial V1 error:",
            createResult.error
          );
          return;
        }

        loadedVersions = [
          createResult.version as VideoVersion,
        ];
      }

      setVersions(loadedVersions);

      if (loadedVersions.length > 0) {
        setActiveVersion(loadedVersions[0]);
      } else {
        setActiveVersion(null);
      }
    } catch (error) {
      console.error("Fetch versions error:", error);
    }
  }

  async function selectTask(task: Task) {
    setSelectedTask(task);
    setSelectedTaskDraft(task);
    setTaskCloseConfirmOpen(false);
    setUploadStatus("");
    setVersions([]);
    setActiveVersion(null);
    resetCommentState();

    if (task.video_url) {
      await fetchVersions(task.id, task.scenes);
    }

    await fetchComments(task.id);
  }

  function updateTaskInState(updatedTask: Task) {
    setTasks((current) =>
      current.map((task) =>
        task.id === updatedTask.id ? { ...task, ...updatedTask } : task
      )
    );

    setSelectedTask((current) =>
      current && current.id === updatedTask.id
        ? { ...current, ...updatedTask }
        : current
    );

    setSelectedTaskDraft((current) =>
      current && current.id === updatedTask.id
        ? { ...current, ...updatedTask }
        : current
    );
  }

  function moveTaskToStatus(taskId: string, nextStatus: Task["status"]) {
    const currentTask = tasks.find((task) => task.id === taskId);

    if (!currentTask || currentTask.status === nextStatus) return;

    if (currentTask.status === "todo" || nextStatus === "todo") {
      return;
    }

    const allowedNextStatuses: Record<"in_progress" | "review" | "done", Task["status"][]> = {
      in_progress: ["review", "done"],
      review: ["in_progress", "done"],
      done: ["in_progress", "review"],
    };

    if (!allowedNextStatuses[currentTask.status as "in_progress" | "review" | "done"].includes(nextStatus)) {
      return;
    }

    const updatedTask = {
      ...currentTask,
      status: nextStatus,
    };

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, status: nextStatus } : task
      )
    );

    if (selectedTask?.id === taskId) {
      setSelectedTask((current) =>
        current ? { ...current, status: nextStatus } : current
      );
      setSelectedTaskDraft((current) =>
        current ? { ...current, status: nextStatus } : current
      );
    }

    void supabase
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", taskId)
      .select("*");

    return updatedTask;
  }

  async function saveTaskChanges(nextStatus?: Task["status"]) {
    if (!selectedTask || !selectedTaskDraft) return;

    const statusToSave = nextStatus ?? selectedTaskDraft.status;
    const updatedTask = {
      ...selectedTask,
      ...selectedTaskDraft,
      status: statusToSave,
    };

    const statusChanged = selectedTask.status !== statusToSave;

    if (statusChanged) {
      const { data, error } = await supabase
        .from("tasks")
        .update({ status: statusToSave })
        .eq("id", selectedTask.id)
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      updateTaskInState({
        ...selectedTask,
        ...(data as Task),
      });
    } else {
      updateTaskInState(updatedTask);
    }

    setTaskCloseConfirmOpen(false);
    setSelectedTask(null);
    setSelectedTaskDraft(null);
    setVersions([]);
    setActiveVersion(null);
  }

  function discardTaskChangesAndClose() {
    setSelectedTask(null);
    setSelectedTaskDraft(null);
    setTaskCloseConfirmOpen(false);
    setVersions([]);
    setActiveVersion(null);
    resetCommentState();
  }

  function handleTaskModalClose() {
    if (!selectedTask || !selectedTaskDraft) return;

    const hasChanges =
      selectedTask.status !== selectedTaskDraft.status;

    if (!hasChanges) {
      discardTaskChangesAndClose();
      return;
    }

    setTaskCloseConfirmOpen(true);
  }

  async function handleTaskDrop(nextStatus: Task["status"]) {
    if (!draggedTaskId) return;

    const draggedTask = tasks.find((task) => task.id === draggedTaskId);

    if (!draggedTask) {
      setDraggedTaskId(null);
      return;
    }

    if (draggedTask.status === "todo" || nextStatus === "todo") {
      setDraggedTaskId(null);
      return;
    }

    const allowedNextStatuses: Record<"in_progress" | "review" | "done", Task["status"][]> = {
      in_progress: ["review", "done"],
      review: ["in_progress", "done"],
      done: ["in_progress", "review"],
    };

    if (!allowedNextStatuses[draggedTask.status as "in_progress" | "review" | "done"].includes(nextStatus)) {
      setDraggedTaskId(null);
      return;
    }

    const updatedTask = moveTaskToStatus(draggedTaskId, nextStatus);

    if (!updatedTask) {
      setDraggedTaskId(null);
      return;
    }

    setDraggedTaskId(null);
  }


  async function deleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) return;

    const confirmed = window.confirm(
      `Видалити задачу "${task.title}"? Цю дію неможливо скасувати.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/tasks?taskId=${encodeURIComponent(taskId)}`,
        {
          method: "DELETE",
        }
      );

      const result = await res.json();

      if (!res.ok) {
        alert(
          "Помилка видалення: " +
            (result.error || "Невідома помилка")
        );
        return;
      }

      setTasks((current) =>
        current.filter((item) => item.id !== taskId)
      );

      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
        setVersions([]);
        setActiveVersion(null);
        setUploadStatus("");
        resetCommentState();
      }
    } catch (error) {
      console.error("Delete task error:", error);
      alert("Помилка видалення задачі.");
    }
  }

  async function handleCreateComment() {
    if (!selectedTask || !commentDraft.trim()) return;

    setCommentLoading(true);

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTask.id, content: commentDraft }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.error || "Помилка створення коментаря");
        return;
      }

      setComments((current) => [...current, result.comment as CommentItem]);
      setCommentDraft("");
    } finally {
      setCommentLoading(false);
    }
  }

  async function handleUpdateComment(commentId: string) {
    if (!editingCommentDraft.trim()) return;

    const res = await fetch("/api/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commentId,
        content: editingCommentDraft,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      alert(result.error || "Помилка редагування коментаря");
      return;
    }

    setComments((current) =>
      current.map((item) =>
        item.id === commentId ? (result.comment as CommentItem) : item
      )
    );
    setEditingCommentId(null);
    setEditingCommentDraft("");
  }

  async function handleReactToComment(commentId: string, emoji: string) {
    const comment = comments.find((item) => item.id === commentId);
    if (!comment) return;

    setCommentReactionLoadingId(commentId);

    const nextReactions = {
      ...(comment.reactions || {}),
      [emoji]: (comment.reactions?.[emoji] || 0) + 1,
    };

    setComments((current) =>
      current.map((item) =>
        item.id === commentId ? { ...item, reactions: nextReactions } : item
      )
    );

    try {
      const res = await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentId,
          reactions: nextReactions,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Помилка реакції");
      }

      setComments((current) =>
        current.map((item) =>
          item.id === commentId ? (result.comment as CommentItem) : item
        )
      );
    } catch (error) {
      console.error("React to comment error:", error);
      setComments((current) =>
        current.map((item) =>
          item.id === commentId ? comment : item
        )
      );
    } finally {
      setCommentReactionLoadingId(null);
    }
  }

  async function handleDeleteComment(commentId: string) {
    const confirmed = window.confirm("Видалити коментар?");

    if (!confirmed) return;

    const res = await fetch(
      `/api/comments?commentId=${encodeURIComponent(commentId)}`,
      { method: "DELETE" }
    );

    const result = await res.json();

    if (!res.ok) {
      alert(result.error || "Помилка видалення коментаря");
      return;
    }

    setComments((current) => current.filter((item) => item.id !== commentId));
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();

    if (!title) return;

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          userId,
        }),
      });

      const result = await res.json();

      if (res.ok) {
        setTitle("");
        await fetchTasks();
      } else {
        alert(
          "Помилка створення задачі: " +
            (result.error || "Невідома помилка")
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Невідома помилка";

      alert("Мережева помилка при створенні: " + message);
    }
  }

  async function handleVideoUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    if (!e.target.files || !e.target.files[0] || !selectedTask) {
      return;
    }

    const file = e.target.files[0];

    setUploading(true);
    setUploadStatus("1/3 Відправка файлу в Supabase Storage...");

    try {
      const cleanFileName = file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

      const filePath = `${selectedTask.id}/${Date.now()}_${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file, {
          upsert: true,
        });

      if (uploadError) {
        alert(
          "Помилка завантаження файлу в Storage: " +
            uploadError.message
        );

        return;
      }

      setUploadStatus(
        "2/3 Отримання публічного посилання..."
      );

      const {
        data: { publicUrl },
      } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath);

      setUploadStatus(
        "3/3 Аналіз відео та визначення сцен..."
      );

      const res = await fetch("/api/upload-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: selectedTask.id,
          videoUrl: publicUrl,
        }),
      });

      const result = await res.json();

      if (res.ok) {
        setSelectedTask(result.data);

        setUploadStatus(
          `Готово. Створено V1 з ${
            result.scenes?.length || 0
          } сценами.`
        );

        await fetchTasks();
        await fetchVersions(selectedTask.id, result.scenes);
      } else {
        alert(
          "Помилка API: " +
            (result.error || "Невідома помилка")
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Невідома помилка";

      alert("Помилка завантаження: " + message);
    } finally {
      setUploading(false);
    }
  }

  async function createNewVersion() {
    if (!selectedTask || !activeVersion) return;

    setCreatingVersion(true);

    try {
      const res = await fetch("/api/versions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: selectedTask.id,
          scenes: activeVersion.scenes,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(
          "Помилка створення версії: " +
            (result.error || "Невідома помилка")
        );
        return;
      }

      const newVersion = result.version as VideoVersion;

      setVersions((current) => [...current, newVersion]);
      setActiveVersion(newVersion);

      setUploadStatus(
        `Створено версію V${newVersion.version_number}.`
      );
    } catch (error) {
      console.error("Create version error:", error);

      alert("Помилка створення нової версії.");
    } finally {
      setCreatingVersion(false);
    }
  }

  async function saveScenes(scenes: Scene[]) {
    if (!activeVersion) return;

    const normalized = normalizeScenes(scenes);

    setSavingScenes(true);

    try {
      const res = await fetch("/api/versions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          versionId: activeVersion.id,
          scenes: normalized,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(
          "Помилка збереження монтажу: " +
            (result.error || "Невідома помилка")
        );
        return;
      }

      const updatedVersion =
        result.version as VideoVersion;

      setActiveVersion(updatedVersion);

      setVersions((current) =>
        current.map((version) =>
          version.id === updatedVersion.id
            ? updatedVersion
            : version
        )
      );
    } catch (error) {
      console.error("Save scenes error:", error);
      alert("Помилка збереження монтажу.");
    } finally {
      setSavingScenes(false);
    }
  }

  function updateScene(
    index: number,
    field: "start" | "end",
    value: number
  ) {
    if (!activeVersion) return;

    if (!Number.isFinite(value)) return;

    const scenes = [...activeVersion.scenes];
    const scene = { ...scenes[index] };

    if (field === "start") {
      const maxStart = scene.end - 0.1;

      scene.start = Math.max(
        0,
        Math.min(value, maxStart)
      );
    } else {
      const duration =
        selectedTask?.duration || scene.end;

      const minEnd = scene.start + 0.1;

      scene.end = Math.min(
        duration,
        Math.max(value, minEnd)
      );
    }

    scene.duration = scene.end - scene.start;

    scenes[index] = scene;

    setActiveVersion({
      ...activeVersion,
      scenes,
    });
  }

  async function handleDragEnd(targetIndex: number) {
    if (
      draggedSceneIndex === null ||
      !activeVersion ||
      draggedSceneIndex === targetIndex
    ) {
      setDraggedSceneIndex(null);
      return;
    }

    const scenes = [...activeVersion.scenes];

    const [movedScene] = scenes.splice(
      draggedSceneIndex,
      1
    );

    scenes.splice(targetIndex, 0, movedScene);

    const updatedVersion = {
      ...activeVersion,
      scenes,
    };

    setActiveVersion(updatedVersion);
    setDraggedSceneIndex(null);

    await saveScenes(scenes);
  }

  async function handleTrimSave() {
    if (!activeVersion) return;

    await saveScenes(activeVersion.scenes);
  }

  useEffect(() => {
  const video = renderVideoRef.current;

  if (!video) {
    setRenderPlaybackTime(0);
    return;
  }

  const handleTimeUpdate = () => {
    setRenderPlaybackTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    setRenderPlaybackTime(video.currentTime);
  };

  video.addEventListener("timeupdate", handleTimeUpdate);
  video.addEventListener("loadedmetadata", handleLoadedMetadata);

  return () => {
    video.removeEventListener("timeupdate", handleTimeUpdate);
    video.removeEventListener(
      "loadedmetadata",
      handleLoadedMetadata
    );
  };
}, [activeVersion?.id, activeVersion?.render_url]);

async function renderVersion() {
    if (!activeVersion) return;

    setRenderingVersion(true);
    setUploadStatus(
      `Рендеринг V${activeVersion.version_number}...`
    );

    try {
      const res = await fetch("/api/render-version", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          versionId: activeVersion.id,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(
          "Помилка рендеру: " +
            (result.error || "Невідома помилка")
        );
        return;
      }

      const renderedVersion =
        result.version as VideoVersion;

      const updatedTask = result.task as Task | undefined;

      setActiveVersion(renderedVersion);

      setVersions((current) =>
        current.map((version) =>
          version.id === renderedVersion.id
            ? renderedVersion
            : version
        )
      );

      if (updatedTask) {
      updateTaskInState({
        ...updatedTask,
        status: "review",
      });
      }

      setUploadStatus(
        `V${renderedVersion.version_number} успішно відрендерено.`
      );
    } catch (error) {
      console.error("Render version error:", error);
      alert("Помилка рендеру відео.");
    } finally {
      setRenderingVersion(false);
    }
  }

  const columns: Task["status"][] = [
    "todo",
    "in_progress",
    "review",
    "done",
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">
        AI Video Automation — Kanban
      </h1>

      <form
        onSubmit={handleAddTask}
        className="flex gap-4 mb-8"
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Назва нової відео-задачі..."
          className="px-4 py-2 bg-slate-800 rounded border border-slate-700 w-80 text-white"
        />

        <button
          type="submit"
          className="px-5 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500 transition"
        >
          Додати задачу
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {columns.map((column) => {
          const columnTasks = tasks.filter(
            (task) => task.status === column
          );

          const columnTitle =
            column === "todo"
              ? "Todo"
              : column === "in_progress"
                ? "In Progress"
                : column === "review"
                  ? "Review"
                  : "Done";

          return (
            <div
              key={column}
              className="bg-slate-800 rounded-lg p-4 min-h-[300px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                void handleTaskDrop(column);
              }}
            >
              <h2 className="text-lg font-semibold mb-4">
                {columnTitle}
              </h2>

              <div className="space-y-3">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedTaskId(task.id)}
                    onDragEnd={() => setDraggedTaskId(null)}
                    onClick={() => selectTask(task)}
                    className="h-[105px] bg-slate-700 rounded cursor-pointer hover:bg-slate-600 transition flex items-center px-5"
                  >
                    <p className="text-2xl font-medium text-white">
                      {task.title}
                    </p>
                  </div>
                ))}

                {column !== "todo" && columnTasks.length === 0 && (
                  <div className="min-h-[105px] flex items-center justify-center rounded border border-dashed border-slate-700 text-sm text-slate-500">
                    Немає задач
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && selectedTaskDraft && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-slate-800 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="text-xl font-bold">{selectedTask.title}</h3>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void saveTaskChanges();
                  }}
                  className="px-4 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500 transition"
                >
                  Зберегти зміни
                </button>

                <button
                  type="button"
                  onClick={handleTaskModalClose}
                  aria-label="Закрити"
                  title="Закрити"
                  className="shrink-0 p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 6l12 12M18 6L6 18"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-4 flex items-center gap-2">
              <span>Статус:</span>
              {selectedTask.status === "todo" ? (
                <span className="text-blue-400 font-semibold">Todo</span>
              ) : (
                <select
                  value={selectedTaskDraft.status}
                  onChange={(e) =>
                    setSelectedTaskDraft((current) =>
                      current
                        ? { ...current, status: e.target.value as Task["status"] }
                        : current
                    )
                  }
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-1 text-white"
                >
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              )}
            </p>

            {selectedTask.video_url && (
              <p className="text-sm text-slate-400 mb-4">
                Тривалість відео:{" "}
                <span className="text-slate-200 font-medium">
                  {(selectedTask.duration || 0).toFixed(1)} с
                </span>
              </p>
            )}

            {selectedTask.video_url ? (
              <>
                <div className="mb-6">
                  <p className="text-sm font-medium mb-2 text-green-400">
                    Перегляд завантаженого відео:
                  </p>

                  <video
                    controls
                    src={selectedTask.video_url}
                    className="w-full rounded border border-slate-700 max-h-96"
                  />
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold">
                      Версії монтажу
                    </h4>

                    {activeVersion && (
                      <button
                        type="button"
                        onClick={createNewVersion}
                        disabled={creatingVersion}
                        className="px-4 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500 disabled:opacity-50"
                      >
                        {creatingVersion
                          ? "Створення..."
                          : "+ Нова версія"}
                      </button>
                    )}
                  </div>

                  {versions.length > 0 ? (
                    <div className="flex gap-2 flex-wrap">
                      {versions.map((version) => (
                        <button
                          key={version.id}
                          type="button"
                          onClick={() => setActiveVersion(version)}
                          className={`px-4 py-2 rounded border font-medium transition ${
                            activeVersion?.id === version.id
                              ? "bg-blue-600 border-blue-500 text-white"
                              : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          V{version.version_number}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Версій монтажу ще немає.
                    </p>
                  )}
                </div>

                {activeVersion && (
                  <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="text-lg font-semibold">
                          V{activeVersion.version_number} — Монтажний таймлайн
                        </h4>

                        <p className="text-xs text-slate-500 mt-1">
                          Перетягуй сцени для зміни порядку
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          {savingScenes ? "Збереження..." : "Збережено"}
                        </span>

                        <button
                          type="button"
                          onClick={renderVersion}
                          disabled={
                            renderingVersion ||
                            savingScenes ||
                            activeVersion.scenes.length === 0
                          }
                          className="px-4 py-2 bg-green-600 rounded font-medium hover:bg-green-500 disabled:opacity-50"
                        >
                          {renderingVersion
                            ? "Рендеринг..."
                            : `Рендерити V${activeVersion.version_number}`}
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-1 w-full">
                      {activeVersion.scenes.map(
                        (scene, index) => {
                          const total =
                            selectedTask.duration || 1;

                          const width =
                            (scene.duration / total) * 100;

                          const sceneRenderStart =
                            activeVersion.scenes
                              .slice(0, index)
                              .reduce(
                                (sum, currentScene) =>
                                  sum + currentScene.duration,
                                0
                              );

                          const sceneRenderEnd =
                            sceneRenderStart + scene.duration;

                          let sceneProgress = 0;

                          if (renderPlaybackTime >= sceneRenderEnd) {
                            sceneProgress = 1;
                          } else if (
                            renderPlaybackTime > sceneRenderStart
                          ) {
                            sceneProgress =
                              (renderPlaybackTime -
                                sceneRenderStart) /
                              scene.duration;
                          }

                          return (
                            <div
                              key={`${activeVersion.id}-${index}-${scene.start}-${scene.end}`}
                              draggable
                              onDragStart={() =>
                                setDraggedSceneIndex(index)
                              }
                              onDragOver={(e) =>
                                e.preventDefault()
                              }
                              onDrop={() =>
                                handleDragEnd(index)
                              }
                              onDragEnd={() =>
                                setDraggedSceneIndex(null)
                              }
                              className={`relative rounded border overflow-hidden shrink-0 cursor-grab active:cursor-grabbing transition ${
                                draggedSceneIndex === index
                                  ? "border-blue-400 opacity-50"
                                  : "border-slate-600"
                              }`}
                              style={{
                                flexGrow: Math.max(width, 1),
                                flexShrink: 1,
                                flexBasis: 0,
                                minWidth: 0,
                              }}
                            >
                              <div className="relative flex items-stretch min-w-0 bg-slate-700">
                                <div
                                  className="absolute inset-y-0 left-0 bg-black/45 pointer-events-none z-10 transition-[width] duration-100"
                                  style={{
                                    width: `${sceneProgress * 100}%`,
                                  }}
                                />
                                {selectedTask.video_url && (
                                  <SceneThumbnail
                                    videoUrl={
                                      selectedTask.video_url
                                    }
                                    timestamp={scene.start}
                                  />
                                )}

                                <div className="flex-1 min-w-[120px] p-4 flex flex-col justify-center gap-4">
                                  <span className="text-xs font-semibold text-blue-400">
                                    SCENE {index + 1}
                                  </span>

                                  <div>
                                    <span className="block text-sm text-slate-300">
                                      {formatTime(scene.start)} -{" "}
                                      {formatTime(scene.end)}
                                    </span>

                                    <span className="block text-xs text-slate-500 mt-1">
                                      {scene.duration.toFixed(1)}s
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>

                    {activeVersion.render_url && (
                      <div className="mt-6 mb-6">
                        <p className="text-sm font-medium mb-2 text-green-400">
                          Готовий рендер V{activeVersion.version_number}:
                        </p>

                        <video
                          ref={renderVideoRef}
                          controls
                          src={activeVersion.render_url}
                          className="w-full rounded border border-slate-700 max-h-96"
                        />

                        <div className="mt-3 flex justify-center">
                          <button
                            type="button"
                            onClick={handleDownloadRender}
                            className="inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/20 hover:text-blue-300"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-4 w-4"
                              aria-hidden="true"
                            >
                              <path d="M10 2a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.75A.75.75 0 0 1 10 2Zm-5.25 12a.75.75 0 0 1 .75.75v1a.75.75 0 0 0 .75.75h8.5a.75.75 0 0 0 .75-.75v-1a.75.75 0 0 1 1.5 0v1A2.25 2.25 0 0 1 14.75 18h-8.5A2.25 2.25 0 0 1 4 15.75v-1a.75.75 0 0 1 .75-.75Z" />
                            </svg>
                            Завантажити відео
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h4 className="text-sm font-semibold text-slate-100">
                          Коментарі
                        </h4>
                        <span className="text-xs text-slate-500">
                          {comments.length} ком.
                        </span>
                      </div>

                      <div className="flex gap-2 mb-3">
                        <div className="flex-1">
                          <textarea
                            value={commentDraft}
                            onChange={(e) => setCommentDraft(e.target.value)}
                            rows={3}
                            placeholder="Додайте коментар..."
                            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-col gap-2 self-start">
                          <button
                            type="button"
                            onClick={handleCreateComment}
                            disabled={commentLoading || !commentDraft.trim()}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                          >
                            {commentLoading ? "..." : "Відправити"}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {comments.map((comment) => {
                          const isEditing = editingCommentId === comment.id;
                          const reactions = comment.reactions || {
                            "👍": 0,
                            "❤️": 0,
                            "😂": 0,
                            "👀": 0,
                            "🚀": 0,
                          };

                          return (
                            <div key={comment.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                              <div className="flex items-center justify-between gap-3 text-xs text-slate-500 mb-2">
                                <span className="font-medium text-slate-300">{comment.author_name}</span>
                                <span>{new Date(comment.created_at).toLocaleString()}</span>
                              </div>

                              {isEditing ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editingCommentDraft}
                                    onChange={(e) => setEditingCommentDraft(e.target.value)}
                                    rows={3}
                                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateComment(comment.id)}
                                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium hover:bg-blue-500"
                                    >
                                      Зберегти
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setEditingCommentId(null); setEditingCommentDraft(""); }}
                                      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
                                    >
                                      Скасувати
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className="whitespace-pre-wrap text-sm text-slate-200">{comment.content}</p>
                                  <div className="mt-2 flex gap-3 text-xs">
                                    <button
                                      type="button"
                                      onClick={() => { setEditingCommentId(comment.id); setEditingCommentDraft(comment.content); }}
                                      className="text-blue-400 hover:text-blue-300"
                                    >
                                      Редагувати
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteComment(comment.id)}
                                      className="text-red-400 hover:text-red-300"
                                    >
                                      Видалити
                                    </button>
                                  </div>
                                </>
                              )}

                              <div className="mt-3 flex flex-wrap gap-2">
                                {["👍", "❤️", "😂", "👀", "🚀"].map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    disabled={commentReactionLoadingId === comment.id}
                                    onClick={() => handleReactToComment(comment.id, emoji)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                                  >
                                    <span>{emoji}</span>
                                    {reactions[emoji] > 0 && (
                                      <span className="text-slate-400">{reactions[emoji]}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        {comments.length === 0 && (
                          <p className="text-sm text-slate-500">Коментарів ще немає.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Завантажити відео (.mp4):
                </label>

                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={uploading}
                  className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
                />
              </div>
            )}

            {uploadStatus && (
              <p
                className={`text-sm mt-4 mb-4 font-medium ${
                  uploading ? "text-yellow-400" : "text-green-400"
                }`}
              >
                {uploadStatus}
              </p>
            )}

            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={() => deleteTask(selectedTask.id)}
                className="inline-flex items-center gap-2 px-5 py-3 bg-slate-700 rounded text-slate-300 hover:bg-red-900/40 hover:text-red-400 font-medium transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 6h18"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 6V4h8v2"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 6l-1 14H6L5 6"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 10v6M14 10v6"
                  />
                </svg>
                Видалити задачу
              </button>
            </div>
          </div>
        </div>
      )}

      {taskCloseConfirmOpen && selectedTask && selectedTaskDraft && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-slate-800 rounded-xl w-full max-w-md p-6">
            <h4 className="text-lg font-semibold mb-3">Є незбережені зміни</h4>
            <p className="text-sm text-slate-300 mb-6">
              Що зробити зі змінами статусу задачі?
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  void saveTaskChanges();
                }}
                className="px-4 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500 transition"
              >
                Зберегти зміни
              </button>
              <button
                type="button"
                onClick={discardTaskChangesAndClose}
                className="px-4 py-2 bg-slate-700 rounded font-medium hover:bg-slate-600 transition"
              >
                Не зберігати та закрити
              </button>
              <button
                type="button"
                onClick={() => setTaskCloseConfirmOpen(false)}
                className="px-4 py-2 bg-transparent border border-slate-600 rounded font-medium hover:bg-slate-700 transition"
              >
                Відміна
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
