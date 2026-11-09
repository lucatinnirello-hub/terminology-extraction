// n8n Code node: "Stage 1 rows"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Flatten to one item per term for the spreadsheet node.
// Fails loudly on zero terms: otherwise the run would stop here silently and
// the job would sit in 'running' until it went stale.
const input = $input.first().json;
const rows = input.rows || [];
if (!rows.length) {
  const log = input.log || {};
  const skipped = (log.skipped || []).map((s) => `${s.reason} x${s.count}`).join(', ') || 'none';
  throw new Error(
    `No candidate terms found. Segments read: ${log.segments_total || 0}; skipped: ${skipped}. ` +
    'Check the source language matches the files (TMX/XLIFF files in another language are skipped), or lower "minimum segments".'
  );
}
return rows.map((row) => ({ json: row }));
