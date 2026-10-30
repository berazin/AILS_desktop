export type VoiceSessionState =
  | "Idle"
  | "Listening"
  | "UserSpeaking"
  | "Thinking"
  | "ExecutingTool"
  | "Speaking"
  | "Interrupted"
  | "Stopping"

export type VoiceLatencySnapshot = {
  generation: number
  events: Partial<Record<keyof TurnClock, number>>
  speechToFinalMs?: number
  speechEndToFirstAudioMs?: number
  finalToFirstTokenMs?: number
  finalToToolStartMs?: number
  llmToFirstAudioMs?: number
  firstTokenToFirstAudioMs?: number
  finalToFirstAudioMs?: number
  bargeInToStopMs?: number
}

type VoiceSessionCallbacks = {
  onState?: (state: VoiceSessionState) => void
  onAssistantText?: (text: string) => void
  onLatency?: (latency: VoiceLatencySnapshot) => void
  onPlaybackChange?: (playing: boolean) => void
}

type TurnClock = {
  speechDetected?: number
  speechEnded?: number
  firstHypothesis?: number
  sttFinal?: number
  llmRequest?: number
  firstToken?: number
  firstTool?: number
  toolCompleted?: number
  firstAudio?: number
  playbackStarted?: number
  bargeIn?: number
  playbackStopped?: number
}

const now = () => performance.now()

const SPEECHLESS_TEXT = /^[\s.,?!;:~·…\-—_"'`()[\]{}<>「」『』]+$/

export function hasSpeechText(text: string) {
  const trimmed = text.trim()
  return trimmed.length > 0 && !SPEECHLESS_TEXT.test(trimmed)
}

function normalizeSpeechText(text: string) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>]+/g, " ").replace(/\s+/g, " ").trim()
}

export function takeSemanticSpeechChunks(source: string, flush = false) {
  const chunks: string[] = []
  let rest = source
  while (rest.length >= 24) {
    const searchLimit = Math.min(rest.length, 140)
    const window = rest.slice(0, searchLimit)
    const matches = [...window.matchAll(/[.!?。！？]|[.?!]\s|[다요죠임됨함]\.(?:\s|$)/g)]
    const preferred = matches.find((match) => (match.index ?? 0) >= 32) ?? matches.at(-1)
    const fallback = window.lastIndexOf(" ", 120)
    const end = preferred
      ? (preferred.index ?? 0) + preferred[0].length
      : rest.length > 140 && fallback >= 48 ? fallback : -1
    if (end < 0) break
    const chunk = normalizeSpeechText(rest.slice(0, end))
    if (chunk) chunks.push(chunk)
    rest = rest.slice(end).trimStart()
  }
  if (flush) {
    const tail = normalizeSpeechText(rest)
    if (tail) chunks.push(tail)
    rest = ""
  }
  return { chunks, rest }
}

export class VoiceActivityDetector {
  private noiseFloor = 0.004
  private speaking = false
  private aboveFrames = 0
  private belowFrames = 0

  accept(samples: Float32Array) {
    let sum = 0
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index]
    const rms = Math.sqrt(sum / Math.max(1, samples.length))
    if (!this.speaking && rms < this.noiseFloor * 2.2) {
      this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
    }
    const active = rms >= Math.max(0.012, this.noiseFloor * 3.2)
    this.aboveFrames = active ? this.aboveFrames + 1 : 0
    this.belowFrames = active ? 0 : this.belowFrames + 1
    if (!this.speaking && this.aboveFrames >= 2) {
      this.speaking = true
      this.belowFrames = 0
      return "started" as const
    }
    if (this.speaking && this.belowFrames >= 5) {
      this.speaking = false
      this.aboveFrames = 0
      return "ended" as const
    }
    return "none" as const
  }

  reset() {
    this.speaking = false
    this.aboveFrames = 0
    this.belowFrames = 0
  }
}

export class VoiceSessionController {
  private state: VoiceSessionState = "Idle"
  private generation = 0
  private abortController: AbortController | null = null
  private ttsBuffer = ""
  private assistantText = ""
  private clocks = new Map<number, TurnClock>()
  private callbacks: VoiceSessionCallbacks

  constructor(callbacks: VoiceSessionCallbacks = {}) {
    this.callbacks = callbacks
  }

  start() {
    this.transition("Listening")
  }

  stop() {
    this.transition("Stopping")
    this.cancelCurrent(false)
    this.clocks.clear()
    this.transition("Idle")
  }

  markFirstHypothesis() {
    const clock = this.clocks.get(this.generation)
    if (clock && clock.firstHypothesis === undefined) clock.firstHypothesis = now()
  }

  onUserSpeechStarted() {
    const speechAt = now()
    const shouldInterrupt = ["Thinking", "ExecutingTool", "Speaking"].includes(this.state)
    if (shouldInterrupt) {
      const clock = this.clocks.get(this.generation) ?? {}
      clock.bargeIn = speechAt
      this.clocks.set(this.generation, clock)
      this.transition("Interrupted")
      this.cancelCurrent(true)
    }
    const current = this.clocks.get(this.generation) ?? {}
    current.speechDetected = speechAt
    this.clocks.set(this.generation, current)
    this.transition("UserSpeaking")
  }

  onUserSpeechEnded() {
    const clock = this.clocks.get(this.generation) ?? {}
    clock.speechEnded = now()
    this.clocks.set(this.generation, clock)
    if (this.state === "UserSpeaking") this.transition("Listening")
  }

  beginTurn() {
    this.cancelCurrent(false)
    this.generation += 1
    const generation = this.generation
    const started = now()
    const previous = this.clocks.get(generation - 1)
    this.clocks.clear()
    this.clocks.set(generation, {
      speechDetected: previous?.speechDetected,
      speechEnded: previous?.speechEnded,
      firstHypothesis: previous?.firstHypothesis,
      sttFinal: started,
    })
    this.abortController = new AbortController()
    this.ttsBuffer = ""
    this.assistantText = ""
    this.callbacks.onAssistantText?.("")
    this.transition("Thinking")
    return { generation, signal: this.abortController.signal }
  }

  acceptToken(generation: number, token: string) {
    if (!this.isCurrent(generation) || !token) return
    const clock = this.clocks.get(generation) ?? {}
    if (clock.firstToken === undefined) clock.firstToken = now()
    this.clocks.set(generation, clock)
    this.assistantText += token
    this.callbacks.onAssistantText?.(this.assistantText)
    this.ttsBuffer += token
    const { chunks, rest } = takeSemanticSpeechChunks(this.ttsBuffer)
    this.ttsBuffer = rest
    for (const chunk of chunks) this.enqueueSpeech(generation, chunk)
  }

  markLlmRequest(generation: number) {
    if (!this.isCurrent(generation)) return
    const clock = this.clocks.get(generation) ?? {}
    if (clock.llmRequest === undefined) clock.llmRequest = now()
    this.clocks.set(generation, clock)
  }

  markToolStarted(generation: number) {
    if (!this.isCurrent(generation)) return
    const clock = this.clocks.get(generation) ?? {}
    if (clock.firstTool === undefined) clock.firstTool = now()
    this.clocks.set(generation, clock)
    this.transition("ExecutingTool")
  }

  markToolCompleted(generation: number) {
    if (!this.isCurrent(generation)) return
    const clock = this.clocks.get(generation) ?? {}
    clock.toolCompleted = now()
    this.clocks.set(generation, clock)
    this.transition("Thinking")
  }

  finishTurn(generation: number, finalText = this.assistantText) {
    if (!this.isCurrent(generation)) return
    if (!this.assistantText && finalText) {
      this.assistantText = finalText
      this.callbacks.onAssistantText?.(finalText)
      this.ttsBuffer += finalText
    }
    const { chunks } = takeSemanticSpeechChunks(this.ttsBuffer, true)
    this.ttsBuffer = ""
    for (const chunk of chunks) this.enqueueSpeech(generation, chunk)
    if (!("speechSynthesis" in window) || (!window.speechSynthesis.speaking && !window.speechSynthesis.pending)) {
      this.transition("Listening")
      this.reportLatency(generation)
    }
  }

  failTurn(generation: number) {
    if (!this.isCurrent(generation)) return
    this.cancelCurrent(false)
    this.transition("Listening")
  }

  currentGeneration() {
    return this.generation
  }

  private enqueueSpeech(generation: number, text: string) {
    if (!this.isCurrent(generation) || !("speechSynthesis" in window) || !text) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = "ko-KR"
    utterance.rate = 1.05
    utterance.onstart = () => {
      if (!this.isCurrent(generation)) {
        window.speechSynthesis.cancel()
        return
      }
      const clock = this.clocks.get(generation) ?? {}
      const started = now()
      if (clock.firstAudio === undefined) clock.firstAudio = started
      if (clock.playbackStarted === undefined) clock.playbackStarted = started
      this.clocks.set(generation, clock)
      this.callbacks.onPlaybackChange?.(true)
      this.transition("Speaking")
    }
    utterance.onend = () => {
      if (!this.isCurrent(generation) || window.speechSynthesis.speaking || window.speechSynthesis.pending) return
      this.callbacks.onPlaybackChange?.(false)
      this.transition("Listening")
      this.reportLatency(generation)
    }
    utterance.onerror = (event) => {
      if (!this.isCurrent(generation) || event.error === "interrupted" || event.error === "canceled") return
      this.callbacks.onPlaybackChange?.(false)
      this.transition("Listening")
      this.reportLatency(generation)
    }
    window.speechSynthesis.speak(utterance)
  }

  private cancelCurrent(reportBargeIn: boolean) {
    this.abortController?.abort()
    this.ttsBuffer = ""
    if ("speechSynthesis" in window) window.speechSynthesis.cancel()
    this.callbacks.onPlaybackChange?.(false)
    if (reportBargeIn) {
      const clock = this.clocks.get(this.generation) ?? {}
      clock.playbackStopped = now()
      this.clocks.set(this.generation, clock)
      this.reportLatency(this.generation)
    }
  }

  private isCurrent(generation: number) {
    return generation === this.generation && !this.abortController?.signal.aborted
  }

  private transition(state: VoiceSessionState) {
    if (this.state === state) return
    this.state = state
    this.callbacks.onState?.(state)
  }

  private reportLatency(generation: number) {
    const clock = this.clocks.get(generation)
    if (!clock) return
    const latency: VoiceLatencySnapshot = {
      generation,
      events: { ...clock },
      ...(clock.speechDetected !== undefined && clock.sttFinal !== undefined
        ? { speechToFinalMs: clock.sttFinal - clock.speechDetected }
        : {}),
      ...(clock.speechEnded !== undefined && clock.firstAudio !== undefined
        ? { speechEndToFirstAudioMs: clock.firstAudio - clock.speechEnded }
        : {}),
      ...(clock.sttFinal !== undefined && clock.firstToken !== undefined
        ? { finalToFirstTokenMs: clock.firstToken - clock.sttFinal }
        : {}),
      ...(clock.sttFinal !== undefined && clock.firstTool !== undefined
        ? { finalToToolStartMs: clock.firstTool - clock.sttFinal }
        : {}),
      ...(clock.llmRequest !== undefined && clock.firstAudio !== undefined
        ? { llmToFirstAudioMs: clock.firstAudio - clock.llmRequest }
        : {}),
      ...(clock.firstToken !== undefined && clock.firstAudio !== undefined
        ? { firstTokenToFirstAudioMs: clock.firstAudio - clock.firstToken }
        : {}),
      ...(clock.sttFinal !== undefined && clock.firstAudio !== undefined
        ? { finalToFirstAudioMs: clock.firstAudio - clock.sttFinal }
        : {}),
      ...(clock.bargeIn !== undefined && clock.playbackStopped !== undefined
        ? { bargeInToStopMs: clock.playbackStopped - clock.bargeIn }
        : {}),
    }
    console.info("[AILS voice latency]", latency)
    this.callbacks.onLatency?.(latency)
  }
}
