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

const fail = (why) => sent.map((t) => ({ json: { ...t, ai_keep: null, ai_reason: '', ai_error: why } }));

// Gemini: { content: { parts: [{ text }] }, finishReason } per candidate,
// or { candidates: [...] } with Simplify Output off.
const candidate = Array.isArray(response.candidates) ? response.candidates[0] || {} : response;
let text = '';
if (candidate.content && Array.isArray(candidate.content.parts)) {
  text = candidate.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
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

const byTerm = new Map((parsed.results || []).map((r) => [String(r.term).toLowerCase(), r]));
const normaliseCase = $('Settings').first().json.normalise_case !== false;

return sent.map((t) => {
  const v = byTerm.get(String(t.term).toLowerCase());
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
    },
  };
});
