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

return sent.map((t) => {
  const v = byTerm.get(String(t.term).toLowerCase());
  return {
    json: {
      ...t,
      ai_keep: v ? v.keep !== false : null,
      ai_reason: v ? v.reason || '' : 'no verdict returned',
      definition: v && v.definition ? v.definition : t.definition || '',
      ...translationOf(t, v),
    },
  };
});
