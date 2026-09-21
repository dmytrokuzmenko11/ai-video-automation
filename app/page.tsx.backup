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

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

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
        console.error(
          "Supabase Storage Error:",
          uploadError
        );

        alert(
          "Помилка завантаження файлу в Storage: " +
            uploadError.message
        );

        setUploading(false);
        setUploadStatus("");

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

      console.log("Uploaded Public URL:", publicUrl);

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
          `Готово. Визначено ${
            result.scenes?.length || 0
          } сцен.`
        );

        await fetchTasks();
      } else {
        alert(
          "Помилка API: " +
            (result.error || "Невідома помилка")
        );
      }
    } catch (err) {
      console.error("Upload Catch Error:", err);

      const message =
        err instanceof Error ? err.message : "Невідома помилка";

      alert("Помилка завантаження: " + message);
    } finally {
      setUploading(false);
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
                    <p className="font-medium">
                      {task.title}
                    </p>

                    {task.video_url && (
                      <p className="text-xs text-green-400 mt-2">
                        📹 Відео завантажено
                      </p>
                    )}

                    {task.duration && (
                      <p className="text-xs text-slate-400 mt-1">
                        Довжина:{" "}
                        {formatTime(task.duration)}
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
          <div className="bg-slate-800 p-6 rounded-lg max-w-4xl w-full border border-slate-700 shadow-xl max-h-[90vh] overflow-y-auto">
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
                    <div className="mb-6">
                      <p className="text-lg font-semibold mb-3">
                        Автоматично визначені сцени
                      </p>

                      <div className="w-full h-3 bg-slate-900 rounded overflow-hidden flex mb-4">
                        {selectedTask.scenes.map(
                          (scene, index) => {
                            const total =
                              selectedTask.duration ||
                              1;

                            return (
                              <div
                                key={`${scene.start}-${scene.end}`}
                                title={`Scene ${
                                  index + 1
                                }: ${formatTime(
                                  scene.start
                                )} - ${formatTime(
                                  scene.end
                                )}`}
                                className="h-full border-r border-slate-800 bg-blue-500"
                                style={{
                                  width: `${
                                    (scene.duration /
                                      total) *
                                    100
                                  }%`,
                                }}
                              />
                            );
                          }
                        )}
                      </div>

                      <div className="space-y-2">
                        {selectedTask.scenes.map(
                          (scene, index) => (
                            <div
                              key={`${scene.start}-${scene.end}`}
                              className="flex items-center justify-between p-3 bg-slate-900 rounded border border-slate-700"
                            >
                              <div className="flex items-center gap-4">
                                <span className="font-semibold text-blue-400">
                                  Scene{" "}
                                  {String(
                                    index + 1
                                  ).padStart(2, "0")}
                                </span>

                                <span className="text-sm text-slate-300">
                                  {formatTime(
                                    scene.start
                                  )}{" "}
                                  →{" "}
                                  {formatTime(
                                    scene.end
                                  )}
                                </span>
                              </div>

                              <span className="text-sm text-slate-500">
                                {scene.duration.toFixed(
                                  2
                                )}
                                s
                              </span>
                            </div>
                          )
                        )}
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
                className={`text-sm mb-4 font-medium ${
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
              className="w-full py-2 bg-slate-700 rounded text-slate-300 hover:bg-slate-600 font-medium mt-2"
            >
              Закрити
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
