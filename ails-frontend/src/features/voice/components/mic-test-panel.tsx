import { t } from "../../../lib/i18n.ts"
import { useCallback, useRef, useState } from "react"
import { Mic, Square } from "lucide-react"
import { VoiceActivityDetector, hasSpeechText } from "../lib/voice-session.ts"
import { pcm16Base64 } from "../lib/pcm16.ts"
import { sendVoiceChunk, startVoiceSession, stopVoiceSession } from "../../../lib/api"

type MicTestState = {
  phase: "idle" | "starting" | "testing"
  level: number
  vadActive: boolean
  speechDetected: boolean
  partial: string
  finals: string[]
  chunkErrors: number
  chunkCount: number
  lastError: string
  processing: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; sampleRate?: number }
}

const INITIAL_STATE: MicTestState = {
  phase: "idle",
  level: 0,
  vadActive: false,
  speechDetected: false,
  partial: "",
  finals: [],
  chunkErrors: 0,
  chunkCount: 0,
  lastError: "",
  processing: {},
}

export function MicTestPanel() {
  const [state, setState] = useState<MicTestState>(INITIAL_STATE)
  const cleanupRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setState(INITIAL_STATE)
  }, [])

  const start = useCallback(async () => {
    if (cleanupRef.current) return
    setState((current) => ({ ...current, phase: "starting", lastError: "" }))
    let mediaStream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    let session = ""
    let meterTimer: number | null = null
    const processorRef = { current: null as ScriptProcessorNode | null }
    const sourceRef = { current: null as MediaStreamAudioSourceNode | null }
    const peakRef = { current: 0 }
    const vadRef = { current: false }
    const speechRef = { current: false }
    const dispose = () => {
      if (meterTimer !== null) window.clearInterval(meterTimer)
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      mediaStream?.getTracks().forEach((track) => track.stop())
      if (audioContext && audioContext.state !== "closed") void audioContext.close()
      if (session) void stopVoiceSession(session).catch(() => undefined)
    }
    cleanupRef.current = dispose
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      })
      const trackSettings = mediaStream.getAudioTracks()[0]?.getSettings() ?? {}
      audioContext = new AudioContext({ sampleRate: 16_000 })
      const source = audioContext.createMediaStreamSource(mediaStream)
      const processor = audioContext.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor
      sourceRef.current = source
      const vad = new VoiceActivityDetector()
      try {
        session = (await startVoiceSession()).session_id
      } catch (error) {
        setState((current) => ({
          ...current,
          lastError: t("오프라인 STT 세션 실패: {p0} — 레벨·VAD만 확인합니다.", { p0: String((error as Error)?.message ?? error) }),
        }))
      }
      meterTimer = window.setInterval(() => {
        const peak = peakRef.current
        peakRef.current = 0
        setState((current) => ({
          ...current,
          level: Math.min(100, Math.round(peak * 3000) / 10),
          vadActive: vadRef.current,
          speechDetected: speechRef.current,
        }))
      }, 120)
      const queue = { current: Promise.resolve() }
      let speechActive = false
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)
        let sum = 0
        for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index]
        const rms = Math.sqrt(sum / Math.max(1, samples.length))
        if (rms > peakRef.current) peakRef.current = rms
        const activity = vad.accept(samples)
        let speechState: "idle" | "started" | "active" | "ended" = speechActive ? "active" : "idle"
        if (activity === "started") {
          speechActive = true
          speechState = "started"
          vadRef.current = true
        } else if (activity === "ended") {
          speechActive = false
          speechState = "ended"
          vadRef.current = false
        }
        if (!session) return
        const encoded = pcm16Base64(samples)
        queue.current = queue.current
          .then(async () => {
            const result = await sendVoiceChunk({
              session_id: session,
              sample_rate: audioContext!.sampleRate,
              pcm16_base64: encoded,
              speech_state: speechState,
            })
            speechRef.current = Boolean(result.speech_detected ?? vadRef.current)
            const finalText = result.finals.filter(hasSpeechText).join(" ").trim()
            setState((current) => ({
              ...current,
              chunkCount: current.chunkCount + 1,
              partial: finalText ? "" : hasSpeechText(result.partial || "") ? result.partial || "" : "",
              finals: finalText && !current.finals.includes(finalText) ? [...current.finals, finalText].slice(-5) : current.finals,
            }))
          })
          .catch((error) => {
            setState((current) => ({
              ...current,
              chunkErrors: current.chunkErrors + 1,
              lastError: t("청크 전송 실패: {p0}", { p0: String((error as Error)?.message ?? error) }),
            }))
          })
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      await audioContext.resume()
      setState((current) => ({
        ...current,
        phase: "testing",
        processing: {
          echoCancellation: trackSettings.echoCancellation === undefined ? undefined : Boolean(trackSettings.echoCancellation),
          noiseSuppression: trackSettings.noiseSuppression === undefined ? undefined : Boolean(trackSettings.noiseSuppression),
          autoGainControl: trackSettings.autoGainControl === undefined ? undefined : Boolean(trackSettings.autoGainControl),
          sampleRate: trackSettings.sampleRate,
        },
        partial: "",
        finals: [],
        chunkCount: 0,
        chunkErrors: 0,
      }))
    } catch (error) {
      dispose()
      cleanupRef.current = null
      setState((current) => ({ ...current, phase: "idle", lastError: String((error as Error)?.message ?? error) }))
    }
  }, [])

  const { phase, level, vadActive, speechDetected, partial, finals, chunkErrors, chunkCount, lastError, processing } = state
  const testing = phase === "testing"
  const levelColor = level >= 8 && level <= 85 ? "bg-emerald-500" : level > 85 ? "bg-amber-500" : "bg-[var(--muted-foreground)]"
  return (
    <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/35 p-3 text-xs font-medium text-[var(--muted-foreground)] xl:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span>{t("마이크 감도 테스트")}</span>
        {testing ? (
          <button className="flex items-center gap-1 rounded bg-red-500/90 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-500" onClick={stop} type="button">
            <Square size={9} /> {t("테스트 중지")}</button>
        ) : (
          <button className="flex items-center gap-1 rounded bg-[var(--brand)] px-2 py-1 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-40" disabled={phase === "starting"} onClick={() => void start()} type="button">
            <Mic size={9} /> {phase === "starting" ? t("준비 중") : t("테스트 시작")}
          </button>
        )}
      </div>
      {(testing || phase === "starting") && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-[var(--muted)]">
              <div className={`h-full ${levelColor} transition-[width] duration-100`} style={{ width: `${level}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right text-[10px] tabular-nums">{level.toFixed(1)}%</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            <span className={vadActive ? "font-bold text-emerald-500" : ""}>{t("클라이언트 VAD: ")}{vadActive ? t("발화 감지") : t("대기")}</span>
            <span className={speechDetected ? "font-bold text-emerald-500" : ""}>STT VAD: {speechDetected ? t("발화 감지") : t("대기")}</span>
            <span>{t("청크 ")}{chunkCount}{t("건")}{chunkErrors > 0 ? t(" · 실패 {p0}건", { p0: chunkErrors }) : ""}</span>
            <span>AEC {processing.echoCancellation === false ? t("꺼짐") : t("켜짐")} · NS {processing.noiseSuppression === false ? t("꺼짐") : t("켜짐")} · AGC {processing.autoGainControl === false ? t("꺼짐") : t("켜짐")}</span>
          </div>
          <p className="text-[10px] leading-4">
            {t("편한 거리에서 말했을 때 레벨 8% 이상 + 두 VAD 모두 발화 감지면 정상. 레벨이 2% 미만이면 Windows 설정 &gt; 시스템 &gt; 소리 &gt; 입력에서 마이크 볼륨·증폭을 올리세요. 클라이언트 VAD만 감지되면 감지 임계값을 낮춰 보세요.")}</p>
          {(partial || finals.length > 0) && (
            <div className="min-h-0 text-[10px] leading-4">
              {partial && <div className="truncate text-[var(--foreground)]">{t("인식 중: ")}{partial}</div>}
              {finals.map((text, index) => (
                <div key={`${text}-${index}`} className="truncate text-emerald-600">{t("확정: ")}{text}</div>
              ))}
            </div>
          )}
        </>
      )}
      {lastError && <span className="text-[10px] text-amber-500">{lastError}</span>}
    </div>
  )
}
