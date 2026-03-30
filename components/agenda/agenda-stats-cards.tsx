"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { IconTrendingUp } from "@tabler/icons-react";
import { ContainerLoader } from "@/components/ui/container-loader";
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

    const handler = () => void load();
    document.addEventListener("agenda-refresh", handler);
    document.addEventListener("agenda-stats-refresh", handler);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      document.removeEventListener("agenda-refresh", handler);
      document.removeEventListener("agenda-stats-refresh", handler);
    };
  }, []);

  if (error) return null;

  return (
    <div className="relative min-h-[170px]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: stats ? 1 : 0.35 }}
        transition={{ duration: 0.16 }}
        className="*:data-[slot=card]:from-primary/12 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 md:grid-cols-3"
      >
      <Card data-slot="card" className="min-h-[150px]">
        <CardHeader>
          <CardDescription>Total Events</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats ? (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>{stats.totalEvents}</motion.span>
            ) : "—"}
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

      <Card data-slot="card" className="min-h-[150px]">
        <CardHeader>
          <CardDescription>Not Ran Yet</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats ? (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>{stats.notRanYetCount}</motion.span>
            ) : "—"}
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

      <Card data-slot="card" className={`min-h-[150px] ${stats && stats.failedCount > 0 ? "border-red-200 dark:border-red-900" : ""}`}>
        <CardHeader>
          <CardDescription>Failed Count</CardDescription>
          <CardTitle className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${stats && stats.failedCount > 0 ? "text-red-600" : ""}`}>
            {stats ? (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>{stats.failedCount}</motion.span>
            ) : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant={stats && stats.failedCount > 0 ? "destructive" : "outline"}>
              <IconTrendingUp />
              {stats && stats.failedCount > 0 ? "Attention" : "Clean"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">Failed + needs retry</div>
          <div className="text-muted-foreground">Across all occurrences</div>
        </CardFooter>
      </Card>
      </motion.div>

      {!stats ? <ContainerLoader label="Loading stats…" /> : null}
    </div>
  );
}
