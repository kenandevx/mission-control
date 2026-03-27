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
  totalEvents: number;
  notRanYetCount: number;
  failedCount: number;
};

async function fetchStats(): Promise<AgendaStats> {
  const res = await fetch("/api/agenda/stats", { cache: "reload" });
  const json = await res.json();
  return {
    totalEvents: json.totalEvents ?? 0,
    notRanYetCount: json.notRanYetCount ?? 0,
    failedCount: json.failedCount ?? 0,
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
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-3">
      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Total Events</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats.totalEvents}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Events
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">All agenda events</div>
          <div className="text-muted-foreground">Draft + active</div>
        </CardFooter>
      </Card>

      <Card data-slot="card">
        <CardHeader>
          <CardDescription>Not Ran Yet</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats.notRanYetCount}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              Pending
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Queued + scheduled occurrences</div>
          <div className="text-muted-foreground">Active events only</div>
        </CardFooter>
      </Card>

      <Card data-slot="card" className={stats.failedCount > 0 ? "border-red-200 dark:border-red-900" : ""}>
        <CardHeader>
          <CardDescription>Failed Count</CardDescription>
          <CardTitle className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${stats.failedCount > 0 ? "text-red-600" : ""}`}>
            {stats.failedCount}
          </CardTitle>
          <CardAction>
            <Badge variant={stats.failedCount > 0 ? "destructive" : "outline"}>
              <IconTrendingUp />
              {stats.failedCount > 0 ? "Attention" : "Clean"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Failed + needs retry + expired</div>
          <div className="text-muted-foreground">Across all occurrences</div>
        </CardFooter>
      </Card>
    </div>
  );
}
