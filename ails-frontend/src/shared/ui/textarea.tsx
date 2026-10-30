import * as React from "react"

import { cn } from "../../lib/utils.ts"

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
      className,
    )}
    {...props}
  />
))
Textarea.displayName = "Textarea"
