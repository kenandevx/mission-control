"use client";

type ContainerLoaderProps = {
  label?: string;
  className?: string;
};

export function ContainerLoader({ label = "Loading…", className = "" }: ContainerLoaderProps) {
  return (
    <div className={`absolute inset-0 z-10 flex items-center justify-center bg-background/92 ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <span className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
