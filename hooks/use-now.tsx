"use client";
import { useState, useEffect, useRef } from "react";

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => { clearInterval(timer); startedRef.current = false; };
  }, [intervalMs]);
  return now;
}

export function formatDuration(startedAt: string | null | undefined, finishedAt: string | null | undefined, now?: number): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : (now ?? Date.now());
  const diffMs = end - start;
  if (diffMs < 0) return null;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function LiveDuration({ startedAt, finishedAt, prefix, className }: { startedAt?: string | null; finishedAt?: string | null; prefix?: string; className?: string }) {
  const isLive = !!startedAt && !finishedAt;
  const now = useNow(isLive ? 1_000 : 60_000);
  const dur = formatDuration(startedAt, finishedAt, now.getTime());
  if (!dur) return null;
  if (className) return <span className={className}>{prefix}{dur}</span>;
  return <>{prefix}{dur}</>;
}
