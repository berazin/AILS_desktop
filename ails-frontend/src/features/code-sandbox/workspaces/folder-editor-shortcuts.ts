import { CODE_SHORTCUT_DEFINITIONS } from "../lib/code-shortcuts.ts"

// Learning/AI shortcuts are deliberately not part of the folder workbench.
export const FOLDER_SHORTCUT_DEFINITIONS = CODE_SHORTCUT_DEFINITIONS.filter((item) => item.group !== "학습 및 AI")
export const FOLDER_SHORTCUT_ACTIONS = FOLDER_SHORTCUT_DEFINITIONS.map((item) => item.action)
