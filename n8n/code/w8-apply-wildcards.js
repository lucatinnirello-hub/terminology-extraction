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
function lcpLen(list) {
  let i = 0;
  while (list.every((w) => i < w.length && w[i] === list[0][i])) i += 1;
  return i;
}

// base: the term in its dictionary form. forms: its inflected forms (any case).
function proposeWildcard(base, forms) {
  const bw = words(base);
  const bl = bw.map(lower);
  const total = bw.join(' ').length;
  const variants = [];
  const otherShape = [];
  for (const f of new Set(forms.map((x) => words(lower(x)).join(' ')))) {
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
  return { wildcarded: out.join(' '), reason: why.join('; ') || 'no variation in the forms: no wildcard' };
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
  const pw = words(wildcarded);
  const fw = words(form);
  if (pw.length !== fw.length) return false;
  const total = stripWildcards(pw.join(' ')).length;
  return pw.every((p, i) => wordMatches(p, fw[i], i === pw.length - 1 ? Math.floor(0.5 * (pw.length === 1 ? stripWildcards(p).length : total)) : 0));
}
// Words in the client's own texts that a wildcard would also catch, which
// aren't among the term's forms: likely false hits ("Wassert|urm" ->
// "Wassertropfen"). Most frequent first.
// `vocabulary` is [[word, count], ...] sorted by word (see sortVocabulary).
function alsoMatches(wildcarded, forms, vocabulary, max = 5) {
  const known = new Set(forms.flatMap((f) => words(lower(f))));
  const hits = new Map();
  for (const p of words(wildcarded)) {
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

// Final wildcards: the AI's answer where it passes the checks below, else
// the code's proposal. Then notes what each one misses or also catches.
//
// wildcard_check:
//   AI confirmed                          the code's proposal, checked by the AI
//   AI corrected                          the AI changed it: check these first
//   Code proposal kept (AI reply invalid) the AI's version broke the term
//   Code only, not validated              the AI didn't run (or failed)
const plan = $('Wildcard plan').first().json;
const settings = $('Settings').first().json;
const proposals = plan.route === 'none' ? [] : $('Propose wildcards').all().map((i) => i.json);
const verdicts = plan.route === 'ai' ? new Map($input.all().map((i) => [String(i.json.id), i.json])) : new Map();
const vocabulary = sortVocabulary(plan.vocabulary);

// Why an AI answer can't be used, or '' if it can.
function invalid(w, base) {
  if (lower(stripWildcards(w)).replace(/\s+/g, ' ').trim() !== lower(base).replace(/\s+/g, ' ').trim()) return 'it changes the letters of the term';
  for (const word of words(w)) {
    const marks = (word.match(/[|*]/g) || []).length;
    if (marks > 1) return `more than one wildcard in "${word}"`;
    if (word.includes('*') && !word.endsWith('*')) return `"*" not at the end of "${word}"`;
    if (word.startsWith('|') || word.endsWith('|')) return `"|" at the edge of "${word}"`;
  }
  return '';
}
// Puts the AI's wildcards into the term exactly as written (keeps its capitals).
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
  let check = 'Code only, not validated';
  const notes = [`Code: ${p.reason}`];
  if (plan.route === 'ai') {
    const v = verdicts.get(String(p.id)) || {};
    if (p.forms_error) notes.push(`AI forms: ${p.forms_error}`);
    if (v.check_error || !v.ai_wildcarded) {
      notes.push(`AI check failed: ${v.check_error || 'no answer'}`);
    } else {
      const bad = invalid(v.ai_wildcarded, p.base);
      if (bad) {
        check = 'Code proposal kept (AI reply invalid)';
        notes.push(`AI suggested "${v.ai_wildcarded}", not used: ${bad}`);
      } else {
        final = transfer(v.ai_wildcarded, p.base);
        check = final === p.proposed ? 'AI confirmed' : 'AI corrected';
        if (v.ai_note && check === 'AI corrected') notes.push(`AI: ${v.ai_note}`);
      }
    }
  } else if (plan.ai_note) {
    notes.push(`AI didn't run: ${plan.ai_note}`);
  }
  const missed = p.forms.filter((f) => !termMatches(final, f));
  if (missed.length) notes.push(`doesn't match: ${missed.slice(0, 4).join(', ')}`);
  const also = alsoMatches(final, p.forms, vocabulary);
  if (also.length) notes.push(`also matches in the files: ${also.join(', ')}`);
  if (p.had_wildcards) notes.push(`the glossary had: ${p.had_wildcards}`);
  results.set(String(p.id), { memoq_term: final, wildcard_check: check, wildcard_note: notes.join('; ') });
}

// ---- extraction jobs: back onto the terms
if (!plan.wildcards_only) {
  return plan.terms.map((t, i) => ({ json: { ...t, ...(results.get(String(i)) || {}) } }));
}

// ---- wildcards-only jobs: the glossary's rows, with three columns added
const g = $('Glossary terms').first().json;
const memoqColumn = `${g.target_column} (memoQ)`;
return g.rows.map((row, r) => {
  const parts = [];
  for (let k = 0; results.has(`${r}:${k}`); k += 1) parts.push(results.get(`${r}:${k}`));
  const out = {};
  for (const c of g.columns) out[c] = row[c];
  out[memoqColumn] = parts.map((x) => x.memoq_term).join('; ');
  out.wildcard_check = [...new Set(parts.map((x) => x.wildcard_check))].join(' / ');
  out.wildcard_note = parts.length > 1 ? parts.map((x) => `${x.memoq_term}: ${x.wildcard_note}`).join(' / ') : parts.map((x) => x.wildcard_note).join('');
  return { json: out };
});
