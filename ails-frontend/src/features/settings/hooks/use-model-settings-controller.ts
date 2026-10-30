import { useState } from "react"

import { getModelOptions, type ModelOptionsPayload } from "../../../lib/api"

// The legacy provider/model editor is gone. This list supplies local voice
// model availability and the compact chatbot picker.
export function useModelSettingsController() {
  const [modelOptions, setModelOptions] = useState<ModelOptionsPayload | null>(null)

  async function loadOptions() {
    const options = await getModelOptions()
    setModelOptions(options)
    return options
  }

  return { modelOptions, setModelOptions, loadOptions }
}

export type ModelSettingsController = ReturnType<typeof useModelSettingsController>
