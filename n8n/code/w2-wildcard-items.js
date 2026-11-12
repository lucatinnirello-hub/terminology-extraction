// n8n Code node: "Wildcard items"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One item per target term, for batching through the AI.
return $('Wildcard plan').first().json.items.map((it) => ({ json: it }));
