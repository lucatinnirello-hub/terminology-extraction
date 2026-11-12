// n8n Code node: "Run manifest"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// The run record, plus the three output files ready for upload: one item per
// file, each with its binary in 'data'. Keep the manifest with the glossary:
// it is what lets someone reproduce or question a result later.
const stage = $('Match translations').first().json;
const gate = $('Check restricted list').first().json.gate || {};
const settings = $('Settings').first().json;
const finalRows = $('Final rows').all().map((i) => i.json);

const manifest = {
  run_at: new Date().toISOString(),
  job_id: settings.job_id,
  submitted_by: settings.submitted_by,
  client: settings.client || '',
  source_lang: settings.source_lang,
  tmx_lang: settings.tmx_lang,
  language_used: stage.language,
  stopwords: stage.stopwords,
  settings_used: settings,
  input_files: $('Documents in').all().map((i) => i.json.file_name),
  coverage: {
    files_seen: stage.log.files_seen,
    files_parsed: stage.log.files_parsed,
    by_source_type: stage.log.by_source_type,
    segments: stage.log.segments_total,
    skipped: stage.log.skipped,
    unsupported_in_folder: ($('Check job files').first().json.skipped_in_folder || 0),
  },
  extraction: {
    candidates_before_filter: stage.log.candidates_before_filter,
    merges: stage.log.merges,
    suppressed_subphrases: stage.log.suppressed_subphrases,
    dropped_below_min_segments: stage.log.dropped_below_min_segments,
    terms_returned: stage.log.terms_returned,
  },
  case_normalisation: {
    setting: settings.normalise_case !== false ? 'on' : 'off',
    ...(stage.log.case || {}),
    changed_by_ai: finalRows.filter((r) => /^AI:/.test(r.case_note)).length,
  },
  stage_2: stage.log.stage_2,
  translations: settings.suggest_translations
    ? {
      ...stage.log.translations,
      target_label: settings.target_label,
      ai_translate_missing: settings.ai_translate_missing === true,
      checks: finalRows.reduce((acc, r) => { acc[r.translation_check] = (acc[r.translation_check] || 0) + 1; return acc; }, {}),
    }
    : { requested: false },
  wildcards: settings.add_wildcards
    ? {
      requested: true,
      ai_checked: $('Wildcard plan').first().json.route === 'ai',
      terms_with_wildcards: finalRows.filter((r) => /[|*]/.test(r.memoq_term || '')).length,
      checks: finalRows.reduce((acc, r) => { if (r.wildcard_check) acc[r.wildcard_check] = (acc[r.wildcard_check] || 0) + 1; return acc; }, {}),
    }
    : { requested: false },
  ai_stage: {
    requested: gate.requested || false,
    approved: gate.approved || false,
    restricted: gate.restricted || false,
    ran: gate.may_run_ai || false,
    note: gate.reason || '',
    focus: settings.ai_focus || 'general',
    domain: settings.ai_domain || '',
    instructions: settings.ai_instructions || '',
    terms_with_parse_errors: finalRows.filter((r) => r.ai_error).length,
  },
};

const safe = (s) => String(s || '').replace(/[^\w.\-]+/g, '_').slice(0, 60);
const base = `${safe(settings.client)}_${settings.source_lang}_${settings.job_id}`;

const glossary = ($('Final spreadsheet').first().binary || {}).data;
const stage1 = ($('Stage 1 spreadsheet').first().binary || {}).data;
if (!glossary || !stage1) throw new Error('A spreadsheet node produced no file.');

const manifestFile = await this.helpers.prepareBinaryData(
  Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
  `run_manifest_${base}.json`,
  'application/json',
);

return [
  { json: { kind: 'glossary', fileName: `glossary_${base}.xlsx`, manifest }, binary: { data: glossary } },
  { json: { kind: 'stage1', fileName: `stage1_candidates_${base}.xlsx` }, binary: { data: stage1 } },
  { json: { kind: 'manifest', fileName: `run_manifest_${base}.json` }, binary: { data: manifestFile } },
];
