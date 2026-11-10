// n8n Code node: "Final rows"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

return $input.all().map((item) => {
  const t = item.json;
  const join = (v) => (Array.isArray(v) ? v.join(' | ') : v || '');
  return {
    json: {
      rank: t.rank,
      term: t.term,
      source_form: t.source_form || '',
      case_note: t.case_note || '',
      word_count: t.word_count,
      yake_score: t.yake_score,
      occurrences: t.occurrences,
      segments: t.segments,
      source_types: join(t.source_types),
      merged_variants: join(t.merged_variants),
      lemma: t.lemma || '',
      ai_keep: t.ai_keep === null || t.ai_keep === undefined ? '' : String(t.ai_keep),
      ai_reason: t.ai_reason || '',
      definition: t.definition || '',
      translation: t.translation || '',
      examples: join(t.examples),
      ai_error: t.ai_error || '',
    },
  };
});
