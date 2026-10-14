// Starts the production server for the e2e run (unless E2E_URL points at one that is already up).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

let server: ChildProcess | null = null;

async function waitFor(url: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start at ${url}`);
}

export async function setup(): Promise<void> {
  if (process.env.E2E_URL) return;
  const port = 3199;
  server = spawn('npx', ['next', 'start', '-p', String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'ignore' });
  process.env.E2E_URL = `http://localhost:${port}`;
  await waitFor(process.env.E2E_URL, 60_000);
}

export async function teardown(): Promise<void> {
  server?.kill('SIGTERM');
}
