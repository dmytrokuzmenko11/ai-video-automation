"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";

interface Scene {
  start: number;
  end: number;
  duration: number;
  thumbnail_url?: string | null;
}

interface TimelineSceneMapping {
  scene: Scene;
  sceneIndex: number;
  timelineStart: number;
  timelineEnd: number;
  timelineDuration: number;
  sourceStart: number;
  sourceEnd: number;
  sourceTime: number;
  offset: number;
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
  render_completed_at?: string | null;
  created_at: string;
}

interface CommentItem {
  id: string;
  task_id: string;
  author_name: string;
  content: string;
  reactions: Record<string, number>;
  created_at: string;
  updated_at: string;
}

interface CommentApiResponse {
  comments?: CommentItem[];
  comment?: CommentItem;
  error?: string;
}

const COMMENT_REACTIONS = ["👍", "❤️", "😂", "👀", "🚀"];

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
    thumbnail_url: scene.thumbnail_url ?? null,
  }));
}

function getRulerInterval(duration: number): number {
  if (duration <= 10) return 1;
  if (duration <= 30) return 5;
  if (duration <= 120) return 10;
  if (duration <= 300) return 15;
  return 30;
}

function SceneThumbnail({
  thumbnailUrl,
}: {
  thumbnailUrl?: string | null;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-black">
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt="Scene thumbnail"
          className="h-full w-full object-cover"
          onError={(event) => {
            console.error("Scene thumbnail failed to load:", event.currentTarget.src);
          }}
          loading="lazy"
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950" />
      )}
    </div>
  );
}

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const [versions, setVersions] = useState<VideoVersion[]>([]);
  const [activeVersion, setActiveVersion] =
    useState<VideoVersion | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentName, setCommentName] = useState("");
  const [commentContent, setCommentContent] = useState("");
  const [selectedCommentReactions, setSelectedCommentReactions] = useState<string[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const [draggedSceneIndex, setDraggedSceneIndex] =
    useState<number | null>(null);

  const [creatingVersion, setCreatingVersion] = useState(false);
  const [renderingVersion, setRenderingVersion] = useState(false);
  const [renderSuccessVersionId, setRenderSuccessVersionId] = useState<
    string | null
  >(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveVersionIdRef = useRef<string | null>(null);
  const [acceptedVersionTaskId, setAcceptedVersionTaskId] = useState<string | null>(null);
  const [renderPlaybackTime, setRenderPlaybackTime] = useState(0);
  const [isRenderPlaying, setIsRenderPlaying] = useState(false);
  const [playheadPosition, setPlayheadPosition] = useState(0);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [initialTimelineScale, setInitialTimelineScale] = useState(1);

  const renderVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const playheadIndicatorRef = useRef<HTMLDivElement | null>(null);
  const playheadHandleRef = useRef<HTMLDivElement | null>(null);
  const renderPlaybackTimeRef = useRef(0);
  const virtualTimelineTimeRef = useRef(0);
  const activeSceneIndexRef = useRef<number | null>(null);
  const activeSceneTimelineStartRef = useRef(0);
  const sceneTransitionLockRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const scrubSeekInFlightRef = useRef(false);
  const videoFrameRequestIdRef = useRef<number | null>(null);
  const animationFrameRequestIdRef = useRef<number | null>(null);
  const initialTimelineFitAppliedRef = useRef(false);

  const supabase = createClient();

  function getNormalizedTimelinePosition(clientX: number) {
    const timeline = timelineTrackRef.current;

    if (!timeline) return 0;

    const rect = timeline.getBoundingClientRect();

    if (rect.width <= 0) return 0;

    const normalized = (clientX - rect.left) / rect.width;

    return Math.min(1, Math.max(0, normalized));
  }

  function updatePlayheadDomPosition(position: number) {
    const clampedPosition = Math.min(1, Math.max(0, position));
    const translateX = `${clampedPosition * 100}%`;

    if (playheadIndicatorRef.current) {
      playheadIndicatorRef.current.style.left = translateX;
    }

    if (playheadHandleRef.current) {
      playheadHandleRef.current.style.left = translateX;
    }
  }

  function getTotalTimelineDuration(scenes: Scene[]): number {
    return scenes.reduce((sum, scene) => sum + scene.duration, 0);
  }

  function buildTimelineSceneMappings(scenes: Scene[]): TimelineSceneMapping[] {
    let timelineStart = 0;

    return scenes.map((scene, sceneIndex) => {
      const timelineDuration = Math.max(0, scene.end - scene.start);
      const timelineEnd = timelineStart + timelineDuration;
      const mapping: TimelineSceneMapping = {
        scene,
        sceneIndex,
        timelineStart,
        timelineEnd,
        timelineDuration,
        sourceStart: scene.start,
        sourceEnd: scene.end,
        sourceTime: scene.start,
        offset: 0,
      };

      timelineStart = timelineEnd;

      return mapping;
    });
  }

  function findTimelineMappingAtTime(
    timelineTime: number,
    scenes: Scene[] = activeVersion?.scenes ?? []
  ): TimelineSceneMapping | null {
    const mappings = buildTimelineSceneMappings(scenes);

    if (!mappings.length) return null;

    const totalDuration = mappings[mappings.length - 1].timelineEnd;
    const clampedTime = Math.min(Math.max(timelineTime, 0), totalDuration);

    for (let index = 0; index < mappings.length; index += 1) {
      const mapping = mappings[index];
      const isLast = index === mappings.length - 1;
      const withinRange =
        clampedTime >= mapping.timelineStart &&
        (clampedTime < mapping.timelineEnd || (isLast && clampedTime <= mapping.timelineEnd));

      if (!withinRange) continue;

      const offset = Math.min(
        mapping.timelineDuration,
        Math.max(0, clampedTime - mapping.timelineStart)
      );

      return {
        ...mapping,
        offset,
        sourceTime: Math.min(mapping.sourceEnd, mapping.sourceStart + offset),
      };
    }

    return mappings[mappings.length - 1] ?? null;
  }

  function sourceTimeToTimelineTime(
    sourceTime: number,
    scenes: Scene[] = activeVersion?.scenes ?? []
  ): number {
    const mappings = buildTimelineSceneMappings(scenes);

    if (!mappings.length) return 0;

    let fallbackTimelineTime = 0;

    for (const mapping of mappings) {
      fallbackTimelineTime = mapping.timelineEnd;

      if (sourceTime < mapping.sourceStart || sourceTime > mapping.sourceEnd) {
        continue;
      }

      const offset = Math.min(
        mapping.timelineDuration,
        Math.max(0, sourceTime - mapping.sourceStart)
      );

      return mapping.timelineStart + offset;
    }

    return fallbackTimelineTime;
  }

  function getSceneProgressWithinTimeline(
    timelineTime: number,
    scenes: Scene[] = activeVersion?.scenes ?? []
  ) {
    const mapping = findTimelineMappingAtTime(timelineTime, scenes);

    if (!mapping) {
      return {
        mapping: null as TimelineSceneMapping | null,
        timelineTime: 0,
        sourceTime: 0,
      };
    }

    return {
      mapping,
      timelineTime: mapping.timelineStart + mapping.offset,
      sourceTime: mapping.sourceTime,
    };
  }

  function seekToTimelineTime(timelineTime: number, shouldPlay = false) {
    const video = renderVideoRef.current;
    const scenes = activeVersion?.scenes ?? [];
    const mapping = findTimelineMappingAtTime(timelineTime, scenes);

    if (!video || !mapping) return;

    const duration = getTotalTimelineDuration(scenes);
    const clampedTimelineTime = Math.min(Math.max(timelineTime, 0), duration);

    virtualTimelineTimeRef.current = clampedTimelineTime;
    renderPlaybackTimeRef.current = mapping.sourceTime;
    activeSceneIndexRef.current = mapping.sceneIndex;
    videoFrameRequestIdRef.current = null;
    video.currentTime = mapping.sourceTime;
    syncPlayheadToVideoTime(mapping.sourceTime, duration || video.duration);

    if (shouldPlay) {
      if (video.paused || video.ended) {
        void video.play();
      }
    }
  }

  function getTimelineStateFromSourceTime(sourceTime: number) {
    const scenes = activeVersion?.scenes ?? [];
    const mappings = buildTimelineSceneMappings(scenes);

    if (!mappings.length) {
      return null;
    }

    const currentIndex = activeSceneIndexRef.current;
    const currentMapping = currentIndex !== null ? mappings[currentIndex] : null;

    if (currentMapping && sourceTime >= currentMapping.sourceStart - 0.001) {
      const localOffset = Math.max(0, Math.min(currentMapping.timelineDuration, sourceTime - currentMapping.sourceStart));
      const timelineTime = currentMapping.timelineStart + localOffset;

      if (sourceTime <= currentMapping.sourceEnd + 0.02) {
        return {
          sceneIndex: currentMapping.sceneIndex,
          timelineTime,
          sourceTime,
          scene: currentMapping.scene,
          timelineStart: currentMapping.timelineStart,
          timelineEnd: currentMapping.timelineEnd,
        };
      }
    }

    for (let index = 0; index < mappings.length; index += 1) {
      const mapping = mappings[index];

      if (sourceTime < mapping.sourceStart - 0.001 || sourceTime > mapping.sourceEnd + 0.02) {
        continue;
      }

      const localOffset = Math.max(0, Math.min(mapping.timelineDuration, sourceTime - mapping.sourceStart));
      return {
        sceneIndex: mapping.sceneIndex,
        timelineTime: mapping.timelineStart + localOffset,
        sourceTime,
        scene: mapping.scene,
        timelineStart: mapping.timelineStart,
        timelineEnd: mapping.timelineEnd,
      };
    }

    return null;
  }

  function setAuthoritativePlaybackState(sceneIndex: number, timelineStart: number, timelineTime: number) {
    activeSceneIndexRef.current = sceneIndex;
    activeSceneTimelineStartRef.current = timelineStart;
    virtualTimelineTimeRef.current = timelineTime;
  }

  function updatePlayheadForTimelineTime(timelineTime: number, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;

    const normalizedPosition = Math.min(Math.max(timelineTime / duration, 0), 1);
    setPlayheadPosition(normalizedPosition);
    updatePlayheadDomPosition(normalizedPosition);
  }

  function syncPlayheadToVideoTime(mediaTime: number, duration: number) {
    syncVirtualTimelineFromSource(mediaTime, duration);
  }

  function syncVirtualTimelineFromSource(sourceTime: number, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const state = getTimelineStateFromSourceTime(sourceTime);
    if (!state) return;
    setAuthoritativePlaybackState(state.sceneIndex, state.timelineStart, state.timelineTime);
    updatePlayheadForTimelineTime(state.timelineTime, duration);
  }

  function advancePlaybackIfNeeded(video: HTMLVideoElement, mediaTime: number) {
    const scenes = activeVersion?.scenes ?? [];
    if (!scenes.length || !Number.isFinite(video.duration) || video.duration <= 0) return;

    const currentIndex = activeSceneIndexRef.current;
    if (currentIndex === null) return;

    const mappings = buildTimelineSceneMappings(scenes);
    const currentMapping = mappings[currentIndex];
    if (!currentMapping) return;

    const tolerance = 0.02;
    if (sceneTransitionLockRef.current) {
      return;
    }

    if (mediaTime < currentMapping.sourceEnd - tolerance) {
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= mappings.length) {
      setAuthoritativePlaybackState(currentMapping.sceneIndex, currentMapping.timelineStart, currentMapping.timelineEnd);
      updatePlayheadForTimelineTime(currentMapping.timelineEnd, getTotalTimelineDuration(scenes));
      return;
    }

    const nextMapping = mappings[nextIndex];
    if (!nextMapping) return;

    sceneTransitionLockRef.current = true;
    setAuthoritativePlaybackState(nextMapping.sceneIndex, nextMapping.timelineStart, nextMapping.timelineStart);
    renderPlaybackTimeRef.current = nextMapping.sourceStart;
    virtualTimelineTimeRef.current = nextMapping.timelineStart;
    video.currentTime = nextMapping.sourceStart;

    const releaseLock = () => {
      sceneTransitionLockRef.current = false;
      video.removeEventListener("seeked", releaseLock);
    };

    video.addEventListener("seeked", releaseLock, { once: true });
  }

  function syncPlayheadToNormalizedPosition(position: number) {
    setPlayheadPosition(position);
    updatePlayheadDomPosition(position);
  }

  function seekVideoToNormalizedPosition(position: number) {
    const video = renderVideoRef.current;

    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }

    const timelineDuration = getTotalTimelineDuration(activeVersion?.scenes ?? []);
    const clampedPosition = Math.min(1, Math.max(0, position));
    const targetTimelineTime = clampedPosition * timelineDuration;
    const targetMapping = findTimelineMappingAtTime(targetTimelineTime);
    const targetTime = targetMapping?.sourceTime ?? 0;

    renderPlaybackTimeRef.current = targetTime;
    virtualTimelineTimeRef.current = targetTimelineTime;
    scrubSeekInFlightRef.current = true;
    videoFrameRequestIdRef.current = null;
    video.currentTime = targetTime;
    syncPlayheadToVideoTime(targetTime, timelineDuration || video.duration);

    window.setTimeout(() => {
      scrubSeekInFlightRef.current = false;
    }, 0);
  }

  function splitSceneAtPlayhead() {
    if (!activeVersion?.scenes?.length) return false;

    const timeline = timelineTrackRef.current;
    const playhead = playheadIndicatorRef.current;
    const sceneElements = timeline?.querySelectorAll<HTMLElement>(
      "[data-scene-index]"
    );

    if (!timeline || !playhead || !sceneElements?.length) return false;

    const playheadRect = playhead.getBoundingClientRect();

    if (playheadRect.width <= 0) return false;

    const playheadCenterX = playheadRect.left + playheadRect.width / 2;
    const timelineTime = virtualTimelineTimeRef.current;
    const mapping = findTimelineMappingAtTime(timelineTime);
    if (!mapping) return false;

    for (const sceneElement of Array.from(sceneElements)) {
      const index = Number(sceneElement.dataset.sceneIndex);

      if (!Number.isInteger(index)) continue;

      const scene = activeVersion.scenes[index];

      if (!scene) continue;

      const sceneRect = sceneElement.getBoundingClientRect();

      if (playheadCenterX < sceneRect.left || playheadCenterX > sceneRect.right) {
        continue;
      }

      if (playheadCenterX <= sceneRect.left + 0.0001 || playheadCenterX >= sceneRect.right - 0.0001) {
        return false;
      }

      if (scene.duration <= 0.0002 || sceneRect.width <= 0) {
        return false;
      }

      const localPixelOffset = playheadCenterX - sceneRect.left;
      const localNormalized = Math.min(1, Math.max(0, localPixelOffset / sceneRect.width));
      const localTimelinePosition = localNormalized * scene.duration;
      const sourceSplitTime = scene.start + localTimelinePosition;
      const firstDuration = sourceSplitTime - scene.start;
      const secondDuration = scene.end - sourceSplitTime;

      if (firstDuration <= 0.0001 || secondDuration <= 0.0001) {
        return false;
      }

      const firstScene = {
        ...scene,
        end: Number(sourceSplitTime.toFixed(3)),
        duration: Number(firstDuration.toFixed(3)),
        thumbnail_url: null,
      };

      const secondScene = {
        ...scene,
        start: Number(sourceSplitTime.toFixed(3)),
        duration: Number(secondDuration.toFixed(3)),
        thumbnail_url: null,
      };

      const nextScenes = [
        ...activeVersion.scenes.slice(0, index),
        firstScene,
        secondScene,
        ...activeVersion.scenes.slice(index + 1),
      ];

      setActiveVersion({
        ...activeVersion,
        scenes: nextScenes,
      });

      return true;
    }

    return false;
  }

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handlePointerMove = (event: PointerEvent) => {
      const nextPosition = getNormalizedTimelinePosition(event.clientX);
      setPlayheadPosition(nextPosition);
      updatePlayheadDomPosition(nextPosition);

      seekVideoToNormalizedPosition(nextPosition);
    };

    const handlePointerUp = () => {
      const video = renderVideoRef.current;

      if (video) {
        const finalTime = renderPlaybackTimeRef.current;

        isScrubbingRef.current = false;
        scrubSeekInFlightRef.current = true;
        videoFrameRequestIdRef.current = null;
        video.currentTime = finalTime;

        window.setTimeout(() => {
          scrubSeekInFlightRef.current = false;
        }, 0);

        syncPlayheadToVideoTime(finalTime, video.duration);

        if (wasPlayingBeforeScrubRef.current) {
          void video.play().catch((error) => {
            console.error("Resume render video after scrub error:", error);
          });
        }
      } else {
        isScrubbingRef.current = false;
      }

      setIsDraggingPlayhead(false);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDraggingPlayhead]);

  useEffect(() => {
    initialTimelineFitAppliedRef.current = false;
    setInitialTimelineScale(1);
  }, [selectedTask?.id, activeVersion?.id]);

  useEffect(() => {
    if (!selectedTask || !activeVersion || initialTimelineFitAppliedRef.current) {
      return;
    }

    const timeline = timelineTrackRef.current;

    if (!timeline) return;

    const availableWidth = timeline.clientWidth;

    if (availableWidth <= 0) return;

    const totalDuration = activeVersion.scenes.reduce(
      (sum, scene) => sum + scene.duration,
      0
    );

    if (totalDuration <= 0) return;

    const minSceneWidth = 120;
    const gapWidth = 4;
    const gapCount = Math.max(activeVersion.scenes.length - 1, 0);
    const contentWidth =
      minSceneWidth * activeVersion.scenes.length + gapWidth * gapCount;
    const scale = Math.min(1, availableWidth / contentWidth);

    initialTimelineFitAppliedRef.current = true;
    setInitialTimelineScale(scale);
  }, [activeVersion, selectedTask]);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingField =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable;

      if (isTypingField) return;

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key.toLowerCase() === "s") {
        if (!selectedTask || !activeVersion?.scenes?.length) return;

        const didSplit = splitSceneAtPlayhead();

        if (didSplit) {
          event.preventDefault();
        }

        return;
      }

      const isSpace = event.key === " " || event.code === "Space";

      if (!isSpace || !selectedTask) return;

      event.preventDefault();

      await toggleRenderPlayback();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedTask, toggleRenderPlayback]);

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

  async function acceptVersion() {
    if (!selectedTask || selectedTask.status !== "review") return;
    await updateSelectedTaskStatus(selectedTask.id, "done", {
      onSuccess: () => setAcceptedVersionTaskId(selectedTask.id),
      errorMessage: "Error accepting version.",
      logLabel: "Accept version",
      alertLabel: "Error accepting version: ",
    });
  }

  async function sendTaskToReview() {
    if (!selectedTask || selectedTask.status !== "in_progress") return;

    await updateSelectedTaskStatus(selectedTask.id, "review", {
      errorMessage: "Error sending task to review.",
      logLabel: "Send to review",
      alertLabel: "Error sending task to review: ",
    });
  }

  async function updateSelectedTaskStatus(
    taskId: string,
    status: Task["status"],
    options?: {
      onSuccess?: () => void;
      errorMessage?: string;
      logLabel?: string;
      alertLabel?: string;
    }
  ) {
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId,
          status,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(
          `${options?.alertLabel ?? "Error updating task status: "}${result.error || "Unknown error"}`
        );
        return;
      }

      setSelectedTask((current) =>
        current && current.id === taskId ? { ...current, status } : current
      );

      setTasks((current) =>
        current.map((task) => (task.id === taskId ? { ...task, status } : task))
      );

      options?.onSuccess?.();
    } catch (error) {
      console.error(`${options?.logLabel ?? "Update task status"} error:`, error);
      alert(options?.errorMessage ?? "Error updating task status.");
    }
  }

  const canDownloadActiveRender = !!activeVersion?.render_url;

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

      if (loadedVersions.length === 0) {
        const scenesToUse =
          fallbackScenes && fallbackScenes.length > 0
            ? fallbackScenes
            : selectedTask?.scenes && selectedTask.scenes.length > 0
              ? selectedTask.scenes
              : null;

        if (!scenesToUse) {
          setVersions([]);
          setActiveVersion(null);
          return;
        }

        const createRes = await fetch("/api/versions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId,
            scenes: scenesToUse,
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

        loadedVersions = [createResult.version as VideoVersion];
      }

      const sortedVersions = [...loadedVersions].sort(
        (a, b) => a.version_number - b.version_number
      );

      setVersions(sortedVersions);

      if (sortedVersions.length > 0) {
        const nextActiveVersion =
          sortedVersions.find((version) => version.id === activeVersion?.id) ??
          sortedVersions[sortedVersions.length - 1] ??
          null;

        setActiveVersion(nextActiveVersion);
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
    setComments([]);
    setCommentName("");
    setCommentContent("");
    setSelectedCommentReactions([]);
    setCommentError(null);

    if (task.video_url) {
      await fetchVersions(task.id, task.scenes);
    }

    if (task.status === "review" || task.status === "done") {
      await fetchComments(task.id);
    }
  }

  async function fetchComments(taskId: string) {
    setCommentLoading(true);
    setCommentError(null);

    try {
      const res = await fetch(`/api/comments?taskId=${encodeURIComponent(taskId)}`);
      const result = (await res.json()) as CommentApiResponse;

      if (res.ok) {
        setComments((result.comments ?? []) as CommentItem[]);
      } else {
        setComments([]);
        setCommentError(result.error || "Failed to load comments.");
      }
    } catch (error) {
      console.error("Fetch comments error:", error);
      setComments([]);
      setCommentError("Failed to load comments. Please try again.");
    } finally {
      setCommentLoading(false);
    }
  }

  async function submitComment() {
    if (!selectedTask) return;

    const name = commentName.trim();
    const content = commentContent.trim();

    if (!name || !content) return;

    if (commentSubmitting) return;

    setCommentSubmitting(true);
    setCommentError(null);

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTask.id,
          authorName: name,
          content,
          reactions: selectedCommentReactions.reduce<Record<string, number>>((acc, emoji) => {
            acc[emoji] = 1;
            return acc;
          }, {}),
        }),
      });

      const result = (await res.json()) as CommentApiResponse;

      if (!res.ok) {
        setCommentError(result.error || "Не вдалося створити коментар.");
        return;
      }

      if (result.comment) {
        setComments((current) => [...current, result.comment as CommentItem]);
      } else {
        await fetchComments(selectedTask.id);
      }
      setCommentContent("");
      setSelectedCommentReactions([]);
      setCommentName(name);
    } catch (error) {
      console.error("Submit comment error:", error);
      setCommentError("Не вдалося створити коментар. Спробуйте ще раз.");
    } finally {
      setCommentSubmitting(false);
    }
  }


  async function deleteTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);

    if (!task) return;

    const confirmed = window.confirm(
      `Delete task "${task.title}"? This action cannot be undone.`
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
          "Error deleting task: " +
            (result.error || "Unknown error")
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
      alert("Error deleting task.");
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
          "Error creating task: " +
            (result.error || "Unknown error")
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";

      alert("Network error while creating task: " + message);
    }
  }

  async function handleVideoUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    if (!selectedTask) {
      alert("Please select a task before uploading a video.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setUploadStatus("1/3 Uploading file to Supabase Storage...");

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
        console.error("Supabase Storage upload error:", uploadError);
        alert(
          "Error uploading file to Storage: " +
            uploadError.message
        );

        return;
      }

      setUploadStatus(
        "2/3 Getting public link..."
      );

      const {
        data: { publicUrl },
      } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath);

      setUploadStatus(
        "3/3 Analyzing video and detecting scenes..."
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

        const completedScenes =
          Array.isArray(result.scenes) && result.scenes.length > 0
            ? result.scenes
            : Array.isArray(result.data?.scenes) && result.data.scenes.length > 0
              ? result.data.scenes
              : [];

        if (completedScenes.length > 0) {
          await fetchVersions(selectedTask.id, completedScenes);
        }

        setUploadStatus(
          `Done. Created V1 with ${
            completedScenes.length
          } scenes.`
        );

        await fetchTasks();
      } else {
        console.error("Upload video API error:", result);
        alert("API error: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Video upload flow error:", err);
      const message =
        err instanceof Error ? err.message : "Невідома помилка";

      alert("Upload error: " + message);
    } finally {
      setUploading(false);
      e.target.value = "";
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

      const insertedVersions = [...versions, newVersion].sort(
        (a, b) => a.version_number - b.version_number
      );

      setVersions(insertedVersions);
      setActiveVersion(newVersion);

    } catch (error) {
      console.error("Create version error:", error);

      alert("Помилка створення нової версії.");
    } finally {
      setCreatingVersion(false);
    }
  }

  const canRenderActiveVersion =
    !!activeVersion &&
    !renderingVersion &&
    activeVersion.scenes.length > 0;

  function scheduleVersionAutosave(nextVersion: VideoVersion) {
    autosaveVersionIdRef.current = nextVersion.id;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void persistVersionScenes(nextVersion.id, nextVersion.scenes);
    }, 600);
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
    scene.thumbnail_url = null;

    scenes[index] = scene;

    setActiveVersion({
      ...activeVersion,
      scenes,
    });

    scheduleVersionAutosave({
      ...activeVersion,
      scenes,
    });
  }

  async function persistVersionScenes(versionId: string, scenes: Scene[]) {
    if (!versionId) return;

    try {
      const res = await fetch("/api/versions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          versionId,
          scenes: normalizeScenes(scenes),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        console.error("Persist version scenes failed:", result.error);
        return;
      }

      const updatedVersion = result.version as VideoVersion;

      if (autosaveVersionIdRef.current !== versionId) {
        return;
      }

      setActiveVersion((current) =>
        current && current.id === updatedVersion.id ? updatedVersion : current
      );
      setVersions((current) =>
        current
          .map((version) =>
            version.id === updatedVersion.id ? updatedVersion : version
          )
          .sort((a, b) => a.version_number - b.version_number)
      );
    } catch (error) {
      console.error("Persist version scenes error:", error);
    }
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

    scheduleVersionAutosave(updatedVersion);

  }

  useEffect(() => {
    const video = renderVideoRef.current;

    if (!video) {
      return;
    }

    const cancelFrameLoop = () => {
      if (videoFrameRequestIdRef.current !== null) {
        if (typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(videoFrameRequestIdRef.current);
        }
        videoFrameRequestIdRef.current = null;
      }

      if (animationFrameRequestIdRef.current !== null) {
        cancelAnimationFrame(animationFrameRequestIdRef.current);
        animationFrameRequestIdRef.current = null;
      }
    };

    const scheduleVideoFrameSync = () => {
      cancelFrameLoop();

      if (typeof video.requestVideoFrameCallback === "function") {
        const handleVideoFrame = (
          _now: number,
          metadata: VideoFrameCallbackMetadata
        ) => {
          videoFrameRequestIdRef.current = null;

          if (!isScrubbingRef.current) {
            const state = getTimelineStateFromSourceTime(metadata.mediaTime);

            if (state) {
              if (
                activeSceneIndexRef.current !== state.sceneIndex ||
                metadata.mediaTime < renderPlaybackTimeRef.current - 0.04 ||
                metadata.mediaTime < state.scene.start - 0.04
              ) {
                setAuthoritativePlaybackState(
                  state.sceneIndex,
                  state.timelineStart,
                  state.timelineTime
                );
              } else {
                renderPlaybackTimeRef.current = metadata.mediaTime;
                virtualTimelineTimeRef.current =
                  state.timelineStart +
                  Math.max(0, Math.min(state.scene.duration, metadata.mediaTime - state.scene.start));
                activeSceneIndexRef.current = state.sceneIndex;
                activeSceneTimelineStartRef.current = state.timelineStart;
              }

              updatePlayheadForTimelineTime(
                virtualTimelineTimeRef.current,
                video.duration
              );
            }

            advancePlaybackIfNeeded(video, metadata.mediaTime);
          }

          if (!video.paused && !video.ended) {
            videoFrameRequestIdRef.current = video.requestVideoFrameCallback(
              handleVideoFrame
            );
          }
        };

        videoFrameRequestIdRef.current = video.requestVideoFrameCallback(
          handleVideoFrame
        );

        return;
      }

      const handleAnimationFrame = () => {
        animationFrameRequestIdRef.current = null;

        advancePlaybackIfNeeded(video, video.currentTime);
        syncVirtualTimelineFromSource(video.currentTime, video.duration);

        if (!video.paused && !video.ended) {
          animationFrameRequestIdRef.current = requestAnimationFrame(
            handleAnimationFrame
          );
        }
      };

      animationFrameRequestIdRef.current = requestAnimationFrame(
        handleAnimationFrame
      );
    };

    const handlePlay = () => {
      setIsRenderPlaying(true);
      const scenes = activeVersion?.scenes ?? [];
      const timelineState = getTimelineStateFromSourceTime(video.currentTime);

      if (timelineState) {
        setAuthoritativePlaybackState(
          timelineState.sceneIndex,
          timelineState.timelineStart,
          timelineState.timelineTime
        );
      } else {
        const timelineTime =
          virtualTimelineTimeRef.current > 0
            ? virtualTimelineTimeRef.current
            : sourceTimeToTimelineTime(video.currentTime, scenes);
        seekToTimelineTime(timelineTime, false);
      }
      scheduleVideoFrameSync();
    };

    const handlePause = () => {
      setIsRenderPlaying(false);
      syncVirtualTimelineFromSource(video.currentTime, getTotalTimelineDuration(activeVersion?.scenes ?? []));
      cancelFrameLoop();
    };

    const handleLoadedMetadata = () => {
      syncVirtualTimelineFromSource(video.currentTime, video.duration);
    };

    const handleSeeked = () => {
      if (scrubSeekInFlightRef.current) {
        return;
      }

      syncVirtualTimelineFromSource(video.currentTime, getTotalTimelineDuration(activeVersion?.scenes ?? []));
      sceneTransitionLockRef.current = false;
    };

    setIsRenderPlaying(!video.paused && !video.ended);
    syncVirtualTimelineFromSource(video.currentTime, getTotalTimelineDuration(activeVersion?.scenes ?? []));

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("seeked", handleSeeked);

    if (!video.paused && !video.ended) {
      scheduleVideoFrameSync();
    }

    return () => {
      cancelFrameLoop();
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [activeVersion?.id, activeVersion?.render_url, isDraggingPlayhead]);

  async function toggleRenderPlayback() {
    const video = renderVideoRef.current;

    if (!video) return;

    if (video.paused || video.ended) {
      try {
        const playPromise = video.play();

        if (playPromise) {
          await playPromise;
        }
      } catch (error) {
        console.error("Play render video error:", error);
      }
    } else {
      video.pause();
    }
  }

  useEffect(() => {
    renderPlaybackTimeRef.current = 0;
    syncPlayheadToNormalizedPosition(0);
  }, [activeVersion?.id]);

async function renderVersion() {
    if (!activeVersion) return;

    setRenderingVersion(true);
    setRenderSuccessVersionId(null);
    setUploadStatus("");

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
        {
          ...(result.version as VideoVersion),
          render_url: result.renderUrl ?? (result.version as VideoVersion).render_url ?? null,
        } as VideoVersion;

      const updatedTask = result.task as Task | undefined;
      const nextTaskStatus = updatedTask?.status === "review" ? "review" : updatedTask?.status;

      setActiveVersion(renderedVersion);

      setRenderSuccessVersionId(renderedVersion.id);

      window.setTimeout(() => {
        setRenderSuccessVersionId(null);
      }, 1000);

      setVersions((current) =>
        current.map((version) =>
          version.id === renderedVersion.id
            ? renderedVersion
            : version
        )
      );

      if (updatedTask) {
        setTasks((current) =>
          current.map((task) =>
            task.id === updatedTask.id
              ? {
                  ...task,
                  ...updatedTask,
                  status: nextTaskStatus ?? task.status,
                }
              : task
          )
        );

        setSelectedTask((current) =>
          current && current.id === updatedTask.id
            ? {
                ...current,
                ...updatedTask,
                status: nextTaskStatus ?? current.status,
              }
            : current
        );
      }

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
    <div className="min-h-screen bg-[#09090b] px-5 py-4 text-zinc-100">
      <div className="mb-5 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          AI Video Automation — Kanban
        </h1>

        <a
          href="/admin"
          className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
        >
          Admin
        </a>
      </div>

      <form
        onSubmit={handleAddTask}
        className="mb-5 flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New video task title..."
          className="h-9 w-[22rem] rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500/60"
        />

        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 hover:text-emerald-200"
        >
          Add task
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              className="min-h-[280px] rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
            >
              <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-zinc-400">
                {columnTitle}
              </h2>

              <div className="space-y-2">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => selectTask(task)}
                    className="flex h-[92px] cursor-pointer items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-4 transition hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <p className="text-sm font-medium text-zinc-100">
                      {task.title}
                    </p>
                  </div>
                ))}

                {columnTasks.length === 0 && (
                  <p className="text-sm text-zinc-500">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
              <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/80 p-3 sm:p-4 backdrop-blur-[1px]">
                <div className={`max-h-[94vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/95 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.45)] sm:p-5 ${selectedTask.status === "todo" ? "w-[50vw] min-w-[50vw] max-w-[50vw]" : "w-[min(98vw,1600px)]"}`}>
            <div className="flex items-start justify-between gap-4 mb-2">
                <h3 className="text-base font-semibold text-zinc-100">
                {selectedTask.title}
              </h3>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => deleteTask(selectedTask.id)}
                  aria-label="Delete task"
                  title="Delete task"
                  className="shrink-0 rounded-md p-2 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100"
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
                      d="M6 6l1 14h10l1-14"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 11v6M14 11v6"
                    />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedTask(null);
                    setVersions([]);
                    setActiveVersion(null);
                    setUploadStatus("");
                  }}
                  aria-label="Close"
                  title="Close"
                  className="shrink-0 rounded-md p-2 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100"
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

            <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
              <p>
                Статус:{" "}
                <span className="text-blue-400 uppercase font-semibold">
                  {selectedTask.status === "review" && acceptedVersionTaskId === selectedTask.id
                    ? "done"
                    : selectedTask.status}
                </span>
              </p>

              {selectedTask.status === "in_progress" && (
                <button
                  type="button"
                  onClick={sendTaskToReview}
                  className="inline-flex h-8 items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                >
                  Send to Review
                </button>
              )}
              {selectedTask.status === "review" && acceptedVersionTaskId !== selectedTask.id && (
                <button
                  type="button"
                  onClick={acceptVersion}
                  className="inline-flex h-8 items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                >
                  Accept version
                </button>
              )}
              {acceptedVersionTaskId === selectedTask.id && selectedTask.status === "done" && (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-8 items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-sm font-medium text-emerald-300 opacity-100"
                >
                  Прийнято
                </button>
              )}
            </div>

            {selectedTask.video_url && (
              <p className="relative text-sm text-slate-400 mb-4">
                Тривалість відео:{" "}
                <span className="text-slate-200 font-medium">
                  {(selectedTask.duration || 0).toFixed(1)} с
                </span>
              </p>
            )}

            {selectedTask.video_url ? (
              <>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(300px,0.8fr)] items-start">
                  <div className="min-w-0 flex flex-col gap-4 self-start">
                  <div className="relative mb-4 rounded-md border border-zinc-800 bg-zinc-950/80 p-4">
                  <div className="relative mb-4 flex items-center justify-between gap-4 flex-nowrap">
                    <div className="relative flex items-center gap-3 shrink-0 whitespace-nowrap">
                      <div className="relative flex min-w-0 items-center gap-2 overflow-hidden">
                        <h4 className="shrink-0 text-lg font-semibold whitespace-nowrap" />

                        {versions.length > 0 ? (
                          <div className="relative flex items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap">
                            {versions.map((version) => (
                              <button
                                key={version.id}
                                type="button"
                                onClick={() => setActiveVersion(version)}
                                className={`shrink-0 px-4 py-2 rounded border font-medium transition ${
                                  activeVersion?.id === version.id
                                    ? "bg-blue-600 border-blue-500 text-white"
                                    : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700"
                                }`}
                              >
                                Vers {version.version_number}
                              </button>
                            ))}
                            {activeVersion && (
                              <button
                                type="button"
                                onClick={createNewVersion}
                                disabled={creatingVersion}
                                className="shrink-0 inline-flex h-10 items-center rounded-md border border-zinc-800 bg-zinc-900/80 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {creatingVersion ? "Створення..." : "+"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400">
                            Версій монтажу ще немає.
                          </p>
                        )}
                      </div>

                      {activeVersion && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={renderVersion}
                            disabled={
                              !canRenderActiveVersion
                            }
                            className={`shrink-0 inline-flex h-10 items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50 ${renderingVersion ? 'render-button-blink' : ''}`}
                            style={renderingVersion ? {
                              animation: 'renderButtonBlink 1.15s ease-in-out infinite',
                              boxShadow: '0 0 0 1px rgba(16, 185, 129, 0.16), 0 0 16px rgba(16, 185, 129, 0.18)',
                            } : undefined}
                          >
                            {renderingVersion
                              ? `Рендеринг V${activeVersion.version_number}...`
                              : renderSuccessVersionId === activeVersion.id
                                ? "Success"
                                : `Рендерити V${activeVersion.version_number}`}
                          </button>

                          {canDownloadActiveRender && (
                            <button
                              type="button"
                              onClick={handleDownloadRender}
                              aria-label={`Download V${activeVersion.version_number}`}
                              title={`Download V${activeVersion.version_number}`}
                              className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/80 text-zinc-200 transition hover:cursor-pointer hover:border-zinc-700 hover:bg-zinc-800"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                              >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" x2="12" y1="15" y2="3" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                      <div className="relative flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={toggleRenderPlayback}
                        aria-label="Play / Pause"
                        title="Play / Pause (Space)"
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 text-zinc-200 transition hover:cursor-pointer hover:border-zinc-700 hover:bg-zinc-800"
                      >
                        {isRenderPlaying ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M6.75 5.75A1.75 1.75 0 0 1 8.5 4h1.5c.966 0 1.75.784 1.75 1.75v12.5A1.75 1.75 0 0 1 10 20h-1.5a1.75 1.75 0 0 1-1.75-1.75V5.75Zm7.25 0A1.75 1.75 0 0 1 15.75 4h1.5A1.75 1.75 0 0 1 19 5.75v12.5A1.75 1.75 0 0 1 17.25 20h-1.5A1.75 1.75 0 0 1 14 18.25V5.75Z" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M8 5.14v13.72a.75.75 0 0 0 1.14.64l10.27-6.86a.75.75 0 0 0 0-1.28L9.14 4.5A.75.75 0 0 0 8 5.14Z" />
                          </svg>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={splitSceneAtPlayhead}
                        aria-label="Cut at Playhead"
                        title="Cut at Playhead (S)"
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 text-zinc-200 transition hover:cursor-pointer hover:border-zinc-700 hover:bg-zinc-800"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="h-4 w-4"
                          aria-hidden="true"
                        >
                          <path d="M15.6 4.2a1 1 0 0 1 1.2.8l.7 3.5c.1.3 0 .7-.2.9l-2.2 2.2 1.7 1.7a2.5 2.5 0 1 1-1.4 1.4l-1.7-1.7-2.1 2.1-.6 2.8a1 1 0 0 1-.8.8l-3.6.7a1 1 0 0 1-1.2-1.2l.7-3.6a1 1 0 0 1 .3-.5l9.7-9.7a1 1 0 0 1 .5-.3Zm-7.2 11.5-.4 2 2-.4 8.7-8.7-.8-1.6-1.6-.8-8.7 8.7Zm4 2.4a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z" />
                        </svg>
                        <span className="text-[11px] font-medium leading-none text-zinc-400">Cut</span>
                      </button>
                    </div>
                  </div>

                      <div className="relative w-full min-w-0 flex flex-col self-start overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 pt-2 pb-4">
                      <div className="mb-0 h-8 shrink-0 rounded-t-md border-b border-zinc-800 bg-zinc-900/30" />
                      <div className="flex items-center justify-between mb-0 shrink-0">
                        <h5 className="text-sm font-semibold text-slate-300"></h5>
                      </div>

                      <div className="relative h-8 shrink-0 mb-0 overflow-hidden border-b border-slate-700/50">
                        {(() => {
                          const duration = selectedTask.duration || 0;
                          const interval = getRulerInterval(duration);
                          const ticks = Math.max(
                            1,
                            Math.floor(duration / interval)
                          );

                          const marks = Array.from({ length: ticks + 1 }, (_, index) => {
                            const time = Math.min(duration, index * interval);
                            const percent =
                              duration > 0 ? (time / duration) * 100 : 0;
                            const isLabel =
                              time === 0 || time === duration ||
                              Number.isInteger(time / interval);

                            return {
                              key: `${time}-${index}`,
                              time,
                              percent,
                              isLabel,
                            };
                          });

                          return marks.map((mark) => (
                            <div
                              key={mark.key}
                              className="absolute top-0 h-full"
                              style={{ left: `${mark.percent}%` }}
                            >
                              <div
                                className={`absolute top-0 left-1/2 -translate-x-1/2 bg-slate-500/70 ${
                                  mark.time % (interval * 5) === 0
                                    ? "h-3 w-px"
                                    : "h-2 w-px"
                                }`}
                              />
                              {mark.isLabel && (
                                <span className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-500">
                                  {`${Math.round(mark.time)}s`}
                                </span>
                              )}
                            </div>
                          ));
                        })()}
                      </div>

                        <div
                        ref={timelineTrackRef}
                        onClick={(e) => {
                          const position = getNormalizedTimelinePosition(
                            e.clientX
                          );
                          seekVideoToNormalizedPosition(position);
                        }}
                            className="relative w-full min-w-0 flex flex-col self-start overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 pt-2 pb-4"
                      >
                        <div
                          ref={playheadIndicatorRef}
                          className="absolute top-[-0.75rem] bottom-0 z-40 w-px bg-emerald-400/90 pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                          style={{
                            left: "0%",
                            transform: "translateX(-50%)",
                          }}
                        />
                        {selectedTask.duration ? (
                          <div
                            className="absolute top-[-1.25rem] left-0 z-30 -translate-x-full text-[11px] text-slate-400 tabular-nums pointer-events-none"
                            style={{ left: "100%" }}
                          >
                            {`${Number(selectedTask.duration.toFixed(1))}s`}
                          </div>
                        ) : null}
                        <div
                          ref={playheadHandleRef}
                          className="absolute top-0 bottom-0 left-0 z-50 cursor-ew-resize"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            const position = getNormalizedTimelinePosition(
                              e.clientX
                            );
                            const video = renderVideoRef.current;

                            wasPlayingBeforeScrubRef.current = !!video && !video.paused && !video.ended;
                            isScrubbingRef.current = true;
                            videoFrameRequestIdRef.current = null;
                            syncPlayheadToNormalizedPosition(position);
                            seekVideoToNormalizedPosition(position);
                            setIsDraggingPlayhead(true);
                          }}
                          style={{ left: "0%" }}
                        >
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px bottom-0 bg-transparent" />
                           <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-sm border border-sky-200/80 bg-gradient-to-b from-sky-200 to-sky-400 shadow-[0_0_0_1px_rgba(15,23,42,0.95),0_1px_2px_rgba(8,15,30,0.35)] pointer-events-none" />
                        </div>
                        <div
                          className="relative flex gap-1 w-full min-w-0"
                          style={{
                            transformOrigin: "left center",
                            width: "100%",
                          }}
                        >
                          {renderingVersion && activeVersion && (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 z-20 overflow-hidden render-progress-overlay"
                            >
                              <div className="render-progress-overlay__shutters" />
                            </div>
                          )}

                          {activeVersion ? (
                            activeVersion.scenes.map((scene, index) => {
                              const total = selectedTask.duration ||
                                activeVersion.scenes.reduce(
                                (sum, s) => sum + s.duration,
                                0
                              );
                              const width =
                                total > 0
                                  ? (scene.duration / total) * 100
                                  : 0;

                              const sceneRenderStart = activeVersion.scenes
                                .slice(0, index)
                                .reduce((sum, s) => sum + s.duration, 0);
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
                              data-scene-index={index}
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
                                <div className="relative flex min-h-[120px] items-stretch min-w-0 bg-slate-700">
                                  <div
                                    className="absolute inset-y-0 left-0 pointer-events-none z-10 transition-[width] duration-100"
                                    style={{
                                      width: `${sceneProgress * 100}%`,
                                    }}
                                  />
                                  <div className="relative h-full w-full min-h-[120px] overflow-hidden">
                                    <SceneThumbnail thumbnailUrl={null} />
                                  </div>

                                  <div className="absolute top-2 left-2 z-20 rounded-md bg-slate-950/70 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
                                    {scene.duration.toFixed(1)}s
                                  </div>
                                </div>
                              </div>
                              );
                            })
                          ) : (
                            <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-slate-700/80 text-sm text-slate-500">
                              Loading versions...
                            </div>
                          )}
                        </div>

                        
                      </div>
                      </div>
                    </div>

                    <div className="relative w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950/40 p-2 flex flex-col overflow-hidden justify-start">
                      <div className="pointer-events-none absolute left-2 top-1 z-[60] flex flex-col gap-1" />
                      {selectedTask.video_url ? (
                        <div className="flex-1 min-h-0 flex items-start justify-center overflow-hidden pt-2">
                          <div className="w-full max-w-[340px] aspect-[9/16] rounded-md border border-slate-700 bg-black overflow-hidden shadow-2xl">
                            <video
                              src={selectedTask.video_url}
                              ref={renderVideoRef}
                              controls={false}
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-contain bg-black"
                              onError={(event) => {
                                const target = event.currentTarget;
                                const mediaError = target.error;
                                const mediaErrorNames: Record<number, string> = {
                                  1: "MEDIA_ERR_ABORTED",
                                  2: "MEDIA_ERR_NETWORK",
                                  3: "MEDIA_ERR_DECODE",
                                  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
                                };

                                console.error(
                                  "Source video error:",
                                  {
                                    src: target.currentSrc || target.src,
                                    readyState: target.readyState,
                                    networkState: target.networkState,
                                    errorCode: mediaError?.code,
                                    errorMessage: mediaError?.message,
                                    errorName: mediaError
                                      ? mediaErrorNames[mediaError.code] ?? "UNKNOWN_MEDIA_ERROR"
                                      : undefined,
                                  }
                                );
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 min-h-[120px] rounded-md border border-dashed border-slate-700/80 bg-slate-900/40" />
                      )}
                    </div>

                    {selectedTask.status === "review" || selectedTask.status === "done" ? (
                      <div className="mt-0 flex justify-center">
                        <div className="w-full max-w-[50%] min-w-[320px] rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-medium text-zinc-100">Comments</h3>
                            </div>
                            <span className="text-[11px] text-zinc-500">{comments.length} шт.</span>
                          </div>

                          {commentLoading ? (
                            <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                               Loading comments...
                            </div>
                          ) : null}

                          {commentError ? (
                            <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                              {commentError}
                            </div>
                          ) : null}

                          <div className="mb-4 space-y-2">
                            {comments.length === 0 && !commentLoading ? (
                              <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950 px-3 py-5 text-center text-xs text-zinc-500">
                                No comments yet. Be the first.
                              </div>
                            ) : null}

                            {comments.map((comment) => {
                              const reactionIcons = COMMENT_REACTIONS.filter(
                                (emoji) => (comment.reactions?.[emoji] ?? 0) > 0
                              );

                              return (
                                <div key={comment.id} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3">
                                  <div className="mb-1 flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium text-zinc-100">{comment.author_name}</span>
                                    <span className="text-[11px] text-zinc-500">
                                      {new Date(comment.created_at).toLocaleString("uk-UA", {
                                        day: "2-digit",
                                        month: "2-digit",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-5 text-zinc-300">
                                    {comment.content}
                                  </p>
                                  {reactionIcons.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {reactionIcons.map((emoji) => (
                                        <span
                                          key={emoji}
                                          className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300"
                                        >
                                          {emoji}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          <textarea
                            value={commentContent}
                            onChange={(e) => setCommentContent(e.target.value)}
                              placeholder="Write a comment..."
                            rows={3}
                            className="mb-3 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                          />

                          <div className="mb-3 grid gap-2 sm:grid-cols-2">
                            <input
                              value={commentName}
                              onChange={(e) => setCommentName(e.target.value)}
                               placeholder="Your name"
                              className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
                            />
                            <div className="flex items-center gap-2 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                              {COMMENT_REACTIONS.map((emoji) => {
                                const active = selectedCommentReactions.includes(emoji);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() =>
                                      setSelectedCommentReactions((current) =>
                                        current.includes(emoji)
                                          ? current.filter((item) => item !== emoji)
                                          : [...current, emoji]
                                      )
                                    }
                                    className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-base transition ${
                                      active
                                        ? "border-zinc-600 bg-zinc-800 text-white"
                                        : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                                    }`}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={submitComment}
                              disabled={commentSubmitting || !commentName.trim() || !commentContent.trim()}
                              className="inline-flex h-9 items-center rounded-md border border-zinc-800 bg-zinc-900 px-4 text-sm font-medium text-zinc-100 transition hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                               {commentSubmitting ? "Sending..." : "Send"}
                            </button>
                          </div>

                        </div>
                      </div>
                    ) : null}

                </div>


              </>
            ) : (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Upload video (.mp4):
                </label>

                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={uploading}
                  className="block w-full cursor-pointer text-sm text-zinc-300 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-zinc-100 hover:file:bg-zinc-700"
                />

                {uploadStatus ? (
                  <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200">
                    <div className="flex items-center gap-2">
                      {uploading ? (
                        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                      ) : null}
                      <span>{uploadStatus}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
