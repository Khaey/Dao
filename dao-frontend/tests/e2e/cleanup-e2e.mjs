import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expectedUrl = 'http://127.0.0.1:54321';
const url = process.env.DAO_SUPABASE_URL;
const stateDir = path.resolve(process.env.DAO_E2E_STATE_DIR || path.join(os.tmpdir(), 'dao-e2e-local-' + process.pid));
const tmpRoot = path.resolve(os.tmpdir());
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const collections = ['users', 'projects', 'publications', 'contractorProfiles'];

if (url && url !== expectedUrl) {
  throw new Error('E2E cleanup refused: DAO_SUPABASE_URL is not the disposable local Supabase endpoint');
}

if (path.dirname(stateDir) !== tmpRoot || !/^dao-e2e-[a-z0-9-]+$/i.test(path.basename(stateDir))) {
  throw new Error('E2E cleanup refused: worker state must be inside a dedicated dao-e2e-* directory under the OS temp directory');
}

function readWorkerState() {
  if (!existsSync(stateDir)) return { files: [], temporaryFiles: [], state: Object.fromEntries(collections.map(key => [key, []])) };
  const directory = lstatSync(stateDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('E2E cleanup refused: worker state path must be a real directory');
  }

  const entries = readdirSync(stateDir, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && /^[a-f0-9]{24}\.json$/i.test(entry.name))
    .map(entry => path.join(stateDir, entry.name));
  const temporaryFiles = entries
    .filter(entry => entry.isFile() && /^[a-f0-9]{24}\.json\.[a-f0-9-]+\.tmp$/i.test(entry.name))
    .map(entry => path.join(stateDir, entry.name));
  if (entries.length !== files.length + temporaryFiles.length) {
    throw new Error('E2E cleanup refused: worker state directory contains an unexpected entry');
  }

  const state = Object.fromEntries(collections.map(key => [key, []]));
  for (const file of files) {
    if (!lstatSync(file).isFile()) throw new Error('E2E cleanup refused: worker state entries must be regular files');
    const workerState = JSON.parse(readFileSync(file, 'utf8'));
    if (!workerState || typeof workerState !== 'object' || Array.isArray(workerState)) {
      throw new Error('E2E cleanup refused: worker state must be a JSON object');
    }
    for (const collection of collections) {
      const ids = workerState[collection] ?? [];
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !uuidPattern.test(id))) {
        throw new Error('E2E cleanup refused: worker state contains malformed IDs');
      }
      state[collection].push(...ids);
    }
  }
  return { files, temporaryFiles, state };
}

const { files, temporaryFiles, state } = readWorkerState();
if ((files.length || temporaryFiles.length) && !url) {
  throw new Error('E2E cleanup refused: tracked worker state exists without the isolated Supabase endpoint');
}

const counts = Object.fromEntries(collections.map(key => [key, new Set(state[key]).size]));

// Submitted bids and their history remain immutable for the whole run.
// The disposable local Supabase stack, recreated by the next CI runner, is the database cleanup boundary.
for (const file of [...files, ...temporaryFiles]) unlinkSync(file);
if (existsSync(stateDir) && readdirSync(stateDir).length === 0) rmdirSync(stateDir);

process.stdout.write(
  'E2E cleanup: deleted worker tracking files only; database rows and submitted offer history remain until runner disposal. '
  + 'Tracked ' + counts.projects + ' project(s), ' + counts.publications + ' publication(s), '
  + counts.users + ' user(s), and ' + counts.contractorProfiles + ' contractor profile(s).\n',
);
