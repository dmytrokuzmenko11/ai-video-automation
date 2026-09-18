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

interface VideoVersion {
  id: string;
  task_id: string;
  version_number: number;
  scenes: Scene[];
  render_url?: string | null;
  created_at: string;
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

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [activeVersion, setActiveVersion] =
    useState<VideoVersion | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const [draggedSceneIndex, setDraggedSceneIndex] =
    useState<number | null>(null);

  const [savingScenes, setSavingScenes] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const supabase = createClient();

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
    setUploadStatus("");
    setVersions([]);
    setActiveVersion(null);

    if (task.video_url) {
      await fetchVersions(task.id, task.scenes);
    }
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
      }
    } catch (error) {
      console.error("Delete task error:", error);
      alert("Помилка видалення задачі.");
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
            >
              <h2 className="text-lg font-semibold mb-4">
                {columnTitle}
              </h2>

              <div className="space-y-3">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => selectTask(task)}
                    className="h-[105px] bg-slate-700 rounded cursor-pointer hover:bg-slate-600 transition flex items-center px-5"
                  >
                    <p className="text-2xl font-medium text-white">
                      {task.title}
                    </p>
                  </div>
                ))}

                {columnTasks.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Немає задач
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="bg-slate-800 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="text-xl font-bold">
                {selectedTask.title}
              </h3>

              <button
                type="button"
                onClick={() => {
                  setSelectedTask(null);
                  setVersions([]);
                  setActiveVersion(null);
                  setUploadStatus("");
                }}
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
                  <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold">
                          V{activeVersion.version_number} — Монтажний таймлайн
                        </h4>

                        <p className="text-xs text-slate-500 mt-1">
                          Перетягуй сцени для зміни порядку
                        </p>
                      </div>

                      <span className="text-xs text-slate-400">
                        {savingScenes ? "Збереження..." : "Збережено"}
                      </span>
                    </div>

                    <div className="flex gap-1 h-24 mb-2">
                      {activeVersion.scenes.map((scene, index) => {
                        const total = selectedTask.duration || 1;
                        const width = (scene.duration / total) * 100;

                        return (
                          <div
                            key={`${activeVersion.id}-${index}-${scene.start}-${scene.end}`}
                            draggable
                            onDragStart={() => setDraggedSceneIndex(index)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDragEnd(index)}
                            onDragEnd={() => setDraggedSceneIndex(null)}
                            className={`relative rounded border cursor-grab active:cursor-grabbing overflow-hidden transition ${
                              draggedSceneIndex === index
                                ? "border-blue-400 opacity-50"
                                : "border-slate-600"
                            }`}
                            style={{
                              flexGrow: Math.max(width, 0.1),
                              flexBasis: 0,
                              minWidth: "80px",
                            }}
                          >
                            <div className="absolute inset-0 bg-slate-700" />

                            <div className="relative z-10 p-3 h-full flex flex-col justify-between">
                              <span className="text-xs font-semibold text-blue-400">
                                SCENE {index + 1}
                              </span>

                              <div>
                                <span className="block text-xs text-slate-300">
                                  {formatTime(scene.start)} →{" "}
                                  {formatTime(scene.end)}
                                </span>

                                <span className="block text-xs text-slate-500 mt-1">
                                  {scene.duration.toFixed(1)}s
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-between text-xs text-slate-500">
                      <span>00:00</span>
                      <span>
                        {formatTime(selectedTask.duration || 0)}
                      </span>
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
    </div>
  );
}
