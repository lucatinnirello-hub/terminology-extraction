# n8n Code node: "Stage 2 NLP"
# Language: Python. Mode: Run Once for All Items.
# Paste this whole file into that node, replacing everything in it.
# (Copy of the code in Terminology_extraction_webhook_v4.json.)
#
# ===========================================================================
# STAGE 2: lemmatisation and part-of-speech filtering, with spaCy.
#
# Runs after the JavaScript stage 1 and refines its candidates:
#   1. Drops candidates that aren't term-shaped: no noun at all
#      ("inspected annually"), a finite verb or auxiliary inside, or a
#      leading verb ("replace filter").
#   2. Groups inflected forms ("valve" / "valves") under one lemma and adds
#      up their occurrences and segment counts.
#   3. Sets `lemma`, `pos` and `pos_filtered` on each term. `lemma` is the
#      group's singular form as found in the corpus ("valve" for "valves"),
#      or, if only plurals occur, the term with its nouns lemmatised.
#
# Each term is tagged where it occurs in one of its example segments, so
# spaCy sees the sentence around it. Without a match it tags the term alone.
#
# Needs the custom runner image in n8n/runners/ (spaCy plus the models).
# If the job's language has no model installed, terms pass through
# unchanged and the run manifest's stage_2.status says why.
#
# Input: one item from "Stage 2 input" ({ stage1, source_lang, include_examples }).
# Output: stage 1's shape, { stage, log, terms, rows, ... }.
# Uses only spaCy: the runner allows no standard-library modules by default.
# ===========================================================================

import spacy

# --- EDITABLE: spaCy model per language -------------------------------------
# Keys are the stopword-list codes the page sends ('no' is Norwegian Bokmål).
# Every model listed here must also be installed in the runner image
# (SPACY_MODELS in n8n/runners/Dockerfile). Languages with no spaCy model
# (cz, sk, hu, et, lv, tr, id...) pass through unchanged.
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

data = _items[0]["json"]
stage1 = data["stage1"]
lang = str(data.get("source_lang") or "").lower()
keep_examples = data.get("include_examples")
if keep_examples is None:
    keep_examples = 3
terms_in = stage1.get("terms") or []


def to_rows(terms):
    # Same columns as stage 1's rows.
    rows = []
    for t in terms:
        rows.append({
            "rank": t["rank"],
            "term": t["term"],
            "word_count": t["word_count"],
            "yake_score": t["yake_score"],
            "occurrences": t["occurrences"],
            "segments": t["segments"],
            "source_types": " | ".join(t.get("source_types") or []),
            "merged_variants": " | ".join(t.get("merged_variants") or []),
            "examples": " | ".join(t.get("examples") or []),
            "definition": "",
            "translation": "",
        })
    return rows


def finish(terms, stage_2_log):
    stage_2_log["terms_in"] = len(terms_in)
    stage_2_log["terms_out"] = len(terms)
    log = dict(stage1.get("log") or {})
    log["stage_2"] = stage_2_log
    out = dict(stage1)
    out["stage"] = "stage_2_nlp"
    out["log"] = log
    out["terms"] = terms
    out["rows"] = to_rows(terms)
    return [{"json": out}]


def pass_through(status):
    terms = []
    for t in terms_in:
        t = dict(t)
        t["lemma"] = None
        t["pos"] = None
        t["pos_filtered"] = False
        terms.append(t)
    return finish(terms, {
        "status": status,
        "model": None,
        "merged_by_lemma": 0,
        "dropped_by_pos": 0,
        "dropped": [],
    })


def is_word_char(ch):
    return ch.isalnum() or ch == "_"


def find_in(text, term):
    # Character offsets of `term` in `text`, case-insensitive, whole words only.
    hay = text.lower()
    needle = term.lower()
    start = hay.find(needle)
    while start != -1:
        end = start + len(needle)
        before_ok = start == 0 or not is_word_char(hay[start - 1])
        after_ok = end == len(hay) or not is_word_char(hay[end])
        if before_ok and after_ok:
            return start, end
        start = hay.find(needle, start + 1)
    return None


def verb_forms(token):
    return token.morph.get("VerbForm")


def verdict(span):
    # None if the span is term-shaped, otherwise the reason to drop it.
    tokens = [t for t in span if not t.is_punct and not t.is_space]
    if not tokens:
        return "no words"
    if not any(t.pos_ in ("NOUN", "PROPN") for t in tokens):
        return "no noun"
    for t in tokens:
        if t.pos_ == "AUX":
            return "auxiliary verb '" + t.text + "'"
        if t.pos_ == "VERB" and "Fin" in verb_forms(t):
            return "finite verb '" + t.text + "'"
    first = tokens[0]
    if first.pos_ == "VERB" and not any(f in verb_forms(first) for f in MODIFIER_VERB_FORMS):
        return "starts with verb '" + first.text + "'"
    return None


def lemma_key(span):
    # Every word lemmatised: the key that groups inflected forms.
    return " ".join((t.lemma_ or t.text).lower() for t in span if not t.is_space)


def is_singular(span):
    return not any("Plur" in t.morph.get("Number") for t in span if t.pos_ in ("NOUN", "PROPN"))


def nouns_lemmatised(span, term):
    # Fallback citation form when only plural forms were found: nouns
    # lemmatised, other words as written. Lemmatising every word mangles
    # terms ("cutting tools" -> "cut tool"; adjectives lose agreement in
    # German and Romance languages).
    text = ""
    for t in span:
        word = (t.lemma_ or t.text) if t.pos_ in ("NOUN", "PROPN") else t.text
        text += word + t.whitespace_
    text = text.strip()
    # The span keeps the example's casing ("Cutting" at a sentence start);
    # follow the term's own instead.
    return text.lower() if term == term.lower() else text


# ---- load the model --------------------------------------------------------
model_name = MODELS.get(lang)
if not model_name:
    return pass_through("No spaCy model configured for language '" + lang + "'; terms passed through unchanged.")
if not spacy.util.is_package(model_name):
    return pass_through("spaCy model " + model_name + " is not installed in the runner image; terms passed through unchanged.")

nlp = spacy.load(model_name)
unused = [p for p in ("parser", "ner") if p in nlp.pipe_names]
if unused:
    nlp.select_pipes(disable=unused)

# ---- tag every example segment once ----------------------------------------
texts = []
seen = {}
for t in terms_in:
    for ex in (t.get("examples") or [])[:EXAMPLES_TO_TAG]:
        if ex not in seen:
            seen[ex] = len(texts)
            texts.append(ex)
docs = list(nlp.pipe(texts, batch_size=64))

# Terms with no usable example are tagged on their own, in one batch.
bare_needed = []
spans = []
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

bare = {}
for term, doc in zip(bare_needed, nlp.pipe(bare_needed, batch_size=256)):
    bare[term] = doc[:]

# ---- filter, then group by lemma -------------------------------------------
# Stage 1's terms arrive best first, so the first form of each lemma is
# the one that stays; the others become its merged variants.
groups = {}
order = []
dropped = []
tagged_in_context = 0
for t, span in zip(terms_in, spans):
    if span is None:
        span = bare[t["term"]]
    else:
        tagged_in_context += 1
    pos = " ".join(tok.pos_ for tok in span)
    reason = verdict(span)
    if reason:
        dropped.append({"term": t["term"], "pos": pos, "reason": reason})
        continue

    key = lemma_key(span)
    singular = is_singular(span)
    host = groups.get(key)
    if host is None:
        t = dict(t)
        t["lemma"] = t["term"] if singular else nouns_lemmatised(span, t["term"])
        t["lemma_from_corpus"] = singular
        t["pos"] = pos
        t["pos_filtered"] = True
        t["merged_variants"] = list(t.get("merged_variants") or [])
        t["examples"] = list(t.get("examples") or [])
        groups[key] = t
        order.append(key)
        continue

    # Counts are added up. A segment holding both forms counts twice, so
    # `segments` is an upper bound for merged terms.
    host["occurrences"] += t["occurrences"]
    host["segments"] += t["segments"]
    host["source_types"] = sorted(set(host.get("source_types") or []) | set(t.get("source_types") or []))
    host["sources"] = sorted(set(host.get("sources") or []) | set(t.get("sources") or []))
    if singular and not host["lemma_from_corpus"]:
        host["lemma"] = t["term"]
        host["lemma_from_corpus"] = True
    host["merged_variants"].append("(lemma) " + t["term"])
    host["merged_variants"].extend(t.get("merged_variants") or [])
    for ex in t.get("examples") or []:
        if len(host["examples"]) < keep_examples and ex not in host["examples"]:
            host["examples"].append(ex)

terms = []
for i, key in enumerate(order):
    t = groups[key]
    t.pop("lemma_from_corpus")
    t["rank"] = i + 1
    terms.append(t)

return finish(terms, {
    "status": "Lemmatised and POS-filtered with spaCy.",
    "model": model_name + " " + str(nlp.meta.get("version") or ""),
    "tagged_in_context": tagged_in_context,
    "tagged_alone": len(terms_in) - tagged_in_context,
    "merged_by_lemma": len(terms_in) - len(dropped) - len(terms),
    "dropped_by_pos": len(dropped),
    "dropped": dropped,
})
