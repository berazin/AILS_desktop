import * as React from "react"
import { cn } from "../../lib/utils.ts"

const baseClass = "ails-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 outline-none active:scale-[0.98] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
const variantClasses = {
  default: "ails-button-brand bg-[var(--brand)] text-[var(--brand-foreground)]",
  secondary: "ails-button-neutral bg-[var(--muted)] text-[var(--foreground)]",
  ghost: "ails-button-neutral text-[var(--foreground)]",
  outline: "ails-button-neutral border border-[var(--border)] bg-transparent text-[var(--foreground)]",
  danger: "ails-button-danger border border-red-500/80 bg-[var(--background)] text-red-500 hover:bg-red-500/10 focus-visible:ring-red-500",
} as const
const sizeClasses = {
  sm: "h-8 px-3",
  md: "h-9 px-4",
  lg: "h-10 px-5",
  icon: "h-9 w-9",
} as const

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantClasses
  size?: keyof typeof sizeClasses
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      className={cn(baseClass, variantClasses[variant], sizeClasses[size], className)}
      ref={ref}
      {...props}
    />
  ),
)
Button.displayName = "Button"
