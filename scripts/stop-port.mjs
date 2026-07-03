#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const port = Number(process.argv[2] || 3001);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error("Usage: node scripts/stop-port.mjs <port>");
  process.exit(2);
}

async function listeningPids() {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return [...new Set(
      stdout
        .split(/\s+/)
        .map((x) => Number(x))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    )];
  } catch (err) {
    if (err?.code === 1) return [];
    throw err;
  }
}

function signal(pid, sig) {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const initial = await listeningPids();
if (!initial.length) {
  console.log(`[stop-port] no LISTEN process on :${port}`);
  process.exit(0);
}

console.log(`[stop-port] SIGTERM :${port} → ${initial.join(", ")}`);
for (const pid of initial) signal(pid, "SIGTERM");

for (let i = 0; i < 20; i += 1) {
  await sleep(150);
  const remaining = await listeningPids();
  if (!remaining.length) {
    console.log(`[stop-port] :${port} released`);
    process.exit(0);
  }
}

const remaining = await listeningPids();
if (remaining.length) {
  console.log(`[stop-port] SIGKILL :${port} → ${remaining.join(", ")}`);
  for (const pid of remaining) signal(pid, "SIGKILL");
  await sleep(300);
}

const final = await listeningPids();
if (final.length) {
  console.error(`[stop-port] still busy :${port} → ${final.join(", ")}`);
  process.exit(1);
}

console.log(`[stop-port] :${port} released`);
