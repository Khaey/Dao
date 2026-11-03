#!/usr/bin/env node
// Résumé PASS / FAIL / UNTESTED d'une recette DEV Playwright (rapport JSON),
// écrit en Markdown pour $GITHUB_STEP_SUMMARY. Usage : node scripts/dev-recette-summary.mjs <resultats.json>
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('## Recette DEV\n\n**FAIL** : aucun rapport JSON produit (échec avant les tests, voir les logs).');
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = [];
function walk(suite, titles) {
  const here = suite.title && !suite.title.endsWith('.ts') ? [...titles, suite.title] : titles;
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      const last = (t.results || []).at(-1) || {};
      const verdict = t.status === 'skipped' ? 'UNTESTED'
        : t.status === 'expected' || t.status === 'flaky' ? 'PASS' : 'FAIL';
      const error = verdict === 'FAIL'
        ? String(last.error?.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 160)
        : '';
      rows.push({ file: spec.file, title: [...here, spec.title].join(' › '), project: t.projectName, verdict, error });
    }
  }
  for (const child of suite.suites || []) walk(child, here);
}
for (const suite of report.suites || []) walk(suite, []);

const count = v => rows.filter(r => r.verdict === v).length;
const cell = s => String(s).replace(/\|/g, '\\|');
const lines = [
  '## Recette DEV — https://dao-dev.logiclab.fr',
  '',
  `**PASS ${count('PASS')} · FAIL ${count('FAIL')} · UNTESTED ${count('UNTESTED')}**`,
  '',
  '| Résultat | Appareil | Scénario | Fichier | Détail |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.verdict} | ${r.project} | ${cell(r.title)} | ${r.file} | ${cell(r.error)} |`),
  '',
  'Rapport HTML et captures : artefact du run (dossier `html/` et `captures/`).',
];
for (const e of report.errors || []) lines.push('', `Erreur globale : ${cell(String(e.message || '').split('\n')[0].slice(0, 200))}`);
console.log(lines.join('\n'));
