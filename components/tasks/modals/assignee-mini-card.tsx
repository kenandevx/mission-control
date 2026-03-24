"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  initials: string;
  subtitle: string;
  selected?: boolean;
  onClick?: () => void;
};

export function AssigneeMiniCard({
  name,
  initials,
  subtitle,
  selected = false,
  onClick,
}: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-auto min-w-44 justify-start rounded-xl border px-3 py-2 text-left",
        "bg-card/70 transition-colors hover:bg-card",
        selected
          ? "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
          : "border-border/70",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary/80 text-[10px] text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </Button>
  );
}
