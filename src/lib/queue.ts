import type { Env } from "../env";
import type { Job } from "./jobs";

export async function enqueue(env: Env, job: Job) {
  if (!env.JOBS) throw new Error("Queue binding JOBS is missing");
  await env.JOBS.send(job);
}
