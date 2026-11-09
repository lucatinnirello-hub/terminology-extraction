// n8n Code node: "Stage 1 statistical extraction"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Stage 1 extraction logic, written to be testable outside n8n.
// No dependencies.

// Stopwords are supplied at runtime (see the "Stopword lists" node), so the
// list can be the official YAKE one for the chosen language rather than
// anything hand-written here.
let ACTIVE_STOPWORDS = new Set();
let ACTIVE_CONNECTORS = new Set();

// Abbreviations that must not end a sentence.
const ABBREV = new Set(['fig', 'figs', 'no', 'nos', 'approx', 'etc', 'eg', 'ie', 'vs', 'cf', 'al',
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'vol', 'ch', 'sec', 'para', 'ref', 'max', 'min',
  'temp', 'dia', 'qty', 'incl', 'excl', 'ext', 'int', 'avg', 'std', 'mm', 'cm', 'kg', 'hr', 'rev']);

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// --- language codes -----------------------------------------------------
// TMX and XLIFF files may name the source language as 'en', 'en-US', 'EN_GB'
// or, from some memoQ exports, the three-letter 'eng'. `sourceLang` is a
// comma-separated list of two-letter prefixes (e.g. 'nb,no,nn').
const ISO3 = {
  en: ['eng'], it: ['ita'], fr: ['fre', 'fra'], de: ['ger', 'deu'], es: ['spa'], pt: ['por'], nl: ['dut', 'nld'],
  da: ['dan'], sv: ['swe'], nb: ['nob', 'nor'], no: ['nor', 'nob'], nn: ['nno', 'nor'], fi: ['fin'], pl: ['pol'],
  cs: ['cze', 'ces'], sk: ['slo', 'slk'], sl: ['slv'], hr: ['hrv'], ro: ['rum', 'ron'], hu: ['hun'], et: ['est'],
  lv: ['lav'], lt: ['lit'], tr: ['tur'], id: ['ind'],
};
function langMatches(lang, sourceLang) {
  const l = String(lang || '').toLowerCase().replace(/_/g, '-');
  const wants = String(sourceLang || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
  return wants.some((w) => [w].concat(ISO3[w] || []).some((code) => l === code || l.startsWith(code + '-')));
}

// --- inline markup ----------------------------------------------------------
// Codes (<bpt>, <ept>, <ph>, <it>) hold formatting such as {} or <b>, not
// text, so they go with their content. Wrappers (<g>, <mrk>, <pc>) keep
// their text. Anything else (<x/>, <sc/>, <ec/>...) becomes a space.
function cleanInline(s) {
  return decodeEntities(
    s.replace(/<(bpt|ept|ph|it)\b[^>]*\/>/gi, ' ')
      .replace(/<(bpt|ept|ph|it)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(g|mrk|pc)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

// --- XLIFF ----------------------------------------------------------------
// memoQ (.mqxliff) and other XLIFF 1.2 files, and XLIFF 2.x. Reads only the
// source text: targets, TM matches (<alt-trans>) and memoQ's own extra
// elements are ignored, as are units marked translate="no".
// Returns { segments, lang } where lang is the file's declared source language.
function parseXliff(xml) {
  const segments = [];
  const attr = (tag, name) => (tag.match(new RegExp('\\s' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [, ''])[1];
  const add = (inner) => { const t = cleanInline(inner); if (t) segments.push(t); };
  const rootTag = (xml.match(/<xliff\b[^>]*>/i) || [''])[0];
  const v2 = /^2/.test(attr(rootTag, 'version'));
  let lang;
  if (v2) {
    lang = attr(rootTag, 'srcLang');
    const unitRe = /<unit\b([^>]*)>([\s\S]*?)<\/unit>/gi;
    let u;
    while ((u = unitRe.exec(xml)) !== null) {
      if (/\stranslate\s*=\s*["']no["']/i.test(u[1])) continue;
      const segRe = /<segment\b[^>]*>([\s\S]*?)<\/segment>/gi;
      let s;
      while ((s = segRe.exec(u[2])) !== null) {
        const src = s[1].match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
        if (src) add(src[1]);
      }
    }
  } else {
    lang = attr((xml.match(/<file\b[^>]*>/i) || [''])[0], 'source-language');
    const tuRe = /<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/gi;
    let tu;
    while ((tu = tuRe.exec(xml)) !== null) {
      if (/\stranslate\s*=\s*["']no["']/i.test(tu[1])) continue;
      const body = tu[2].replace(/<alt-trans\b[\s\S]*?<\/alt-trans>/gi, '');
      // Some tools also store the source split into segments: use those.
      const segSource = body.match(/<seg-source\b[^>]*>([\s\S]*?)<\/seg-source>/i);
      if (segSource) {
        const mrkRe = /<mrk\b[^>]*mtype\s*=\s*["']seg["'][^>]*>([\s\S]*?)<\/mrk>/gi;
        let m;
        let any = false;
        while ((m = mrkRe.exec(segSource[1])) !== null) { add(m[1]); any = true; }
        if (any) continue;
      }
      const src = body.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
      if (src) add(src[1]);
    }
  }
  return { segments, lang: String(lang || '').toLowerCase() };
}

// --- TMX ------------------------------------------------------------------
// Pulls the source-language segment out of each translation unit.
function parseTmx(xml, sourceLang) {
  const segments = [];
  const tuRe = /<tu\b[^>]*>([\s\S]*?)<\/tu>/gi;
  const tuvRe = /<tuv\b([^>]*)>([\s\S]*?)<\/tuv>/gi;
  const segRe = /<seg\b[^>]*>([\s\S]*?)<\/seg>/i;
  const langRe = /(?:xml:)?lang\s*=\s*["']([^"']+)["']/i;

  let tu;
  while ((tu = tuRe.exec(xml)) !== null) {
    tuvRe.lastIndex = 0;
    let tuv;
    while ((tuv = tuvRe.exec(tu[1])) !== null) {
      const lang = (tuv[1].match(langRe) || [, ''])[1].toLowerCase();
      if (!langMatches(lang, sourceLang)) continue;
      const seg = tuv[2].match(segRe);
      if (!seg) continue;
      const text = cleanInline(seg[1]);
      if (text) segments.push(text);
      break;
    }
  }
  return segments;
}

// --- sentence splitting ---------------------------------------------------
function splitSentences(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const out = [];
  let buf = '';
  const parts = cleaned.split(/([.!?]+)(\s+)/);
  for (let i = 0; i < parts.length; i += 3) {
    const chunk = parts[i] || '';
    const punct = parts[i + 1] || '';
    const space = parts[i + 2] || '';
    buf += chunk + punct;
    const lastWord = (chunk.match(/([A-Za-z]+)$/) || [, ''])[1].toLowerCase();
    const isAbbrev = ABBREV.has(lastWord);
    const isInitial = /\b[A-Z]$/.test(chunk);
    const isDecimal = /\d$/.test(chunk) && /^\s*\d/.test(parts[i + 3] || '');
    if (punct && !isAbbrev && !isInitial && !isDecimal) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += space;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

// --- tokenising -----------------------------------------------------------
function tokenise(sentence) {
  const raw = sentence.match(/[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'’\-]*|\d+(?:[.,]\d+)?/g) || [];
  return raw.map((t) => t.replace(/^['’\-]+|['’\-]+$/g, '')).filter(Boolean);
}

function isStop(token) {
  const t = token.toLowerCase();
  return ACTIVE_STOPWORDS.has(t) || ABBREV.has(t) || /^\d/.test(t) || t.length < 2;
}

// --- YAKE word-level features --------------------------------------------
function wordFeatures(sentences, tokensBySentence) {
  const stats = new Map();
  const totalSentences = sentences.length;

  tokensBySentence.forEach((tokens, sIdx) => {
    tokens.forEach((tok, pos) => {
      const key = tok.toLowerCase();
      let s = stats.get(key);
      if (!s) {
        s = { tf: 0, upper: 0, acronym: 0, sentences: new Set(), offsets: [], left: new Map(), right: new Map() };
        stats.set(key, s);
      }
      s.tf += 1;
      s.sentences.add(sIdx);
      s.offsets.push(sIdx);
      if (/^[A-Z][a-z]/.test(tok) && pos > 0) s.upper += 1;
      if (/^[A-Z]{2,}$/.test(tok)) s.acronym += 1;
      const prev = tokens[pos - 1];
      const next = tokens[pos + 1];
      if (prev && !isStop(prev)) s.left.set(prev.toLowerCase(), (s.left.get(prev.toLowerCase()) || 0) + 1);
      if (next && !isStop(next)) s.right.set(next.toLowerCase(), (s.right.get(next.toLowerCase()) || 0) + 1);
    });
  });

  const contentTf = [...stats.entries()].filter(([k]) => !isStop(k)).map(([, v]) => v.tf);
  const meanTf = contentTf.length ? contentTf.reduce((a, b) => a + b, 0) / contentTf.length : 1;
  const sd = contentTf.length
    ? Math.sqrt(contentTf.reduce((a, b) => a + (b - meanTf) ** 2, 0) / contentTf.length)
    : 0;
  const maxTf = contentTf.length ? Math.max(...contentTf) : 1;

  const scores = new Map();
  for (const [key, s] of stats) {
    // Casing: capitalised or acronym usage signals importance.
    const casing = Math.max(s.upper, s.acronym) / (1 + Math.log(1 + s.tf));

    // Position: terms appearing early are weighted higher.
    const sorted = [...s.offsets].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const position = Math.log(Math.log(3 + median));

    // Frequency, normalised against the spread of the whole corpus.
    const frequency = s.tf / (meanTf + sd || 1);

    // Relatedness: a word with many different neighbours behaves like a
    // stopword. Few, consistent neighbours suggest a real term.
    const leftTotal = [...s.left.values()].reduce((a, b) => a + b, 0);
    const rightTotal = [...s.right.values()].reduce((a, b) => a + b, 0);
    const dl = leftTotal ? s.left.size / leftTotal : 0;
    const dr = rightTotal ? s.right.size / rightTotal : 0;
    const relatedness = 1 + (dl + dr) * (s.tf / maxTf);

    // Dispersion: spread across many sentences beats clustering in one.
    const different = s.sentences.size / (totalSentences || 1);

    const score =
      (relatedness * position) /
      (casing + frequency / relatedness + different / relatedness || 1e-9);

    scores.set(key, { score, tf: s.tf, sentences: s.sentences.size });
  }
  return scores;
}

// --- candidate phrases ----------------------------------------------------
// Phrases are the runs of content words between stopwords and punctuation.
function candidatesFrom(tokens, ngramMax) {
  // Connectors are stopwords that may sit INSIDE a term but never at its edge.
  // Needed for Romance and other languages where multi-word terms are built
  // with prepositions: "valvola di sicurezza", "messa in servizio",
  // "chiffre d'affaires". Without this the boundary rule splits them apart.
  const runs = [];
  let current = [];
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    if (ACTIVE_CONNECTORS.has(t)) {
      // Only continues a run that has already started.
      if (current.length) current.push(tok);
      continue;
    }
    if (isStop(tok)) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length) runs.push(current);

  const isConnector = (tok) => ACTIVE_CONNECTORS.has(tok.toLowerCase());

  const out = [];
  for (const run of runs) {
    for (let n = 1; n <= Math.min(ngramMax, run.length); n += 1) {
      for (let i = 0; i + n <= run.length; i += 1) {
        const phrase = run.slice(i, i + n);
        // A term cannot begin or end with a connector.
        if (isConnector(phrase[0]) || isConnector(phrase[phrase.length - 1])) continue;
        // Two connectors in a row is a clause, not a term.
        let consecutive = 0;
        let bad = false;
        for (const tok of phrase) {
          consecutive = isConnector(tok) ? consecutive + 1 : 0;
          if (consecutive > 1) { bad = true; break; }
        }
        if (bad) continue;
        out.push(phrase);
      }
    }
  }
  return out;
}

// --- similarity for dedup -------------------------------------------------
function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  if (Math.abs(m - n) / Math.max(m, n) > 0.5) return 0;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// --- main -----------------------------------------------------------------
function extract(documents, opts = {}) {
  const {
    ngramMax = 4,
    minChars = 15,
    dedupeThreshold = 0.85,
    minSegments = 1,
    topN = 500,
    includeExamples = 3,
    dedupeSegments = true,
    independenceRatio = 1.25,
    stopwords = [],
    extraStopwords = [],
    connectors = [],
  } = opts;

  ACTIVE_STOPWORDS = new Set([...stopwords, ...extraStopwords].map((w) => String(w).toLowerCase()));
  ACTIVE_CONNECTORS = new Set(connectors.map((w) => String(w).toLowerCase()));
  if (ACTIVE_STOPWORDS.size < 20) {
    throw new Error(
      `Only ${ACTIVE_STOPWORDS.size} stopwords supplied. Check the "Stopword lists" node has an entry for this language.`
    );
  }

  const log = { stopwords_used: ACTIVE_STOPWORDS.size, connectors_used: ACTIVE_CONNECTORS.size, files_seen: documents.length, files_parsed: 0, skipped: [], by_source_type: {} };
  const skip = (reason) => {
    const row = log.skipped.find((r) => r.reason === reason);
    if (row) row.count += 1;
    else log.skipped.push({ reason, count: 1 });
  };

  // ---- normalise into segments
  const segments = [];
  const seen = new Set();
  for (const doc of documents) {
    let raw = [];
    try {
      if (doc.source_type === 'tmx') {
        raw = parseTmx(doc.content, doc.source_lang || 'en');
        if (!raw.length) { skip('tmx_no_source_language_segments'); continue; }
      } else if (doc.source_type === 'xliff') {
        const x = parseXliff(doc.content);
        // A file in another source language would only add noise: skip it and say why.
        if (x.lang && !langMatches(x.lang, doc.source_lang || 'en')) { skip(`xliff_source_language_is_${x.lang}`); continue; }
        raw = x.segments;
        if (!raw.length) { skip('xliff_no_source_segments'); continue; }
      } else {
        raw = splitSentences(doc.content);
        if (!raw.length) { skip('no_extractable_text'); continue; }
      }
    } catch (e) {
      skip(`parse_error:${doc.source_type}`);
      continue;
    }
    log.files_parsed += 1;
    log.by_source_type[doc.source_type] = (log.by_source_type[doc.source_type] || 0) + 1;

    for (const text of raw) {
      if (text.length < minChars) { skip('below_min_chars'); continue; }
      const key = text.toLowerCase();
      if (dedupeSegments && seen.has(key)) { skip('duplicate_segment'); continue; }
      seen.add(key);
      segments.push({ text, source: doc.name, source_type: doc.source_type });
    }
  }

  log.segments_total = segments.length;
  if (!segments.length) return { terms: [], rows: [], log };

  // ---- sentence-level tokens, for the word scores
  const sentences = segments.map((s) => s.text);
  const tokensBySentence = sentences.map(tokenise);
  const wordScores = wordFeatures(sentences, tokensBySentence);

  // ---- candidate accumulation
  const cands = new Map();
  tokensBySentence.forEach((tokens, sIdx) => {
    const seg = segments[sIdx];
    for (const phrase of candidatesFrom(tokens, ngramMax)) {
      const surface = phrase.join(' ');
      const key = surface.toLowerCase();
      let c = cands.get(key);
      if (!c) {
        c = {
          term: surface,
          words: phrase.map((w) => w.toLowerCase()),
          n: phrase.length,
          occurrences: 0,
          segments: new Set(),
          sourceTypes: new Set(),
          sources: new Set(),
          examples: [],
          surfaces: new Map(),
        };
        cands.set(key, c);
      }
      c.occurrences += 1;
      c.segments.add(sIdx);
      c.sourceTypes.add(seg.source_type);
      c.sources.add(seg.source);
      c.surfaces.set(surface, (c.surfaces.get(surface) || 0) + 1);
      if (c.examples.length < includeExamples && !c.examples.includes(seg.text)) {
        c.examples.push(seg.text);
      }
    }
  });

  log.candidates_before_filter = cands.size;

  // ---- score each candidate (YAKE phrase formula; lower is better)
  const scored = [];
  for (const c of cands.values()) {
    if (c.segments.size < minSegments) continue;
    let product = 1;
    let sum = 0;
    let missing = false;
    for (const w of c.words) {
      const ws = wordScores.get(w);
      if (!ws) { missing = true; break; }
      product *= ws.score;
      sum += ws.score;
    }
    if (missing) continue;
    const yake = product / (c.occurrences * (1 + sum));
    // Most frequent surface form becomes the display term.
    const best = [...c.surfaces.entries()].sort((a, b) => b[1] - a[1])[0][0];
    scored.push({
      term: best,
      words: c.words,
      n: c.n,
      yake_score: yake,
      occurrences: c.occurrences,
      segments: c.segments.size,
      source_types: [...c.sourceTypes].sort(),
      sources: [...c.sources].sort(),
      examples: c.examples,
      merged_variants: [],
    });
  }

  log.dropped_below_min_segments = log.candidates_before_filter - scored.length;
  scored.sort((a, b) => a.yake_score - b.yake_score);

  // ---- collapse near-duplicates into the better-scoring candidate
  const kept = [];
  let merges = 0;
  for (const cand of scored) {
    const host = kept.find((k) => {
      if (k.n !== cand.n) return false;
      return similarity(k.term.toLowerCase(), cand.term.toLowerCase()) >= dedupeThreshold;
    });
    if (host) {
      host.occurrences += cand.occurrences;
      host.segments += cand.segments;
      host.source_types = [...new Set([...host.source_types, ...cand.source_types])].sort();
      host.merged_variants.push(cand.term);
      for (const ex of cand.examples) {
        if (host.examples.length < includeExamples && !host.examples.includes(ex)) host.examples.push(ex);
      }
      merges += 1;
    } else {
      kept.push(cand);
    }
  }

  log.merges = merges;
  log.candidates_after_dedupe = kept.length;

  // ---- suppress sub-phrases that add nothing
  // "relief valve" inside "pressure relief valve" is only worth keeping if it
  // also occurs independently. If nearly all its occurrences come from the
  // longer term, it is noise.
  const survivors = [];
  let suppressed = 0;
  for (const cand of kept) {
    const parent = survivors.find((s) => {
      if (s.n <= cand.n) return false;
      const hay = ` ${s.words.join(' ')} `;
      const needle = ` ${cand.words.join(' ')} `;
      if (!hay.includes(needle)) return false;
      // Independent use allowed for: occurrences beyond the parent's count.
      return cand.occurrences <= s.occurrences * independenceRatio;
    });
    if (parent) {
      parent.merged_variants.push(`(sub) ${cand.term}`);
      suppressed += 1;
    } else {
      survivors.push(cand);
    }
  }

  log.suppressed_subphrases = suppressed;
  log.candidates_final = survivors.length;
  kept.length = 0;
  kept.push(...survivors);

  const terms = kept.slice(0, topN).map((t, i) => ({
    rank: i + 1,
    term: t.term,
    word_count: t.n,
    yake_score: Number(t.yake_score.toPrecision(4)),
    occurrences: t.occurrences,
    segments: t.segments,
    source_types: t.source_types,
    sources: t.sources,
    merged_variants: t.merged_variants,
    examples: t.examples,
    lemma: null,
    pos_filtered: null,
    definition: null,
    translation: null,
  }));

  log.terms_returned = terms.length;

  const rows = terms.map((t) => ({
    rank: t.rank,
    term: t.term,
    word_count: t.word_count,
    yake_score: t.yake_score,
    occurrences: t.occurrences,
    segments: t.segments,
    source_types: t.source_types.join(' | '),
    merged_variants: t.merged_variants.join(' | '),
    examples: t.examples.join(' | '),
    definition: '',
    translation: '',
  }));

  return { terms, rows, log };
}

// ===========================================================================
// n8n glue. Run mode must be "Run Once for All Items".
// ===========================================================================

const settings = $('Settings').first().json;
const sw = $('Stopword lists').first().json;

const documents = $input.all().map((item) => ({
  name: item.json.file_name || 'unknown',
  source_type: item.json.source_type || 'text',
  source_lang: settings.tmx_lang || settings.source_lang,
  content: item.json.content || '',
}));

const result = extract(documents, {
  ngramMax: settings.ngram_max,
  minChars: settings.min_chars,
  dedupeThreshold: settings.dedupe_threshold,
  minSegments: settings.min_segments,
  topN: settings.top_n,
  includeExamples: settings.include_examples,
  dedupeSegments: settings.dedupe_segments,
  independenceRatio: settings.independence_ratio,
  stopwords: sw.stopwords,
  extraStopwords: sw.extra_stopwords,
  connectors: sw.connectors,
});

return [
  {
    json: {
      stage: 'stage_1_statistical',
      settings_used: settings,
      language: sw.language,
      stopwords: sw.counts,
      log: result.log,
      terms: result.terms,
      rows: result.rows,
    },
  },
];
