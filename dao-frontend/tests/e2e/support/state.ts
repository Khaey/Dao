import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { WorkerInfo } from '@playwright/test';

export type E2EStateCollection = 'users' | 'projects' | 'publications' | 'contractorProfiles';

export type E2EWorkerIdentity = Pick<WorkerInfo, 'project' | 'workerIndex'>;

function directory() {
  return process.env.DAO_E2E_STATE_DIR || path.join(os.tmpdir(), `dao-e2e-local-${process.pid}`);
}

function stateFile(identity: E2EWorkerIdentity) {
  const root = directory();
  const run = process.env.GITHUB_RUN_ID || 'local';
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const key = `${run}-${attempt}-${identity.project.name}-${identity.workerIndex}`;
  const name = createHash('sha256').update(key).digest('hex').slice(0, 24);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.join(root, `${name}.json`);
}

export function recordE2EValue(identity: E2EWorkerIdentity, collection: E2EStateCollection, id: string) {
  if (!id) throw new Error(`Cannot record an empty E2E ${collection} id`);
  const file = stateFile(identity);
  const state: Partial<Record<E2EStateCollection, string[]>> = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {};
  const values = state[collection] || [];
  if (!values.includes(id)) values.push(id);
  state[collection] = values;

  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}
