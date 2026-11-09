// n8n Code node: "Build AI request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One prompt per batch of 25 terms. Only terms, counts and 2 example segments
// are sent to Google's Gemini API. Never whole files.
const batch = $input.all().map((i) => i.json);

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
  'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"..."}]}',
  'Set keep to false for verb phrases, generic language, and sentence fragments.',
].join(' ');

// `prompt` feeds the Google Gemini node ("Message a Model") in "AI review".
return [{
  json: {
    prompt: `${instruction}\n\nTerms:\n${JSON.stringify(terms, null, 2)}`,
    batch_size: batch.length,
    terms: batch,
  },
}];
