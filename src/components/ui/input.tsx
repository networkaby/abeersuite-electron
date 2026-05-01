import * as React from "react"

import { cn } from "@/lib/utils"
import {
  uiDisabledControlClasses,
  uiInputLikeBaseClasses,
} from "@/components/ui/ui-classnames"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        uiInputLikeBaseClasses,
        "h-9 disabled:pointer-events-none dark:bg-input/30",
        uiDisabledControlClasses,
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
