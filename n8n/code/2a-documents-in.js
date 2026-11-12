// n8n Code node: "Documents in"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// The handoff point. Everything upstream of here just has to produce items
// shaped like:
//
//   { file_name: 'acme.tmx', source_type: 'tmx' | 'text', content: '<string>' }
//
// or, for a wildcards-only job's glossary:
//
//   { file_name: 'terms.xlsx', source_type: 'glossary', columns: [...], rows: [...] }
//
// If you rebuild the Drive nodes by hand, connect them into this node and
// nothing downstream needs changing.
// ===========================================================================

const items = $input.all();
if (!items.length) {
  throw new Error('No documents arrived. Check Settings.input_mode and the branch it selects.');
}

const usable = items.filter((i) => i.json.source_type !== 'unsupported'
  && ((i.json.content || '').length > 0 || (i.json.source_type === 'glossary' && (i.json.rows || []).length > 0)));

if (!usable.length) {
  const reasons = items.map((i) => i.json.skipped || 'empty content').join(', ');
  throw new Error(`No usable documents. Reasons: ${reasons}`);
}

return usable.map((i) => ({ json: i.json }));
