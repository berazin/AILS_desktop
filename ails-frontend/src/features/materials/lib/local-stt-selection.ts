export function resolveLocalSttSelection(selection: boolean | null, configuredProvider: unknown): boolean {
  return selection ?? String(configuredProvider ?? "").includes("whisper.cpp")
}
