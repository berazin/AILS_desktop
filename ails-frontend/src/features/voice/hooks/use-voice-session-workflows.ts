import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import {
  getAiAssistStatus,
  getWorkPreflight,
  type RealtimeVoiceContext,
  type RealtimeVoiceToolCall,
  type RealtimeVoiceToolRound,
  type WorkPreflight,
} from "../../../lib/api"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { t } from "../../../lib/i18n.ts"
import { pcm16Base64 } from "../lib/pcm16.ts"
import {
  VoiceSessionController,
  type VoiceLatencySnapshot,
  type VoiceSessionState,
} from "../lib/voice-session.ts"
import type { VoiceController } from "./use-voice-controller.ts"

type VoiceToolExecutionResult = {
  content: string
  page?: number
}

type UseVoiceSessionWorkflowsOptions = {
  aiAssistEnabled: boolean
  buildContext: (pageOverride?: number) => Promise<RealtimeVoiceContext>
  confirmCloudPreflight: () => Promise<WorkPreflight | null | false>
  executeTool: (call: RealtimeVoiceToolCall, utterance: string) => Promise<VoiceToolExecutionResult>
  getProvider: () => string
  onAiAssistEnabledChange: (enabled: boolean) => void
  onApiError: (message: string) => void
  onDraftChange: (value: string) => void
  onDraftCommitted: (value: string) => void
  onNotice: (message: string) => void
  onTranscript: (value: string) => void
  voice: VoiceController
}

// 2048-sample chunks (~128ms at 16kHz). The queue tolerates about 1.5s
// of transient send backlog before dropping new chunks.
const MAX_PENDING_VOICE_CHUNKS = 12
const VOICE_FINAL_CONTENT_PATTERN = /[\p{L}\p{N}]/u

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hasVoiceFinalContent(text: string): boolean {
  return VOICE_FINAL_CONTENT_PATTERN.test(text)
}

function isAbortError(error: unknown) {
  const name = typeof error === "object" && error
    ? String((error as { name?: unknown }).name ?? "")
    : ""
  return name === "AbortError"
}

function useEventCallback<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: TArgs) => callbackRef.current(...args), [])
}

export function useVoiceSessionWorkflows({
  aiAssistEnabled,
  buildContext,
  confirmCloudPreflight,
  executeTool,
  getProvider,
  onAiAssistEnabledChange,
  onApiError,
  onDraftChange,
  onDraftCommitted,
  onNotice,
  onTranscript,
  voice,
}: UseVoiceSessionWorkflowsOptions) {
  const {
    api: {
      cancelVoiceSession,
      downloadVoiceAgentModelStream,
      downloadVoiceModelStream,
      getVoiceStatus,
      sendVoiceChunk,
      startVoiceSession,
      stopVoiceSession,
      streamRealtimeVoiceAgent,
      warmupRealtimeVoiceAgent,
    },
    refs: {
      agentMetaRef,
      voiceAecActiveRef,
      voiceAudioContextRef,
      voiceChunkQueueRef,
      voiceControllerRef,
      voiceEchoGuardUntilRef,
      voiceEngineRef,
      voiceMediaStreamRef,
      voiceOutputActiveRef,
      voicePendingChunkCountRef,
      voiceProcessorRef,
      voiceSessionIdRef,
      voiceSessionPhaseRef,
      voiceSourceRef,
      voiceTranscriptVersionRef,
      voiceVadRef,
      voiceWhisperSpeechActiveRef,
      voiceWindowsUnsubscribeRef,
      voiceWorkAcknowledgedRef,
    },
    state: {
      setVoiceAssistantText,
      setVoiceError,
      setVoiceLatencyText,
      setVoiceSessionPhase,
      setVoiceState,
      setVoiceStatusText,
      voiceState,
    },
  } = voice

  function showVoiceTranscript(value: string) {
    voiceTranscriptVersionRef.current += 1
    onTranscript(value)
  }

  function commitVoiceDraft(value: string) {
    onDraftChange(value)
    showVoiceTranscript(value)
    onDraftCommitted(value)
  }

  function clearVoiceDraft(version: number) {
    if (version === voiceTranscriptVersionRef.current) commitVoiceDraft("")
  }

  const releaseVoiceAudio = useCallback(() => {
    if (voiceProcessorRef.current) {
      voiceProcessorRef.current.onaudioprocess = null
      voiceProcessorRef.current.disconnect()
    }
    voiceSourceRef.current?.disconnect()
    voiceMediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    if (voiceAudioContextRef.current && voiceAudioContextRef.current.state !== "closed") {
      void voiceAudioContextRef.current.close()
    }
    voiceProcessorRef.current = null
    voiceSourceRef.current = null
    voiceMediaStreamRef.current = null
    voiceAudioContextRef.current = null
    voiceAecActiveRef.current = true
  }, [
    voiceAecActiveRef,
    voiceAudioContextRef,
    voiceMediaStreamRef,
    voiceProcessorRef,
    voiceSourceRef,
  ])

  function reportVoiceError(error: unknown) {
    const rawMessage = getErrorMessage(error)
    const message = rawMessage.includes("frontend build not found")
      ? t("보이스 모드 API를 찾지 못했습니다. AILS를 완전히 종료한 뒤 다시 실행해 주세요.")
      : rawMessage
    onApiError(message)
    setVoiceError(message)
  }

  function getRealtimeVoiceController() {
    if (voiceControllerRef.current) return voiceControllerRef.current
    voiceControllerRef.current = new VoiceSessionController({
      onState: (state) => {
        voiceSessionPhaseRef.current = state
        setVoiceSessionPhase(state)
        const labels: Record<VoiceSessionState, string> = {
          Idle: "",
          Listening: t("말씀해 주세요"),
          UserSpeaking: t("듣는 중"),
          Thinking: t("생각 중"),
          ExecutingTool: t("AILS 실행 중"),
          Speaking: t("답변 중"),
          Interrupted: t("이전 답변 중단"),
          Stopping: t("마무리 중"),
        }
        setVoiceStatusText(labels[state])
      },
      onAssistantText: setVoiceAssistantText,
      onPlaybackChange: (playing) => {
        voiceOutputActiveRef.current = playing
        voiceEchoGuardUntilRef.current = playing ? Number.POSITIVE_INFINITY : Date.now() + 700
      },
      onLatency: (latency: VoiceLatencySnapshot) => {
        const pieces = [
          latency.finalToFirstTokenMs === undefined ? "" : t("첫 응답 {p0}ms", { p0: Math.round(latency.finalToFirstTokenMs) }),
          latency.speechEndToFirstAudioMs === undefined
            ? latency.finalToFirstAudioMs === undefined ? "" : t("첫 음성 {p0}ms", { p0: Math.round(latency.finalToFirstAudioMs) })
            : t("첫 음성 {p0}ms", { p0: Math.round(latency.speechEndToFirstAudioMs) }),
          latency.bargeInToStopMs === undefined ? "" : t("중단 {p0}ms", { p0: Math.round(latency.bargeInToStopMs) }),
        ].filter(Boolean)
        if (pieces.length) setVoiceLatencyText(pieces.join(" · "))
      },
    })
    return voiceControllerRef.current
  }

  async function handleRealtimeVoiceFinal(transcript: string) {
    const text = transcript.trim()
    if (!text || !voiceWorkAcknowledgedRef.current) return
    const controller = getRealtimeVoiceController()
    const transcriptVersion = voiceTranscriptVersionRef.current
    const { generation, signal } = controller.beginTurn()
    const toolRounds: RealtimeVoiceToolRound[] = []
    let pageOverride: number | undefined
    let continueVoiceWithCloud = false
    try {
      for (let round = 0; round < 5; round += 1) {
        const calls: RealtimeVoiceToolCall[] = []
        const context = await buildContext(pageOverride)
        controller.markLlmRequest(generation)
        const response = await streamRealtimeVoiceAgent({
          transcript: text,
          work_acknowledged: true,
          assist_mode: aiAssistEnabled,
          force_cloud: continueVoiceWithCloud,
          context,
          tool_rounds: toolRounds,
        }, {
          onToken: (token) => controller.acceptToken(generation, token),
          onToolCall: (call) => {
            if (!calls.length) controller.markToolStarted(generation)
            calls.push(call)
          },
        }, signal)
        if (signal.aborted || generation !== controller.currentGeneration()) return
        agentMetaRef.current = { model: response.model, provider: response.provider }
        if (!calls.length) {
          controller.finishTurn(generation, response.answer || t("요청을 처리하지 못했습니다."))
          clearVoiceDraft(transcriptVersion)
          return
        }
        if (response.answer_source === "cloud") continueVoiceWithCloud = true
        controller.markToolStarted(generation)
        const results = []
        for (const call of calls) {
          if (signal.aborted || generation !== controller.currentGeneration()) return
          try {
            const result = await executeTool(call, text)
            if (signal.aborted || generation !== controller.currentGeneration()) return
            if (result.page !== undefined) pageOverride = result.page
            results.push({
              tool_call_id: call.id,
              content: call.name === "search_context" ? result.content : JSON.stringify({ ok: true, result: result.content }, null, 0),
            })
          } catch (error) {
            results.push({ tool_call_id: call.id, content: JSON.stringify({ ok: false, error: getErrorMessage(error) }, null, 0) })
          }
        }
        toolRounds.push({ calls, results })
        controller.markToolCompleted(generation)
      }
      controller.acceptToken(generation, t("요청이 너무 많은 단계로 이어져 여기서 멈췄습니다. 더 구체적으로 말씀해 주세요."))
      controller.finishTurn(generation)
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return
      controller.failTurn(generation)
      reportVoiceError(error)
    }
  }

  const handleRealtimeVoiceFinalEvent = useEventCallback(handleRealtimeVoiceFinal)

  async function ensureOfflineVoiceModel(askBeforeDownload = false) {
    let status = await getVoiceStatus()
    if (!status.runtime_ready) throw new Error(status.runtime_error || t("whisper.cpp 실행 코드가 없습니다. AILS를 업데이트해 주세요."))
    if (!status.ready) {
      if (!status.download_required) throw new Error(status.runtime_error || t("Whisper {p0} 모델이 없습니다.", { p0: status.selected_model }))
      if (askBeforeDownload) {
        const sizeLabel = status.file_size > 0
          ? t("약 {p0}GB", { p0: (status.file_size / (1024 ** 3)).toFixed(1) })
          : t("필요한 모델 파일")
        const modeLabel = status.two_pass
          ? `Sherpa + Whisper ${status.selected_model} 2-pass`
          : `Whisper ${status.selected_model}`
        const approved = globalThis.confirm(
          t("{p0} 오프라인 STT 모델이 필요합니다 ({p1}).\n", { p0: modeLabel, p1: sizeLabel }) +
          t("다운로드하고 보이스 모드를 시작할까요?"),
        )
        if (!approved) {
          throw new DOMException(t("오프라인 Whisper 모델 설치를 취소했습니다."), "AbortError")
        }
      }
      await downloadVoiceModelStream((event) => {
        if (event.type !== "model_download") return
        const completed = Number(event.completed_bytes || 0)
        const total = Number(event.total_bytes || status.file_size)
        const label = status.two_pass ? "Sherpa + Whisper 2-pass" : `Whisper ${status.selected_model}`
        setVoiceStatusText(t("{p0} 다운로드 {p1}%", { p0: label, p1: Math.min(100, Math.round(completed * 100 / Math.max(1, total))) }))
      })
      status = await getVoiceStatus()
      if (!status.ready) throw new Error(t("오프라인 STT 모델 설치를 확인하지 못했습니다."))
    }
    return status
  }

  async function stop() {
    if (voiceState === "idle" || voiceState === "stopping") return
    setVoiceState("stopping")
    getRealtimeVoiceController().stop()
    voiceWindowsUnsubscribeRef.current?.()
    voiceWindowsUnsubscribeRef.current = null
    const desktop = getAppDesktopApi()
    if (voiceEngineRef.current === "windows") await desktop?.stop_windows_speech?.().catch(() => undefined)
    const sessionId = voiceSessionIdRef.current
    voiceSessionIdRef.current = ""
    const engine = voiceEngineRef.current
    voiceEngineRef.current = ""
    releaseVoiceAudio()
    try {
      await voiceChunkQueueRef.current
      if (engine === "whisper" && sessionId) await stopVoiceSession(sessionId)
      await cancelVoiceSession(sessionId).catch(() => undefined)
    } catch (error) {
      reportVoiceError(error)
    } finally {
      voiceWorkAcknowledgedRef.current = false
      voiceVadRef.current.reset()
      voiceWhisperSpeechActiveRef.current = false
      setVoiceAssistantText("")
      setVoiceLatencyText("")
      setVoiceState("idle")
      setVoiceStatusText("")
      void getAiAssistStatus()
        .then((status) => onAiAssistEnabledChange(status.resident))
        .catch(() => undefined)
    }
  }

  async function start() {
    if (voiceState === "recording") {
      await stop()
      return
    }
    if (voiceState !== "idle") return
    commitVoiceDraft("")
    setVoiceState("starting")
    setVoiceStatusText(t("실시간 보이스 준비 중"))
    setVoiceError("")
    onApiError("")
    try {
      const provider = getProvider()
      const accepted = provider === "cloud"
        ? await confirmCloudPreflight()
        : await getWorkPreflight({ operation: "voice_agent" })
      if (!accepted || !accepted.allowed) {
        setVoiceState("idle")
        setVoiceStatusText("")
        return
      }
      if (accepted.local_voice_agent_model?.download_required) {
        const size = accepted.local_voice_agent_model.file_size
        await downloadVoiceAgentModelStream((event) => {
          if (event.type !== "model_download") return
          const completed = Number(event.completed_bytes || 0)
          const total = Number(event.total_bytes || size)
          setVoiceStatusText(t("Qwen 모델 다운로드 {p0}%", { p0: Math.min(100, Math.round(completed * 100 / Math.max(1, total))) }))
        })
      }
      if (provider !== "cloud") {
        setVoiceStatusText(t("실시간 AI 준비 중"))
        const response = await warmupRealtimeVoiceAgent()
        if (response.warmed) onAiAssistEnabledChange(true)
      }
      voiceWorkAcknowledgedRef.current = true

      const desktop = getAppDesktopApi()
      const online = navigator.onLine
      const windowsStatus = online
        ? await desktop?.get_windows_speech_status?.().catch(() => null)
        : null
      const useWindowsSpeech = online && Boolean(windowsStatus?.available)
      let engine: "windows" | "whisper" = useWindowsSpeech ? "windows" : "whisper"
      let whisperModel = ""
      let offlineTwoPass = false
      if (engine === "whisper") await ensureOfflineVoiceModel(true)

      setVoiceStatusText(t("마이크 연결 중"))
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        // Chrome noise suppression strips far-field speech to noise, while
        // AEC and AGC remain useful for the realtime voice path.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      })
      voiceMediaStreamRef.current = mediaStream
      voiceAecActiveRef.current = mediaStream.getAudioTracks()[0]?.getSettings().echoCancellation !== false
      const audioContext = new AudioContext({ sampleRate: 16_000 })
      const source = audioContext.createMediaStreamSource(mediaStream)
      const processor = audioContext.createScriptProcessor(2048, 1, 1)
      voiceAudioContextRef.current = audioContext
      voiceSourceRef.current = source
      voiceProcessorRef.current = processor
      voiceChunkQueueRef.current = Promise.resolve()
      voicePendingChunkCountRef.current = 0
      voiceVadRef.current.reset()
      voiceWhisperSpeechActiveRef.current = false

      const startWhisper = async () => {
        const status = await ensureOfflineVoiceModel(true)
        const session = await startVoiceSession()
        voiceSessionIdRef.current = session.session_id
        voiceEngineRef.current = "whisper"
        engine = "whisper"
        whisperModel = session.model || status.selected_model
        offlineTwoPass = status.two_pass
      }

      let switchingToWhisper = false
      const handleWindowsFailure = async (reason: string) => {
        if (switchingToWhisper || voiceEngineRef.current !== "windows") return
        switchingToWhisper = true
        voiceWindowsUnsubscribeRef.current?.()
        voiceWindowsUnsubscribeRef.current = null
        try {
          await desktop?.stop_windows_speech?.().catch(() => undefined)
          if (navigator.onLine) throw new Error(t("Windows 온라인 STT가 중단되었습니다. {p0}", { p0: reason }).trim())
          setVoiceStatusText(t("Whisper 오프라인 STT로 전환 중"))
          await startWhisper()
          onNotice(t("네트워크 연결이 끊겨 {p0}로 전환했습니다.", { p0: offlineTwoPass ? "Sherpa + Whisper 2-pass" : `Whisper ${whisperModel}` }))
        } catch (error) {
          if (isAbortError(error)) onNotice(getErrorMessage(error))
          else reportVoiceError(error)
          const fallbackSessionId = voiceSessionIdRef.current
          voiceSessionIdRef.current = ""
          voiceEngineRef.current = ""
          voiceWorkAcknowledgedRef.current = false
          releaseVoiceAudio()
          getRealtimeVoiceController().stop()
          await cancelVoiceSession(fallbackSessionId).catch(() => undefined)
          setVoiceState("idle")
          setVoiceStatusText("")
        } finally {
          switchingToWhisper = false
        }
      }

      if (engine === "windows" && desktop?.on_windows_speech_event && desktop.start_windows_speech) {
        voiceWindowsUnsubscribeRef.current = desktop.on_windows_speech_event((event) => {
          const userSpeechActive = voiceSessionPhaseRef.current === "UserSpeaking"
          const outputEchoBlocked = !userSpeechActive && (
            voiceOutputActiveRef.current
            || Date.now() < voiceEchoGuardUntilRef.current
          )
          if (event.type === "hypothesis" && event.text && !outputEchoBlocked) {
            getRealtimeVoiceController().markFirstHypothesis()
            showVoiceTranscript(event.text)
          } else if (event.type === "result" && event.text && hasVoiceFinalContent(event.text) && !outputEchoBlocked) {
            getRealtimeVoiceController().onUserSpeechEnded()
            showVoiceTranscript(event.text)
            void handleRealtimeVoiceFinalEvent(event.text)
          } else if (event.type === "error" && event.error) {
            void handleWindowsFailure(event.error)
          } else if (event.type === "completed") {
            void handleWindowsFailure(event.status || t("연속 인식 세션이 종료되었습니다."))
          }
        })
        try {
          await desktop.start_windows_speech("ko-KR")
          voiceEngineRef.current = "windows"
        } catch (error) {
          voiceWindowsUnsubscribeRef.current?.()
          voiceWindowsUnsubscribeRef.current = null
          await desktop.stop_windows_speech?.().catch(() => undefined)
          if (navigator.onLine) throw error
          await startWhisper()
        }
      } else {
        await startWhisper()
      }

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)
        if (!voiceAecActiveRef.current && (
          voiceOutputActiveRef.current || Date.now() < voiceEchoGuardUntilRef.current
        )) return
        const activity = voiceVadRef.current.accept(samples)
        let speechState: "idle" | "started" | "active" | "ended" = voiceWhisperSpeechActiveRef.current
          ? "active"
          : "idle"
        if (activity === "started") {
          voiceWhisperSpeechActiveRef.current = true
          speechState = "started"
          getRealtimeVoiceController().onUserSpeechStarted()
          voiceEchoGuardUntilRef.current = 0
        } else if (activity === "ended") {
          voiceWhisperSpeechActiveRef.current = false
          speechState = "ended"
          getRealtimeVoiceController().onUserSpeechEnded()
        }
        if (voiceEngineRef.current !== "whisper") return
        const sessionId = voiceSessionIdRef.current
        if (!sessionId) return
        if (voicePendingChunkCountRef.current >= MAX_PENDING_VOICE_CHUNKS) return
        const pcm16 = pcm16Base64(samples)
        voicePendingChunkCountRef.current += 1
        voiceChunkQueueRef.current = voiceChunkQueueRef.current
          .then(async () => {
            try {
              const result = await sendVoiceChunk({
                session_id: sessionId,
                sample_rate: audioContext.sampleRate,
                pcm16_base64: pcm16,
                speech_state: speechState,
              })
              const completedText = result.finals.filter(hasVoiceFinalContent).join(" ").trim()
              if (completedText) {
                showVoiceTranscript(completedText)
                void handleRealtimeVoiceFinalEvent(completedText)
              } else if (result.partial && hasVoiceFinalContent(result.partial)) {
                getRealtimeVoiceController().markFirstHypothesis()
                showVoiceTranscript(result.partial)
              }
            } finally {
              voicePendingChunkCountRef.current -= 1
            }
          })
          .catch((error) => {
            reportVoiceError(error)
            voiceSessionIdRef.current = ""
            releaseVoiceAudio()
            void cancelVoiceSession(sessionId)
            getRealtimeVoiceController().stop()
            setVoiceState("idle")
          })
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      await audioContext.resume()
      setVoiceState("recording")
      getRealtimeVoiceController().start()
      onNotice([
        engine === "windows"
          ? t("Windows 온라인 연속 STT를 사용합니다.")
          : offlineTwoPass
            ? t("Sherpa 실시간 인식 + Whisper {p0} 최종 교정 2-pass를 사용합니다.", { p0: whisperModel })
            : t("Whisper {p0} 오프라인 STT를 사용합니다.", { p0: whisperModel }),
        voiceAecActiveRef.current ? t("AEC가 적용됐습니다.") : t("AEC를 사용할 수 없어 AI 음성 재생 중에는 마이크 입력을 잠시 차단합니다."),
      ].join(" "))
    } catch (error) {
      voiceWindowsUnsubscribeRef.current?.()
      voiceWindowsUnsubscribeRef.current = null
      void getAppDesktopApi()?.stop_windows_speech?.().catch(() => undefined)
      releaseVoiceAudio()
      const sessionId = voiceSessionIdRef.current
      voiceSessionIdRef.current = ""
      voiceEngineRef.current = ""
      voiceWorkAcknowledgedRef.current = false
      if (sessionId) await cancelVoiceSession(sessionId).catch(() => undefined)
      getRealtimeVoiceController().stop()
      if (isAbortError(error)) onNotice(getErrorMessage(error))
      else reportVoiceError(error)
      setVoiceState("idle")
      setVoiceStatusText("")
    }
  }

  useEffect(() => () => {
    const sessionId = voiceSessionIdRef.current
    voiceSessionIdRef.current = ""
    voiceWindowsUnsubscribeRef.current?.()
    voiceWindowsUnsubscribeRef.current = null
    void getAppDesktopApi()?.stop_windows_speech?.()
    voiceControllerRef.current?.stop()
    releaseVoiceAudio()
    void cancelVoiceSession(sessionId)
  }, [cancelVoiceSession, releaseVoiceAudio, voiceControllerRef, voiceSessionIdRef, voiceWindowsUnsubscribeRef])

  return {
    clearError: () => setVoiceError(""),
    reportError: reportVoiceError,
    start,
    stop,
  }
}
