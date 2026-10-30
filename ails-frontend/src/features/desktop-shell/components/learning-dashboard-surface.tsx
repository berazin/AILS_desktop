import type { ComponentProps } from "react"
import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"
import type { LearningDashboardSurface as Runtime } from "./learning-dashboard-surface-runtime.tsx"

export const LearningDashboardSurface = createDeferredComponent<ComponentProps<typeof Runtime>>(
  () => import("./learning-dashboard-surface-runtime.tsx").then(module => module.LearningDashboardSurface),
  "자료 작업공간",
)
