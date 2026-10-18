// Turns a Playwright JSON report into GitHub annotations + job-summary rows, so a failing E2E run is
// readable through the check-runs API even when raw logs/artifacts are unreachable (blob storage).
// Read-only: never changes the exit status of the test step and never hides or skips a test.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const [reportPath, label = 'Playwright'] = process.argv.slice(2);
if (!reportPath || !existsSync(reportPath)) { console.log(`No Playwright JSON report at ${reportPath ?? '(none)'}; nothing to annotate.`); process.exit(0); }

const clean = (text) => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
const escape = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const failures = []; const stats = { passed: 0, failed: 0, flaky: 0, skipped: 0 };

const walk = (suite, trail) => {
  const path = suite.title && !suite.file ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? []; const last = results[results.length - 1];
      const failedRuns = results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
      if (test.status === 'skipped') stats.skipped += 1;
      else if (test.status === 'flaky') stats.flaky += 1;
      else if (test.status === 'unexpected') stats.failed += 1;
      else stats.passed += 1;
      if (test.status === 'unexpected' || test.status === 'flaky') {
        const err = (failedRuns[0] ?? last)?.error ?? {};
        failures.push({ kind: test.status === 'flaky' ? 'FLAKY' : 'FAILED', project: test.projectName, title: [...path, spec.title].join(' › '),
          file: spec.file ?? suite.file, line: spec.line, retries: results.length - 1, message: clean(err.message).slice(0, 600) });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
};
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
for (const suite of report.suites ?? []) walk(suite, []);

const prefix = process.env.PLAYWRIGHT_TESTS_DIR ? `${process.env.PLAYWRIGHT_TESTS_DIR}/` : 'dao-frontend/tests/e2e/';
failures.slice(0, 40).forEach((f) => {
  const level = f.kind === 'FLAKY' ? 'warning' : 'error';
  console.log(`::${level} file=${prefix}${f.file},line=${f.line ?? 1},title=${escape(`${label} ${f.kind} [${f.project}]`)}::${escape(`${f.title} — ${f.message}`)}`);
});
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = [`### ${label}: ${stats.passed} passed, ${stats.failed} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`, ''];
  if (failures.length) { rows.push('| Result | Project | Test | Retries | Error |', '| --- | --- | --- | --- | --- |');
    failures.forEach((f) => rows.push(`| ${f.kind} | ${f.project} | ${f.file}:${f.line} ${f.title.replace(/\|/g, '\\|')} | ${f.retries} | ${f.message.replace(/\|/g, '\\|').slice(0, 300)} |`)); }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rows.join('\n')}\n`);
}
