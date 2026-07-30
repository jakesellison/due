#!/usr/bin/env node
/**
 * secrets.mjs — run a command with this project's secrets in its environment.
 *
 * The replacement for `doppler run --`. Secrets live in GCP Secret Manager,
 * which is not a preference so much as an inevitability: Cloud Run reads it
 * directly at runtime, so it exists whether or not anything else does. Doppler
 * was the only optional store, and a second copy of a secret is not redundancy
 * — it is a second thing that can be wrong. (It was: a Mapbox token rotated in
 * one Doppler project while another kept serving the revoked value. See
 * docs/environments.md.)
 *
 *   node scripts/secrets.mjs -- npx expo run:ios
 *   node scripts/secrets.mjs --list
 *
 * WHY THE REST API RATHER THAN `gcloud secrets versions access`: one gcloud
 * invocation per secret is ~0.5-1s of process startup each, so two dozen of
 * them serially turns every build command into a ~20s wait. This mints ONE
 * access token and fetches every secret concurrently, which lands in about a
 * second — close enough to `doppler run` that nobody is tempted to work around
 * it.
 *
 * Nothing is written to disk. Values exist only in this process and the
 * environment of the child it spawns.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'secrets.manifest.json');

/** Env var name -> Secret Manager secret id. `STRAVA_CLIENT_ID` -> `due-strava-client-id`. */
export function secretIdFor(envName) {
  return `due-${envName.toLowerCase().replaceAll('_', '-')}`;
}

function loadManifest() {
  const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const { project, secrets, overrides = {} } = raw;
  if (!project) throw new Error('secrets.manifest.json: "project" is required');
  if (!Array.isArray(secrets)) throw new Error('secrets.manifest.json: "secrets" must be an array');
  return { project, secrets, overrides };
}

function accessToken() {
  const result = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    // The overwhelmingly common failure, and the one whose fix is not obvious
    // from a raw gcloud stack trace.
    throw new Error(
      `Could not get a GCP access token. Run \`gcloud auth login\`.\n${stderr}`,
    );
  }
  return result.stdout.trim();
}

async function fetchSecret(project, secretId, token) {
  const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secretId}/versions/latest:access`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = response.status === 403 || response.status === 404
      ? `not found, or this account cannot read it`
      : await response.text();
    throw new Error(`${secretId}: ${response.status} ${detail}`);
  }
  const body = await response.json();
  return Buffer.from(body.payload.data, 'base64').toString('utf8');
}

export async function resolveSecrets() {
  const { project, secrets, overrides } = loadManifest();
  const token = accessToken();

  const results = await Promise.allSettled(
    secrets.map(async (envName) => {
      const id = overrides[envName] ?? secretIdFor(envName);
      return [envName, await fetchSecret(project, id, token)];
    }),
  );

  const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (failures.length > 0) {
    // Report EVERY missing secret at once. Fixing them one failed run at a time
    // is the kind of papercut that makes people abandon the tool.
    throw new Error(`Could not read ${failures.length} secret(s):\n  ${failures.join('\n  ')}`);
  }

  return Object.fromEntries(results.map((r) => r.value));
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '--list') {
    const { project, secrets, overrides } = loadManifest();
    console.log(`project: ${project}`);
    for (const name of secrets) {
      console.log(`  ${name.padEnd(30)} -> ${overrides[name] ?? secretIdFor(name)}`);
    }
    return;
  }

  const separator = argv.indexOf('--');
  const command = separator >= 0 ? argv.slice(separator + 1) : argv;
  if (command.length === 0) {
    console.error('usage: node scripts/secrets.mjs [--list] -- <command> [args…]');
    process.exit(2);
  }

  const secrets = await resolveSecrets();
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...secrets },
  });
  // Forward signals so Ctrl-C reaches Metro/xcodebuild rather than orphaning them.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// Only run when invoked directly, so the exports stay importable by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}
