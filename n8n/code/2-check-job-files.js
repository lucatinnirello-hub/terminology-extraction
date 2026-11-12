// n8n Code node: "Check job files"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// "List job files" always outputs at least one item, so an empty folder
// reaches here and fails with a clear message instead of stopping silently.
//
// The input may be a folder the user chose, holding PDFs, Word files or
// Google Docs. Only supported files are downloaded; the rest are listed in
// the run manifest as skipped.
//
// Wildcards-only jobs need exactly one glossary (.xlsx or .csv); TMX and
// XLIFF files alongside it are optional (used to spot false hits).
const MEMORIES = ['tmx', 'xml', 'xlf', 'xliff', 'mqxliff', 'mqxlz'];
const GLOSSARIES = ['xlsx', 'csv'];
const wildcardsOnly = $('Settings').first().json.mode === 'wildcards';
const SUPPORTED = wildcardsOnly ? [...GLOSSARIES, ...MEMORIES] : [...MEMORIES, 'txt', 'md'];

const all = $input.all().map((i) => i.json).filter((f) => f && f.id);
const ext = (f) => String(f.name || '').split('.').pop().toLowerCase();
const isSupported = (f) => SUPPORTED.includes(ext(f)) && !String(f.mimeType || '').startsWith('application/vnd.google-apps');
const keep = all.filter(isSupported);

if (wildcardsOnly) {
  const glossaries = keep.filter((f) => GLOSSARIES.includes(ext(f)));
  const sheets = all.filter((f) => f.mimeType === 'application/vnd.google-apps.spreadsheet');
  if (glossaries.length !== 1) {
    throw new Error(glossaries.length
      ? `Found ${glossaries.length} glossaries (${glossaries.map((f) => f.name).join(', ')}): a wildcards job takes exactly one .xlsx or .csv file.`
      : `No glossary found: a wildcards job needs one .xlsx or .csv file.${sheets.length ? ' Google Sheets must be downloaded as .xlsx first.' : ''}`);
  }
} else if (!keep.length) {
  throw new Error(
    all.length
      ? `None of the ${all.length} files in the input folder can be used (needs TMX, XLIFF, memoQ .mqxliff/.mqxlz, or .txt/.md).`
      : "No files found in the job's input folder. Check the source folder and submit again."
  );
}
return keep.map((f) => ({ json: { id: f.id, name: f.name, skipped_in_folder: all.length - keep.length } }));
