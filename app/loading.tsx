export default function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/92" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <span className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
