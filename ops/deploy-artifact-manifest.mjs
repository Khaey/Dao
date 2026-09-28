#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicConfigFingerprint() {
  return sha256(JSON.stringify([
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  ]));
}

async function createManifest([manifestPath, revision, lockfilePath, buildIdPath]) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) fail('A full commit SHA is required');
  if (!manifestPath || !lockfilePath || !buildIdPath) {
    fail('Usage: create <manifest> <sha> <frontend-lockfile> <next-build-id>');
  }

  const [lockfile, buildId] = await Promise.all([
    readFile(lockfilePath),
    readFile(buildIdPath, 'utf8'),
  ]);
  const manifest = {
    schemaVersion: 1,
    revision,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    frontendLockSha256: sha256(lockfile),
    publicConfigSha256: publicConfigFingerprint(),
    buildId: buildId.trim(),
  };
  if (!manifest.buildId) fail('Next.js BUILD_ID is empty');

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

async function verifyManifest([manifestPath, revision, lockfilePath, buildIdPath]) {
  if (!manifestPath || !revision || !lockfilePath || !buildIdPath) {
    fail('Usage: verify <manifest> <sha> <frontend-lockfile> <next-build-id>');
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    fail('Deployment artifact manifest is missing or invalid; using VPS build');
  }

  const [lockfile, buildId] = await Promise.all([
    readFile(lockfilePath),
    readFile(buildIdPath, 'utf8'),
  ]);
  const valid = manifest.schemaVersion === 1
    && manifest.revision === revision
    && manifest.nodeMajor === Number(process.versions.node.split('.')[0])
    && manifest.frontendLockSha256 === sha256(lockfile)
    && manifest.publicConfigSha256 === publicConfigFingerprint()
    && manifest.buildId === buildId.trim()
    && Boolean(manifest.buildId);

  if (!valid) fail('Deployment artifact does not match this release/runtime configuration; using VPS build');
  console.log('Deployment artifact matches SHA, lockfile, Node major, build ID, and DEV public configuration');
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'create') await createManifest(args);
else if (mode === 'verify') await verifyManifest(args);
else fail('Usage: deploy-artifact-manifest.mjs <create|verify> ...');
