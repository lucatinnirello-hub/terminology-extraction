// n8n Code node: "Build check request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Asks the AI to check each term's FORMS. The AI never places wildcards:
// "Apply wildcards" re-applies the rules (Wildcards Logic, Word Matching
// Logic) in code to the checked forms, so the same forms always give the
// same wildcards. In wildcards-only jobs the AI also flags terms that look
// wrong (term_suggestion); the term itself is never changed.
const batch = $input.all().map((i) => i.json);
const settings = $('Settings').first().json;
const plan = $('Wildcard plan').first().json;
const lang = settings.target_label || settings.target_lang;

const instruction = [
  `You are a terminologist for ${lang}. memoQ wildcards will be placed on the ${lang} glossary terms below by code, from each term's list of forms, so the forms must be right and complete.`,
  'For each term, "forms" lists the forms found so far. Check them: remove any that are not forms of this term (other words, misspellings, forms with different words), and add any missing forms that occur in running text.',
  'Forms cover every grammatical case, singular and plural, possessive forms if the language has them, adjective agreement, and the common combinations of endings. Spell each form exactly as written, including letters of the word that change when an ending is added. For multi-word terms, give whole-phrase forms with the same words in the same order. Keep the term itself in the list.',
  'Reply "confirmed" if the forms are right and complete, or "corrected" with the full corrected list and a short note saying what you changed.',
  plan.wildcards_only
    ? 'Also look at the term itself: if it looks misspelt, truncated, ungrammatical or wrongly ordered, put the corrected term and a few words why in "term_suggestion" (for example "management: letter missing"); otherwise leave it empty. Still give the forms of the term as written.'
    : '',
  `Reply with JSON only, no preamble and no code fences. Shape: {"results":[{"id":"...","verdict":"confirmed","forms":["..."],"note":"..."${plan.wildcards_only ? ',"term_suggestion":""' : ''}}]}`,
].filter(Boolean).join('\n');
const terms = batch.map((t) => ({
  id: t.id,
  term: t.base,
  translates: t.source_term || undefined,
  forms: t.forms.slice(0, 30),
}));

// `prompt` feeds the Google Gemini node "AI wildcard check".
return [{ json: { prompt: `${instruction}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`, items: batch } }];
