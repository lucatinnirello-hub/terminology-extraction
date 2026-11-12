// n8n Code node: "Match translations"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// TRANSLATION SUGGESTIONS FROM THE FILES THEMSELVES. No AI.
//
// Only runs when the job asks for translations. For each term it looks at
// the target side of the segments whose source contains the term, and finds
// the target phrase that appears in those targets and rarely elsewhere
// (Dice coefficient). A suggestion must also be built from the translations
// of the term's own words, which stops "remain locked" being offered for
// "golden symbols" just because they happen to share segments.
//
// Confidence measures how CONSISTENTLY the files translate the term, not
// whether the translation is right: the AI review judges that.
//
// Adds to each term: code_suggestion, code_confidence (high / medium / low /
// none), code_found_in, code_segments, code_alternatives, tm_pairs (up to 2
// source/target example pairs for the AI review).
// ===========================================================================

// --- EDITABLE: word endings stripped when counting -------------------------
// So case endings don't split the counts ("okretanja" / "okretanje" /
// "okretanjima"). Only affects how forms are grouped: suggestions are always
// shown as written in the files. Keyed by target language code.
const SUFFIXES = {
  sr: ['ima', 'ama', 'ega', 'emu', 'ome', 'oga', 'omu', 'ih', 'im', 'og', 'om', 'em', 'oj', 'a', 'e', 'i', 'u', 'o'],
};
SUFFIXES.hr = SUFFIXES.sr;

// Segments looked at per term. Plenty for a reliable count; keeps big
// memories fast.
const MAX_SEGMENTS_PER_TERM = 200;
// ---------------------------------------------------------------------------

const settings = $('Settings').first().json;
const input = $input.first().json;

if (!settings.suggest_translations) {
  return [{ json: { ...input, log: { ...input.log, translations: { requested: false } } } }];
}

const target = $('Stopword lists').first().json.target || {};
const targetLang = settings.target_lang;

// --- reading source/target pairs (same cleaning as stage 1) -----------------
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function cleanInline(s) {
  return decodeEntities(
    s.replace(/<(bpt|ept|ph|it)\b[^>]*\/>/gi, ' ')
      .replace(/<(bpt|ept|ph|it)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(g|mrk|pc)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}
const ISO3 = {
  en: ['eng'], it: ['ita'], fr: ['fre', 'fra'], de: ['ger', 'deu'], es: ['spa'], pt: ['por'], nl: ['dut', 'nld'],
  da: ['dan'], sv: ['swe'], nb: ['nob', 'nor'], no: ['nor', 'nob'], nn: ['nno', 'nor'], fi: ['fin'], pl: ['pol'],
  cs: ['cze', 'ces'], sk: ['slo', 'slk'], sl: ['slv'], hr: ['hrv'], ro: ['rum', 'ron'], hu: ['hun'], et: ['est'],
  lv: ['lav'], lt: ['lit'], tr: ['tur'], id: ['ind'], sr: ['srp'], sh: ['hbs'], ru: ['rus'], uk: ['ukr'], bg: ['bul'], el: ['gre', 'ell'],
};
function langMatches(lang, wanted) {
  const l = String(lang || '').toLowerCase().replace(/_/g, '-');
  const wants = String(wanted || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
  return wants.some((w) => [w].concat(ISO3[w] || []).some((code) => l === code || l.startsWith(code + '-')));
}
const attr = (tag, name) => (tag.match(new RegExp('\\s' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [, ''])[1];

function tmxPairs(xml) {
  const pairs = [];
  for (const tu of xml.match(/<tu\b[^>]*>[\s\S]*?<\/tu>/gi) || []) {
    let source = '';
    let tgt = '';
    for (const m of tu.matchAll(/<tuv\b([^>]*)>([\s\S]*?)<\/tuv>/gi)) {
      const lang = (m[1].match(/(?:xml:)?lang\s*=\s*["']([^"']+)["']/i) || [, ''])[1];
      const seg = m[2].match(/<seg\b[^>]*>([\s\S]*?)<\/seg>/i);
      if (!seg) continue;
      if (!source && langMatches(lang, settings.tmx_lang)) source = cleanInline(seg[1]);
      else if (!tgt && langMatches(lang, settings.target_tmx)) tgt = cleanInline(seg[1]);
    }
    if (source) pairs.push({ source, target: tgt });
  }
  return pairs;
}

function xliffPairs(xml) {
  const rootTag = (xml.match(/<xliff\b[^>]*>/i) || [''])[0];
  const pairs = [];
  if (/^2/.test(attr(rootTag, 'version'))) {
    if (attr(rootTag, 'srcLang') && !langMatches(attr(rootTag, 'srcLang'), settings.tmx_lang)) return null;
    if (attr(rootTag, 'trgLang') && !langMatches(attr(rootTag, 'trgLang'), settings.target_tmx)) return null;
    for (const u of xml.matchAll(/<unit\b([^>]*)>([\s\S]*?)<\/unit>/gi)) {
      if (/\stranslate\s*=\s*["']no["']/i.test(u[1])) continue;
      for (const s of u[2].matchAll(/<segment\b[^>]*>([\s\S]*?)<\/segment>/gi)) {
        const src = s[1].match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
        const tgt = s[1].match(/<target\b[^>]*>([\s\S]*?)<\/target>/i);
        if (src) pairs.push({ source: cleanInline(src[1]), target: tgt ? cleanInline(tgt[1]) : '' });
      }
    }
    return pairs;
  }
  const fileTag = (xml.match(/<file\b[^>]*>/i) || [''])[0];
  if (attr(fileTag, 'source-language') && !langMatches(attr(fileTag, 'source-language'), settings.tmx_lang)) return null;
  if (attr(fileTag, 'target-language') && !langMatches(attr(fileTag, 'target-language'), settings.target_tmx)) return null;
  for (const tu of xml.matchAll(/<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/gi)) {
    if (/\stranslate\s*=\s*["']no["']/i.test(tu[1])) continue;
    const body = tu[2].replace(/<alt-trans\b[\s\S]*?<\/alt-trans>/gi, '');
    const src = body.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
    const tgt = body.match(/<target\b[^>]*>([\s\S]*?)<\/target>/i);
    if (src) pairs.push({ source: cleanInline(src[1]), target: tgt ? cleanInline(tgt[1]) : '' });
  }
  return pairs;
}

// --- the matcher -------------------------------------------------------------
const SPLIT_PUNCT = /[.!?:;,()\[\]{}"“”„«»…\/|+=*#<>]+/;
const tokens = (text) => (text.match(/[\p{L}\p{M}][\p{L}\p{M}'’\-]*|\d+(?:[.,]\d+)?/gu) || [])
  .map((t) => t.replace(/^['’\-]+|['’\-]+$/g, ''))
  .filter(Boolean);
const suffixes = SUFFIXES[targetLang] || [];
const stem = (w) => {
  for (const s of suffixes) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
};
const stop = new Set((target.stopwords || []).map((w) => w.toLowerCase()));
const conn = new Set((target.connectors || []).map((w) => w.toLowerCase()));
const srcStop = new Set($('Stopword lists').first().json.stopwords.map((w) => w.toLowerCase()));

// Candidate target phrases: runs of words between stopwords and punctuation,
// 1..maxN words; connectors ("u", "za", "di") allowed only inside.
function phrases(text, maxN) {
  const out = [];
  for (const chunk of text.split(SPLIT_PUNCT)) {
    const runs = [];
    let cur = [];
    for (const tok of tokens(chunk)) {
      const t = tok.toLowerCase();
      if (conn.has(t)) { if (cur.length) cur.push(tok); continue; }
      if (stop.has(t) || /^\d/.test(t) || t.length < 2) { if (cur.length) runs.push(cur); cur = []; } else cur.push(tok);
    }
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      for (let n = 1; n <= Math.min(maxN, run.length); n += 1) {
        for (let i = 0; i + n <= run.length; i += 1) {
          const p = run.slice(i, i + n);
          if (conn.has(p[0].toLowerCase()) || conn.has(p[n - 1].toLowerCase())) continue;
          out.push(p);
        }
      }
    }
  }
  return out;
}
const keyOf = (p) => p.map((w) => stem(w.toLowerCase())).join(' ');

// ---- read every TMX / XLIFF file
const log = { requested: true, target_lang: targetLang, files_with_targets: 0, files_skipped: [], pairs: 0 };
const pairs = [];
for (const item of $('Documents in').all()) {
  const doc = item.json;
  if (doc.source_type !== 'tmx' && doc.source_type !== 'xliff') continue;
  let found;
  try {
    found = doc.source_type === 'tmx' ? tmxPairs(doc.content) : xliffPairs(doc.content);
  } catch (e) {
    log.files_skipped.push(`${doc.file_name}: could not be read`);
    continue;
  }
  if (found === null) { log.files_skipped.push(`${doc.file_name}: another language pair`); continue; }
  const withTarget = found.filter((p) => p.source && p.target);
  if (!withTarget.length) { log.files_skipped.push(`${doc.file_name}: no ${targetLang} target text`); continue; }
  log.files_with_targets += 1;
  pairs.push(...withTarget);
}
log.pairs = pairs.length;

const terms = input.terms || [];
const blank = { code_suggestion: '', code_confidence: 'none', code_found_in: 0, code_segments: 0, code_alternatives: [], tm_pairs: [] };

if (!pairs.length) {
  log.note = 'No target text found in the files.';
  log.by_confidence = { none: terms.length };
  return [{ json: { ...input, terms: terms.map((t) => ({ ...t, ...blank })), log: { ...input.log, translations: log } } }];
}

// ---- index the source side: word -> pairs containing it
const prepared = pairs.map((p) => ({ srcWords: tokens(p.source).map((w) => w.toLowerCase()), ...p }));
const index = new Map();
prepared.forEach((p, i) => {
  for (const w of new Set(p.srcWords)) {
    if (!index.has(w)) index.set(w, []);
    index.get(w).push(i);
  }
});
const containsWords = (hay, needle) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const segmentsWith = (words) => {
  const lists = words.map((w) => index.get(w) || []).sort((a, b) => a.length - b.length);
  if (!lists.length || !lists[0].length) return [];
  const rest = lists.slice(1).map((l) => new Set(l));
  const out = [];
  for (const i of lists[0]) {
    if (rest.every((s) => s.has(i)) && containsWords(prepared[i].srcWords, words)) out.push(i);
    if (out.length >= MAX_SEGMENTS_PER_TERM) break;
  }
  return out;
};

// ---- pass 1: candidates in each term's targets. Single source words are
// included too: their translations check what a suggestion is built from.
const termWords = terms.map((t) => tokens(t.term).map((w) => w.toLowerCase()));
const singles = [...new Set(termWords.flat())].filter((w) => !srcStop.has(w));
const units = [...termWords, ...singles.map((w) => [w])];
const perUnit = units.map((words) => {
  const maxN = words.length === 1 ? 1 : Math.min(4, words.length + 2);
  const segs = segmentsWith(words);
  const cands = new Map();
  for (const i of segs) {
    const seenHere = new Set();
    for (const p of phrases(prepared[i].target, maxN)) {
      const key = keyOf(p);
      let c = cands.get(key);
      if (!c) { c = { key, n: p.length, both: 0, surfaces: new Map() }; cands.set(key, c); }
      const surface = p.join(' ');
      c.surfaces.set(surface, (c.surfaces.get(surface) || 0) + 1);
      if (!seenHere.has(key)) { c.both += 1; seenHere.add(key); }
    }
  }
  return { segs, cands };
});

// ---- pass 2: how many targets in all the files contain each candidate
const wanted = new Set();
for (const u of perUnit) for (const k of u.cands.keys()) wanted.add(k);
const df = new Map();
for (const p of prepared) {
  const seenHere = new Set();
  for (const ph of phrases(p.target, 4)) {
    const key = keyOf(ph);
    if (wanted.has(key) && !seenHere.has(key)) { df.set(key, (df.get(key) || 0) + 1); seenHere.add(key); }
  }
}

const ranked = (u) => {
  const { segs, cands } = perUnit[u];
  const n = segs.length;
  return [...cands.values()]
    .filter((c) => c.both >= Math.min(2, n))
    .map((c) => ({ ...c, dice: (2 * c.both) / (n + (df.get(c.key) || c.both)) }))
    .sort((a, b) => (b.dice - a.dice) || (b.n - a.n) || (b.both - a.both));
};

// Word-level translations: the top few target stems for each source word.
const wordStems = new Map();
singles.forEach((w, i) => {
  wordStems.set(w, new Set(ranked(terms.length + i).filter((c) => c.dice >= 0.25).slice(0, 3).map((c) => c.key)));
});

// 1 when every word of the suggestion translates a word of the term (or is
// the same word, e.g. "bonus") and every word of the term is covered.
const composition = (words, c) => {
  const known = words.filter((w) => wordStems.get(w) && wordStems.get(w).size);
  if (known.length < 2) return null;
  const stems = c.key.split(' ');
  const same = new Set(words.map(stem));
  const explained = stems.filter((s) => same.has(s) || known.some((w) => wordStems.get(w).has(s))).length / stems.length;
  const covered = known.filter((w) => stems.some((s) => wordStems.get(w).has(s) || s === stem(w))).length / known.length;
  return (explained + covered) / 2;
};

const isAllCaps = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const display = (c, sourceTerm) => {
  const forms = [...c.surfaces.entries()].sort((a, b) => b[1] - a[1]);
  const mixed = forms.find(([s]) => !isAllCaps(s));
  if (mixed) return mixed[0];
  return isAllCaps(sourceTerm) ? forms[0][0] : forms[0][0].toLowerCase();
};

const byConfidence = {};
const out = terms.map((t, ti) => {
  const words = termWords[ti];
  const segs = perUnit[ti].segs;
  const n = segs.length;
  let scored = n ? ranked(ti) : [];
  if (!scored.length) {
    byConfidence.none = (byConfidence.none || 0) + 1;
    return { ...t, ...blank, code_segments: n };
  }
  scored = scored.map((c) => {
    const comp = words.length > 1 ? composition(words, c) : null;
    return { ...c, comp, score: comp === null ? c.dice : c.dice * (0.4 + 0.6 * comp) };
  }).sort((a, b) => (b.score - a.score) || (b.n - a.n) || (b.both - a.both));

  // Prefer a longer phrase that scores almost as well ("besplatna okretanja"
  // over "okretanja"), but never longer than the term needs.
  let best = scored[0];
  for (const c of scored) {
    if (words.length > 1 && c.n > best.n && c.n <= words.length + 1 && c.score >= best.score * 0.9 && c.key.includes(best.key)) best = c;
  }
  const coverage = best.both / n;
  const confidence =
    best.both >= 3 && best.dice >= 0.6 && coverage >= 0.7 && (best.comp === null || best.comp >= 0.75) ? 'high'
      : best.both >= 2 && best.dice >= 0.4 && coverage >= 0.5 && (best.comp === null || best.comp >= 0.5) ? 'medium' : 'low';
  byConfidence[confidence] = (byConfidence[confidence] || 0) + 1;

  // Other translations used for the term: no word in common with the best.
  const bestStems = new Set(best.key.split(' '));
  const alternatives = scored
    .filter((c) => c !== best && c.both >= 2 && c.both / n >= 0.15 && (c.comp === null || c.comp >= 0.5) && !c.key.split(' ').some((w) => bestStems.has(w)))
    .slice(0, 2)
    .map((c) => `${display(c, t.term)} (${c.both})`);

  // Example pairs for the AI review: ones that contain the suggestion.
  const tmPairs = [];
  for (const i of segs) {
    if (phrases(prepared[i].target, best.n).some((p) => keyOf(p) === best.key)) {
      tmPairs.push({ source: prepared[i].source, target: prepared[i].target });
      if (tmPairs.length === 2) break;
    }
  }

  return {
    ...t,
    code_suggestion: display(best, t.term),
    code_confidence: confidence,
    code_found_in: best.both,
    code_segments: n,
    code_alternatives: alternatives,
    tm_pairs: tmPairs,
  };
});

log.by_confidence = byConfidence;
return [{ json: { ...input, terms: out, log: { ...input.log, translations: log } } }];
