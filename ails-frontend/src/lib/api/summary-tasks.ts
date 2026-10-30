import { requestJson, runPdfOperationStream } from "./core.ts"

/* @ails-summary-generation:start */
/* @ails-feature:summary.web_inputs:start */
export function createUrlTask(payload: {
  url: string
  start: number
  end: number
  title: string
  stt_only: boolean
  mp3_only: boolean
  detail_mode?: "detailed" | "summary"
}) {
  return requestJson<{ task_id: number }>("/tasks/url", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createYoutubeTask(payload: {
  youtube_url: string
  title?: string
  stt_only: boolean
  mp3_only: boolean
  skip_images: boolean
  frame_interval: number
  detail_mode?: "detailed" | "summary"
}) {
  return requestJson<{ task_id?: number; task_ids?: number[] }>("/tasks/youtube", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createEclassVodTask(payload: {
  vod_url: string
  title: string
  stt_only: boolean
  mp3_only: boolean
  skip_images: boolean
  local_stt: boolean
  detail_mode?: "detailed" | "summary"
}) {
  return requestJson<{ task_id: number }>("/tasks/eclass-vod", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export interface LmsScanPayload {
  course_url: string
  grade: number
  semester: number
  stt_only: boolean
  mp3_only: boolean
  skip_images: boolean
  skip_vods?: boolean
  skip_files?: boolean
  start_week?: number
  detail_mode?: "detailed" | "summary"
  local_stt?: boolean
}

export interface LmsScanResult {
  course_title: string
  grade: number
  semester: number
  scanned_vods_count: number
  missing_vods: Array<{
    course?: string
    week: number
    sequence: number
    title: string
    url: string
  }>
  added_tasks_count: number
  added_task_ids?: number[]
  downloaded_materials_count?: number
  downloaded_materials?: Array<{
    course?: string
    week?: number
    title: string
    path: string
  }>
  details?: Array<{
    course: string
    scanned_vods: number
    scanned_resources: number
    added_tasks: number
    downloaded_files: number
  }>
}

export function scanLmsCourse(payload: LmsScanPayload) {
  return requestJson<LmsScanResult>("/tasks/lms-scan", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export type LmsAuthState =
  | "idle"
  | "checking"
  | "signing_in"
  | "awaiting_mfa"
  | "authenticated"
  | "failed"
  | "cancelled"

export interface LmsAuthStatus {
  attempt_id: string
  state: LmsAuthState
  message: string
  expires_at: number | null
}

export function getLmsAuthStatus(signal?: AbortSignal) {
  return requestJson<LmsAuthStatus>("/lms/auth/status", { signal })
}

export function cancelLmsAuthAttempt(attemptId: string) {
  return requestJson<LmsAuthStatus>("/lms/auth/cancel", {
    method: "POST",
    body: JSON.stringify({ attempt_id: attemptId }),
  })
}

/* @ails-feature:summary.web_inputs:end */
/* @ails-summary-generation:end */

/* @ails-feature:summary.web_inputs:start */
export function openLmsLoginBrowser(targetUrl = "") {
  return requestJson<{
    opened: boolean
    browser: string
    browser_id: string
    profile_dir: string
    cdp_url: string
    automation: "cdp" | "browser_cookies"
  }>("/lms/login", {
    method: "POST",
    body: JSON.stringify({ target_url: targetUrl }),
  })
}

export function saveLmsCredentials(payload: {
  username: string
  password: string
  remember_password: boolean
}) {
  return requestJson<{ saved: boolean; username: string; password_saved: boolean }>("/lms/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
/* @ails-feature:summary.web_inputs:end */

/* @ails-summary-generation:start */
/* @ails-feature:summary.audio_pdf:start */
export function createAudioTask(payload: {
  audio_paths: string[]
  pdf_path?: string
  pdf_password?: string
  title: string
  stt_only: boolean
  mp3_only: boolean
}) {
  return requestJson<{ task_ids: number[] }>("/tasks/audio", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
/* @ails-feature:summary.audio_pdf:end */

/* @ails-feature:summary.media_files:start */
export interface VideoSummaryTaskPayload {
  video_path: string
  title: string
  local_stt: boolean
  local_stt_model?: string
  work_acknowledged?: boolean
}

export function createVideoDetailedTask(payload: VideoSummaryTaskPayload) {
  return requestJson<{ task_id: number }>("/tasks/video-detailed", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createVideoSummaryTask(payload: VideoSummaryTaskPayload) {
  return requestJson<{ task_id: number }>("/tasks/video-summary", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function downloadVideoWhisperModelStream(
  payload: { confirmed: true; model_id: string },
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream(
    '/video/local-stt/model/download/stream',
    payload,
    onEvent,
    'Whisper model download',
    signal,
  )
}
/* @ails-feature:summary.media_files:end */
/* @ails-summary-generation:end */
