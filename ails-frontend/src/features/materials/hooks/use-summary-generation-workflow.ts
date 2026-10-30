import type { Dispatch, SetStateAction } from "react"
import { useEffect, useRef, useState } from "react"
import { SUMMARY_AUDIO_PDF_ENABLED, SUMMARY_MEDIA_FILES_ENABLED, SUMMARY_WEB_INPUTS_ENABLED } from "../../../edition.ts"

import {
  /* @ails-feature:summary.audio_pdf:start */
  createAudioTask,
  /* @ails-feature:summary.audio_pdf:end */
  /* @ails-feature:summary.web_inputs:start */
  createEclassVodTask,
  /* @ails-feature:summary.web_inputs:end */
  /* @ails-feature:summary.web_inputs:start */
  createUrlTask,
  /* @ails-feature:summary.web_inputs:end */
  createVideoDetailedTask,
  createVideoSummaryTask,
  /* @ails-feature:summary.web_inputs:start */
  createYoutubeTask,
  /* @ails-feature:summary.web_inputs:end */
  /* @ails-feature:summary.web_inputs:start */
  cancelLmsAuthAttempt,
  /* @ails-feature:summary.web_inputs:end */
  downloadVideoWhisperModelStream,
  /* @ails-feature:summary.web_inputs:start */
  getLmsAuthStatus,
  /* @ails-feature:summary.web_inputs:end */
  importMarkdown,
  openFileDialog,
  /* @ails-feature:summary.web_inputs:start */
  openLmsLoginBrowser,
  /* @ails-feature:summary.web_inputs:end */
  /* @ails-feature:summary.web_inputs:start */
  saveLmsCredentials,
  /* @ails-feature:summary.web_inputs:end */
  /* @ails-feature:summary.web_inputs:start */
  scanLmsCourse,
  /* @ails-feature:summary.web_inputs:end */
  type AILSConfig,
  type LmsAuthStatus,
  type WorkPreflight,
  type WorkPreflightOperation,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { formatModelDownloadSize } from "../../../lib/stt-config.ts"
import { titleFromPath } from "../../../lib/viewer-document.ts"
import { resolveLocalSttSelection } from "../lib/local-stt-selection.ts"

export type SummaryTaskTab = "url" | "youtube" | "eclass" | "media" | "markdown" | "lms-scan"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

type UseSummaryGenerationWorkflowOptions = {
  config: {
    draft: AILSConfig
    lmsPasswordDraft: string
    setDraft: Dispatch<SetStateAction<AILSConfig>>
    setLmsPasswordDraft: Dispatch<SetStateAction<string>>
  }
  documents: {
    openImportedReport: (reportId: string) => void
  }
  interaction: {
    confirmWorkPreflight: (
      operation: WorkPreflightOperation,
      payload: Record<string, unknown>,
    ) => Promise<WorkPreflight | false | null>
    refreshMaterials: () => Promise<unknown>
    refreshStatus: () => Promise<unknown>
    runInteraction: RunInteraction
    setNotice: (notice: string) => void
  }
}

function inferSegmentEnd(url: string) {
  const match = /segment-(\d+)/i.exec(url)
  return match ? match[1] : ""
}

function incrementLastNumber(value: string) {
  return value.replace(/(\d+)(?!.*\d)/, (match) => String(Number(match) + 1).padStart(match.length, "0"))
}

export function useSummaryGenerationWorkflow({
  config,
  documents,
  interaction,
}: UseSummaryGenerationWorkflowOptions) {
  const [activeTab, setActiveTab] = useState<SummaryTaskTab>(
    SUMMARY_WEB_INPUTS_ENABLED ? "url"
      : SUMMARY_MEDIA_FILES_ENABLED || SUMMARY_AUDIO_PDF_ENABLED ? "media" : "markdown",
  )
  const [open, setOpen] = useState(false)
  const [lmsSubmitPending, setLmsSubmitPending] = useState(false)
  const [lmsAuthStatus, setLmsAuthStatus] = useState<LmsAuthStatus | null>(null)
  const [lmsAuthError, setLmsAuthError] = useState("")
  const [lmsCancelPending, setLmsCancelPending] = useState(false)
  const lmsSubmitPendingRef = useRef(false)
  const lmsCancelPendingRef = useRef(false)
  const [urlForm, setUrlForm] = useState({
    url: "",
    start: "1",
    end: "10",
    title: "",
    sttOnly: false,
    mp3Only: false,
    detailMode: "summary",
  })
  const [lmsForm, setLmsForm] = useState({
    url: "",
    grade: 2,
    semester: 1,
    sttOnly: false,
    mp3Only: false,
    skipImages: false,
    skipVods: false,
    skipFiles: false,
    startWeek: 1,
    detailMode: "summary",
    localStt: null as boolean | null,
  })
  const [youtubeForm, setYoutubeForm] = useState({
    url: "",
    title: "",
    frameInterval: "3",
    sttOnly: false,
    mp3Only: false,
    skipImages: false,
    detailMode: "summary",
  })
  const [eclassForm, setEclassForm] = useState({
    url: "",
    title: "",
    sttOnly: false,
    mp3Only: false,
    skipImages: false,
    localStt: null as boolean | null,
    detailMode: "summary",
  })
  const [audioForm, setAudioForm] = useState({
    audioPath: "",
    pdfPath: "",
    pdfPassword: "",
    title: "",
    sttOnly: false,
    mp3Only: false,
  })
  const [videoForm, setVideoForm] = useState({ videoPath: "", title: "", localStt: null as boolean | null })
  const [markdownForm, setMarkdownForm] = useState({ path: "", content: "" })

  useEffect(() => {
    setLmsForm((current) => ({
      ...current,
      grade: Math.min(6, Math.max(1, Number(config.draft.current_grade) || 2)),
      semester: Math.min(2, Math.max(1, Number(config.draft.current_semester) || 1)),
      startWeek: Math.max(1, Number(config.draft.start_week) || 1),
    }))
  }, [config.draft.current_grade, config.draft.current_semester, config.draft.start_week])

  useEffect(() => {
    const lastLmsUrl = config.draft.last_lms_url
    if (lastLmsUrl === undefined || lastLmsUrl === null) return
    setLmsForm((current) => current.url === ""
      ? { ...current, url: String(lastLmsUrl) }
      : current)
  }, [config.draft.last_lms_url])

  /* @ails-feature:summary.web_inputs:start */
  useEffect(() => {
    if (!lmsSubmitPending) return
    let active = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    async function poll() {
      controller = new AbortController()
      try {
        const status = await getLmsAuthStatus(controller.signal)
        if (!active) return
        setLmsAuthError("")
        setLmsAuthStatus(status.attempt_id && ["checking", "signing_in", "awaiting_mfa"].includes(status.state)
          ? status
          : null)
      } catch (error) {
        if (active) setLmsAuthError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active) timeout = setTimeout(() => void poll(), 1000)
      }
    }

    timeout = setTimeout(() => void poll(), 1000)
    return () => {
      active = false
      clearTimeout(timeout)
      controller?.abort()
    }
  }, [lmsSubmitPending])

  async function runLmsSubmit(key: string, label: string, action: () => Promise<string>) {
    if (lmsSubmitPendingRef.current) return
    lmsSubmitPendingRef.current = true
    setLmsSubmitPending(true)
    setLmsAuthStatus(null)
    setLmsAuthError("")
    try {
      await interaction.runInteraction(key, label, action)
    } finally {
      lmsSubmitPendingRef.current = false
      setLmsSubmitPending(false)
      setLmsAuthStatus(null)
      setLmsAuthError("")
    }
  }

  async function cancelLmsAuthentication() {
    if (lmsCancelPendingRef.current || !lmsAuthStatus?.attempt_id || !["checking", "signing_in", "awaiting_mfa"].includes(lmsAuthStatus.state)) return
    lmsCancelPendingRef.current = true
    setLmsCancelPending(true)
    try {
      await cancelLmsAuthAttempt(lmsAuthStatus.attempt_id)
      setLmsAuthStatus(null)
      setLmsAuthError("")
    } catch (error) {
      setLmsAuthError(error instanceof Error ? error.message : String(error))
    } finally {
      lmsCancelPendingRef.current = false
      setLmsCancelPending(false)
    }
  }

  /* @ails-feature:summary.web_inputs:end */

  function selectTab(tab: SummaryTaskTab, label: string) {
    setActiveTab(tab)
    interaction.setNotice(t("{p0} 입력 칸을 열었습니다.", { p0: label }))
  }

  function updateUrl(nextUrl: string) {
    const inferredEnd = inferSegmentEnd(nextUrl)
    setUrlForm((current) => ({ ...current, url: nextUrl, end: inferredEnd || current.end }))
    if (inferredEnd) {
      interaction.setNotice(t("세그먼트 종료 번호를 {p0}로 자동 입력했습니다.", { p0: inferredEnd }))
    }
  }

  /* @ails-feature:summary.web_inputs:start */
  async function submitUrl() {
    await interaction.runInteraction("url-submit", t("URL 작업 추가"), async () => {
      const nextTitle = incrementLastNumber(urlForm.title)
      await createUrlTask({
        url: urlForm.url,
        start: Number(urlForm.start),
        end: Number(urlForm.end),
        title: urlForm.title,
        stt_only: urlForm.sttOnly,
        mp3_only: urlForm.mp3Only,
        detail_mode: urlForm.detailMode as "detailed" | "summary",
      })
      setUrlForm((current) => ({ ...current, url: "", title: nextTitle }))
      await interaction.refreshStatus()
      return t("URL 작업을 추가했습니다.")
    })
  }

  async function submitYoutube() {
    await interaction.runInteraction("youtube-submit", t("YouTube 작업 추가"), async () => {
      const result = await createYoutubeTask({
        youtube_url: youtubeForm.url,
        title: youtubeForm.title,
        stt_only: youtubeForm.sttOnly,
        mp3_only: youtubeForm.mp3Only,
        skip_images: youtubeForm.skipImages,
        frame_interval: Number(youtubeForm.frameInterval) || 3,
        detail_mode: youtubeForm.detailMode as "detailed" | "summary",
      })
      setYoutubeForm((current) => ({ ...current, url: "" }))
      await interaction.refreshStatus()
      const count = result.task_ids?.length ?? (result.task_id ? 1 : 0)
      return count > 1
        ? t("YouTube 작업 {p0}개를 추가했습니다.", { p0: count })
        : t("YouTube 작업을 추가했습니다.")
    })
  }

  async function submitEclass() {
    await runLmsSubmit("eclass-submit", t("e-class VOD 작업 추가"), async () => {
      await createEclassVodTask({
        vod_url: eclassForm.url,
        title: eclassForm.title,
        stt_only: eclassForm.sttOnly,
        mp3_only: eclassForm.mp3Only,
        skip_images: eclassForm.skipImages,
        local_stt: resolveLocalSttSelection(eclassForm.localStt, config.draft.stt_provider),
        detail_mode: eclassForm.detailMode as "detailed" | "summary",
      })
      const nextTitle = incrementLastNumber(eclassForm.title)
      setEclassForm((current) => ({ ...current, url: "", title: nextTitle }))
      await interaction.refreshStatus()
      return t("e-class VOD 작업을 추가했습니다.")
    })
  }

  async function submitLmsScan() {
    await runLmsSubmit("lms-scan-submit", t("LMS 일괄 스마트 분석"), async () => {
      const result = await scanLmsCourse({
        course_url: lmsForm.url,
        grade: lmsForm.grade,
        semester: lmsForm.semester,
        stt_only: lmsForm.sttOnly,
        mp3_only: lmsForm.mp3Only,
        skip_images: lmsForm.skipImages,
        skip_vods: lmsForm.skipVods,
        skip_files: lmsForm.skipFiles,
        start_week: lmsForm.startWeek,
        detail_mode: lmsForm.detailMode as "detailed" | "summary",
        local_stt: resolveLocalSttSelection(lmsForm.localStt, config.draft.stt_provider),
      })
      setLmsForm((current) => ({ ...current }))
      await interaction.refreshStatus()
      await interaction.refreshMaterials()

      const missingCount = result.missing_vods?.length ?? 0
      const addedCount = result.added_tasks_count ?? 0
      const downloadedCount = result.downloaded_materials_count ?? 0
      let message = t("[{p0}학년 {p1}학기 · {p2}] 스캔 완료: ", {
        p0: result.grade,
        p1: result.semester,
        p2: result.course_title,
      })
      if (addedCount > 0 && downloadedCount > 0) {
        message += t("총 {p0}개 VOD 중 누락된 영상 {p1}개를 작업 대기열에 추가했고, 미보유 일반 자료 {p2}개를 안전하게 다운로드 및 배치했습니다!", { p0: result.scanned_vods_count, p1: missingCount, p2: downloadedCount })
      } else if (addedCount > 0) {
        message += t("총 {p0}개 VOD 중 누락된 영상 {p1}개를 작업 대기열에 추가했습니다.", { p0: result.scanned_vods_count, p1: missingCount })
      } else if (downloadedCount > 0) {
        message += t("누락된 영상은 없으며, 미보유 상태였던 일반 강의 자료 {p0}개를 새로 다운로드하여 배치했습니다!", { p0: downloadedCount })
      } else {
        message += t("이미 모든 동영상 정리본과 일반 학습 강의 자료가 로컬에 완벽히 동기화되어 있습니다.")
      }
      return message
    })
  }

  async function openLmsLogin() {
    await interaction.runInteraction("lms-login", t("LMS 창 열기"), async () => {
      const result = await openLmsLoginBrowser(lmsForm.url.trim())
      return t("{p0}에서 LMS 로그인 창을 열었습니다. 로그인 상태는 이후 작업에서 재사용됩니다.", { p0: result.browser })
    })
  }

  async function saveLmsAccount() {
    await interaction.runInteraction("lms-credentials-save", "LMS credentials save", async () => {
      const username = String(config.draft.lms_username ?? "").trim()
      if (!username) throw new Error(t("LMS ID를 입력하세요."))
      const result = await saveLmsCredentials({
        username,
        password: config.lmsPasswordDraft,
        remember_password: true,
      })
      config.setDraft((current) => ({
        ...current,
        lms_username: result.username,
        lms_password_saved: result.password_saved,
      }))
      config.setLmsPasswordDraft("")
      await interaction.refreshStatus()
      return result.password_saved
        ? t("LMS 계정을 저장했습니다. 이제 e-class VOD 작업 추가 때 자동 로그인합니다.")
        : t("LMS ID를 저장했습니다. 비밀번호를 저장하려면 비밀번호를 입력한 뒤 다시 저장하세요.")
    })
  }

  /* @ails-feature:summary.web_inputs:end */

  /* @ails-feature:summary.audio_pdf:start */
  async function submitAudio() {
    await interaction.runInteraction("audio-submit", t("오디오 작업 추가"), async () => {
      await createAudioTask({
        audio_paths: audioForm.audioPath.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        pdf_path: audioForm.pdfPath,
        pdf_password: audioForm.pdfPassword,
        title: audioForm.title,
        stt_only: audioForm.sttOnly,
        mp3_only: audioForm.mp3Only,
      })
      await interaction.refreshStatus()
      return t("오디오 작업을 추가했습니다.")
    })
  }

  /* @ails-feature:summary.audio_pdf:end */

  async function submitVideo(mode: "detailed" | "summary") {
    const detailed = mode === "detailed"
    const label = detailed ? t("영상 상세 정리") : t("영상 요약 정리")
    const payload = {
      video_path: videoForm.videoPath,
      title: videoForm.title,
      local_stt: resolveLocalSttSelection(videoForm.localStt, config.draft.stt_provider),
    }
    const accepted = await interaction.confirmWorkPreflight(detailed ? "video_detailed" : "video_summary", payload)
    if (!accepted) return
    await interaction.runInteraction(`video-${mode}-submit`, label, async () => {
      const localSttModel = accepted.local_stt_model
      if (payload.local_stt && localSttModel?.download_required) {
        interaction.setNotice(t("Whisper {p0} 모델 다운로드를 시작합니다.", { p0: localSttModel.selected_model }))
        await downloadVideoWhisperModelStream(
          { confirmed: true, model_id: localSttModel.selected_model },
          (event) => {
            if (event.type !== "model_download") return
            const completed = Number(event.completed_bytes || 0)
            const total = Number(event.total_bytes || localSttModel.file_size || 0)
            interaction.setNotice(t("Whisper 모델 다운로드·검증 중: {p0} / {p1}", {
              p0: formatModelDownloadSize(completed),
              p1: formatModelDownloadSize(total),
            }))
          },
        )
      }
      const taskPayload = {
        ...payload,
        local_stt_model: localSttModel?.selected_model,
        work_acknowledged: true,
      }
      if (detailed) await createVideoDetailedTask(taskPayload)
      else await createVideoSummaryTask(taskPayload)
      await interaction.refreshStatus()
      setOpen(false)
      return t("{p0} 작업을 추가했습니다.", { p0: label })
    })
  }

  async function importMarkdownDocument() {
    await interaction.runInteraction("markdown-import", t("마크다운 등록"), async () => {
      const fallbackTitle = markdownForm.path
        ? undefined
        : t("MD 업로드 {p0}", { p0: new Date().toLocaleString("ko-KR") })
      const { report } = await importMarkdown({
        path: markdownForm.path,
        content: markdownForm.content,
        title: fallbackTitle,
      })
      documents.openImportedReport(report.id)
      await interaction.refreshStatus()
      await interaction.refreshMaterials()
      return t("마크다운 리포트를 등록했습니다.")
    })
  }

  async function pickAudioFiles() {
    await interaction.runInteraction("pick-audio", t("오디오 파일 선택"), async () => {
      const result = await openFileDialog({
        kind: "audio",
        multiple: true,
        title: t("오디오 파일 선택"),
        initial_dir: String(config.draft.md_save_path ?? ""),
      })
      if (result.paths.length > 0) {
        setAudioForm((current) => ({
          ...current,
          audioPath: result.paths.join("\n"),
          title: result.paths.length === 1 ? titleFromPath(result.paths[0]) : "",
        }))
        return t("{p0}개 오디오 파일을 선택했습니다.", { p0: result.paths.length })
      }
      return t("선택한 오디오 파일이 없습니다.")
    })
  }

  async function pickPdfFile() {
    await interaction.runInteraction("pick-pdf", t("PDF 파일 선택"), async () => {
      const result = await openFileDialog({
        kind: "pdf",
        title: t("PDF 파일 선택"),
        initial_dir: String(config.draft.md_save_path ?? ""),
      })
      if (result.path) {
        setAudioForm((current) => ({ ...current, pdfPath: result.path }))
        return t("PDF 파일을 선택했습니다.")
      }
      return t("선택한 PDF 파일이 없습니다.")
    })
  }

  async function pickVideoFile() {
    await interaction.runInteraction("pick-video", t("영상 파일 선택"), async () => {
      const result = await openFileDialog({
        kind: "video",
        title: t("영상 파일 선택"),
        initial_dir: String(config.draft.md_save_path ?? ""),
      })
      if (result.path) {
        setVideoForm((current) => ({ ...current, videoPath: result.path, title: titleFromPath(result.path) }))
        return t("영상 파일을 선택했습니다.")
      }
      return t("선택한 영상 파일이 없습니다.")
    })
  }

  async function pickMarkdownFile() {
    await interaction.runInteraction("pick-markdown", t("Markdown 파일 선택"), async () => {
      const result = await openFileDialog({
        kind: "markdown",
        title: t("Markdown 파일 선택"),
        initial_dir: String(config.draft.md_save_path ?? ""),
      })
      if (result.path) {
        setMarkdownForm((current) => ({ ...current, path: result.path }))
        return t("Markdown 파일을 선택했습니다.")
      }
      return t("선택한 Markdown 파일이 없습니다.")
    })
  }

  return {
    actions: {
      /* @ails-feature:summary.web_inputs:start */
      cancelLmsAuthentication,
      /* @ails-feature:summary.web_inputs:end */
      importMarkdownDocument,
      notify: interaction.setNotice,
      /* @ails-feature:summary.web_inputs:start */
      openLmsLogin,
      /* @ails-feature:summary.web_inputs:end */
      pickAudioFiles,
      pickMarkdownFile,
      pickPdfFile,
      pickVideoFile,
      /* @ails-feature:summary.web_inputs:start */
      saveLmsAccount,
      /* @ails-feature:summary.web_inputs:end */
      selectTab,
      setOpen,
      /* @ails-feature:summary.audio_pdf:start */
      submitAudio,
      /* @ails-feature:summary.audio_pdf:end */
      /* @ails-feature:summary.web_inputs:start */
      submitEclass,
      /* @ails-feature:summary.web_inputs:end */
      /* @ails-feature:summary.web_inputs:start */
      submitLmsScan,
      /* @ails-feature:summary.web_inputs:end */
      /* @ails-feature:summary.web_inputs:start */
      submitUrl,
      /* @ails-feature:summary.web_inputs:end */
      submitVideo,
      /* @ails-feature:summary.web_inputs:start */
      submitYoutube,
      /* @ails-feature:summary.web_inputs:end */
      updateUrl,
    },
    forms: {
      audio: audioForm,
      eclass: { ...eclassForm, localStt: resolveLocalSttSelection(eclassForm.localStt, config.draft.stt_provider) },
      lms: { ...lmsForm, localStt: resolveLocalSttSelection(lmsForm.localStt, config.draft.stt_provider) },
      markdown: markdownForm,
      setAudio: setAudioForm,
      setEclass: setEclassForm,
      setLms: setLmsForm,
      setMarkdown: setMarkdownForm,
      setUrl: setUrlForm,
      setVideo: setVideoForm,
      setYoutube: setYoutubeForm,
      url: urlForm,
      video: { ...videoForm, localStt: resolveLocalSttSelection(videoForm.localStt, config.draft.stt_provider) },
      youtube: youtubeForm,
    },
    state: { activeTab, open, lmsAuthStatus, lmsAuthError, lmsCancelPending, lmsSubmitPending },
  }
}

export type SummaryGenerationWorkflow = ReturnType<typeof useSummaryGenerationWorkflow>
