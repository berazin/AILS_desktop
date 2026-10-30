import type { ComponentProps } from "react"
import { CachedTabViews } from "../../document/components/cached-tab-views.tsx"
import { useMaterialSearchModal } from "../../materials/hooks/use-material-search-modal.ts"
import { LearningDashboardSurface } from "./learning-dashboard-surface.tsx"

type Dashboard = ComponentProps<typeof LearningDashboardSurface>

function HomeTabDashboard({ tabId, dashboard }: { tabId: string; dashboard: Dashboard }) {
  const search = useMaterialSearchModal({
    cacheResults: true,
    onOpenResult: (result, context) => {
      if (dashboard.search.onOpenResult) dashboard.search.onOpenResult(result, context)
      else dashboard.search.controller.openResult(result)
    },
  })
  return <div className="flex min-h-0 min-w-0 flex-1" data-ails-home-tab-view={tabId}>
    <LearningDashboardSurface {...dashboard} search={{ controller: search }} />
  </div>
}

export function HomeTabDashboards({ activeId, openIds, dashboard }: {
  activeId: string; openIds: readonly string[]; dashboard: Dashboard
}) {
  // Every open Home owns its component state and DOM; hidden effects are suspended.
  return <CachedTabViews activeId={activeId} openIds={openIds} maxViews={Infinity}>
    <HomeTabDashboard tabId={activeId} dashboard={dashboard} />
  </CachedTabViews>
}
