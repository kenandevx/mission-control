"use client";

import { useEffect, useRef, useState } from "react";
import { IconTrendingUp } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AgendaStats = {
  activeEvents: number;
  todayOccurrences: number;
  failedLast24h: number;
  totalProcesses: number;
  publishedProcesses: number;
};

async function fetchStats(): Promise<AgendaStats> {
  const res = await fetch("/api/agenda/stats", { cache: "reload" });
  const json = await res.json();
  return {
    activeEvents: json.activeEvents ?? 0,
    todayOccurrences: json.todayOccurrences ?? 0,
    failedLast24h: json.failedLast24h ?? 0,
    totalProcesses: json.totalProcesses ?? 0,
    publishedProcesses: json.publishedProcesses ?? 0,
  };
}

export function AgendaStatsCards() {
  const [stats, setStats] = useState<AgendaStats | null>(null);
  const [error, setError] = useState(false);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchStats();
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    void load();

    const interval = setInterval(() => void load(), 30_000);

    const handler = () => void load();
    document.addEventListener("agenda-refresh", handler);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener("agenda-refresh", handler);
    };
  }, []);

  if (error) return null;

  if (!stats) {
    return (
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} data-slot="card">
            <CardHeader>
              <CardDescription className="h-4 w-24 animate-pulse bg-muted rounded" />
              <CardTitle className="h-8 w-16 animate-pulse bg-muted rounded mt-1" />
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="h-4 w-32 animate-pulse bg-muted rounded" />
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-4">
      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Active Events</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats.activeEvents}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Scheduled
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Active agenda events</div>
          <div className="text-muted-foreground">Currently scheduled</div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Today&apos;s Runs</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats.todayOccurrences}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Occurrences
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Runs scheduled today</div>
          <div className="text-muted-foreground">All active events</div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Processes</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats.publishedProcesses}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              / {stats.totalProcesses}
            </span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Published
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Published processes</div>
          <div className="text-muted-foreground">Out of total</div>
        </CardFooter>
      </Card>

      <Card data-slot="card" className={stats.failedLast24h > 0 ? "border-red-200 dark:border-red-900" : ""}>
        <CardHeader>
          <CardDescription>Failed (24h)</CardDescription>
          <CardTitle className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${stats.failedLast24h > 0 ? "text-red-600" : ""}`}>
            {stats.failedLast24h}
          </CardTitle>
          <CardAction>
            <Badge variant={stats.failedLast24h > 0 ? "destructive" : "outline"}>
              <IconTrendingUp />
              {stats.failedLast24h > 0 ? "Attention" : "No failures"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Failed runs last 24h</div>
          <div className="text-muted-foreground">All occurrences</div>
        </CardFooter>
      </Card>
    </div>
  );
}
