import type { Job } from "@/lib/types";

export async function appendJobLog(_job: Job): Promise<{
  rootHash: string;
} | null> {
  return null;
}

export async function readState<T>(_key: string): Promise<T | null> {
  return null;
}

export async function writeState<T>(
  _key: string,
  _value: T,
): Promise<{ rootHash: string } | null> {
  return null;
}

export async function listRecentJobLogs(_limit = 50): Promise<Job[]> {
  return [];
}
