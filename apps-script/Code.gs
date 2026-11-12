/**
 * Terminology extraction: web interface.
 *
 * Runs as the person using it, so Google Drive's own permissions decide which
 * folders they can use. Submitting sends one HTTP request to an n8n webhook
 * (through Cloudflare). n8n checks it can use the folders, replies
 * "accepted" straight away, runs the job, and records the outcome in the log
 * sheet, which this page reads to show progress and result links.
 *
 * The reply can't wait for the finished glossary: Cloudflare drops requests
 * that take longer than about 100 seconds, and a job with AI review takes
 * several minutes.
 *
 * Script Properties (Project Settings → Script Properties), set once by
 * whoever manages the app:
 *   N8N_WEBHOOK_URL          production URL of the n8n Webhook node
 *   N8N_WEBHOOK_KEY          value for the X-Terminology-Key header (n8n Header Auth)
 *   CF_ACCESS_CLIENT_ID      Cloudflare Access service token ID
 *   CF_ACCESS_CLIENT_SECRET  Cloudflare Access service token secret
 *   N8N_EXTRA_HEADERS        optional JSON object of any other headers to send
 *   WORK_FOLDER_ID, LOG_SHEET_ID   written by setup()
 *
 * People who only use the page can't read these: they can run the web app,
 * not open the project.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_TITLE = 'Terminology extraction';
const LOG_SHEET_NAME = 'Jobs';

// Columns of the log sheet. n8n writes every row; matched by header name.
const HEADERS = [
  'job_id', 'status', 'submitted_at', 'submitted_by', 'client', 'source_lang',
  'file_names', 'settings_json', 'job_folder_id', 'input_folder_id', 'output_folder_id',
  'execution_id', 'started_at', 'finished_at', 'terms_returned',
  'glossary_url', 'stage1_url', 'manifest_url', 'message',
];

const MAX_FILE_MB = 25;              // per uploaded file; google.script.run payload limit
const MAX_FILES_PER_JOB = 20;
const MAX_FOLDER_SCAN = 500;         // files listed per source folder
// TMX, XLIFF (incl. memoQ .mqxliff and compressed .mqxlz exports) and plain text.
const ALLOWED_EXTENSIONS = ['tmx', 'xml', 'xlf', 'xliff', 'mqxliff', 'mqxlz', 'txt', 'md'];
const STALE_MINUTES = 45;            // 'running' for longer than this probably stopped
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Languages offered in the form. `code` must be a key in the n8n "Stopword
// lists" node; `tmx` is what the language is called inside TMX files
// (comma-separated prefixes; the extraction accepts any). Only Latin-script
// languages are listed because the stage 1 tokeniser only reads Latin script.
const LANGUAGES = [
  { code: 'en', tmx: 'en', label: 'English' },
  { code: 'it', tmx: 'it', label: 'Italian' },
  { code: 'fr', tmx: 'fr', label: 'French' },
  { code: 'de', tmx: 'de', label: 'German' },
  { code: 'es', tmx: 'es', label: 'Spanish' },
  { code: 'pt', tmx: 'pt', label: 'Portuguese (European)' },
  { code: 'br', tmx: 'pt', label: 'Portuguese (Brazilian)' },
  { code: 'nl', tmx: 'nl', label: 'Dutch' },
  { code: 'da', tmx: 'da', label: 'Danish' },
  { code: 'sv', tmx: 'sv', label: 'Swedish' },
  { code: 'no', tmx: 'nb,no,nn', label: 'Norwegian' },
  { code: 'fi', tmx: 'fi', label: 'Finnish' },
  { code: 'pl', tmx: 'pl', label: 'Polish' },
  { code: 'cz', tmx: 'cs', label: 'Czech' },
  { code: 'sk', tmx: 'sk', label: 'Slovak' },
  { code: 'sl', tmx: 'sl', label: 'Slovenian' },
  { code: 'hr', tmx: 'hr', label: 'Croatian' },
  { code: 'ro', tmx: 'ro', label: 'Romanian' },
  { code: 'hu', tmx: 'hu', label: 'Hungarian' },
  { code: 'et', tmx: 'et', label: 'Estonian' },
  { code: 'lv', tmx: 'lv', label: 'Latvian' },
  { code: 'lt', tmx: 'lt', label: 'Lithuanian' },
  { code: 'tr', tmx: 'tr', label: 'Turkish' },
  { code: 'id', tmx: 'id', label: 'Indonesian' },
];

// Target languages for translation suggestions. `code` must be a stopword
// list in n8n's "Stopword lists" node (or borrow one there: Serbian uses
// Croatian); `tmx` is what the language is called inside TMX/XLIFF files.
// Unlike source languages, non-Latin scripts work here: the translation
// matching reads any alphabet with spaces between words.
const TARGET_LANGUAGES = LANGUAGES.concat([
  { code: 'sr', tmx: 'sr,sh', label: 'Serbian (Latin)' },
  { code: 'bg', tmx: 'bg', label: 'Bulgarian' },
  { code: 'el', tmx: 'el', label: 'Greek' },
  { code: 'ru', tmx: 'ru', label: 'Russian' },
  { code: 'uk', tmx: 'uk', label: 'Ukrainian' },
]).sort(function (a, b) { return a.label.localeCompare(b.label); });

// Tuning settings: defaults match n8n; min/max are enforced here and in n8n.
// `help` is shown in the question-mark tooltip next to each setting.
const TUNING = {
  ngram_max: {
    def: 4, min: 1, max: 6, step: 1, label: 'Longest term (words)',
    help: 'The longest phrase, in words, that can become a term. 4 catches terms like "pressure relief valve body". Higher values find longer terms but add more noise.',
  },
  top_n: {
    def: 500, min: 10, max: 5000, step: 10, label: 'Maximum terms returned',
    help: 'How many terms the glossary keeps, best-scoring first. Lower it for a shorter, more focused list.',
  },
  min_segments: {
    def: 2, min: 1, max: 50, step: 1, label: 'Minimum segments a term must appear in',
    help: 'A term must appear in at least this many different segments. 2 drops one-off phrases. Raise it for large memories; use 1 for very small files.',
  },
  min_chars: {
    def: 15, min: 0, max: 200, step: 1, label: 'Ignore segments shorter than (characters)',
    help: 'Segments shorter than this are skipped, such as button labels or "OK". Set 0 to read everything, which suits UI strings or game text.',
  },
  include_examples: {
    def: 3, min: 0, max: 10, step: 1, label: 'Example segments kept per term',
    help: 'How many example segments appear next to each term in the glossary. AI review uses up to 2 of them to write definitions.',
  },
  dedupe_threshold: {
    def: 0.85, min: 0.5, max: 1, step: 0.01, label: 'Near-duplicate merge threshold (higher merges less)',
    help: 'How alike two terms of the same length must be in spelling to merge into one, such as "colour" and "color". 1 merges only identical terms; lower values merge more.',
  },
  independence_ratio: {
    def: 1.25, min: 1, max: 5, step: 0.05, label: 'Sub-phrase suppression ratio (lower to keep more)',
    help: 'Decides whether a shorter term inside a longer one is kept, e.g. "relief valve" inside "pressure relief valve". It is dropped unless it appears more than this many times as often as the longer term. Lower it to keep more of these; 1 keeps any that also appear on their own.',
  },
};
const DEDUPE_SEGMENTS_HELP = 'Counts each distinct segment once, so text repeated many times, like a recurring disclaimer, does not inflate its terms.';

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Functions called from the page (google.script.run)
// ---------------------------------------------------------------------------

function getAppConfig() {
  const cfg = getConfig_();
  return {
    title: APP_TITLE,
    user: currentUser_(),
    languages: LANGUAGES.map(function (l) { return { code: l.code, label: l.label }; }),
    targetLanguages: TARGET_LANGUAGES.map(function (l) { return { code: l.code, label: l.label }; }),
    tuning: TUNING,
    dedupeSegmentsHelp: DEDUPE_SEGMENTS_HELP,
    limits: { maxFileMb: MAX_FILE_MB, maxFiles: MAX_FILES_PER_JOB, extensions: ALLOWED_EXTENSIONS },
    workFolderUrl: folderUrl_(cfg.workFolderId),
    logSheetUrl: 'https://docs.google.com/spreadsheets/d/' + cfg.logSheetId,
  };
}

/**
 * Checks a pasted folder link: first with the person's own access, then by
 * asking n8n whether its Google account can use it. `purpose` is 'input'
 * or 'output'.
 */
function checkFolder(link, purpose) {
  purpose = purpose === 'output' ? 'output' : 'input';
  const info = inspectFolderAsUser_(link, purpose);
  let n8n;
  try {
    const reply = callN8n_({ action: 'check', folders: [{ purpose: purpose, id: info.id }] });
    n8n = { ok: !!reply.ok, problems: reply.problems || [], account: reply.n8n_account || '' };
  } catch (e) {
    n8n = { ok: false, problems: [e.message], account: '', unreachable: true };
  }
  info.n8n = n8n;
  return info;
}

/**
 * Upload path, step 1: create the job's folders in the working folder and
 * remember them for this person for six hours.
 */
function prepareUpload(form) {
  validateForm_(form);
  const fileCount = Number(form.file_count) || 0;
  if (fileCount < 1) throw new Error('Add at least one file.');
  if (fileCount > MAX_FILES_PER_JOB) throw new Error('At most ' + MAX_FILES_PER_JOB + ' files per job.');

  const jobId = newJobId_();
  const folders = createJobFolders_(jobId, String(form.client).trim(), true, form.output_mode !== 'folder');
  CacheService.getUserCache().put('job:' + jobId, JSON.stringify(folders), 21600);
  return { jobId: jobId };
}

/** Upload path, step 2: one call per file. `base64` excludes the data-URL prefix. */
function uploadFile(jobId, fileName, base64) {
  const folders = pendingJob_(jobId);
  const name = String(fileName || '').replace(/[\\/]/g, '_').slice(0, 200);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
    throw new Error('"' + name + '": only ' + ALLOWED_EXTENSIONS.join(', ') + ' files are accepted.');
  }
  const bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length) throw new Error('"' + name + '" is empty.');
  if (bytes.length > MAX_FILE_MB * 1024 * 1024) throw new Error('"' + name + '" is larger than ' + MAX_FILE_MB + ' MB.');
  // Stored as an opaque file so Drive doesn't try to convert it.
  DriveApp.getFolderById(folders.input).createFile(Utilities.newBlob(bytes, 'application/octet-stream', name));
  return { name: name, bytes: bytes.length };
}

/**
 * Starts a job: works out the folders, then sends n8n one request.
 * `jobId` is set for the upload path (from prepareUpload), empty otherwise.
 * Returns once n8n has accepted the job; the work carries on in n8n.
 */
function submitJob(form, jobId) {
  validateForm_(form);
  const user = currentUser_();
  const client = String(form.client).trim();
  const lang = languageOf_(form.source_lang);
  const inputMode = form.input_mode === 'folder' ? 'folder' : 'upload';
  const outputMode = form.output_mode === 'folder' ? 'folder' : 'job';

  let folders;
  let fileNames;
  if (inputMode === 'upload') {
    folders = pendingJob_(jobId);
    fileNames = listFileNames_(folders.input);
    if (!fileNames.length) throw new Error('No files arrived for this job. Try submitting again.');
  } else {
    const src = inspectFolderAsUser_(form.input_folder, 'input');
    if (!src.usable.length) throw new Error('"' + src.name + '" has no ' + extList_() + ' files directly inside it.');
    jobId = newJobId_();
    folders = { input: src.id };
    fileNames = src.usable.map(function (f) { return f.name; });
  }

  if (outputMode === 'folder') {
    folders.output = inspectFolderAsUser_(form.output_folder, 'output').id;
  } else if (!folders.output) {
    const made = createJobFolders_(jobId, client, false, true);
    folders.output = made.output;
    folders.job = made.job;
  }

  const settings = {
    dedupe_segments: form.dedupe_segments !== false,
    run_ai_review: form.run_ai_review === true,
    ai_review_approved: form.run_ai_review === true && form.ai_review_approved === true,
    suggest_translations: form.suggest_translations === true,
  };
  if (settings.suggest_translations) {
    const target = targetLanguageOf_(form.target_lang, lang.code);
    settings.target_lang = target.code;
    settings.target_tmx = target.tmx;
    settings.target_label = target.label;
    // AI translation of terms the files don't translate: only on request, and only with AI review.
    settings.ai_translate_missing = settings.run_ai_review && form.ai_translate_missing === true;
  }
  Object.keys(TUNING).forEach(function (key) { settings[key] = clampNumber_(form[key], TUNING[key]); });

  const reply = callN8n_({
    action: 'start',
    job: {
      job_id: jobId,
      client: client,
      source_lang: lang.code,
      tmx_lang: lang.tmx,
      submitted_by: user,
      submitted_at: new Date().toISOString(),
      input_mode: inputMode,
      output_mode: outputMode,
      input_folder_id: folders.input,
      output_folder_id: folders.output,
      job_folder_id: folders.job || '',
      file_names: fileNames.sort().join(' | '),
    },
    settings: settings,
  });
  if (!reply.ok) throw new Error(reply.error || 'n8n did not accept the job.');
  if (jobId) CacheService.getUserCache().remove('job:' + jobId);
  return { jobId: jobId, files: fileNames.length };
}

/** Recent jobs from the log sheet. `scope` is 'mine' or 'all'. */
function listJobs(scope) {
  const user = currentUser_();
  const now = Date.now();
  const rows = readLog_()
    .filter(function (r) { return scope === 'all' || r.submitted_by === user; })
    .sort(function (a, b) { return String(b.submitted_at).localeCompare(String(a.submitted_at)); })
    .slice(0, 40);

  return {
    user: user,
    jobs: rows.map(function (r) {
      const s = settingsOf_(r.settings_json);
      const started = Date.parse(r.started_at || '');
      return {
        job_id: r.job_id,
        status: r.status,
        stale: r.status === 'running' && started && (now - started) > STALE_MINUTES * 60000,
        submitted_at: r.submitted_at,
        submitted_by: r.submitted_by,
        mine: r.submitted_by === user,
        client: r.client,
        source_lang: r.source_lang,
        file_names: r.file_names,
        file_count: r.file_names ? String(r.file_names).split(' | ').length : 0,
        started_at: r.started_at,
        finished_at: r.finished_at,
        terms_returned: r.terms_returned,
        glossary_url: r.glossary_url,
        stage1_url: r.stage1_url,
        manifest_url: r.manifest_url,
        input_url: s.input_mode === 'folder' ? folderUrl_(r.input_folder_id) : '',
        output_url: s.output_mode === 'folder' ? folderUrl_(r.output_folder_id) : '',
        folder_url: r.job_folder_id ? folderUrl_(r.job_folder_id) : '',
        message: r.message,
        ai: aiSummary_(s),
        target_label: s.suggest_translations ? s.target_label || s.target_lang : '',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// One-time setup: run from the Apps Script editor by whoever manages the app
// ---------------------------------------------------------------------------

/**
 * Creates the working folder (for uploads and default result folders) and the
 * log sheet, and stores their IDs. Safe to run again.
 *
 * To create them in a Shared Drive (recommended), first set the Script
 * Property PARENT_FOLDER_ID to a folder there, then run setup().
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const parentId = props.getProperty('PARENT_FOLDER_ID');
  const parent = parentId ? DriveApp.getFolderById(parentId) : DriveApp.getRootFolder();

  let work = existingFolder_(props.getProperty('WORK_FOLDER_ID'));
  if (!work) {
    work = parent.createFolder(APP_TITLE + ' - jobs');
    props.setProperty('WORK_FOLDER_ID', work.getId());
  }

  let ss = null;
  const sheetId = props.getProperty('LOG_SHEET_ID');
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(APP_TITLE + ' - job log');
    DriveApp.getFileById(ss.getId()).moveTo(parent);
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(LOG_SHEET_NAME);
  }
  // Plain text everywhere, so timestamps and IDs stay exactly as n8n wrote them.
  sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).setNumberFormat('@');
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const missing = ['N8N_WEBHOOK_URL', 'N8N_WEBHOOK_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET']
    .filter(function (k) { return !props.getProperty(k); });

  const summary = [
    'Setup complete.',
    'Working folder:  ' + folderUrl_(work.getId()),
    'Log sheet:       ' + ss.getUrl(),
    'Log sheet ID:    ' + ss.getId() + '   <- paste into the n8n Google Sheets nodes',
    '',
    'Share:',
    '  working folder  team: Editor (Contributor in a shared drive) · n8n account: Editor',
    '  log sheet       team: Viewer · n8n account: Editor',
    missing.length ? '\nStill to set in Script Properties: ' + missing.join(', ') : '',
  ].join('\n');
  Logger.log(summary);
  return summary;
}

/** Run from the editor after setting the properties: sends a harmless folder check. */
function testConnection() {
  const cfg = getConfig_();
  const reply = callN8n_({ action: 'check', folders: [{ purpose: 'output', id: cfg.workFolderId }] });
  Logger.log(JSON.stringify(reply, null, 2));
  return reply;
}

// ---------------------------------------------------------------------------
// n8n
// ---------------------------------------------------------------------------

/**
 * POSTs to the n8n webhook and returns the parsed JSON reply. Turns the
 * usual failures (Cloudflare, wrong key, workflow off, n8n down) into
 * messages that say what to fix.
 */
function callN8n_(body) {
  const props = PropertiesService.getScriptProperties();
  // Trimmed: a space or line break picked up when pasting a value would
  // otherwise make n8n or Cloudflare reject every request.
  const prop = (name) => String(props.getProperty(name) || '').trim();
  const url = prop('N8N_WEBHOOK_URL');
  if (!url) throw new Error('The app is not connected to n8n yet (N8N_WEBHOOK_URL is not set).');

  const headers = {
    'X-Terminology-Key': prop('N8N_WEBHOOK_KEY'),
    'CF-Access-Client-Id': prop('CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': prop('CF_ACCESS_CLIENT_SECRET'),
  };
  const extra = prop('N8N_EXTRA_HEADERS');
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      Object.keys(parsed).forEach(function (k) { headers[k.trim()] = String(parsed[k]).trim(); });
    } catch (e) {
      throw new Error('N8N_EXTRA_HEADERS is not valid JSON.');
    }
  }

  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      headers: headers,
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    throw new Error("Couldn't reach n8n (" + e.message + '). Try again in a minute; if it keeps happening, n8n may be down.');
  }

  const code = res.getResponseCode();
  const type = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
  const text = res.getContentText();
  let json = null;
  if (type.indexOf('json') !== -1) {
    try { json = JSON.parse(text); } catch (e) { json = null; }
  }

  if (json && (json.ok !== undefined)) return json;                 // n8n's own reply, accepted or not
  if (code >= 300 && code < 400) throw new Error('Cloudflare redirected the request to a login page. Check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.');
  if (code === 403 && type.indexOf('html') !== -1) throw new Error('Cloudflare blocked the request. Check the Cloudflare Access service token.');
  if (code === 401 || code === 403) throw new Error('n8n rejected the request key. Check N8N_WEBHOOK_KEY matches the Header Auth credential on the Webhook node.');
  if (code === 404) throw new Error('n8n has no active workflow at that address. Check the terminology workflow is activated and N8N_WEBHOOK_URL is its production URL.');
  if (code === 524 || code === 504) throw new Error('n8n took too long to answer. Try again in a minute.');
  if (code >= 500) throw new Error('n8n hit an error before accepting the job (HTTP ' + code + '). Check its executions list.');
  throw new Error('Unexpected reply from n8n (HTTP ' + code + ').');
}

// ---------------------------------------------------------------------------
// Drive (all as the person using the page)
// ---------------------------------------------------------------------------

/** Accepts a folder URL (My Drive or shared drive) or a bare folder ID. */
function parseFolderId_(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([-\w]{10,})/) || s.match(/[?&]id=([-\w]{10,})/) || s.match(/^([-\w]{10,})$/);
  return m ? m[1] : null;
}

/**
 * Checks a folder with the person's own Drive access and, for a source
 * folder, lists the usable files. Throws an Error meant for the person.
 */
function inspectFolderAsUser_(link, purpose) {
  const id = parseFolderId_(link);
  if (!id) throw new Error('Paste a Google Drive folder link. It contains /folders/ followed by the folder ID.');
  let meta;
  try {
    meta = Drive.Files.get(id, {
      fields: 'id,name,mimeType,trashed,capabilities(canAddChildren,canListChildren)',
      supportsAllDrives: true,
    });
  } catch (e) {
    throw new Error("You don't have access to that folder, or the link is incomplete.");
  }
  if (meta.mimeType !== FOLDER_MIME) throw new Error('That link is to a file, not a folder.');
  if (meta.trashed) throw new Error('"' + meta.name + '" is in the bin.');
  const caps = meta.capabilities || {};
  if (purpose === 'output' && !caps.canAddChildren) {
    throw new Error('You need edit access to "' + meta.name + '" to save results there.');
  }

  const info = { id: meta.id, name: meta.name, url: folderUrl_(meta.id), usable: [], skipped: [], truncated: false, totalBytes: 0 };
  if (purpose === 'input') {
    // Only files directly in the folder; subfolders are not searched.
    const it = DriveApp.getFolderById(meta.id).getFiles();
    let seen = 0;
    while (it.hasNext()) {
      if (seen >= MAX_FOLDER_SCAN) { info.truncated = true; break; }
      const f = it.next();
      seen += 1;
      const name = f.getName();
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (ALLOWED_EXTENSIONS.indexOf(ext) !== -1 && f.getMimeType().indexOf('application/vnd.google-apps') !== 0) {
        info.usable.push({ name: name, bytes: f.getSize() });
        info.totalBytes += f.getSize();
      } else {
        info.skipped.push(name);
      }
    }
  }
  return info;
}

/** Creates <working folder>/<job id - client>/ with input/ and/or output/. */
function createJobFolders_(jobId, client, withInput, withOutput) {
  let work;
  try {
    work = DriveApp.getFolderById(getConfig_().workFolderId);
  } catch (e) {
    throw new Error("You don't have access to the app's working folder. Ask for it to be shared with you, or choose your own folders.");
  }
  let job;
  try {
    job = work.createFolder(jobId + ' - ' + safeName_(client));
  } catch (e) {
    throw new Error("You can't add files to the app's working folder. Ask for edit access, or choose your own folders.");
  }
  return {
    job: job.getId(),
    input: withInput ? job.createFolder('input').getId() : '',
    output: withOutput ? job.createFolder('output').getId() : '',
  };
}

function pendingJob_(jobId) {
  const raw = jobId && CacheService.getUserCache().get('job:' + jobId);
  if (!raw) throw new Error('This upload has expired or belongs to someone else. Start again.');
  return JSON.parse(raw);
}

function listFileNames_(folderId) {
  const names = [];
  const it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) names.push(it.next().getName());
  return names;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = { workFolderId: props.getProperty('WORK_FOLDER_ID'), logSheetId: props.getProperty('LOG_SHEET_ID') };
  if (!cfg.workFolderId || !cfg.logSheetId) {
    throw new Error('The app has not been set up yet. Run setup() once from the Apps Script editor.');
  }
  return cfg;
}

function currentUser_() {
  return Session.getActiveUser().getEmail() || 'unknown';
}

function validateForm_(form) {
  const client = String((form && form.client) || '').trim();
  if (!client) throw new Error('Client is required.');
  if (client.length > 80) throw new Error('Client name is too long.');
  const lang = languageOf_(form.source_lang);
  if (form.suggest_translations === true) targetLanguageOf_(form.target_lang, lang.code);
}

function targetLanguageOf_(code, sourceCode) {
  const lang = TARGET_LANGUAGES.filter(function (l) { return l.code === code; })[0];
  if (!lang) throw new Error('Choose a target language for the translations.');
  if (lang.code === sourceCode) throw new Error('The target language must differ from the source language.');
  return lang;
}

function languageOf_(code) {
  const lang = LANGUAGES.filter(function (l) { return l.code === code; })[0];
  if (!lang) throw new Error('Choose a source language from the list.');
  return lang;
}

function readLog_() {
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(getConfig_().logSheetId).getSheetByName(LOG_SHEET_NAME);
  } catch (e) {
    throw new Error("You can't open the job log. Ask for view access to it.");
  }
  if (!sheet) throw new Error('The "' + LOG_SHEET_NAME + '" tab is missing from the job log.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return sheet.getRange(2, 1, lastRow - 1, header.length).getDisplayValues()
    .filter(function (v) { return v[header.indexOf('job_id')]; })
    .map(function (v) {
      const r = {};
      header.forEach(function (name, i) { r[name] = v[i]; });
      return r;
    });
}

function newJobId_() {
  const stamp = Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMdd-HHmmss');
  const rand = Utilities.getUuid().replace(/-/g, '').slice(0, 4).toLowerCase();
  return 'T' + stamp + '-' + rand;
}

function clampNumber_(value, spec) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || isNaN(n)) return spec.def;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  return spec.step >= 1 ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function folderUrl_(id) { return id ? 'https://drive.google.com/drive/folders/' + id : ''; }
function extList_() { return ALLOWED_EXTENSIONS.map(function (e) { return '.' + e; }).join(' '); }
function safeName_(s) { return String(s).replace(/[^\w .\-]/g, '_').slice(0, 60); }

function existingFolder_(id) {
  if (!id) return null;
  try {
    const f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

function settingsOf_(json) {
  try { return JSON.parse(json || '{}'); } catch (e) { return {}; }
}

function aiSummary_(s) {
  if (!s.run_ai_review) return 'off';
  return s.ai_review_approved ? 'requested' : 'requested, not approved';
}
