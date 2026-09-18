"use client";

import { useEffect, useState } from "react";
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

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [draggedSceneIndex, setDraggedSceneIndex] = useState<number | null>(
    null
  );
  const [savingScenes, setSavingScenes] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
      }

      fetchTasks();
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
        fetchTasks();
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
          `Готово. Визначено ${result.scenes?.length || 0} сцен.`
        );

        await fetchTasks();
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

  async function saveScenes(scenes: Scene[]) {
    if (!selectedTask) return;

    const normalized = normalizeScenes(scenes);

    setSavingScenes(true);

    const { data, error } = await supabase
      .from("tasks")
      .update({
        scenes: normalized,
      })
      .eq("id", selectedTask.id)
      .select()
      .single();

    if (error) {
      console.error("Save scenes error:", error);
      alert("Помилка збереження монтажу: " + error.message);
    } else if (data) {
      setSelectedTask(data as Task);

      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === selectedTask.id
            ? (data as Task)
            : task
        )
      );
    }

    setSavingScenes(false);
  }

  function updateScene(
    index: number,
    field: "start" | "end",
    value: number
  ) {
    if (!selectedTask?.scenes) return;

    const scenes = [...selectedTask.scenes];
    const scene = { ...scenes[index] };

    if (field === "start") {
      const maxStart = scene.end - 0.1;
      scene.start = Math.max(0, Math.min(value, maxStart));
    } else {
      const minEnd = scene.start + 0.1;
      const duration = selectedTask.duration || scene.end;
      scene.end = Math.min(duration, Math.max(value, minEnd));
    }

    scene.duration = scene.end - scene.start;

    scenes[index] = scene;

    setSelectedTask({
      ...selectedTask,
      scenes,
    });
  }

  async function handleDragEnd(targetIndex: number) {
    if (
      draggedSceneIndex === null ||
      !selectedTask?.scenes ||
      draggedSceneIndex === targetIndex
    ) {
      setDraggedSceneIndex(null);
      return;
    }

    const scenes = [...selectedTask.scenes];

    const [movedScene] = scenes.splice(draggedSceneIndex, 1);

    scenes.splice(targetIndex, 0, movedScene);

    setSelectedTask({
      ...selectedTask,
      scenes,
    });

    setDraggedSceneIndex(null);

    await saveScenes(scenes);
  }

  function handleTrimSave() {
    if (!selectedTask?.scenes) return;

    saveScenes(selectedTask.scenes);
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
          className="px-6 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500"
        >
          Додати задачу
        </button>
      </form>

      <div className="grid grid-cols-4 gap-4">
        {columns.map((col) => (
          <div
            key={col}
            className="bg-slate-800 p-4 rounded-lg min-h-[400px]"
          >
            <h2 className="text-xl font-semibold capitalize mb-4">
              {col.replace("_", " ")}
            </h2>

            <div className="space-y-3">
              {tasks
                .filter((t) => t.status === col)
                .map((task) => (
                  <div
                    key={task.id}
                    onClick={() => {
                      setSelectedTask(task);
                      setUploadStatus("");
                    }}
                    className="p-4 bg-slate-700 rounded cursor-pointer hover:bg-slate-600 transition"
                  >
                    <p className="font-medium">{task.title}</p>

                    {task.video_url && (
                      <p className="text-xs text-green-400 mt-2">
                        📹 Відео завантажено
                      </p>
                    )}

                    {task.duration && (
                      <p className="text-xs text-slate-400 mt-1">
                        Довжина: {formatTime(task.duration)}
                      </p>
                    )}

                    {task.scenes &&
                      task.scenes.length > 0 && (
                        <p className="text-xs text-blue-400 mt-1">
                          Сцен: {task.scenes.length}
                        </p>
                      )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {selectedTask && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 p-6 rounded-lg max-w-5xl w-full border border-slate-700 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-2">
              {selectedTask.title}
            </h3>

            <p className="text-sm text-slate-400 mb-4">
              Статус:{" "}
              <span className="text-blue-400 uppercase font-semibold">
                {selectedTask.status}
              </span>
            </p>

            {selectedTask.video_url ? (
              <>
                <div className="mb-6">
                  <p className="text-sm font-medium mb-2 text-green-400">
                    📹 Перегляд завантаженого відео:
                  </p>

                  <video
                    controls
                    src={selectedTask.video_url}
                    className="w-full rounded border border-slate-700 max-h-96"
                  />
                </div>

                {selectedTask.scenes &&
                  selectedTask.scenes.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold">
                          Монтажний таймлайн
                        </h4>

                        <span className="text-xs text-slate-400">
                          {savingScenes
                            ? "Збереження..."
                            : "Зміни зберігаються автоматично"}
                        </span>
                      </div>

                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                        <div className="flex gap-1 h-20 mb-6">
                          {selectedTask.scenes.map(
                            (scene, index) => {
                              const total =
                                selectedTask.duration || 1;

                              const width =
                                ((scene.end - scene.start) /
                                  total) *
                                100;

                              return (
                                <div
                                  key={`${scene.start}-${scene.end}-${index}`}
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
                                  className={`relative min-w-[70px] flex-1 rounded border cursor-grab active:cursor-grabbing transition ${
                                    draggedSceneIndex === index
                                      ? "border-blue-400 opacity-50"
                                      : "border-slate-600"
                                  }`}
                                  style={{
                                    flexBasis: `${Math.max(
                                      width,
                                      5
                                    )}%`,
                                  }}
                                >
                                  <div className="absolute inset-0 bg-slate-700 rounded" />

                                  <div className="relative z-10 p-2 h-full flex flex-col justify-between">
                                    <span className="text-xs font-semibold text-blue-400">
                                      SCENE {index + 1}
                                    </span>

                                    <span className="text-xs text-slate-300">
                                      {scene.duration.toFixed(1)}s
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>

                        <div className="flex justify-between text-xs text-slate-500 mb-4">
                          <span>00:00</span>
                          <span>
                            {formatTime(
                              selectedTask.duration || 0
                            )}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {selectedTask.scenes.map(
                            (scene, index) => (
                              <div
                                key={`editor-${index}`}
                                className="bg-slate-800 border border-slate-700 rounded-lg p-4"
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <span className="font-semibold text-blue-400">
                                    Scene{" "}
                                    {String(index + 1).padStart(
                                      2,
                                      "0"
                                    )}
                                  </span>

                                  <span className="text-sm text-slate-400">
                                    {scene.duration.toFixed(2)}s
                                  </span>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <label className="text-sm text-slate-400">
                                    Початок
                                    <input
                                      type="number"
                                      min="0"
                                      max={Math.max(
                                        0,
                                        scene.end - 0.1
                                      )}
                                      step="0.1"
                                      value={scene.start}
                                      onChange={(e) =>
                                        updateScene(
                                          index,
                                          "start",
                                          Number(e.target.value)
                                        )
                                      }
                                      onBlur={handleTrimSave}
                                      className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                                    />
                                  </label>

                                  <label className="text-sm text-slate-400">
                                    Кінець
                                    <input
                                      type="number"
                                      min={
                                        scene.start + 0.1
                                      }
                                      max={
                                        selectedTask.duration ||
                                        scene.end
                                      }
                                      step="0.1"
                                      value={scene.end}
                                      onChange={(e) =>
                                        updateScene(
                                          index,
                                          "end",
                                          Number(e.target.value)
                                        )
                                      }
                                      onBlur={handleTrimSave}
                                      className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                                    />
                                  </label>
                                </div>
                              </div>
                            )
                          )}
                        </div>

                        <div className="mt-4 text-sm text-slate-400">
                          Перетягуй блоки Scene, щоб змінити їх
                          порядок. Значення «Початок» і «Кінець»
                          використовуються для обрізання сцен.
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
                  className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
                />
              </div>
            )}

            {uploadStatus && (
              <p
                className={`text-sm mt-4 mb-4 font-medium ${
                  uploading
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {uploadStatus}
              </p>
            )}

            <button
              onClick={() => {
                setSelectedTask(null);
                setUploadStatus("");
              }}
              className="w-full py-3 bg-slate-700 rounded text-slate-300 hover:bg-slate-600 font-medium mt-4"
            >
              Закрити
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
