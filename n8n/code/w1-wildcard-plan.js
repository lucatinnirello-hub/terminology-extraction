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
//   route 'no_inflection'  the target language doesn't inflect (NO_INFLECTION):
//                 terms come back unchanged, the AI isn't asked
//   route 'none'  wildcards not asked for, or no target terms
//
// Only target terms get wildcards. Reached from the AI review loop or the
// no-AI path (extraction jobs), or from "Glossary terms" (wildcards-only jobs).
// ===========================================================================

// --- EDITABLE: target languages that don't inflect --------------------------
// Their terms never need wildcards, so the AI isn't asked (it might list
// longer phrases as "forms" and earn a wrong asterisk). Codes as on the page.
// Japanese is a judgement call: its nouns, most glossary terms, don't
// inflect, but verbs and adjectives do. Remove 'ja' to treat it like any
// other language. Korean is deliberately not here: particles attach to
// nouns (상금 심볼 → 상금 심볼이), which memoQ's 50% prefix has to cover.
const NO_INFLECTION = ['zh', 'ja', 'th', 'lo', 'km', 'my', 'vi'];
// ---------------------------------------------------------------------------

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
const route = !wanted || !items.length ? 'none'
  : NO_INFLECTION.includes(settings.target_lang) ? 'no_inflection'
    : gate.may_run_ai ? 'ai' : 'code';
const aiNote = route === 'no_inflection' ? `${settings.target_label} doesn't inflect` : gate.reason || '';
return [{ json: { route, wildcards_only: wildcardsOnly, items, vocabulary, terms, ai_note: aiNote } }];
