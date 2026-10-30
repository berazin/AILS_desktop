import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

export function CalloutBlock({
  children,
  defaultOpen,
  title,
  className,
}: {
  children: ReactNode
  defaultOpen: boolean
  title: string
  className: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <aside className={`my-4 overflow-hidden rounded-xl border ${className}`}>
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:hover:bg-white/5"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronDown
          className={`shrink-0 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
          size={16}
        />
        <span>{title}</span>
      </button>
      {open && <div className="px-4 pb-3 prose-p:my-2 prose-ul:my-2 prose-ol:my-2">{children}</div>}
    </aside>
  )
}
