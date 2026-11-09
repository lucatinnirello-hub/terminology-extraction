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
| `n8n/code/` | Plain copies of Code nodes changed since first setup (XLIFF support, Gemini AI review, spaCy stage 2), for pasting into an existing workflow |
| `n8n/runners/` | Task runner image with spaCy, for the Python *Stage 2 NLP* node |
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
   - **Google Gemini** credential on *AI review*, only needed for AI review. *AI review* is n8n's Google Gemini node (*Message a Model*).
     - Get the API key from Google AI Studio, in a project **with billing enabled**. Google may use content sent through free-tier keys to improve its products, which isn't acceptable for client material.
     - On the node: pick a current Gemini model, keep *Output Content as JSON* on, and keep *Maximum Number of Tokens* at about 16000. The node's default of 16 makes every reply useless.

   The Google account you use here is "n8n's account": folders must be shared with it.
4. Publish (activate) *Terminology job errors*. Current n8n versions grey out unpublished workflows in the error workflow list.
   Then: main workflow → **Settings** → **Error workflow** → *Terminology job errors*.
5. Set up the Python task runner for *Stage 2 NLP* (next section). Until it's running, jobs fail at that node.
6. Activate the main workflow and copy the Webhook node's **production** URL. Make sure Cloudflare routes it, the same way as your other webhooks.

### 1b. Python task runner (stage 2)

Stage 1 stays JavaScript. *Stage 2 NLP* is a Python Code node that refines stage 1's candidates with spaCy:

- drops ones that aren't term-shaped: no noun ("inspected annually"), a finite verb or auxiliary inside ("motor drives", "panel is installed"), or a leading verb ("replace filter cartridge");
- groups inflected forms ("valve" / "valves") and adds up their counts;
- fills the glossary's `lemma` column.

What it dropped, and why, is listed under `stage_2` in the run manifest. A language with no spaCy model (Czech, Slovak, Hungarian, Estonian, Latvian, Turkish, Indonesian) passes through unchanged, and the manifest says so.

Python Code nodes run in n8n's separate task runner container, which has no spaCy by default. Self-hosted only: n8n Cloud can't install Python packages.

1. Build the runner image from `n8n/runners/`, with the tag matching your n8n version **exactly**:

   ```bash
   docker build -t n8n-runners-spacy:2.45.5 --build-arg N8N_VERSION=2.45.5 n8n/runners
   ```

   It installs spaCy and one small model per language, and allow-lists `spacy` for Code nodes. To save space, trim `SPACY_MODELS` in the Dockerfile to the languages you use.
2. Run n8n with external task runners, using that image for the runner. With Docker Compose, roughly:

   ```yaml
   services:
     n8n:
       image: n8nio/n8n:2.45.5
       environment:
         - N8N_RUNNERS_ENABLED=true
         - N8N_RUNNERS_MODE=external
         - N8N_RUNNERS_BROKER_LISTEN_ADDRESS=0.0.0.0
         - N8N_RUNNERS_AUTH_TOKEN=<long random value>
     task-runners:
       image: n8n-runners-spacy:2.45.5
       environment:
         - N8N_RUNNERS_TASK_BROKER_URI=http://n8n:5679
         - N8N_RUNNERS_AUTH_TOKEN=<same value>
       depends_on: [n8n]
   ```

   If you already run an `n8nio/runners` container, only its image changes.
3. Rebuild the image whenever you upgrade n8n.

If *Stage 2 NLP* fails with an import error, the runner isn't using this image, or the allow-list step didn't apply: check that `N8N_RUNNERS_EXTERNAL_ALLOW` for the Python runner in `/etc/n8n-task-runners.json` inside the container includes `spacy`.
A job with a very large *top N* takes longer here, because every candidate's example segments are tagged. If it times out, raise `N8N_RUNNERS_TASK_TIMEOUT` (seconds) on the runner.

**Updating an existing workflow** instead of re-importing it:

1. Rename *Stage 2 NLP stub* to *Stage 2 NLP*. n8n updates the three nodes that refer to it by name.
2. Set its **Language** to Python and paste `n8n/code/4b-stage-2-nlp.py`.
3. Add a JavaScript Code node *Stage 2 input* between *Stage 1 spreadsheet* and *Stage 2 NLP*, with `n8n/code/4a-stage-2-input.js`.

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

`.xml` files are recognised as TMX or XLIFF from their content. Formatting codes such as `{}` or `<b>` are removed, so they never become terms.
An XLIFF file that declares a different source language from the job's is skipped, and the job's results note says so. TMX files are only read on the job's language side anyway.

## How it behaves

- **Folders are checked twice, from both sides.**
  - When a link is pasted, the page checks the person's own access (it runs as them).
  - It then asks n8n to check its account's access. If n8n can't use the folder, the page names the account to share it with.
  - Both checks run again on submit.
- **Source files** come from one of two places:
  - an existing Drive folder: every supported file directly inside it, with no size limit;
  - uploads (25 MB per file, 20 files), which go into a new job folder in the working folder.
- **Results** go to a folder you choose (you need edit access) or to a new job folder. File names include the job ID, so nothing is overwritten.
- **Several jobs can run at once.** Each is independent, and failures are matched to their log row by the n8n execution ID.
- **Failures:**
  - Problems found before the reply (folders, the key, Cloudflare, n8n down or the workflow inactive) appear on the page at once, and nothing is logged.
  - Problems after the reply (no usable files, no terms, Drive or Gemini errors) are written to the job's log row, with a link to the n8n execution.
  - If n8n restarts mid-job, nothing can report back, so the page flags a job still running after 45 minutes.
- **AI review** still needs both ticks on the page, and the client must not be on the restricted list in n8n (*Check restricted list*). The page can't override that list.
- **Stage 2** (spaCy) runs on every job, before the AI review. It never sends text anywhere: the models run inside the runner container.
- **Languages** offered are the Latin-script ones, because the stage 1 tokeniser only reads Latin script. Each language maps to its TMX code, e.g. Czech is `cz` in the stopword lists and `cs-CZ` in TMX files.

## Log sheet columns

`job_id, status, submitted_at, submitted_by, client, source_lang, file_names, settings_json, job_folder_id, input_folder_id, output_folder_id, execution_id, started_at, finished_at, terms_returned, glossary_url, stage1_url, manifest_url, message`

n8n matches columns by header name: reorder them if you like, but don't rename them.
