"use client"

import * as React from "react"

import { cn } from "@/shared/lib/format/utils"

const tableWrapperClasses = "relative w-full overflow-x-auto"
const tableBaseClasses = "w-full caption-bottom text-sm"
// Hover and selection are the two signals that tell an operator which line
// they are on, so they must be visible on a dense 1000-row grid — the old
// muted/50 wash was not. Both are opaque mixes against the page background, so
// they read the same in light and dark, and tailwind-merge lets a page pass its
// own bg-* to override (see gridRowClass in shared/lib/format/gridRow).
const tableInteractiveRowClasses =
  "border-b transition-colors hover:bg-[color-mix(in_oklab,var(--primary)_12%,var(--background))] has-aria-expanded:bg-muted/50 data-[state=selected]:bg-[color-mix(in_oklab,#0ea5e9_14%,var(--background))]"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className={tableWrapperClasses}
    >
      <table
        data-slot="table"
        className={cn(tableBaseClasses, className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(tableInteractiveRowClasses, className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 px-3 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
