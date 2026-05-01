export const uiFocusRingClasses =
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export const uiInvalidStateClasses =
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

export const uiDisabledControlClasses =
  "disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:disabled:bg-input/80"

export const uiInputLikeBaseClasses = [
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2",
  "text-base transition-colors outline-none placeholder:text-muted-foreground md:text-sm",
  uiFocusRingClasses,
  uiInvalidStateClasses,
].join(" ")
