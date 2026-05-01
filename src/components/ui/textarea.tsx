import * as React from "react"

import { cn } from "@/lib/utils"
import {
  uiDisabledControlClasses,
  uiInputLikeBaseClasses,
} from "@/components/ui/ui-classnames"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        uiInputLikeBaseClasses,
        "flex field-sizing-content min-h-20 dark:bg-input/30",
        uiDisabledControlClasses,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
