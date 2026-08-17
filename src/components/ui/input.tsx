import * as React from "react"

import { cn } from "@/shared/lib/format/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // Native date inputs don't support ::placeholder, so Chrome renders the
  // "dd-mm-yyyy" hint in the input's text color — indistinguishable from a
  // real date. Mute the whole field until a value is entered so the empty
  // state reads as a placeholder. (All date usages in this app are controlled.)
  // The empty state is kept fainter than normal placeholder text — a hint,
  // never data.
  const emptyDate = type === "date" && (props.value ?? "") === ""
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        emptyDate && "text-muted-foreground/60",
        className
      )}
      {...props}
    />
  )
}

export { Input }
