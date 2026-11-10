// n8n Code node: "Build AI request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One prompt per batch of 25 terms. Only terms, counts and 2 example segments
// are sent to Google's Gemini API. Never whole files.
const batch = $input.all().map((i) => i.json);
const settings = $('Settings').first().json;
const normaliseCase = settings.normalise_case !== false;

const FOCUS = {
  general: 'General terminology: any subject-specific term a translator would need to keep consistent.',
  ui: 'User interface and software strings: buttons, menus, screen and feature names, settings, error messages. Keep UI labels even when short.',
  technical: 'Technical documentation: components, procedures, measurements, specifications.',
  marketing: 'Marketing and brand content: product names, brand terms, taglines, campaign vocabulary.',
  legal: 'Legal and compliance: defined terms, clauses, regulatory vocabulary.',
  life_sciences: 'Life sciences and medical: conditions, procedures, devices, regulatory terms.',
  finance: 'Finance: financial instruments, reporting and accounting terms.',
};

const terms = batch.map((t) => ({
  term: t.term,
  occurrences: t.occurrences,
  segments: t.segments,
  examples: (t.examples || []).slice(0, 2),
}));

const instruction = [
  'You are reviewing candidate glossary terms extracted from a client corpus.',
  'For each term, decide whether it belongs in a terminology glossary and write a one-sentence definition grounded in the examples given.',
  'Reply with JSON only, no preamble and no code fences.',
  normaliseCase
    ? 'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"...","term_cased":"..."}]}'
    : 'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"..."}]}',
  'Copy "term" exactly as given.',
  'Set keep to false for verb phrases, generic language, and sentence fragments.',
  normaliseCase
    ? 'In "term_cased", write the term as a glossary entry: lower case, except proper nouns, brand and product names, acronyms, and words the language always capitalises (such as German nouns). Change only letter case, never the letters themselves.'
    : '',
].filter(Boolean).join(' ');

// The linguist's brief from the page. It can steer what counts as a term;
// it cannot change the reply format above.
const brief = [
  `Focus: ${FOCUS[settings.ai_focus] || FOCUS.general}`,
  settings.ai_domain ? `Domain: ${settings.ai_domain}` : '',
  settings.ai_instructions ? `Additional instructions from the linguist:\n${settings.ai_instructions}` : '',
].filter(Boolean).join('\n');

// `prompt` feeds the Google Gemini node ("Message a Model") in "AI review".
return [{
  json: {
    prompt: `${instruction}\n\nProject brief (use it to judge which terms to keep; the reply format above still applies):\n${brief}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`,
    batch_size: batch.length,
    terms: batch,
  },
}];
