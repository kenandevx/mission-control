import { NextResponse } from "next/server";
import { Queue } from "bullmq";

export const dynamic = "force-dynamic";

function getRedisConnection() {
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

type QueueInfo = {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  jobs: Array<{
    id: string;
    name: string;
    data: Record<string, unknown>;
    state: string;
    attemptsMade: number;
    timestamp: number;
    processedOn: number | null;
    finishedOn: number | null;
    delay: number;
    failedReason?: string;
  }>;
};

async function getQueueInfo(queueName: string): Promise<QueueInfo> {
  const queue = new Queue(queueName, { connection: getRedisConnection() });
  try {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      Promise.resolve(0), // paused count not available in this BullMQ version
    ]);

    // Get all non-completed jobs for display
    const [waitingJobs, activeJobs, delayedJobs, failedJobs] = await Promise.all([
      queue.getWaiting(0, 50),
      queue.getActive(0, 50),
      queue.getDelayed(0, 50),
      queue.getFailed(0, 50),
    ]);

    const allJobs = [...activeJobs, ...waitingJobs, ...delayedJobs, ...failedJobs];

    const jobs = allJobs.map((job) => ({
      id: job.id ?? "",
      name: job.name ?? "",
      data: (job.data ?? {}) as Record<string, unknown>,
      state: job.failedReason ? "failed" : activeJobs.includes(job) ? "active" : delayedJobs.includes(job) ? "delayed" : "waiting",
      attemptsMade: job.attemptsMade ?? 0,
      timestamp: job.timestamp ?? 0,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      delay: job.delay ?? 0,
      failedReason: job.failedReason ?? undefined,
    }));

    return { name: queueName, waiting, active, completed, failed, delayed, paused, jobs };
  } finally {
    await queue.close();
  }
}

export async function GET() {
  try {
    const [tickets, agenda] = await Promise.all([
      getQueueInfo("tickets"),
      getQueueInfo("agenda"),
    ]);
    return NextResponse.json({ ok: true, queues: [tickets, agenda] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch queues";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    const queueName = String(body.queue || "");
    const jobId = body.jobId ? String(body.jobId) : null;

    if (!["removeJob", "retryJob", "promoteJob", "drainQueue", "cleanQueue", "pauseQueue", "resumeQueue"].includes(action)) {
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    if (!queueName) {
      return NextResponse.json({ ok: false, error: "Missing queue name" }, { status: 400 });
    }

    const queue = new Queue(queueName, { connection: getRedisConnection() });

    try {
      if (action === "removeJob" && jobId) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          return NextResponse.json({ ok: true, message: `Job ${jobId} removed` });
        }
        return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
      }

      if (action === "retryJob" && jobId) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.retry();
          return NextResponse.json({ ok: true, message: `Job ${jobId} retried` });
        }
        return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
      }

      if (action === "promoteJob" && jobId) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.promote();
          return NextResponse.json({ ok: true, message: `Job ${jobId} promoted to waiting (will run next)` });
        }
        return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
      }

      if (action === "drainQueue") {
        await queue.drain();
        return NextResponse.json({ ok: true, message: `Queue ${queueName} drained (waiting jobs removed)` });
      }

      if (action === "cleanQueue") {
        await queue.clean(0, 1000, "completed");
        await queue.clean(0, 1000, "failed");
        await queue.clean(0, 1000, "delayed");
        await queue.clean(0, 1000, "wait");
        await queue.drain();
        return NextResponse.json({ ok: true, message: `Queue ${queueName} fully cleaned` });
      }

      if (action === "pauseQueue") {
        await queue.pause();
        return NextResponse.json({ ok: true, message: `Queue ${queueName} paused` });
      }

      if (action === "resumeQueue") {
        await queue.resume();
        return NextResponse.json({ ok: true, message: `Queue ${queueName} resumed` });
      }

      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    } finally {
      await queue.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue action failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
