// n8n Code node: "Glossary terms"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// WILDCARDS-ONLY JOBS: reads the glossary and lists its target terms.
//
// The target column is the one named on the page, or else the first column
// whose header matches the target language ("Serbian (Latin)", "Serbian",
// "sr", "sr-Latn"...) or reads "translation" / "target". The source term,
// sent to the AI as context, is the first other column.
//
// A cell can hold several terms separated by ";" (synonyms): each one gets
// its own wildcards. Wildcards already in a cell are removed and worked out
// again; the note says so.
//
// TMX/XLIFF files in the job are only used for their target-language words:
// they show which other words a wildcard would also catch.
// ===========================================================================

const MAX_ROWS = 5000;

const settings = $('Settings').first().json;
const docs = $input.all().map((i) => i.json);
const glossary = docs.find((d) => d.source_type === 'glossary');
if (!glossary) throw new Error('No readable glossary in the job (needs one .xlsx or .csv file).');
if (glossary.rows.length > MAX_ROWS) throw new Error(`The glossary has ${glossary.rows.length} rows; the limit is ${MAX_ROWS}. Split it and run it in parts.`);

// ---- target column
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const columns = glossary.columns;
let target;
if (settings.target_column) {
  target = columns.find((c) => norm(c) === norm(settings.target_column));
  if (!target) throw new Error(`No column "${settings.target_column}" in ${glossary.file_name}. Its columns: ${columns.join(', ')}.`);
} else {
  const label = norm(settings.target_label);
  const wanted = [
    label, label.split(' ')[0], settings.target_lang,
    ...String(settings.target_tmx || '').split(','),
    'translation', 'target', 'target term',
  ].map(norm).filter(Boolean);
  for (const w of wanted) {
    target = columns.find((c) => norm(c) === w) || columns.find((c) => norm(c).split(' ')[0] === w);
    if (target) break;
  }
  if (!target) {
    throw new Error(`Couldn't tell which column holds the ${settings.target_label} terms in ${glossary.file_name}. `
      + `Type its header in "Target term column" on the page. Its columns: ${columns.join(', ')}.`);
  }
}
const sourceColumn = columns.find((c) => c !== target && glossary.rows.some((r) => String(r[c] || '').trim()));

// ---- one item per target term (synonyms split)
const items = [];
glossary.rows.forEach((row, r) => {
  String(row[target] || '').split(';').map((t) => t.trim()).filter(Boolean).forEach((term, k) => {
    const clean = term.replace(/[|*]/g, '');
    items.push({
      id: `${r}:${k}`,
      source_term: sourceColumn ? String(row[sourceColumn] || '').trim() : '',
      base: clean,
      had_wildcards: clean !== term ? term : '',
      tm_forms: [],
    });
  });
});
if (!items.length) throw new Error(`The "${target}" column of ${glossary.file_name} is empty.`);

// ---- target-language words in the job's memories (for false hits)
const ISO3 = { en: ['eng'], it: ['ita'], fr: ['fre', 'fra'], de: ['ger', 'deu'], es: ['spa'], pt: ['por'], nl: ['dut', 'nld'],
  da: ['dan'], sv: ['swe'], nb: ['nob', 'nor'], no: ['nor', 'nob'], fi: ['fin'], pl: ['pol'], cs: ['cze', 'ces'], sk: ['slo', 'slk'],
  sl: ['slv'], hr: ['hrv'], ro: ['rum', 'ron'], hu: ['hun'], et: ['est'], lv: ['lav'], lt: ['lit'], tr: ['tur'], id: ['ind'],
  sr: ['srp'], sh: ['hbs'], ru: ['rus'], uk: ['ukr'], bg: ['bul'], el: ['gre', 'ell'] };
const langMatches = (lang, wanted) => {
  const l = String(lang || '').toLowerCase().replace(/_/g, '-');
  return String(wanted || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean)
    .some((w) => [w].concat(ISO3[w] || []).some((code) => l === code || l.startsWith(code + '-')));
};
const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const vocab = new Map();
const addWords = (text) => {
  for (const w of plain(text).toLowerCase().match(/[\p{L}\p{M}][\p{L}\p{M}'’\-]*/gu) || []) vocab.set(w, (vocab.get(w) || 0) + 1);
};
for (const d of docs) {
  if (d.source_type === 'tmx') {
    for (const m of d.content.matchAll(/<tuv\b([^>]*)>[\s\S]*?<seg\b[^>]*>([\s\S]*?)<\/seg>/gi)) {
      if (langMatches((m[1].match(/(?:xml:)?lang\s*=\s*["']([^"']+)["']/i) || [, ''])[1], settings.target_tmx)) addWords(m[2]);
    }
  } else if (d.source_type === 'xliff') {
    const declared = (d.content.match(/(?:target-language|trgLang)\s*=\s*["']([^"']+)["']/i) || [, ''])[1];
    if (declared && !langMatches(declared, settings.target_tmx)) continue;
    for (const m of d.content.matchAll(/<target\b[^>]*>([\s\S]*?)<\/target>/gi)) addWords(m[1]);
  }
}

return [{
  json: {
    file_name: glossary.file_name,
    columns,
    target_column: target,
    source_column: sourceColumn || '',
    rows: glossary.rows,
    items,
    vocabulary: [...vocab.entries()],
    memories_used: docs.filter((d) => d.source_type === 'tmx' || d.source_type === 'xliff').map((d) => d.file_name),
  },
}];
