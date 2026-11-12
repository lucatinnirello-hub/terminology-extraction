# Stage 2 server (runs on your machine)

n8n can't run spaCy, so stage 2 runs here instead: n8n sends stage 1's terms to
this small server and gets the cleaned-up list back. A free Cloudflare tunnel
gives your machine an address n8n can reach, without opening anything on your
network.

```
n8n (server)  ── HTTPS ──►  Cloudflare tunnel  ──►  your machine: stage2_server.py (spaCy)
```

**Before you start:** client text (example segments) goes to your machine
through the tunnel while a job runs. It's encrypted and needs the key, but
check with IT that this is OK for client material.

## One-time setup

1. Install **Python 3.12 or 3.13** from <https://www.python.org/downloads/>.
   On Windows, tick **"Add python.exe to PATH"** in the installer.
2. Install **cloudflared**:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - Mac: `brew install cloudflared`
3. In a terminal, in this `local-server` folder, install spaCy:

   ```bash
   python -m pip install -r requirements.txt
   ```

   (Mac: use `python3` instead of `python`.) Language models download by
   themselves the first time a job in that language arrives.
4. In n8n, on the **Stage 2 NLP** node: **Authentication** → *Generic* →
   *Header Auth* → new credential with **Name** `X-Stage2-Key` and **Value** =
   the key the server prints when it starts (step "Each time" below). The key
   is saved in `stage2-key.txt`, so it stays the same from then on.

## Each time you want stage 2 to run

1. Start it:
   - Windows: double-click `start-windows.bat`.
   - Mac: in two terminal windows, in this folder:

     ```bash
     python3 stage2_server.py
     ```

     ```bash
     cloudflared tunnel --url http://localhost:8765
     ```

2. cloudflared prints an address like `https://some-random-words.trycloudflare.com`.
   In n8n, put it in the **Stage 2 NLP** node's URL, followed by `/stage2`:
   `https://some-random-words.trycloudflare.com/stage2`.
   Save the workflow.
3. Leave both windows open, and the machine awake, while jobs run.

The address **changes every time cloudflared restarts**, so repeat step 2
after each restart. To check it's up, open the address in a browser: it
should show `{"ok": true, ...}`.

## When your machine is off

Jobs still finish, without stage 2: terms come through as stage 1 found them.
The job's note on the web page says *"Stage 2 (spaCy) skipped"*, and the run
manifest says why (machine off, old address, wrong key...).

## What stage 2 does

- Drops candidates that aren't terms: no noun ("inspected annually"), a verb
  inside ("motor drives", "panel is installed"), or a verb at the start
  ("replace filter cartridge").
- Merges singular and plural ("valve" / "valves") and adds up their counts.
- Fills the glossary's `lemma` column.

What it dropped, and why, is listed under `stage_2` in the run manifest.
Languages with no spaCy model (Czech, Slovak, Hungarian, Estonian, Latvian,
Turkish, Indonesian) pass through unchanged. The language-to-model list is
`MODELS` at the top of `stage2_server.py`.
