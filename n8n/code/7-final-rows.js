// n8n Code node: "Final rows"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// One row per term for the glossary.
//
// With translations on, `translation_check` says where each translation came
// from, so reviewers know what to look at first:
//   AI confirmed                       the files' translation, checked by the AI
//   AI corrected                       the AI disagreed with the files: check these
//   AI translated (not from the files) no match in the files; the AI translated it
//   Code suggestion, not validated     the AI didn't run: see code_suggestion
//   No match in the files              nothing found, and no AI translation asked for
// Nothing unchecked ever goes in `translation` itself.
//
// With wildcards on, `memoq_term` is the target term with memoQ wildcards
// (see "Apply wildcards" for `wildcard_check`).
const settings = $('Settings').first().json;
const CHECK = {
  confirmed: 'AI confirmed',
  corrected: 'AI corrected',
  translated: 'AI translated (not from the files)',
};

return $input.all().map((item) => {
  const t = item.json;
  const join = (v) => (Array.isArray(v) ? v.join(' | ') : v || '');
  const row = {
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
  };
  if (settings.suggest_translations) {
    row.translation = CHECK[t.ai_translation_check] ? t.ai_translation : '';
    row.translation_check = CHECK[t.ai_translation_check]
      || (t.code_suggestion ? 'Code suggestion, not validated' : 'No match in the files');
    row.translation_note = t.ai_translation_note || '';
    row.code_suggestion = t.code_suggestion || '';
    row.code_confidence = t.code_suggestion ? `${t.code_confidence} (${t.code_found_in}/${t.code_segments})` : '';
    row.code_alternatives = join(t.code_alternatives);
  }
  if (settings.add_wildcards) {
    row.memoq_term = t.memoq_term || '';
    row.wildcard_check = t.wildcard_check || '';
    row.wildcard_note = t.wildcard_note || '';
  }
  row.examples = join(t.examples);
  row.ai_error = t.ai_error || '';
  return { json: row };
});
