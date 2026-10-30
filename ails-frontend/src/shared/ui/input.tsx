import * as React from "react"

import { cn } from "../../lib/utils.ts"

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = "Input"
