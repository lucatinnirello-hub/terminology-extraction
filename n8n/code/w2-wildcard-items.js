// n8n Code node: "Wildcard items"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One item per distinct target term, for batching through the AI. A term
// that appears more than once (in any capitals) is sent once: "Propose
// wildcards" gives every copy the same answer.
const key = (s) => String(s).toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const seen = new Set();
return $('Wildcard plan').first().json.items
  .filter((it) => !seen.has(key(it.base)) && seen.add(key(it.base)))
  .map((it) => ({ json: it }));
