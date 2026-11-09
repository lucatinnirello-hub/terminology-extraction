// n8n Code node: "Build AI request"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One request body per batch. Only terms, metrics and examples are sent —
// never whole files.
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
  'Reply with JSON only — no preamble, no code fences.',
  'Shape: {"results":[{"term":"...","keep":true,"reason":"...","definition":"..."}]}',
  'Set keep to false for verb phrases, generic language, and sentence fragments.',
].join(' ');

const body = {
  model: 'claude-sonnet-5-5',
  max_tokens: 4000,
  messages: [{ role: 'user', content: `${instruction}\n\nTerms:\n${JSON.stringify(terms, null, 2)}` }],
};

// `prompt` feeds the Anthropic node ("Message a Model"); `llm_body` is the
// same request as raw JSON, for use with an HTTP Request node instead.
return [{ json: { prompt: body.messages[0].content, llm_body: JSON.stringify(body), batch_size: batch.length, terms: batch } }];
