import type { AILSStatus, StatusPayload } from "../../../lib/api"

const EMPTY_STATUS: AILSStatus = {
  is_running: false,
  current_title: "",
  current_task_id: null,
  cancel_requested: false,
  is_paused: false,
  logs: [],
  debug_events: [],
}

export function normalizeStatusPayload(payload: StatusPayload, fallback?: StatusPayload | null): StatusPayload {
  return {
    status: payload.status ?? EMPTY_STATUS,
    active_tasks: Array.isArray(payload.active_tasks) ? payload.active_tasks : [],
    pending: Array.isArray(payload.pending) ? payload.pending : [],
    reports: Array.isArray(payload.reports) ? payload.reports : (fallback?.reports ?? []),
    retry_candidates: Array.isArray(payload.retry_candidates) ? payload.retry_candidates : (fallback?.retry_candidates ?? []),
    config: payload.config ?? fallback?.config ?? {},
    lite: Boolean(payload.lite),
    reports_fingerprint: payload.reports_fingerprint ?? fallback?.reports_fingerprint,
    retry_candidates_fingerprint: payload.retry_candidates_fingerprint ?? fallback?.retry_candidates_fingerprint,
  }
}

export function isStatusPayloadWorkActive(payload: StatusPayload | null | undefined) {
  return Boolean(
    payload?.status?.is_running
      || (payload?.active_tasks?.length ?? 0) > 0
      || (payload?.pending?.length ?? 0) > 0,
  )
}
