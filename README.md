# Terminology extraction: web page + n8n webhook

```
 Web page (Apps Script, runs as you)            n8n (behind Cloudflare)
 ───────────────────────────────────            ───────────────────────
 paste folder link ── POST {action: check} ──►  can n8n's account use it? ──► reply at once
 submit            ── POST {action: start} ──►  checks folders, logs "running" ──► 202 accepted
                                                 … extracts, uploads results to Drive …
 job list (15 s)   ◄── reads ── Job log sheet ◄── done + links / failed + reason
```

The page sends n8n one HTTP request per job, through Cloudflare, in the same
way as your other webhook-driven workflows. The request carries only job
details and Drive folder IDs; n8n reads the source files from Drive and writes
the results back to Drive.

**Why the reply doesn't carry the glossary:** Cloudflare drops requests that
wait more than about 100 seconds, and a job with AI review takes several
minutes. So n8n checks everything it can up front, replies *accepted* (or
says why not) within a second or two, then keeps working. The outcome goes
to the job log sheet, which the page shows.

## Files

| File | What it is |
|---|---|
| `apps-script/Code.gs` | Server side: folder checks, uploads, the request to n8n, job list |
| `apps-script/Index.html` | The page |
| `apps-script/appsscript.json` | Manifest: runs as the user, Drive advanced service on |
| `n8n/Terminology_extraction_webhook_v4.json` | Main workflow: Webhook → checks → reply → extraction → log |
| `n8n/Terminology_job_errors.json` | Error workflow: marks the failed job's log row, matched by execution ID |
| `docs/terminology-job-flow.html` | The diagrams |
| `n8n/code/` | Plain copies of Code nodes changed since first setup (XLIFF support, Gemini AI review, lower-case entries, the AI brief, translation suggestions, memoQ wildcards), for pasting into an existing workflow |
| `docs/workflow-nodes.html` | Every n8n node: what it does, what to set up on it, whether it can stop a job |
| `n8n/superseded/` | The earlier scheduled-check version, for reference only |

## Setup

### 1. n8n

1. Import both workflow files.
2. **Webhook** node:
   - attach a Header Auth credential with name `X-Terminology-Key` and a long random value;
   - keep the value; Apps Script needs it.
   - The path is `terminology-extraction`; change it if you like.
3. Attach credentials:
   - **Google Drive** on *Get folder (as n8n)*, *n8n account*, *List job files*, *Download job files* and *Upload to job folder*;
   - **Google Sheets** on *Log job started* and *Mark job done*, plus the two Sheets nodes in the error workflow;
   - **Google Gemini** credential on *AI review*, *AI forms* and *AI wildcard check*, only needed for AI review and memoQ wildcards. All three are n8n's Google Gemini node (*Message a Model*), with the same settings.
     - Get the API key from Google AI Studio, in a project **with billing enabled**. Google may use content sent through free-tier keys to improve its products, which isn't acceptable for client material.
     - On the node: pick a current Gemini model, keep *Output Content as JSON* on, and keep *Maximum Number of Tokens* at about 16000. The node's default of 16 makes every reply useless.

   The Google account you use here is "n8n's account": folders must be shared with it.
4. Publish (activate) *Terminology job errors*. Current n8n versions grey out unpublished workflows in the error workflow list.
   Then: main workflow → **Settings** → **Error workflow** → *Terminology job errors*.
5. Activate the main workflow and copy the Webhook node's **production** URL. Make sure Cloudflare routes it, the same way as your other webhooks.

### 2. Apps Script

1. At <https://script.google.com> create a project, e.g. *Terminology extraction*.
2. **Project Settings**: tick *Show "appsscript.json" manifest file in editor*.
   Paste `Code.gs` and `appsscript.json`, and add an HTML file named `Index` with `Index.html`.
3. *(Recommended)* To keep the working folder and log in a Shared Drive, add the Script Property `PARENT_FOLDER_ID` = a folder there.
4. Run `setup()` from the editor. It creates:
   - a **working folder**, used for uploads and for results when nobody picks a folder;
   - a **job log** sheet. It prints the log's ID.
5. Paste the log sheet ID into the n8n Sheets nodes, replacing `PASTE_LOG_SHEET_ID_HERE` (2 in the main workflow, 2 in the error workflow).
6. Share:

   | | Team | n8n's account |
   |---|---|---|
   | Working folder | Editor (Contributor in a shared drive) | Editor |
   | Job log | **Viewer** | Editor |

   The team only views the log, so nobody can edit other people's rows.
7. **Project Settings → Script Properties**:

   | Property | Value |
   |---|---|
   | `N8N_WEBHOOK_URL` | the Webhook's production URL |
   | `N8N_WEBHOOK_KEY` | the Header Auth value from n8n step 2 |
   | `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | the Cloudflare credentials your other script uses |
   | `N8N_EXTRA_HEADERS` | optional: JSON of any other headers your other script sends, e.g. `{"X-Other": "value"}` |

   If your other script sends Cloudflare credentials under different header names, put them in `N8N_EXTRA_HEADERS` instead.
   People using the page can't read these values; they can run the app but not open the project.
8. Run `testConnection()` from the editor. It asks n8n to check the working folder, and the log shows n8n's reply or a message saying what to fix.
9. **Deploy → New deployment → Web app**:
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within ics-translate.com**

   Each person approves the app's Drive access the first time they open it.

## Supported files

| Format | Extensions | What is read |
|---|---|---|
| TMX | `.tmx`, `.xml` | The source-language side of each translation unit |
| XLIFF 1.2 and 2.x | `.xlf`, `.xliff`, `.xml` | The `<source>` of each unit; targets, TM matches and units marked "do not translate" are ignored |
| memoQ XLIFF | `.mqxliff` | As XLIFF |
| memoQ compressed export | `.mqxlz` | The `.mqxliff` inside the package (memoQ's *Export bilingual → memoQ XLIFF* with "Save a compressed file" ticked) |
| Plain text | `.txt`, `.md` | Split into sentences |
| Glossary (wildcards-only jobs) | `.xlsx`, `.csv` | The first worksheet; the first non-empty row is the header. CSV may use commas, semicolons or tabs |

`.xml` files are recognised as TMX or XLIFF from their content. Formatting codes such as `{}` or `<b>` are removed, so they never become terms.
An XLIFF file that declares a different source language from the job's is skipped, and the job's results note says so. TMX files are only read on the job's language side anyway.

## How it behaves

- **Folders are checked twice, from both sides.**
  - When a link is pasted, the page checks the person's own access (it runs as them).
  - It then asks n8n to check its account's access. If n8n can't use the folder, the page names the account to share it with.
  - Both checks run again on submit.
- **Source files** come from one of two places:
  - an existing Drive folder: every supported file directly inside it, with no size limit;
  - uploads (25 MB per file, 20 files), which go into a new job folder in the working folder. Pick files, or a folder on your computer (subfolders included), or drag either onto the page. Unsupported files in a folder are skipped and counted. A file in a subfolder is saved as `subfolder_name.tmx`, so files with the same name don't clash.
- **Results** go to a folder you choose (you need edit access) or to a new job folder. File names include the job ID, so nothing is overwritten.
- **Several jobs can run at once.** Each is independent, and failures are matched to their log row by the n8n execution ID.
- **Failures:**
  - Problems found before the reply (folders, the key, Cloudflare, n8n down or the workflow inactive) appear on the page at once, and nothing is logged.
  - Problems after the reply (no usable files, no terms, Drive or Gemini errors) are written to the job's log row, with a link to the n8n execution.
  - If n8n restarts mid-job, nothing can report back, so the page flags a job still running after 45 minutes.
- **The page has three steps:** *Job details* (client, what to do, language, files, where results go), *Job settings* (lower case, translations and extraction settings; or, for a glossary, its target language and column) and *AI review*. *Next* only moves on once the step's required fields are filled in. After a job starts, the page goes back to step 1, and the settings are kept for the next job.
- **Lower case** is on by default, following glossary practice. Stage 1 decides each word's case from how the files write it mid-sentence:
  - Words the files mostly write in lower case become lower case ("Pressure Valve" from a heading becomes "pressure valve").
  - Words mostly capitalised stay that way ("Siemens", German nouns), as do acronyms ("ISO") and mixed-case names ("PowerPoint").
  - A term only ever seen at the start of a sentence or in a heading becomes lower case, and its `case_note` says to check it.

  When AI review runs, the model can correct a term's case, but nothing else about the term. The glossary's `source_form` column keeps the most common original form.
- **The AI brief** (step 3, extraction jobs) is sent with every batch. It holds the type of terminology (general, UI strings, technical, marketing and others), the subject area and up to 2,000 characters of instructions, and it's saved in the run manifest. It can change which terms are kept, how definitions read and how translations are judged, but not the reply format.
- **AI review** still needs both ticks on the page, and the client must not be on the restricted list in n8n (*Check restricted list*). The page can't override that list.
- **Languages** offered are the Latin-script ones, because the stage 1 tokeniser only reads Latin script. Each language maps to its TMX code, e.g. Czech is `cz` in the stopword lists and `cs-CZ` in TMX files.

## Reading the candidate list

Each extraction job writes two spreadsheets to the results folder:

- **Stage 1**: the candidate terms straight from the statistics, before any AI. Its columns are the first block below.
- **The glossary**: the same terms in the same order, with the AI's verdicts added. Translation and wildcard columns are added when those options are on.

Every term from stage 1 reaches the glossary: the AI marks terms to drop, but nothing is removed. Filter on `ai_keep` to get the AI's shortlist.

**From stage 1 (statistics, no AI)**

| Column | What it holds | How to read it |
|---|---|---|
| `rank` | Position in the list, 1 = best | Ordered by `yake_score`. The AI doesn't change it. |
| `term` | The term as it should go in the glossary | Lower case unless the files show it's a name, brand, acronym or always-capitalised word (see *Lower case* above). |
| `source_form` | The most common way the files write it | Compare with `term` to see what the case rule changed. |
| `case_note` | Why the case is what it is | *lower case*, *kept capitals: …* with the reason, or *lower case (check: only seen at sentence start or in headings)*: check these. *AI: …* means the AI changed the case. |
| `word_count` | Words in the term | Capped by *Longest term (words)*. |
| `yake_score` | How term-like the phrase looks statistically | See below. |
| `occurrences` | How many times it appears in total | Includes the counts of any merged variants. |
| `segments` | How many different segments it appears in | Always at least *Minimum segments a term must appear in*. Much lower than `occurrences` means it repeats inside a few segments. |
| `source_types` | Which kinds of file it came from | `tmx`, `xliff`, `text`, separated by `\|`. |
| `merged_variants` | Other spellings folded into this term | E.g. *color* merged into *colour* (set by *Near-duplicate merge threshold*). Entries starting `(sub)` are shorter terms dropped because they almost only appear inside this one, e.g. `(sub) relief valve` under *pressure relief valve* (set by *Sub-phrase suppression ratio*). |
| `examples` | Up to *Example segments kept per term* segments containing it | Separated by `\|`. Read these before trusting a term. |

**The YAKE score.** YAKE is the statistical method stage 1 uses to rank phrases. Each word gets a score from how it behaves in the files: frequent, often capitalised, appearing early, and next to the same few words each time (rather than next to anything, like *the* or *with*) all make a word look more like part of a term. A phrase's score combines its words' scores and is divided by how often the phrase occurs.

- **Lower is better.** Rank 1 has the lowest score.
- **Only compare within one job.** The number depends on the files, so there's no fixed good or bad value, and scores from different jobs can't be compared.
- **It says how term-like a phrase looks, not whether it's right.** Frequent general phrases can still score well; that's what AI review and `ai_keep` are for.
- **Longer terms tend to score worse,** because every word adds to the score. Don't drop a 3- or 4-word term just because it ranks below single words.

**Added in the glossary**

| Column | What it holds | How to read it |
|---|---|---|
| `lemma` | The term's dictionary form | Always empty for now: lemmatisation (stage 2) isn't built yet. |
| `ai_keep` | The AI's verdict | `true`: a real term for this job. `false`: the AI suggests dropping it; `ai_reason` says why. Empty: the AI didn't run or its reply failed (see `ai_error`). |
| `ai_reason` | The AI's reason, mostly for dropped terms | *no verdict returned* means the AI skipped this term in its reply. |
| `definition` | A short definition written by the AI | Based on the examples and the AI brief. Empty without AI review. |
| `translation` and the other translation columns | See *Translations* below | Only with *Suggest translations* on. |
| `memoq_term`, `wildcard_check`, `wildcard_note` | See *memoQ wildcards* below | Only with wildcards on. |
| `ai_error` | Why the AI review failed for this term's batch | Empty when all went well. All 25 terms of a failed batch carry the same message. |

**A quick way to review:** filter `ai_keep` to `true`, sort by `rank`, then check rows with a *check* in `case_note`, any `(sub)` entries in `merged_variants` you'd want back, and, with translations on, *AI corrected* rows first.

## Translations

Tick **Suggest translations of the terms** on the page and pick the target language.

1. **From the files, without AI.** *Match translations* reads the target side of the TMX and XLIFF files. For each term it finds the target phrase that appears in the translations of the term's segments and rarely elsewhere, checks that it is built from the translations of the term's own words, and rates it:
   - **high**: found in most of the term's segments (at least 3);
   - **medium**: found in at least half of them (at least 2);
   - **low**: a weak match, often a rare term.

   The rating measures how *consistently* the files translate a term, not whether the translation is right. Other translations the files use for the same term are listed too, e.g. *multiplikatora (18)*: useful for spotting inconsistencies.
2. **Checked by the AI**, if AI review runs. Each term goes with its suggestion and 1 source/target example pair (2 for medium or low confidence). The AI confirms the suggestion, or corrects it with a short note, and gives the translation in its dictionary form.
3. **Terms with no match in the files** are translated by the AI only if *Where the files have no translation for a term, let the AI translate it* is ticked. It needs AI review, and is greyed out without it.

Glossary columns added for translation jobs:

| Column | What it holds |
|---|---|
| `translation` | The checked translation. Empty unless the AI confirmed, corrected or translated it: nothing unchecked goes here. |
| `translation_check` | *AI confirmed* · *AI corrected* (the AI disagreed with the files: check these first) · *AI translated (not from the files)* · *Code suggestion, not validated* (the AI didn't run) · *No match in the files* |
| `translation_note` | Why the AI corrected it |
| `code_suggestion`, `code_confidence`, `code_alternatives` | What the files suggested, how consistently (e.g. *high (29/32)*), and other translations used |

The job's note on the page counts each kind, e.g. *"Translations into Serbian (Latin): 456 confirmed by AI, 41 corrected by AI, 3 AI-translated, not from the files."*

**Languages.** Any target language with a stopword list in *Stopword lists* works, including Cyrillic and Greek; Serbian (Latin) borrows the Croatian list plus a few Serbian words, and accepts both `sr` and `sh` as its code in TMX files. For strongly inflected languages, *Match translations* can also strip word endings so case forms count together (`SUFFIXES` at the top of the node; set up for Serbian and Croatian). Plain-text files have no target side, so their terms only get AI translations, and only when chosen.

**Cost.** With translations on, each AI request is about twice the size (about 4,300 tokens per 25 terms, against 1,900 without).

## memoQ wildcards

Wildcards go on **target terms only**. memoQ reads any entry with a `|` or `*` as Custom matching; entries without one keep the term base's default matching.

Two ways to use it, both optional:

- **In an extraction job**: with *Suggest translations* on, tick *Add memoQ wildcards to the target terms*. The glossary gains `memoq_term`, `wildcard_check` and `wildcard_note`.
- **On a finished glossary**: choose *Add memoQ wildcards to a glossary* at the top of the page and upload one `.xlsx` or `.csv` (or point to a folder holding one), plus the client's TMX/XLIFF files if you have them. Pick the target language; name the target-term column if its header isn't the language name. You get the glossary back as `wildcards_….xlsx`, with the same three columns added after the existing ones. Several terms in one cell, separated by `;`, are handled one by one. This needs AI review with the client's approval: without the AI there are no forms to work from.

How each target term gets its wildcards (batches of 25):

1. **The AI lists the term's forms**: cases, singular and plural, agreeing adjectives. In extraction jobs, the forms the TM actually uses are added to these.
2. **Code applies the rules** of the *Wildcards Logic* and *Word Matching Logic* documents: a pipe after the shared stem where endings change (`period|o`, `besplatn|a okretanj|a`); an asterisk when forms only add letters and the addition is over 50% of the term (`run*`); no wildcard at or under 50% (`cat` → *cats*: memoQ's 50% prefix covers it); any word but the last that varies always marked (`Símbolo* de Premio`). Words changing near their start (*Mutter/Mütter*) are left alone and noted.
3. **The AI checks each proposal** against the rules, the forms, and the words in the client's TMX/XLIFF that the proposal would also catch (*Wassert|urm* → *Wassertropfen*). It confirms it or corrects it.
4. **Code checks the AI's answer**: it's used only if it keeps the term's letters and uses the wildcards validly. The note lists any forms the result misses and other words it catches.

`wildcard_check` says what happened: *AI confirmed*, *AI corrected* (check these first), *Code proposal kept (AI reply invalid)*, *Code only, not validated* (the AI didn't run), or *No wildcards needed* (see below). The job's note on the page counts each.

**Languages that don't inflect.** Chinese, Japanese, Thai, Lao, Khmer, Burmese and Vietnamese terms never need wildcards, so the AI isn't asked and every term comes back unchanged, marked *No wildcards needed* (`NO_INFLECTION` in *Wildcard plan*). Japanese is a judgement call: its nouns don't inflect but its verbs and adjectives do; remove `'ja'` to treat it like other languages. Korean is deliberately not on the list: particles attach to nouns. Chinese, Japanese and Thai are offered for wildcards-only jobs only: they're written without spaces, which the translation matching needs to find words.

**Editing the rules.** The AI's copy of the rules is `RULES` in *Build check request*. The code's rules are in *Propose wildcards* and *Apply wildcards* (the same block in both; keep them identical). `PIPE_MATCHES_STEM_ALONE` there sets whether a pipe also matches the stem on its own. It does in memoQ (`program|ming instruction|s` matches *program instruction*), so it's on, although *Wildcards Logic* says otherwise; switch it off and the code uses an asterisk wherever the stem is itself a form.

**Cost.** Two small AI requests per 25 terms: the terms and their forms only, no example segments.

## Log sheet columns

`job_id, status, submitted_at, submitted_by, client, source_lang, file_names, settings_json, job_folder_id, input_folder_id, output_folder_id, execution_id, started_at, finished_at, terms_returned, glossary_url, stage1_url, manifest_url, message`

n8n matches columns by header name: reorder them if you like, but don't rename them.
