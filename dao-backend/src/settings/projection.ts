import { createHash } from 'node:crypto';
import { catalogProjection, SETTINGS_CATALOG } from './catalog.js';

// Server/CLI only (node:crypto): catalog.ts stays importable by the browser.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function catalogHash(catalog = SETTINGS_CATALOG): string {
  return createHash('sha256').update(canonical(catalogProjection(catalog))).digest('hex');
}

export function catalogSqlLiteral(catalog = SETTINGS_CATALOG): string {
  return canonical(catalogProjection(catalog)).replace(/'/g, "''");
}
