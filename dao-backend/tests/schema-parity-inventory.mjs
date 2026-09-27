import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const outputColumns = [
  'kind',
  'object_name',
  'raw_fingerprint',
  'semantic_fingerprint',
  'function_definition_raw_fingerprint',
  'function_definition_semantic_fingerprint',
  'function_metadata_fingerprint',
];

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function isWordStart(char) {
  return !!char && (/[A-Za-z_]/.test(char) || char.charCodeAt(0) > 127);
}

function isWordPart(char) {
  return !!char && (/[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 127);
}

function isEscapeStringPrefix(source, quoteIndex) {
  if (quoteIndex < 1 || !/[eE]/.test(source[quoteIndex - 1])) return false;
  return quoteIndex < 2 || !isWordPart(source[quoteIndex - 2]);
}

function tokenizeSql(source, insideFunctionBody = false) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }

    if (source.startsWith('/*', index)) {
      let depth = 1;
      let cursor = index + 2;
      while (depth > 0 && cursor < source.length) {
        if (source.startsWith('/*', cursor)) {
          depth += 1;
          cursor += 2;
        } else if (source.startsWith('*/', cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      if (depth !== 0) throw new Error('Unterminated SQL block comment');
      index = cursor;
      continue;
    }

    if (char === '$') {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index))?.[0];
      if (delimiter) {
        const bodyStart = index + delimiter.length;
        const bodyEnd = source.indexOf(delimiter, bodyStart);
        if (bodyEnd < 0) throw new Error('Unterminated SQL dollar quote: ' + delimiter);
        const body = source.slice(bodyStart, bodyEnd);
        if (!insideFunctionBody && tokens.at(-1) === 'as') {
          tokens.push(['function_body', tokenizeSql(body, true)]);
        } else {
          tokens.push(['dollar_literal', body]);
        }
        index = bodyEnd + delimiter.length;
        continue;
      }
    }

    if (char === "'") {
      const escapeString = isEscapeStringPrefix(source, index);
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (escapeString && source[cursor] === '\\') {
          cursor += 2;
        } else if (source[cursor] === "'") {
          if (source[cursor + 1] === "'") cursor += 2;
          else {
            cursor += 1;
            closed = true;
            break;
          }
        } else {
          cursor += 1;
        }
      }
      if (!closed) throw new Error('Unterminated SQL string literal');
      tokens.push(['string', source.slice(index, cursor)]);
      index = cursor;
      continue;
    }

    if (char === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '"') {
          if (source[cursor + 1] === '"') cursor += 2;
          else {
            cursor += 1;
            closed = true;
            break;
          }
        } else {
          cursor += 1;
        }
      }
      if (!closed) throw new Error('Unterminated SQL quoted identifier');
      tokens.push(['quoted_identifier', source.slice(index, cursor)]);
      index = cursor;
      continue;
    }

    if (isWordStart(char)) {
      let cursor = index + 1;
      while (cursor < source.length && isWordPart(source[cursor])) cursor += 1;
      tokens.push(source.slice(index, cursor).toLowerCase());
      index = cursor;
      continue;
    }

    const numeric = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index))?.[0];
    if (numeric) {
      tokens.push(['number', numeric]);
      index += numeric.length;
      continue;
    }

    if ('+-*/<>=~!@#%^&|?:'.includes(char)) {
      let cursor = index + 1;
      while (cursor < source.length && '+-*/<>=~!@#%^&|?:'.includes(source[cursor])) cursor += 1;
      tokens.push(['operator', source.slice(index, cursor)]);
      index = cursor;
      continue;
    }

    tokens.push(['punctuation', char]);
    index += 1;
  }

  return tokens;
}

function runNormalizerSelfTests() {
  const formattedA = "CREATE OR REPLACE FUNCTION dao_private.example() RETURNS text LANGUAGE plpgsql AS $one$\nBEGIN -- explanation\n RETURN 'a b'; /* block */\nEND;\n$one$;";
  const formattedB = "create or replace function dao_private.example ( ) returns text language plpgsql as $two$ BEGIN RETURN 'a b'; END; $two$ ;";
  assert.deepEqual(tokenizeSql(formattedA), tokenizeSql(formattedB), 'comments, whitespace, and dollar-quote tags must not alter semantic fingerprints');
  const changedLiteral = formattedB.replace("'a b'", "'a  b'");
  assert.notDeepEqual(tokenizeSql(formattedA), tokenizeSql(changedLiteral), 'meaningful string-literal changes must remain visible');
  const changedLogic = formattedB.replace('RETURN', 'RAISE');
  assert.notDeepEqual(tokenizeSql(formattedA), tokenizeSql(changedLogic), 'meaningful function-body changes must remain visible');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) throw new Error('Unterminated CSV quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(value => value.length > 0)) rows.push(row);
  }
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function encodeCsv(headers, rows) {
  return [headers, ...rows.map(row => headers.map(header => row[header]))].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

function readCsv(path) {
  const parsed = parseCsv(readFileSync(path, 'utf8'));
  if (parsed.length < 2) throw new Error('Schema inventory CSV has no object rows: ' + path);
  const headers = parsed[0];
  return parsed.slice(1).map(values => {
    if (values.length !== headers.length) throw new Error('CSV column count mismatch in ' + path);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function uniqueRows(rows, path) {
  const map = new Map();
  for (const row of rows) {
    const key = row.kind + '\u0000' + row.object_name;
    if (map.has(key)) throw new Error('Duplicate inventory object in ' + path + ': ' + row.kind + ' ' + row.object_name);
    map.set(key, row);
  }
  return map;
}

function finalize(path) {
  runNormalizerSelfTests();
  const rawText = readFileSync(path, 'utf8');
  const rawRows = parseCsv(rawText);
  if (rawRows.length < 2) throw new Error('Raw schema inventory CSV has no objects: ' + path);
  const headers = rawRows[0];
  const rows = rawRows.slice(1).map(values => {
    if (values.length !== headers.length) throw new Error('Raw inventory CSV column count mismatch');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
  const required = ['kind', 'object_name', 'raw_fingerprint', 'function_definition_raw_fingerprint', 'function_metadata_fingerprint', 'function_definition_hex'];
  for (const column of required) if (!headers.includes(column)) throw new Error('Missing raw inventory column: ' + column);

  const finalized = rows.map(row => {
    if (!/^[0-9a-f]{32}$/.test(row.raw_fingerprint)) throw new Error('Invalid raw fingerprint for ' + row.kind + ' ' + row.object_name);
    if (row.kind !== 'function') {
      return {
        kind: row.kind,
        object_name: row.object_name,
        raw_fingerprint: row.raw_fingerprint,
        semantic_fingerprint: row.raw_fingerprint,
        function_definition_raw_fingerprint: '',
        function_definition_semantic_fingerprint: '',
        function_metadata_fingerprint: '',
      };
    }
    if (!/^[0-9a-f]{32}$/.test(row.function_definition_raw_fingerprint) || !/^[0-9a-f]{32}$/.test(row.function_metadata_fingerprint)) {
      throw new Error('Invalid function fingerprint for ' + row.object_name);
    }
    if (!/^(?:[0-9a-f]{2})*$/.test(row.function_definition_hex)) throw new Error('Invalid function definition hex for ' + row.object_name);
    const definition = Buffer.from(row.function_definition_hex, 'hex').toString('utf8');
    const tokens = tokenizeSql(definition);
    const definitionSemantic = md5(JSON.stringify(tokens));
    const semantic = md5(JSON.stringify({ definition: tokens, metadata: row.function_metadata_fingerprint }));
    return {
      kind: row.kind,
      object_name: row.object_name,
      raw_fingerprint: row.raw_fingerprint,
      semantic_fingerprint: semantic,
      function_definition_raw_fingerprint: row.function_definition_raw_fingerprint,
      function_definition_semantic_fingerprint: definitionSemantic,
      function_metadata_fingerprint: row.function_metadata_fingerprint,
    };
  });

  uniqueRows(finalized, path);
  finalized.sort((left, right) => left.kind.localeCompare(right.kind) || left.object_name.localeCompare(right.object_name));
  process.stdout.write(encodeCsv(outputColumns, finalized));
}

function compare(firstPath, secondPath) {
  runNormalizerSelfTests();
  const firstRows = readCsv(firstPath);
  const secondRows = readCsv(secondPath);
  const first = uniqueRows(firstRows, firstPath);
  const second = uniqueRows(secondRows, secondPath);
  const keys = [...new Set([...first.keys(), ...second.keys()])].sort();
  const missingFromFresh = [];
  const extraInFresh = [];
  const semanticDrift = [];
  const rawOnlyDifferences = [];

  for (const key of keys) {
    const fresh = first.get(key);
    const other = second.get(key);
    if (!fresh) {
      missingFromFresh.push({ kind: other.kind, object_name: other.object_name, other_raw_fingerprint: other.raw_fingerprint, other_semantic_fingerprint: other.semantic_fingerprint });
    } else if (!other) {
      extraInFresh.push({ kind: fresh.kind, object_name: fresh.object_name, fresh_raw_fingerprint: fresh.raw_fingerprint, fresh_semantic_fingerprint: fresh.semantic_fingerprint });
    } else if (fresh.semantic_fingerprint !== other.semantic_fingerprint) {
      semanticDrift.push({
        kind: fresh.kind,
        object_name: fresh.object_name,
        fresh_raw_fingerprint: fresh.raw_fingerprint,
        other_raw_fingerprint: other.raw_fingerprint,
        fresh_semantic_fingerprint: fresh.semantic_fingerprint,
        other_semantic_fingerprint: other.semantic_fingerprint,
      });
    } else if (fresh.raw_fingerprint !== other.raw_fingerprint) {
      rawOnlyDifferences.push({
        kind: fresh.kind,
        object_name: fresh.object_name,
        fresh_raw_fingerprint: fresh.raw_fingerprint,
        other_raw_fingerprint: other.raw_fingerprint,
      });
    }
  }

  const result = {
    fresh_objects: first.size,
    other_objects: second.size,
    missing_from_fresh: missingFromFresh,
    extra_in_fresh: extraInFresh,
    semantic_drift: semanticDrift,
    raw_only_differences: rawOnlyDifferences,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (missingFromFresh.length || extraInFresh.length || semanticDrift.length) process.exitCode = 1;
}

function summary(path) {
  const rows = readCsv(path);
  const counts = {};
  for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  const targetSignatures = new Set([
    'dao_private.add_project_request(uuid,uuid,text,text)',
    'dao_private.create_bid_draft(uuid)',
    'dao_private.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid)',
    'dao_private.submit_bid_version(uuid)',
    'dao_private.submit_bid_version(uuid,uuid)',
    'dao_private.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text)',
  ]);
  const targets = rows
    .filter(row => targetSignatures.has(row.object_name.replace(/\s/g, '')))
    .sort((left, right) => left.object_name.localeCompare(right.object_name))
    .map(row => ({
      object_name: row.object_name,
      raw_fingerprint: row.raw_fingerprint,
      semantic_fingerprint: row.semantic_fingerprint,
      function_definition_raw_fingerprint: row.function_definition_raw_fingerprint,
      function_definition_semantic_fingerprint: row.function_definition_semantic_fingerprint,
      function_metadata_fingerprint: row.function_metadata_fingerprint,
    }));
  process.stdout.write(JSON.stringify({ objects: rows.length, by_kind: counts, target_functions: targets }, null, 2) + '\n');
}

const [command, ...args] = process.argv.slice(2);
if (command === 'finalize' && args.length === 1) finalize(args[0]);
else if (command === 'compare' && args.length === 2) compare(args[0], args[1]);
else if (command === 'summary' && args.length === 1) summary(args[0]);
else throw new Error('Usage: finalize <raw-inventory.csv> | compare <fresh.csv> <other.csv> | summary <inventory.csv>');
