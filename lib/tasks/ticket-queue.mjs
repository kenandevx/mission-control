import { Queue } from "bullmq";

let queueInstance = null;

function getRedisConnection() {
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

export function getTicketQueue() {
  if (!queueInstance) {
    queueInstance = new Queue("tickets", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }
  return queueInstance;
}

export async function enqueueTicket(ticketId, data = {}) {
  if (!ticketId) return null;
  const queue = getTicketQueue();
  return queue.add("process-ticket", { ticketId: String(ticketId), ...data }, { jobId: `ticket-${ticketId}` });
}
