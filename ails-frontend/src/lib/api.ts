// Domain-split backend API client. One module per backend route family;
// this barrel re-exports everything so `import { ... } from "./api"`
// keeps its original compile-time and runtime surface.
export * from "./api/core.ts"
export * from "./api/config.ts"
export * from "./api/materials.ts"
export * from "./api/material-practice.ts"
export * from "./api/practice-rounds.ts"
export * from "./api/notebook.ts"
export * from "./api/background-work.ts"
export * from "./api/voice.ts"
export * from "./api/chatbot.ts"
export * from "./api/chatbot-catalog.ts"
export * from "./api/code-sandbox.ts"
export * from "./api/pdf-study.ts"
export * from "./api/language-profiles.ts"
export * from "./api/developer-tools.ts"
/* @ails-feature:user_memory:start */
export * from "./api/memory.ts"
/* @ails-feature:user_memory:end */
export * from "./api/compliance.ts"
export * from "./api/summary-tasks.ts"
export * from "./api/work-preflight.ts"
export * from "./api/reports.ts"
export * from "./api/managed-auth.ts"
export * from "./api/pdf-ocr.ts"
export * from "./api/pdf-problems.ts"
export * from "./api/managed-ai-policy.ts"
export * from "./api/material-search.ts"
