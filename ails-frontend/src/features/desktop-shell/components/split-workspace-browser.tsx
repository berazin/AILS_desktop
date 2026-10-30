import type { ComponentProps } from "react"
import type { WorkbenchLayoutModel } from "../../code-sandbox/workspaces/folder-workbench-layout.tsx"
import { LearningDashboardSurface } from "./learning-dashboard-surface.tsx"

export function SplitWorkspaceBrowser({ dashboard, workbench }: {
  dashboard: ComponentProps<typeof LearningDashboardSurface>; workbench: WorkbenchLayoutModel
}) {
  return <LearningDashboardSurface {...dashboard} workspaceOnly
    navigation={{ ...dashboard.navigation, openFile: (path) => { void workbench.controller.openSplitFile(path) } }}
    pdf={{ ...dashboard.pdf, onOpenAtPage: (path, page) => {
      void workbench.controller.openSplitFile(path).then((document) => {
        if (document) workbench.onPdfPageChange(document, page)
      })
    } }} />
}
