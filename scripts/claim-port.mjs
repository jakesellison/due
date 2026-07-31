#!/usr/bin/env node
/**
 * Claim the dev-server port before starting Metro.
 *
 * The installed dev client is pinned to port 8081 and IGNORES server-switch
 * deep links, so whichever Metro holds 8081 decides which repo the app runs —
 * a stale Metro (this repo's or the old mileage repo's) silently serves the
 * wrong bundle. Instead of documenting that, `npm start` runs this first:
 * any Node/Metro/expo process holding the port is killed; anything else on
 * the port aborts with a message rather than being killed blind.
 *
 *   node scripts/claim-port.mjs [port]   (default 8081)
 */
import { execSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 8081);
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const holders = () => sh(`lsof -ti :${port}`).split('\n').filter(Boolean);

for (const pid of holders()) {
  const cmd = sh(`ps -o command= -p ${pid}`);
  if (!cmd) continue; // already gone
  if (/node|expo|metro|react-native/i.test(cmd)) {
    console.log(`claim-port: killing stale dev server on :${port} (pid ${pid}: ${cmd.slice(0, 80)})`);
    try { process.kill(Number(pid), 'SIGTERM'); } catch {}
  } else {
    console.error(`claim-port: :${port} is held by a non-Metro process (pid ${pid}: ${cmd.slice(0, 120)}). Free it yourself and retry.`);
    process.exit(1);
  }
}

// SIGTERM is async — wait (up to ~3s) for the port to actually free so the
// `expo start` that follows doesn't race the dying process for the socket.
for (let i = 0; i < 30 && holders().length > 0; i++) sh('sleep 0.1');
if (holders().length > 0) {
  console.error(`claim-port: :${port} still occupied after SIGTERM. Free it yourself and retry.`);
  process.exit(1);
}
