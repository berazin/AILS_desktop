import { useRef, useState } from "react"

import {
  cancelVoiceSession,
  downloadVoiceAgentModelStream,
  downloadVoiceModelStream,
  getVoiceStatus,
  sendVoiceChunk,
  startVoiceSession,
  stopVoiceSession,
  streamRealtimeVoiceAgent,
  warmupRealtimeVoiceAgent,
} from "../../../lib/api"
import {
  VoiceActivityDetector,
  VoiceSessionController,
  type VoiceSessionState,
} from "../lib/voice-session.ts"

export type VoiceInputState = "idle" | "starting" | "recording" | "stopping"

export function useVoiceController() {
  const [voiceState, setVoiceState] = useState<VoiceInputState>("idle")
  const [voiceStatusText, setVoiceStatusText] = useState("")
  const [voiceError, setVoiceError] = useState("")
  const [voiceSessionPhase, setVoiceSessionPhase] = useState<VoiceSessionState>("Idle")
  const [voiceAssistantText, setVoiceAssistantText] = useState("")
  const [voiceLatencyText, setVoiceLatencyText] = useState("")
  const voiceSessionIdRef = useRef("")
  const voiceMediaStreamRef = useRef<MediaStream | null>(null)
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const voiceProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const voiceChunkQueueRef = useRef<Promise<void>>(Promise.resolve())
  const voicePendingChunkCountRef = useRef(0)
  const voiceTranscriptVersionRef = useRef(0)
  const voiceControllerRef = useRef<VoiceSessionController | null>(null)
  const voiceVadRef = useRef(new VoiceActivityDetector())
  const voiceEngineRef = useRef<"" | "windows" | "whisper">("")
  const voiceWhisperSpeechActiveRef = useRef(false)
  const voiceWindowsUnsubscribeRef = useRef<null | (() => void)>(null)
  const voiceWorkAcknowledgedRef = useRef(false)
  const voiceSessionPhaseRef = useRef<VoiceSessionState>("Idle")
  const voiceEchoGuardUntilRef = useRef(0)
  const voiceOutputActiveRef = useRef(false)
  const voiceAecActiveRef = useRef(true)
  const agentMetaRef = useRef<{ model: string; provider: string }>({ model: "", provider: "" })

  return {
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
      voiceAssistantText,
      voiceError,
      voiceLatencyText,
      voiceSessionPhase,
      voiceState,
      voiceStatusText,
    },
  }
}

export type VoiceController = ReturnType<typeof useVoiceController>
