// n8n Code node: "Build check request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Asks the AI to check the proposed wildcards against the rules.
//
// RULES is a summary of "Wildcards Logic" and "Word Matching Logic": edit
// it here if those documents change.
const RULES = [
  'memoQ wildcard rules for target terms:',
  '1. | (pipe) inside a word marks the end of the stem: memoQ then matches words that begin with the stem, including the stem on its own (program|ming matches program, programming, programmer). Use it when the ENDING CHANGES between forms: period|o (periodo, periodi), amig|o (amigo, amiga), talletu|s (talletus, talletuksen).',
  '2. * (asterisk) at the end of a word matches the word itself and anything added after it. Use it when forms only ADD letters and the addition is more than 50% of the length of the term: run* (running), text* (texting), child* (children).',
  '3. No wildcard when forms only ADD letters and the addition is at most 50% of the length of the term (cat/cats, bank/banks): memoQ\'s 50% prefix matching covers them.',
  '4. The stem is the longest beginning shared by all forms, not necessarily the grammatical stem.',
  '5. Multi-word terms: measure additions against the whole term. The last word follows rules 1-3; any other word that varies always gets a wildcard (Símbolo* de Premio; besplatn|a okretanj|a).',
  '6. If a word changes at its start or in the middle (Mutter/Mütter), wildcards cannot cover it: leave that word as it is.',
  '7. Only insert | or *, at most one per word. Never change, add or remove letters, spaces or capitals.',
].join('\n');

const batch = $input.all().map((i) => i.json);
const settings = $('Settings').first().json;
const lang = settings.target_label || settings.target_lang;

const instruction = [
  `You are checking memoQ term base wildcards for ${lang} target terms.`,
  RULES,
  'For each term: "proposal" was worked out from "forms" by applying these rules in code; "reason" says how; "also_matches" lists other words in the client\'s files that the proposal would also catch.',
  'Check that the forms are right and complete for the term, and that the proposal follows the rules, covers the forms and doesn\'t catch unrelated words. Reply "confirmed" if the proposal is right, or "corrected" with your own version and a short note saying why.',
  'Reply with JSON only, no preamble and no code fences. Shape: {"results":[{"id":"...","wildcarded":"...","verdict":"confirmed","note":"..."}]}',
].join('\n');
const terms = batch.map((t) => ({
  id: t.id,
  term: t.base,
  translates: t.source_term || undefined,
  forms: t.forms.slice(0, 15),
  proposal: t.proposed,
  reason: t.reason,
  also_matches: t.also_matches.length ? t.also_matches : undefined,
}));

// `prompt` feeds the Google Gemini node "AI wildcard check".
return [{ json: { prompt: `${instruction}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`, items: batch } }];
