import {
  SUMMARY_LOCAL_STT_ENABLED,
  SUMMARY_STT_ENABLED,
} from "../edition.ts"
import type { AILSConfig } from "./api"

const DEFAULT_CLOUD_STT_PROVIDER = "Gemini"
const DEFAULT_GEMINI_STT_MODEL = "gemini-3.5-flash-lite"

function isLocalSttProvider(value: unknown) {
  return /^local\s*\(/i.test(String(value ?? "").trim())
}

export function availableSttProviderOptions(providerOptions: readonly string[] | null | undefined) {
  const safeOptions = Array.isArray(providerOptions) ? providerOptions : []
  if (!SUMMARY_STT_ENABLED) return []
  if (SUMMARY_LOCAL_STT_ENABLED) return [...safeOptions]
  return safeOptions.filter((provider) => !isLocalSttProvider(provider))
}

export function formatModelDownloadSize(bytes: number) {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MiB`
}

export function normalizeSttConfigForEdition(
  config: AILSConfig,
  providerOptions: readonly string[] = [],
): AILSConfig {
  const editionConfig = config
  if (!SUMMARY_STT_ENABLED) return editionConfig
  if (SUMMARY_LOCAL_STT_ENABLED) return editionConfig
  if (!isLocalSttProvider(editionConfig.stt_provider) && !isLocalSttProvider(editionConfig.stt_model_name)) {
    return editionConfig
  }

  const cloudProviders = availableSttProviderOptions(providerOptions)
  const fallbackProvider = cloudProviders.includes(DEFAULT_CLOUD_STT_PROVIDER)
    ? DEFAULT_CLOUD_STT_PROVIDER
    : cloudProviders[0] ?? DEFAULT_CLOUD_STT_PROVIDER
  return {
    ...editionConfig,
    stt_provider: fallbackProvider,
    stt_model_name: fallbackProvider === DEFAULT_CLOUD_STT_PROVIDER ? DEFAULT_GEMINI_STT_MODEL : "",
  }
}
