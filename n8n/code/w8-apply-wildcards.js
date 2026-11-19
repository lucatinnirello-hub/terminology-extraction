// n8n Code node: "Apply wildcards"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===== wildcard engine (shared by "Propose wildcards" and "Apply wildcards")
// Rules from "Wildcards Logic" and "Word Matching Logic":
//   ending CHANGES between forms (periodo/periodi)  -> pipe after the shared stem: period|o
//   forms only ADD letters, addition <= 50%           -> no wildcard (memoQ's 50% prefix)
//   forms only ADD letters, addition > 50%            -> asterisk: run*
//   multi-word: additions measured against the whole term; a word other
//   than the last that varies always gets a wildcard (Símbolo* de Premio).
// Whether a pipe also matches the stem on its own. It does in memoQ:
// "program|ming instruction|s" matches "program instruction" (tested).
// ("Wildcards Logic" says it doesn't; its own examples, and memoQ, say it does.)
const PIPE_MATCHES_STEM_ALONE = true;
// A shared beginning shorter than this can't be a useful stem (Mutter/Mütter).
const MIN_STEM = 3;

const lower = (s) => s.toLocaleLowerCase();
const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const stripWildcards = (s) => s.replace(/[|*]/g, '');
// Punctuation around a word ("(ОЮНЧУГА", "көбөйтүү!") stays outside the
// wildcards: the rules apply to the letters and digits only.
const splitPunct = (w) => { const m = w.match(/^([^\p{L}\p{N}|*]*)(.*?)([^\p{L}\p{N}|*]*)$/u); return { pre: m[1], core: m[2], post: m[3] }; };
const coreWords = (s) => words(s).map((w) => splitPunct(w).core).filter(Boolean);
function lcpLen(list) {
  let i = 0;
  while (list.every((w) => i < w.length && w[i] === list[0][i])) i += 1;
  return i;
}

// base: the term in its dictionary form. forms: its inflected forms (any case).
function proposeWildcard(base, forms) {
  const tokens = words(base).map(splitPunct);
  const bw = tokens.map((t) => t.core).filter(Boolean);
  const bl = bw.map(lower);
  const total = bw.join(' ').length;
  const variants = [];
  const otherShape = [];
  for (const f of new Set(forms.map((x) => coreWords(lower(x)).join(' ')))) {
    const fw = f.split(' ');
    if (fw.length === bw.length) variants.push(fw); else if (f) otherShape.push(f);
  }
  const out = [];
  const why = [];
  const irregular = [];
  bw.forEach((word, i) => {
    const b = bl[i];
    const last = i === bw.length - 1;
    let vs = [...new Set(variants.map((v) => v[i]))].filter((v) => v !== b);
    // Forms that change near the start (Mutter/Mütter) can't be wildcarded.
    // (A form that starts with the whole word is an addition, however short the word.)
    const odd = vs.filter((v) => !v.startsWith(b) && lcpLen([b, v]) < MIN_STEM);
    if (odd.length) { irregular.push(...odd); vs = vs.filter((v) => !odd.includes(v)); }
    if (!vs.length) { out.push(word); return; }
    if (vs.every((v) => v.startsWith(b))) {
      const add = Math.max(...vs.map((v) => v.length - b.length));
      const ratio = add / (bw.length === 1 ? b.length : total);
      const pct = Math.round(ratio * 100);
      if (last && ratio <= 0.5) { out.push(word); why.push(`"${word}" only adds up to ${add} letter${add === 1 ? '' : 's'} (${pct}%): 50% prefix, no wildcard`); return; }
      out.push(word + '*');
      why.push(last ? `"${word}" adds up to ${add} letters (${pct}%, over 50%): asterisk` : `"${word}" is not the last word and varies (${vs.slice(0, 3).join(', ')}): asterisk`);
      return;
    }
    const stem = lcpLen([b, ...vs]);
    const stemText = word.slice(0, stem);
    if (stem < MIN_STEM) { out.push(word); why.push(`"${word}" changes near its start: wildcards can't cover it`); return; }
    if (!PIPE_MATCHES_STEM_ALONE && vs.includes(b.slice(0, stem))) {
      out.push(stemText + '*'); why.push(`"${word}": the stem "${stemText}" is itself a form (${vs.slice(0, 3).join(', ')}): asterisk`); return;
    }
    out.push(stemText + '|' + word.slice(stem));
    why.push(`"${word}" changes its ending (${vs.slice(0, 3).join(', ')}): pipe after "${stemText}"`);
  });
  if (irregular.length) why.push(`not covered, changes near the start: ${[...new Set(irregular)].slice(0, 3).join(', ')}`);
  if (otherShape.length) why.push(`forms with a different number of words ignored: ${otherShape.slice(0, 2).join(', ')}`);
  if (!variants.some((v) => v.join(' ') !== bl.join(' '))) return { wildcarded: base, reason: 'no forms other than the term itself are known: no wildcard' };
  let k = 0;
  const rebuilt = tokens.map((t) => (t.core ? t.pre + out[k++] + t.post : t.pre)).join(' ');
  return { wildcarded: rebuilt, reason: why.join('; ') || 'no variation in the forms: no wildcard' };
}

// Does one word of a wildcarded term match a word of the text? `prefixRoom`
// is how many extra letters memoQ's 50% prefix allows on an unmarked word.
function wordMatches(p, w, prefixRoom) {
  p = lower(p); w = lower(w);
  if (p.endsWith('*')) return w.startsWith(p.slice(0, -1));
  const bar = p.indexOf('|');
  if (bar >= 0) { const stem = p.slice(0, bar); return w.startsWith(stem) && (PIPE_MATCHES_STEM_ALONE || w !== stem); }
  return w === p || (prefixRoom > 0 && w.startsWith(p) && w.length - p.length <= prefixRoom);
}
function termMatches(wildcarded, form) {
  const pw = coreWords(wildcarded);
  const fw = coreWords(form);
  if (pw.length !== fw.length) return false;
  const total = stripWildcards(pw.join(' ')).length;
  return pw.every((p, i) => wordMatches(p, fw[i], i === pw.length - 1 ? Math.floor(0.5 * (pw.length === 1 ? stripWildcards(p).length : total)) : 0));
}
// Words in the client's own texts that a wildcard would also catch, which
// aren't among the term's forms: likely false hits ("Wassert|urm" ->
// "Wassertropfen"). Most frequent first.
// `vocabulary` is [[word, count], ...] sorted by word (see sortVocabulary).
function alsoMatches(wildcarded, forms, vocabulary, max = 5) {
  const known = new Set(forms.flatMap((f) => coreWords(lower(f))));
  const hits = new Map();
  for (const p of coreWords(wildcarded)) {
    if (!/[|*]/.test(p)) continue;
    const stem = lower(p).split(/[|*]/)[0];
    let lo = 0;
    let hi = vocabulary.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vocabulary[mid][0] < stem) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < vocabulary.length && vocabulary[i][0].startsWith(stem); i += 1) {
      const [w, n] = vocabulary[i];
      if (!known.has(w) && wordMatches(p, w, 0)) hits.set(w, n);
    }
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}
const sortVocabulary = (v) => (v || []).map(([w, n]) => [lower(w), n]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
// ===== end of wildcard engine

// Final wildcards, always placed by the code: from the forms the AI checked
// (or corrected), else from the forms in "Propose wildcards". Then notes what
// each one misses or also catches. Every copy of a term gets the same answer.
//
// wildcard_check:
//   AI confirmed              the AI found the forms right: the code's wildcards stand
//   AI corrected              the AI corrected the forms and the code re-placed the
//                             wildcards from them: check these first
//   Code only, not validated  the AI didn't run (or failed)
//   No wildcards needed       the target language doesn't inflect
const plan = $('Wildcard plan').first().json;
const settings = $('Settings').first().json;
const proposals = plan.route === 'ai' || plan.route === 'code' ? $('Propose wildcards').all().map((i) => i.json).filter((p) => !p.skip) : [];
const verdicts = plan.route === 'ai' ? new Map($input.all().map((i) => [String(i.json.id), i.json])) : new Map();
const vocabulary = sortVocabulary(plan.vocabulary);
const itemsById = new Map(plan.items.map((it) => [String(it.id), it]));

// Puts the wildcards into a copy of the term exactly as that copy is written
// (keeps its capitals).
function transfer(w, base) {
  const marks = [];
  let n = 0;
  for (const ch of w.replace(/\s+/g, ' ').trim()) { if (ch === '|' || ch === '*') marks.push([n, ch]); else n += 1; }
  const chars = [...base.replace(/\s+/g, ' ').trim()];
  for (const [pos, ch] of marks.reverse()) chars.splice(pos, 0, ch);
  return chars.join('');
}

const results = new Map();
for (const p of proposals) {
  let final = p.proposed;
  let forms = p.forms;
  let check = 'Code only, not validated';
  let suggestion = '';
  const notes = [];
  if (plan.route === 'ai') {
    const v = verdicts.get(String(p.id)) || {};
    if (p.forms_error) notes.push(`AI forms: ${p.forms_error}`);
    if (v.check_error || !v.ai_verdict) {
      notes.push(`Code: ${p.reason}`, `AI check failed: ${v.check_error || 'no answer'}`);
    } else if (v.ai_verdict === 'confirmed') {
      check = 'AI confirmed';
      notes.push(`Code: ${p.reason}`);
    } else {
      forms = [...new Set([p.base, ...v.ai_forms].map((f) => String(f).trim()).filter(Boolean))];
      const again = proposeWildcard(p.base, forms);
      final = again.wildcarded;
      check = 'AI corrected';
      notes.push(`Code, from the AI's corrected forms: ${again.reason}`);
      if (final !== p.proposed) notes.push(`before the AI's correction: ${p.proposed}`);
      if (v.ai_note) notes.push(`AI: ${v.ai_note}`);
    }
    suggestion = v.term_suggestion || '';
  } else {
    notes.push(`Code: ${p.reason}`);
    if (plan.ai_note) notes.push(`AI didn't run: ${plan.ai_note}`);
  }
  const missed = forms.filter((f) => !termMatches(final, f));
  if (missed.length) notes.push(`doesn't match: ${missed.slice(0, 4).join(', ')}`);
  const also = alsoMatches(final, forms, vocabulary);
  if (also.length) notes.push(`also matches in the files: ${also.join(', ')}`);
  for (const id of p.ids || [p.id]) {
    const it = itemsById.get(String(id)) || p;
    const own = [...notes];
    if (it.had_wildcards) own.push(`the glossary had: ${it.had_wildcards}`);
    if ((p.ids || []).length > 1) own.push(`same term ${p.ids.length} times in the glossary: same wildcards for each`);
    results.set(String(id), { memoq_term: transfer(final, it.base), wildcard_check: check, wildcard_note: own.join('; '), term_suggestion: suggestion });
  }
}

// Languages that don't inflect: every term as it is.
if (plan.route === 'no_inflection') {
  for (const it of plan.items) {
    results.set(String(it.id), {
      memoq_term: it.base,
      wildcard_check: 'No wildcards needed',
      wildcard_note: `${settings.target_label} doesn't inflect: no wildcards needed${it.had_wildcards ? `; the glossary had: ${it.had_wildcards}` : ''}`,
    });
  }
}

// ---- extraction jobs: back onto the terms
if (!plan.wildcards_only) {
  return plan.terms.map((t, i) => ({ json: { ...t, ...(results.get(String(i)) || {}) } }));
}

// ---- wildcards-only jobs: the glossary's rows, with three columns added
const g = $('Glossary terms').first().json;
const memoqColumn = `${g.target_column} (memoQ)`;
const sepById = new Map(g.items.map((it) => [String(it.id), it.sep || '']));
return g.rows.map((row, r) => {
  const parts = [];
  for (let k = 0; results.has(`${r}:${k}`); k += 1) parts.push({ ...results.get(`${r}:${k}`), sep: sepById.get(`${r}:${k}`) || '' });
  const out = {};
  for (const c of g.columns) out[c] = row[c];
  // The cell's own separators (";", ",", "/") between its terms, as written.
  out[memoqColumn] = parts.map((x) => x.memoq_term + x.sep).join('');
  out.wildcard_check = [...new Set(parts.map((x) => x.wildcard_check))].join(' / ');
  out.wildcard_note = parts.length > 1 ? parts.map((x) => `${x.memoq_term}: ${x.wildcard_note}`).join(' / ') : parts.map((x) => x.wildcard_note).join('');
  if (parts.length > 1 && g.split_rows && g.split_rows.includes(r)) out.wildcard_note = `cell split into ${parts.length} terms at its separators / ${out.wildcard_note}`;
  const suggestions = parts.filter((x) => x.term_suggestion);
  out.term_suggestion = parts.length > 1 ? suggestions.map((x) => `${stripWildcards(x.memoq_term)} → ${x.term_suggestion}`).join(' / ') : suggestions.map((x) => x.term_suggestion).join('');
  return { json: out };
});
