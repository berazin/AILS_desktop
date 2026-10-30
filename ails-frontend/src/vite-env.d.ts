/// <reference types="vite/client" />

declare const __AILS_EDITION__: "personal" | "developer" | "commercial" | "general"
declare const __AILS_EDITION_MANIFEST_SHA256__: string
declare const __AILS_EDITION_FEATURES__: Readonly<Record<string, boolean>>
declare const __AILS_DEFAULT_TASK_TAB__: "url" | "media" | "markdown"
declare const __AILS_SUMMARY_GENERATION__: boolean
