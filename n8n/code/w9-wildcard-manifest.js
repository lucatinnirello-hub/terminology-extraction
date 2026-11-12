// n8n Code node: "Wildcard manifest"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Wildcards-only jobs: the run record, plus the two output files ready for
// upload (the glossary with wildcards, and this manifest).
const settings = $('Settings').first().json;
const plan = $('Wildcard plan').first().json;
const gate = $('Check restricted list').first().json.gate || {};
const g = $('Glossary terms').first().json;
const rows = $('Apply wildcards').all().map((i) => i.json);
const memoqColumn = `${g.target_column} (memoQ)`;

const byCheck = rows.reduce((acc, r) => { if (r.wildcard_check) acc[r.wildcard_check] = (acc[r.wildcard_check] || 0) + 1; return acc; }, {});

const manifest = {
  run_at: new Date().toISOString(),
  job_id: settings.job_id,
  submitted_by: settings.submitted_by,
  client: settings.client || '',
  mode: 'wildcards',
  target_language: settings.target_label,
  glossary: g.file_name,
  target_column: g.target_column,
  source_column: g.source_column,
  rows: rows.length,
  terms: plan.items.length,
  terms_with_wildcards: rows.reduce((n, r) => n + String(r[memoqColumn] || '').split(';').filter((t) => /[|*]/.test(t)).length, 0),
  memories_used: g.memories_used,
  words_in_memories: (g.vocabulary || []).length,
  ai: {
    requested: gate.requested || false,
    approved: gate.approved || false,
    restricted: gate.restricted || false,
    ran: plan.route === 'ai',
    note: gate.reason || '',
  },
  rows_by_check: byCheck,
};

const safe = (s) => String(s || '').replace(/[^\w.\-]+/g, '_').slice(0, 60);
const base = `${safe(settings.client)}_${settings.target_lang}_${settings.job_id}`;
const glossary = ($('Wildcard spreadsheet').first().binary || {}).data;
if (!glossary) throw new Error('The wildcard spreadsheet node produced no file.');
const manifestFile = await this.helpers.prepareBinaryData(
  Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
  `run_manifest_${base}.json`,
  'application/json',
);

return [
  { json: { kind: 'glossary', fileName: `wildcards_${base}.xlsx`, manifest }, binary: { data: glossary } },
  { json: { kind: 'manifest', fileName: `run_manifest_${base}.json` }, binary: { data: manifestFile } },
];
