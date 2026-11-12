// n8n Code node: "Wildcard plan"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// MEMOQ WILDCARDS: which target terms get them, and how.
//
//   route 'ai'    the AI lists each term's forms, the code proposes the
//                 wildcards (your Wildcards Logic rules), the AI checks them
//   route 'code'  the code proposes from the forms seen in the files only:
//                 AI review not ticked, not approved, or client restricted
//   route 'none'  wildcards not asked for, or no target terms
//
// Only target terms get wildcards. Reached from the AI review loop or the
// no-AI path (extraction jobs), or from "Glossary terms" (wildcards-only jobs).
// ===========================================================================
const settings = $('Settings').first().json;
const gate = $('Check restricted list').first().json.gate || {};
const wildcardsOnly = settings.mode === 'wildcards';

let terms = [];
let items = [];
let vocabulary = [];
if (wildcardsOnly) {
  const g = $('Glossary terms').first().json;
  items = g.items;
  vocabulary = g.vocabulary;
} else {
  terms = $input.all().map((i) => i.json);
  if (settings.add_wildcards) {
    vocabulary = $('Match translations').first().json.target_vocabulary || [];
    terms.forEach((t, i) => {
      // The checked translation if there is one, else the files' suggestion.
      const checked = ['confirmed', 'corrected', 'translated'].includes(t.ai_translation_check) && t.ai_translation;
      const base = checked ? t.ai_translation : t.code_suggestion;
      if (!base) return;
      // The forms seen in the files belong to the files' suggestion: use them
      // unless the AI replaced it with another translation.
      const filesForms = !checked || t.ai_translation_check === 'confirmed';
      items.push({
        id: String(i),
        source_term: t.term,
        base: String(base).replace(/[|*]/g, ''),
        had_wildcards: '',
        tm_forms: filesForms ? t.code_forms || [] : [],
      });
    });
  }
}

const wanted = wildcardsOnly || settings.add_wildcards === true;
const route = !wanted || !items.length ? 'none' : gate.may_run_ai ? 'ai' : 'code';
return [{ json: { route, wildcards_only: wildcardsOnly, items, vocabulary, terms, ai_note: gate.reason || '' } }];
