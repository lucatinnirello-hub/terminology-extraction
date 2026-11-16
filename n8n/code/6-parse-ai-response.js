// n8n Code node: "Parse AI response"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Merge the model's verdicts back onto the terms.
//
// Reads the reply from the Google Gemini node ("Simplify Output" on or off).
// Also understands an Anthropic-style reply, so the AI node can be swapped
// without touching this code.
const response = $input.first().json;
const sent = $('Build AI request').first().json.terms || [];

const fail = (why) => sent.map((t) => ({ json: { ...t, ai_keep: null, ai_reason: '', ai_translation_check: null, ai_error: why } }));

// Translations are accepted only where the job allowed them: for terms with a
// suggestion from the files, and for the rest only if "let AI translate" was
// chosen. The check is set from that, not taken on trust from the model.
const settings = $('Settings').first().json;
function translationOf(t, v) {
  if (!settings.suggest_translations || !v || typeof v.translation !== 'string' || !v.translation.trim()) return {};
  const translation = v.translation.trim();
  if (t.code_suggestion) {
    const check = v.translation_check === 'confirmed' ? 'confirmed' : 'corrected';
    return { ai_translation: translation, ai_translation_check: check, ai_translation_note: check === 'corrected' ? String(v.translation_note || '') : '' };
  }
  if (settings.ai_translate_missing) return { ai_translation: translation, ai_translation_check: 'translated', ai_translation_note: '' };
  return {};
}

// Gemini: { content: { parts: [{ text }] }, finishReason } per candidate,
// or { candidates: [...] } with Simplify Output off.
const candidate = Array.isArray(response.candidates) ? response.candidates[0] || {} : response;
let text = '';
if (candidate.content && Array.isArray(candidate.content.parts)) {
  // With "Output Content as JSON" on, n8n may hand over the text already parsed.
  text = candidate.content.parts.filter((p) => p.text && !p.thought)
    .map((p) => (typeof p.text === 'string' ? p.text : JSON.stringify(p.text))).join('');
} else if (Array.isArray(response.content)) {
  text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
} else if (typeof response.text === 'string') {
  text = response.text;
}

const finish = String(candidate.finishReason || '');
if (finish === 'MAX_TOKENS') {
  return fail('Reply was cut off: raise "Maximum Number of Tokens" on the AI review node.');
}
if (finish && finish !== 'STOP') {
  return fail(`The model stopped early (${finish}).`);
}

let parsed;
try {
  parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
} catch (e) {
  return fail(`Could not parse model response: ${e.message}`);
}

// Find the list of verdicts. The prompt asks for {"results":[...]}, but the
// model sometimes sends a bare list, another key, or an object keyed by term.
function resultsOf(p) {
  if (Array.isArray(p)) return p;
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.results)) return p.results;
  const list = Object.values(p).find((v) => Array.isArray(v) && v.some((r) => r && typeof r === 'object'));
  if (list) return list;
  const keyed = p.results && typeof p.results === 'object' ? p.results : p;
  const entries = Object.entries(keyed).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  return entries.map(([k, v]) => ({ term: k, ...v }));
}
const results = resultsOf(parsed);

// Terms are matched ignoring case, spacing, accents-as-typed, quotes and
// trademark signs, so a reply that writes "Free Spins" as "free spins" or
// "MEGAWAYS™" as "MEGAWAYS" still counts.
const key = (s) => String(s == null ? '' : s)
  .normalize('NFC')
  .toLowerCase()
  .replace(/[™®©"“”‘’']/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const termOf = (r) => (r && (r.term ?? r.Term ?? r.source_term ?? r.original_term)) ?? '';

const byTerm = new Map();
results.forEach((r, i) => {
  if (!r || typeof r !== 'object') return;
  const k = key(termOf(r));
  if (k && !byTerm.has(k)) byTerm.set(k, i);
});
const used = new Set();
const verdicts = sent.map((t) => {
  const i = byTerm.get(key(t.term));
  if (i === undefined || used.has(i)) return undefined;
  used.add(i);
  return i;
});
// Last resort: the reply has one entry per term but left "term" out. Match
// those by position. Entries with a rewritten term are not guessed at.
if (results.length === sent.length) {
  verdicts.forEach((v, i) => {
    if (v === undefined && !used.has(i) && results[i] && typeof results[i] === 'object' && !key(termOf(results[i]))) {
      verdicts[i] = i;
      used.add(i);
    }
  });
}

// A reply that matches no term at all is a failure, not a batch of skipped
// terms: say so, with the start of the reply, so it can be seen in the glossary.
if (sent.length && verdicts.every((v) => v === undefined)) {
  const shape = Array.isArray(parsed) ? 'a list' : `an object with keys ${Object.keys(parsed || {}).slice(0, 5).join(', ') || '(none)'}`;
  return fail(`The reply matched none of the terms (it was ${shape}, ${results.length} entries). Start of reply: ${text.slice(0, 300)}`);
}

const normaliseCase = $('Settings').first().json.normalise_case !== false;

return sent.map((t, i) => {
  const v = verdicts[i] === undefined ? undefined : results[verdicts[i]];
  // The model may only change letter case: anything else is ignored.
  const cased = v && normaliseCase && typeof v.term_cased === 'string' ? v.term_cased.trim() : '';
  const recase = cased && cased !== t.term && cased.toLowerCase() === String(t.term).toLowerCase();
  return {
    json: {
      ...t,
      term: recase ? cased : t.term,
      case_note: recase ? `AI: ${cased === cased.toLowerCase() ? 'lower case' : 'kept capitals'} (rule gave "${t.term}")` : t.case_note || '',
      ai_keep: v ? v.keep !== false : null,
      ai_reason: v ? v.reason || '' : 'no verdict returned',
      definition: v && v.definition ? v.definition : t.definition || '',
      ...translationOf(t, v),
    },
  };
});
