"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
};

export function MetaPill({ icon, label, onClick, className }: Props) {
  if (onClick) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className={cn(
          "h-8 rounded-full border border-border/70 bg-muted/35 px-3 text-xs text-muted-foreground hover:bg-muted/55",
          className,
        )}
      >
        <span className="opacity-80">{icon}</span>
        <span>{label}</span>
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="opacity-80">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
