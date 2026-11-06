"use client";

// A "?" button that opens a short how-to for the screen it sits on. Any page
// can use it: pass a title and the help as children.

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function HelpButton({ title, children, label = "Help" }: { title: string; children: ReactNode; label?: string }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label={`${label}: ${title}`}>
                    <CircleHelp size={14} /> {label}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><CircleHelp size={18} /> {title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm leading-relaxed">{children}</div>
            </DialogContent>
        </Dialog>
    );
}
