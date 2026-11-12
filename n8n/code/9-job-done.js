// n8n Code node: "Job done"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Write the result back to the job's row: links, counts and a short note.
const uploads = $input.all();
const wildcardsOnly = $('Settings').first().json.mode === 'wildcards';
const sent = $(wildcardsOnly ? 'Wildcard manifest' : 'Run manifest').all();
const urls = {};
uploads.forEach((u, i) => {
  const kind = sent[i].json.kind;
  urls[kind] = u.json.webViewLink || `https://drive.google.com/file/d/${u.json.id}/view`;
});

const manifest = sent[0].json.manifest;
const notes = [];
const countChecks = (byCheck) => [
  ['AI confirmed', 'confirmed by AI'], ['AI corrected', 'corrected by AI'],
  ['Code proposal kept (AI reply invalid)', 'code proposal kept'], ['Code only, not validated', 'not validated'],
  ['No wildcards needed', 'need none (the language doesn\'t inflect)'],
].filter(([k]) => byCheck[k]).map(([k, label]) => `${byCheck[k]} ${label}`).join(', ');

if (wildcardsOnly) {
  notes.push(`Wildcards added to ${manifest.terms_with_wildcards} of ${manifest.terms} terms (column "${manifest.target_column}").`);
  const counts = countChecks(manifest.rows_by_check || {});
  if (counts) notes.push(`Rows: ${counts}.`);
  if (!manifest.ai.ran && manifest.ai.requested) notes.push(`AI not used: ${manifest.ai.note}.`);
  return [{
    json: {
      job_id: manifest.job_id,
      status: 'done',
      finished_at: new Date().toISOString(),
      terms_returned: manifest.terms,
      glossary_url: urls.glossary || '',
      stage1_url: '',
      manifest_url: urls.manifest || '',
      message: notes.join(' '),
    },
  }];
}
if (manifest.ai_stage.ran) {
  notes.push('AI review ran.');
  if (manifest.ai_stage.terms_with_parse_errors) {
    notes.push(`${manifest.ai_stage.terms_with_parse_errors} terms have no AI verdict (response could not be parsed).`);
  }
} else if (manifest.ai_stage.requested) {
  notes.push(`AI review skipped: ${manifest.ai_stage.note}`);
}
if (manifest.translations && manifest.translations.requested) {
  const c = manifest.translations.checks || {};
  const parts = [
    ['AI confirmed', 'confirmed by AI'], ['AI corrected', 'corrected by AI'],
    ['AI translated (not from the files)', 'AI-translated, not from the files'],
    ['Code suggestion, not validated', 'suggested from the files, not validated'],
    ['No match in the files', 'no match in the files'],
  ].filter(([k]) => c[k]).map(([k, label]) => `${c[k]} ${label}`);
  notes.push(`Translations into ${manifest.translations.target_label}: ${parts.join(', ') || 'none'}.`);
  if (manifest.translations.note) notes.push(manifest.translations.note);
}
if (manifest.wildcards && manifest.wildcards.requested) {
  const counts = countChecks(manifest.wildcards.checks || {});
  notes.push(`memoQ wildcards on ${manifest.wildcards.terms_with_wildcards} terms${counts ? ` (${counts})` : ''}.`);
}
const skipped = (manifest.coverage.skipped || []).filter((s) => !['below_min_chars', 'duplicate_segment'].includes(s.reason));
if (skipped.length) notes.push('Skipped: ' + skipped.map((s) => `${s.reason} x${s.count}`).join(', '));
if (manifest.coverage.unsupported_in_folder) notes.push(`${manifest.coverage.unsupported_in_folder} other files in the folder were ignored.`);
if (manifest.coverage.files_parsed < manifest.coverage.files_seen) {
  notes.push(`${manifest.coverage.files_seen - manifest.coverage.files_parsed} of ${manifest.coverage.files_seen} files produced no text.`);
}

return [{
  json: {
    job_id: manifest.job_id,
    status: 'done',
    finished_at: new Date().toISOString(),
    terms_returned: manifest.extraction.terms_returned,
    glossary_url: urls.glossary || '',
    stage1_url: urls.stage1 || '',
    manifest_url: urls.manifest || '',
    message: notes.join(' '),
  },
}];
