export const USER_MEMORY_ENABLED = Boolean(__AILS_EDITION_FEATURES__["user_memory"])
export const INSIGHT_BOOK_ENABLED = Boolean(__AILS_EDITION_FEATURES__["insight_book"])
export const IDE_ENABLED = Boolean(__AILS_EDITION_FEATURES__["ide"])
export const AILS_EDITION = __AILS_EDITION__
export const EDITION_MANIFEST_SHA256 = __AILS_EDITION_MANIFEST_SHA256__
export const EDITION_FEATURES = __AILS_EDITION_FEATURES__
export const SUMMARY_AUDIO_PDF_ENABLED = Boolean(EDITION_FEATURES["summary.audio_pdf"])
export const SUMMARY_LOCAL_STT_ENABLED = Boolean(EDITION_FEATURES["summary.local_stt"])
export const SUMMARY_MEDIA_FILES_ENABLED = Boolean(EDITION_FEATURES["summary.media_files"])
export const SUMMARY_WEB_INPUTS_ENABLED = Boolean(EDITION_FEATURES["summary.web_inputs"])
export const SUMMARY_GENERATION_ENABLED = __AILS_SUMMARY_GENERATION__
export const SUMMARY_STT_ENABLED = SUMMARY_AUDIO_PDF_ENABLED || SUMMARY_MEDIA_FILES_ENABLED || SUMMARY_WEB_INPUTS_ENABLED
export const DEVELOPER_TOOLS_ENABLED = Boolean(EDITION_FEATURES["developer_tools"])
export const LOCAL_AI_SETTINGS_ENABLED = AILS_EDITION === "developer" || AILS_EDITION === "personal"
export const DEFAULT_TASK_TAB = __AILS_DEFAULT_TASK_TAB__

export const PERSONAL_MODE = AILS_EDITION === "personal"
