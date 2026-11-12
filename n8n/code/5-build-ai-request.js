// n8n Code node: "Build AI request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One prompt per batch of 25 terms. Only terms, counts and a few example
// segments are sent to Google's Gemini API. Never whole files.
//
// With translations on, each term with a suggestion from the files gets it,
// plus source/target example pairs: 1 for a high-confidence match, 2
// otherwise. Terms with no suggestion are translated by the AI only if the
// person chose "let AI translate" on the page.
const batch = $input.all().map((i) => i.json);
const settings = $('Settings').first().json;
const translations = settings.suggest_translations === true;
const targetName = settings.target_label || settings.target_lang;

// Source examples, for the definition: at most 2 in all, counting the
// source side of any example pairs.
const MAX_EXAMPLES = 2;

const terms = batch.map((t) => {
  const item = { term: t.term, occurrences: t.occurrences, segments: t.segments };
  const pairs = translations && t.code_suggestion
    ? (t.tm_pairs || []).slice(0, t.code_confidence === 'high' ? 1 : 2)
    : [];
  const examples = (t.examples || [])
    .filter((ex) => !pairs.some((p) => p.source === ex))
    .slice(0, Math.max(0, MAX_EXAMPLES - pairs.length));
  if (examples.length) item.examples = examples;
  if (pairs.length) item.example_translations = pairs;
  if (translations && t.code_suggestion) {
    item.tm_suggestion = t.code_suggestion;
    if ((t.code_alternatives || []).length) item.tm_alternatives = t.code_alternatives;
  } else if (translations && settings.ai_translate_missing) {
    item.translate = true;
  }
  return item;
});

const instruction = [
  'You are reviewing candidate glossary terms extracted from a client corpus.',
  'For each term, decide whether it belongs in a terminology glossary and write a one-sentence definition grounded in the examples given.',
  'Reply with JSON only, no preamble and no code fences.',
  translations
    ? 'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"...","translation":"...","translation_check":"confirmed","translation_note":"..."}]}'
    : 'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"..."}]}',
  'Set keep to false for verb phrases, generic language, and sentence fragments.',
];
if (translations) {
  instruction.push(
    `Translations into ${targetName}:`,
    '"tm_suggestion" is how the client\'s translation memory most often translates the term, found automatically by matching segments. Nobody has checked it: it may be wrong, used inconsistently, or in an inflected form. Judge it yourself, using "example_translations" and "tm_alternatives" (other translations used, with how often).',
    'For terms with "tm_suggestion", give "translation" and set "translation_check" to "confirmed" if the suggestion is a correct translation of the term, or "corrected" if you would use a different one. Putting the suggestion into its dictionary form (for example nominative singular instead of another case) still counts as "confirmed". When corrected, say why in "translation_note", in a few words.',
    'For terms with "translate": true, give your own translation and set "translation_check" to "translated".',
    'For any other term, leave out translation, translation_check and translation_note.',
    'Give every translation in its dictionary form, in normal case rather than all capitals, unless it is a name.',
  );
}

// `prompt` feeds the Google Gemini node ("Message a Model") in "AI review".
return [{
  json: {
    prompt: `${instruction.join(' ')}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`,
    batch_size: batch.length,
    terms: batch,
  },
}];
