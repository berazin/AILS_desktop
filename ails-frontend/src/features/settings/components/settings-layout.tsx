import type { ReactNode } from "react"

import { cn } from "../../../lib/utils.ts"

export const SETTINGS_SELECT_CLASS = "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--brand)]"

export function SettingsCard({ title, description, actions, children }: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-1">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-[var(--muted-foreground)] leading-5">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xs">
        {children}
      </div>
    </section>
  )
}

export function SettingsRow({ label, description, control, layout = "inline" }: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
  layout?: "inline" | "stacked"
}) {
  if (layout === "stacked") {
    return (
      <div className="border-t border-[var(--border)] px-5 py-4 first:border-t-0">
        <div className="text-sm font-medium text-[var(--foreground)]">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>}
        <div className="mt-3">{control}</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--foreground)]">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>}
      </div>
      <div className="w-full shrink-0 sm:w-64">{control}</div>
    </div>
  )
}

export function SettingsSwitch({ checked, disabled, onCheckedChange, ariaLabel }: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-transparent bg-[var(--foreground)]" : "border-[var(--border)] bg-[var(--muted)]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-[var(--background)] shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  )
}
