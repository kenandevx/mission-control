"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

type Props = {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
};

export function SectionCardHeader({ label, count, collapsed, onToggle }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{label}</p>
        {typeof count === "number" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={`Toggle ${label}`}>
        <ChevronDownIcon className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")} />
      </Button>
    </div>
  );
}
