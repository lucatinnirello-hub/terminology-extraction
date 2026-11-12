"""Stage 2 server: spaCy lemmatisation and part-of-speech filtering.

Runs on your own machine. n8n's "Stage 2 NLP" node sends it stage 1's terms
and gets the refined list back. See local-server/README.md.

    python stage2_server.py

What it does to stage 1's candidates:
  1. Drops ones that aren't term-shaped: no noun ("inspected annually"), a
     finite verb or auxiliary inside ("motor drives", "panel is installed"),
     or a leading verb ("replace filter cartridge").
  2. Groups inflected forms ("valve" / "valves") and adds up their counts.
  3. Sets `lemma`, `pos` and `pos_filtered` on each term.
Each term is tagged where it occurs in one of its example segments, so spaCy
sees the sentence around it; without a match it tags the term alone.
"""

import hmac
import json
import os
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import spacy

PORT = int(os.environ.get("STAGE2_PORT", "8765"))
KEY_FILE = Path(__file__).with_name("stage2-key.txt")

# --- EDITABLE: spaCy model per language -------------------------------------
# Keys are the stopword-list codes the page sends ('no' is Norwegian Bokmål).
# A model is downloaded the first time a job in its language arrives.
# Languages with no spaCy model (cz, sk, hu, et, lv, tr, id...) pass through.
MODELS = {
    "en": "en_core_web_sm",
    "de": "de_core_news_sm",
    "fr": "fr_core_news_sm",
    "es": "es_core_news_sm",
    "it": "it_core_news_sm",
    "pt": "pt_core_news_sm",
    "nl": "nl_core_news_sm",
    "da": "da_core_news_sm",
    "sv": "sv_core_news_sm",
    "no": "nb_core_news_sm",
    "fi": "fi_core_news_sm",
    "pl": "pl_core_news_sm",
    "ro": "ro_core_news_sm",
    "hr": "hr_core_news_sm",
    "lt": "lt_core_news_sm",
    "sl": "sl_core_news_sm",
}

# Example segments tagged per term, to find the term in context.
EXAMPLES_TO_TAG = 3

# Verb forms allowed inside a term, as modifiers: participles ("laminated
# glass", "vetro laminato") and gerunds ("cutting tool").
MODIFIER_VERB_FORMS = ("Part", "Ger")
# ---------------------------------------------------------------------------

_models = {}
_lock = threading.Lock()  # one job at a time: keeps memory use flat


def load_model(name):
    if name not in _models:
        if not spacy.util.is_package(name):
            print(f"Downloading spaCy model {name} (first job in this language)...", flush=True)
            spacy.cli.download(name)
        nlp = spacy.load(name)
        unused = [p for p in ("parser", "ner") if p in nlp.pipe_names]
        if unused:
            nlp.select_pipes(disable=unused)
        _models[name] = nlp
    return _models[name]


# ---- the term logic --------------------------------------------------------

def is_word_char(ch):
    return ch.isalnum() or ch == "_"


def find_in(text, term):
    # Character offsets of `term` in `text`, case-insensitive, whole words only.
    hay, needle = text.lower(), term.lower()
    start = hay.find(needle)
    while start != -1:
        end = start + len(needle)
        if (start == 0 or not is_word_char(hay[start - 1])) and (end == len(hay) or not is_word_char(hay[end])):
            return start, end
        start = hay.find(needle, start + 1)
    return None


def verdict(span):
    # None if the span is term-shaped, otherwise the reason to drop it.
    tokens = [t for t in span if not t.is_punct and not t.is_space]
    if not tokens:
        return "no words"
    if not any(t.pos_ in ("NOUN", "PROPN") for t in tokens):
        return "no noun"
    for t in tokens:
        if t.pos_ == "AUX":
            return f"auxiliary verb '{t.text}'"
        if t.pos_ == "VERB" and "Fin" in t.morph.get("VerbForm"):
            return f"finite verb '{t.text}'"
    first = tokens[0]
    if first.pos_ == "VERB" and not any(f in first.morph.get("VerbForm") for f in MODIFIER_VERB_FORMS):
        return f"starts with verb '{first.text}'"
    return None


def lemma_key(span):
    # Every word lemmatised: the key that groups inflected forms.
    return " ".join((t.lemma_ or t.text).lower() for t in span if not t.is_space)


def is_singular(span):
    return not any("Plur" in t.morph.get("Number") for t in span if t.pos_ in ("NOUN", "PROPN"))


def nouns_lemmatised(span, term):
    # Citation form when only plurals were found: nouns lemmatised, other
    # words as written. Lemmatising every word mangles terms ("cutting tools"
    # -> "cut tool"; adjectives lose agreement in German and Romance languages).
    text = "".join(((t.lemma_ or t.text) if t.pos_ in ("NOUN", "PROPN") else t.text) + t.whitespace_ for t in span).strip()
    # The span keeps the example's casing ("Cutting" at a sentence start).
    return text.lower() if term == term.lower() else text


def to_rows(terms):
    # Same columns as stage 1's rows.
    return [{
        "rank": t["rank"], "term": t["term"], "word_count": t["word_count"], "yake_score": t["yake_score"],
        "occurrences": t["occurrences"], "segments": t["segments"],
        "source_types": " | ".join(t.get("source_types") or []),
        "merged_variants": " | ".join(t.get("merged_variants") or []),
        "examples": " | ".join(t.get("examples") or []),
        "definition": "", "translation": "",
    } for t in terms]


def refine(data):
    """{stage1, source_lang, include_examples} -> stage 1's shape, refined."""
    stage1 = data["stage1"]
    lang = str(data.get("source_lang") or "").lower()
    keep_examples = data.get("include_examples")
    if keep_examples is None:
        keep_examples = 3
    terms_in = stage1.get("terms") or []

    def finish(terms, stage_2_log):
        stage_2_log.update(terms_in=len(terms_in), terms_out=len(terms))
        out = dict(stage1, stage="stage_2_nlp", terms=terms, rows=to_rows(terms))
        out["log"] = dict(stage1.get("log") or {}, stage_2=stage_2_log)
        return out

    model_name = MODELS.get(lang)
    if not model_name:
        terms = [dict(t, lemma=None, pos=None, pos_filtered=False) for t in terms_in]
        return finish(terms, {"status": f"No spaCy model for language '{lang}'; terms passed through unchanged.",
                              "model": None, "merged_by_lemma": 0, "dropped_by_pos": 0, "dropped": []})
    nlp = load_model(model_name)

    # Tag every example segment once.
    texts, seen = [], {}
    for t in terms_in:
        for ex in (t.get("examples") or [])[:EXAMPLES_TO_TAG]:
            if ex not in seen:
                seen[ex] = len(texts)
                texts.append(ex)
    docs = list(nlp.pipe(texts, batch_size=64))

    # Find each term in its examples; terms not found are tagged on their own.
    spans, bare_needed = [], []
    for t in terms_in:
        span = None
        for ex in (t.get("examples") or [])[:EXAMPLES_TO_TAG]:
            hit = find_in(ex, t["term"])
            if hit:
                span = docs[seen[ex]].char_span(hit[0], hit[1], alignment_mode="expand")
                if span is not None and len(span):
                    break
                span = None
        spans.append(span)
        if span is None:
            bare_needed.append(t["term"])
    bare = {term: doc[:] for term, doc in zip(bare_needed, nlp.pipe(bare_needed, batch_size=256))}

    # Filter, then group by lemma. Stage 1's terms arrive best first, so the
    # first form of each lemma stays; the others become its merged variants.
    groups, order, dropped, in_context = {}, [], [], 0
    for t, span in zip(terms_in, spans):
        if span is None:
            span = bare[t["term"]]
        else:
            in_context += 1
        pos = " ".join(tok.pos_ for tok in span)
        reason = verdict(span)
        if reason:
            dropped.append({"term": t["term"], "pos": pos, "reason": reason})
            continue

        key, singular = lemma_key(span), is_singular(span)
        host = groups.get(key)
        if host is None:
            t = dict(t, pos=pos, pos_filtered=True,
                     lemma=t["term"] if singular else nouns_lemmatised(span, t["term"]),
                     merged_variants=list(t.get("merged_variants") or []),
                     examples=list(t.get("examples") or []))
            t["_lemma_from_corpus"] = singular
            groups[key] = t
            order.append(key)
            continue

        # Counts are added up. A segment holding both forms counts twice, so
        # `segments` is an upper bound for merged terms.
        host["occurrences"] += t["occurrences"]
        host["segments"] += t["segments"]
        host["source_types"] = sorted(set(host.get("source_types") or []) | set(t.get("source_types") or []))
        host["sources"] = sorted(set(host.get("sources") or []) | set(t.get("sources") or []))
        if singular and not host["_lemma_from_corpus"]:
            host["lemma"], host["_lemma_from_corpus"] = t["term"], True
        host["merged_variants"].append("(lemma) " + t["term"])
        host["merged_variants"].extend(t.get("merged_variants") or [])
        for ex in t.get("examples") or []:
            if len(host["examples"]) < keep_examples and ex not in host["examples"]:
                host["examples"].append(ex)

    terms = []
    for i, key in enumerate(order):
        t = groups[key]
        del t["_lemma_from_corpus"]
        t["rank"] = i + 1
        terms.append(t)

    return finish(terms, {
        "status": f"Lemmatised and POS-filtered with spaCy {spacy.__version__}.",
        "model": f"{model_name} {nlp.meta.get('version', '')}",
        "tagged_in_context": in_context,
        "tagged_alone": len(terms_in) - in_context,
        "merged_by_lemma": len(terms_in) - len(dropped) - len(terms),
        "dropped_by_pos": len(dropped),
        "dropped": dropped,
    })


# ---- the server ------------------------------------------------------------

def get_key():
    key = os.environ.get("STAGE2_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.exists():
        return KEY_FILE.read_text().strip()
    key = secrets.token_urlsafe(32)
    KEY_FILE.write_text(key + "\n")
    return key


KEY = get_key()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        # Health check: no data, no key needed.
        self.reply(200, {"ok": True, "service": "terminology stage 2"})

    def do_POST(self):
        if self.path.rstrip("/") != "/stage2":
            return self.reply(404, {"error": "Not found. POST to /stage2."})
        if not hmac.compare_digest(self.headers.get("X-Stage2-Key", "").encode(), KEY.encode()):
            return self.reply(401, {"error": "Missing or wrong X-Stage2-Key header."})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            if not isinstance(data, dict) or "stage1" not in data:
                return self.reply(400, {"error": "Body must be the output of the 'Stage 2 input' node."})
            with _lock:
                result = refine(data)
        except Exception as e:  # reported back to n8n; the job then skips stage 2
            return self.reply(500, {"error": f"{type(e).__name__}: {e}"})
        s2 = result["log"]["stage_2"]
        print(f"Job done: {s2['terms_in']} terms in, {s2['terms_out']} out. {s2['status']}", flush=True)
        self.reply(200, result)

    def log_message(self, fmt, *args):
        pass  # one line per job (above) is enough


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Stage 2 server running on http://localhost:{PORT}")
    print(f"Key for n8n's 'X-Stage2-Key' credential: {KEY}")
    print("Leave this window open. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
