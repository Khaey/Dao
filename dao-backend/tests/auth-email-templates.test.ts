import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authTemplates, renderAuthTemplate } from './auth-email-templates.js';

// #482 D3 — the committed Supabase Auth templates are exactly the shared-layout render, keep each official
// variable intact, have exactly one link (the confirmation URL) and are wired in config.toml for the local stack.
const root = new URL('../../', import.meta.url);
const config = readFileSync(new URL('supabase/config.toml', root), 'utf8');

for (const name of Object.keys(authTemplates)) {
  test(`Modèle Auth « ${name} » versionné, à jour et branché en local`, () => {
    const file = readFileSync(new URL(`supabase/templates/${name}.html`, root), 'utf8');
    assert.equal(file, renderAuthTemplate(name), 'regenerate: node dist/tests/auth-email-templates.js supabase/templates');
    const links = [...file.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(links, ['{{ .ConfirmationURL }}']);
    assert.ok(file.includes('{{ .Email }}'));
    assert.doesNotMatch(file, /<img|<script|<link|url\(/i);
    assert.ok(file.includes('Transparence · Précision · Confiance'));
    const section = config.split(`[auth.email.template.${name}]`)[1]?.split('\n[')[0] ?? '';
    assert.ok(section.includes(`content_path = "./supabase/templates/${name}.html"`), `config.toml [auth.email.template.${name}]`);
    assert.ok(section.includes(`subject = "${authTemplates[name].subject}"`));
  });
}
