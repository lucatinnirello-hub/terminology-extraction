// n8n Code node: "Check job files"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// "List job files" always outputs at least one item, so an empty folder
// reaches here and fails with a clear message instead of stopping silently.
//
// The input may be a folder the user chose, holding PDFs, Word files or
// Google Docs. Only supported files are downloaded; the rest are listed in
// the run manifest as skipped.
const SUPPORTED = ['tmx', 'xml', 'txt', 'md', 'xlf', 'xliff', 'mqxliff', 'mqxlz'];

const all = $input.all().map((i) => i.json).filter((f) => f && f.id);
const isSupported = (f) => {
  const ext = String(f.name || '').split('.').pop().toLowerCase();
  return SUPPORTED.includes(ext) && !String(f.mimeType || '').startsWith('application/vnd.google-apps');
};
const keep = all.filter(isSupported);

if (!keep.length) {
  throw new Error(
    all.length
      ? `None of the ${all.length} files in the input folder can be used (needs TMX, XLIFF, memoQ .mqxliff/.mqxlz, or .txt/.md).`
      : "No files found in the job's input folder. Check the source folder and submit again."
  );
}
return keep.map((f) => ({ json: { id: f.id, name: f.name, skipped_in_folder: all.length - keep.length } }));
