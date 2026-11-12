// n8n Code node: "Read request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// THE REQUEST from the web page (Apps Script). Two actions:
//
//   check  Can n8n use these folders? Answered straight away.
//          { action: 'check', folders: [{ purpose: 'input' | 'output', id }] }
//
//   start  Run a job. Answered with 'accepted' (or why not) within a second
//          or two; the extraction then carries on and reports to the log
//          sheet. Cloudflare drops requests that wait ~100 s, so the reply
//          can't wait for the result.
//          { action: 'start', job: {...}, settings: {...} }
//
// DEFAULTS and LIMITS also live in the web page; they are enforced again
// here so a hand-made request can't push values out of range. The
// restricted-client list is NOT here; it stays in "Check restricted list".
// ===========================================================================

const DEFAULTS = {
  ngram_max: 4, dedupe_threshold: 0.85, top_n: 500, min_segments: 2, min_chars: 15,
  include_examples: 3, dedupe_segments: true, independence_ratio: 1.25,
  run_ai_review: false, ai_review_approved: false, normalise_case: true,
  ai_focus: 'general', ai_domain: '', ai_instructions: '',
};
// The AI brief: what to focus on, plus free text from the linguist. Kept
// short so a batch prompt stays small.
const AI_FOCUS = ['general', 'ui', 'technical', 'marketing', 'legal', 'life_sciences', 'finance'];
const TEXT_LIMITS = { ai_domain: 120, ai_instructions: 2000 };
const LIMITS = {
  ngram_max: [1, 6, true], dedupe_threshold: [0.5, 1, false], top_n: [10, 5000, true],
  min_segments: [1, 50, true], min_chars: [0, 200, true], include_examples: [0, 10, true],
  independence_ratio: [1, 5, false],
};

const body = $input.first().json.body || {};
const reject = (error) => [{ json: { ok: false, action: String(body.action || ''), code: 400, reply: { ok: false, error } } }];
const isId = (s) => typeof s === 'string' && /^[-\w]{10,}$/.test(s);

if (body.action === 'check') {
  const folders = (body.folders || []).filter((f) => f && isId(f.id) && ['input', 'output'].includes(f.purpose));
  if (!folders.length) return reject('No valid folder to check.');
  return [{ json: { ok: true, action: 'check', folders } }];
}
if (body.action !== 'start') return reject(`Unknown action "${body.action}".`);

const job = body.job || {};
if (!/^T\d{8}-\d{6}-[0-9a-f]{4}$/.test(job.job_id || '')) return reject('Missing or malformed job_id.');
if (!String(job.client || '').trim()) return reject('Client is required.');
if (!/^[a-z]{2}$/.test(job.source_lang || '')) return reject('source_lang must be a two-letter stopword-list key.');
if (!isId(job.input_folder_id) || !isId(job.output_folder_id)) return reject('Input and output folder IDs are required.');
// 'extract': find terms in TMX/XLIFF/text. 'wildcards': add memoQ wildcards
// to the target terms of a finished glossary (.xlsx/.csv).
const mode = job.mode === 'wildcards' ? 'wildcards' : 'extract';
if (!/^[^@\s]+@[^@\s]+$/.test(job.submitted_by || '')) return reject('submitted_by must be an email address.');

const fromPage = body.settings || {};
const settings = { ...DEFAULTS };
for (const [key, [min, max, integer]] of Object.entries(LIMITS)) {
  const n = Number(fromPage[key]);
  if (fromPage[key] === undefined || fromPage[key] === '' || Number.isNaN(n)) continue;
  const clamped = Math.min(max, Math.max(min, n));
  settings[key] = integer ? Math.round(clamped) : clamped;
}
settings.dedupe_segments = fromPage.dedupe_segments !== false;
settings.run_ai_review = fromPage.run_ai_review === true;
settings.ai_review_approved = settings.run_ai_review && fromPage.ai_review_approved === true;
settings.normalise_case = fromPage.normalise_case !== false;
settings.ai_focus = AI_FOCUS.includes(fromPage.ai_focus) ? fromPage.ai_focus : 'general';
for (const [key, max] of Object.entries(TEXT_LIMITS)) {
  // Control characters out (line breaks kept in the instructions), then trimmed.
  const text = String(fromPage[key] || '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  settings[key] = key === 'ai_domain' ? text.replace(/\s+/g, ' ').slice(0, max) : text.slice(0, max);
}

// Translation suggestions: target language as a stopword-list key (e.g.
// 'it', or 'sr', which uses the Croatian list), and what it's called inside
// TMX/XLIFF files ('sr,sh'). AI translation of terms with no target text
// only when the person chose it, and only with AI review.
settings.mode = mode;
settings.suggest_translations = mode === 'extract' && fromPage.suggest_translations === true;
if (settings.suggest_translations || mode === 'wildcards') {
  const t = fromPage.target_lang;
  if (!/^[a-z]{2}$/.test(t || '')) return reject('target_lang must be a two-letter language key.');
  if (t === job.source_lang) return reject('The target language must differ from the source language.');
  settings.target_lang = t;
  settings.target_tmx = String(fromPage.target_tmx || t).toLowerCase().replace(/[^a-z,\-]/g, '');
  settings.target_label = String(fromPage.target_label || t).slice(0, 40);
}
settings.ai_translate_missing = settings.suggest_translations && settings.run_ai_review && fromPage.ai_translate_missing === true;

// memoQ wildcards on the target terms: an option of extraction jobs with
// translations, and the whole point of wildcards-only jobs. The target
// column of a wildcards-only glossary may be named; otherwise it's detected.
settings.add_wildcards = mode === 'wildcards' || (settings.suggest_translations && fromPage.add_wildcards === true);
if (mode === 'wildcards') settings.target_column = String(fromPage.target_column || '').trim().slice(0, 80);

Object.assign(settings, {
  client: String(job.client).trim(),
  source_lang: job.source_lang,
  // What the language is called inside TMX files (Czech is 'cz' in the
  // stopword lists but 'cs' in TMX). Comma-separated prefixes.
  tmx_lang: String(job.tmx_lang || job.source_lang).toLowerCase(),
  input_mode: job.input_mode === 'folder' ? 'folder' : 'upload',
  output_mode: job.output_mode === 'folder' ? 'folder' : 'job',
  job_id: job.job_id,
  submitted_by: job.submitted_by,
  submitted_at: job.submitted_at || new Date().toISOString(),
  input_folder_id: job.input_folder_id,
  output_folder_id: job.output_folder_id,
  job_folder_id: job.job_folder_id || '',
});

return [{
  json: {
    ok: true,
    action: 'start',
    settings,
    file_names: String(job.file_names || ''),
    folders: [
      { purpose: 'input', id: settings.input_folder_id },
      { purpose: 'output', id: settings.output_folder_id },
    ],
  },
}];
