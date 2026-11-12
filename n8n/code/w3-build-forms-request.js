// n8n Code node: "Build forms request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Asks the AI for each target term's forms: the code needs them to place
// the wildcards. Sends the terms (and the source terms, as context) only.
const batch = $input.all().map((i) => i.json);
const settings = $('Settings').first().json;
const lang = settings.target_label || settings.target_lang;

const instruction = [
  `You are a terminologist for ${lang}. For each term below (a ${lang} glossary term, with the term it translates for context), list the forms it takes in running text: every grammatical case, singular and plural, and for adjectives the forms that agree with the noun.`,
  'For multi-word terms, give whole-phrase forms with the words agreeing, as they would appear in a sentence.',
  'Include the term itself. Give up to 15 forms, most common first. Leave out derived words (for example a verb made from a noun), other spellings, and capitalised duplicates.',
  'Reply with JSON only, no preamble and no code fences. Shape: {"results":[{"id":"...","forms":["..."]}]}',
].join(' ');
const terms = batch.map((t) => ({ id: t.id, term: t.base, translates: t.source_term || undefined }));

// `prompt` feeds the Google Gemini node "AI forms".
return [{ json: { prompt: `${instruction}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`, items: batch } }];
