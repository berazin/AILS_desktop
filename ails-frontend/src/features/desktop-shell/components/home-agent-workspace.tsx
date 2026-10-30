import type { ReactNode } from "react"

export function HomeAgentWorkspace({ agent }: { agent: ReactNode; onOpenDashboard?: () => void }) {
  return (
    <section className="ails-home-enter relative flex h-full min-h-0 flex-1 overflow-hidden bg-[#f8f9fd] dark:bg-[#0b0d14]" data-ails-home-surface="true">
      {agent}
    </section>
  )
}
