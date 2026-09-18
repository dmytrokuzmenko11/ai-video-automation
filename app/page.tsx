"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  video_url?: string;
  duration?: number;
}

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const supabase = createClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
      fetchTasks();
    }
    init();
  }, []);

  async function fetchTasks() {
    const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, userId }),
      });

      const result = await res.json();

      if (res.ok) {
        setTitle("");
        fetchTasks();
      } else {
        alert("Помилка створення задачі: " + (result.error || "Невідома помилка"));
      }
    } catch (err: any) {
      alert("Мережева помилка при створенні: " + err.message);
    }
  }

  async function handleVideoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || !e.target.files[0] || !selectedTask) return;
    const file = e.target.files[0];
    setUploading(true);
    setUploadStatus("1/3 Відправка файлу в Supabase Storage...");

    try {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${selectedTask.id}/${Date.now()}_${cleanFileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error("Supabase Storage Error:", uploadError);
        alert("Помилка завантаження файлу в Storage: " + uploadError.message);
        setUploading(false);
        setUploadStatus("");
        return;
      }

      setUploadStatus("2/3 Отримання публічного посилання...");
      const { data: { publicUrl } } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath);

      console.log("Uploaded Public URL:", publicUrl);

      setUploadStatus("3/3 Оновлення статусу задачи та відправка сповіщення...");
      const res = await fetch("/api/upload-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTask.id, videoUrl: publicUrl }),
      });

      const updatedTask = await res.json();

      if (res.ok) {
        setSelectedTask(updatedTask);
        setUploadStatus("Успішно завантажено!");
        await fetchTasks();
      } else {
        alert("Помилка API при збереженні відео: " + (updatedTask.error || "Невідома помилка"));
      }
    } catch (err: any) {
      console.error("Upload Catch Error:", err);
      alert("Помилка завантаження: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  const columns: Task["status"][] = ["todo", "in_progress", "review", "done"];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">AI Video Automation — Kanban</h1>

      <form onSubmit={handleAddTask} className="flex gap-4 mb-8">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Назва нової відео-задачі..."
          className="px-4 py-2 bg-slate-800 rounded border border-slate-700 w-80 text-white"
        />
        <button type="submit" className="px-6 py-2 bg-blue-600 rounded font-medium hover:bg-blue-500">
          Додати задачу
        </button>
      </form>

      <div className="grid grid-cols-4 gap-4">
        {columns.map((col) => (
          <div key={col} className="bg-slate-800 p-4 rounded-lg min-h-[400px]">
            <h2 className="text-xl font-semibold capitalize mb-4">{col.replace("_", " ")}</h2>
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
                    {task.video_url && <p className="text-xs text-green-400 mt-2">📹 Відео завантажено</p>}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modal for Video Upload & Preview */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 p-6 rounded-lg max-w-lg w-full border border-slate-700 shadow-xl">
            <h3 className="text-xl font-bold mb-2">{selectedTask.title}</h3>
            <p className="text-sm text-slate-400 mb-4">
              Статус: <span className="text-blue-400 uppercase font-semibold">{selectedTask.status}</span>
            </p>

            {selectedTask.video_url ? (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2 text-green-400">📹 Перегляд завантаженого відео:</p>
                <video controls src={selectedTask.video_url} className="w-full rounded border border-slate-700 max-h-60" />
                <div className="mt-4 p-3 bg-slate-900 rounded border border-slate-700 text-xs text-slate-400 break-all">
                  <p className="font-semibold text-slate-300 mb-1">Direct URL:</p>
                  <a href={selectedTask.video_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                    {selectedTask.video_url}
                  </a>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Завантажити відео (.mp4):</label>
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
              <p className={`text-sm mb-4 font-medium ${uploading ? "text-yellow-400" : "text-green-400"}`}>
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
