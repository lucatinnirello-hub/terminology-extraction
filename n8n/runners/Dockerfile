# n8n task runner image with spaCy, for the "Stage 2 NLP" Python Code node.
#
#   docker build -t n8n-runners-spacy:2.45.5 --build-arg N8N_VERSION=2.45.5 n8n/runners
#
# N8N_VERSION must match your n8n version exactly: rebuild on every n8n upgrade.

ARG N8N_VERSION=2.45.5
FROM n8nio/runners:${N8N_VERSION}

# One model per language you extract from. Keep in step with MODELS in
# n8n/code/4b-stage-2-nlp.py; a language whose model is missing here passes
# through stage 2 unchanged. Drop the ones you never use to save ~20-40 MB each.
ARG SPACY_MODELS="en_core_web_sm de_core_news_sm fr_core_news_sm es_core_news_sm it_core_news_sm pt_core_news_sm nl_core_news_sm da_core_news_sm sv_core_news_sm nb_core_news_sm fi_core_news_sm pl_core_news_sm ro_core_news_sm hr_core_news_sm lt_core_news_sm sl_core_news_sm"
# Model releases must match spaCy's minor version (3.8.x models for spaCy 3.8).
ARG SPACY_MODELS_VERSION=3.8.0

USER root

# The runner image ships uv, not pip, so `python -m spacy download` doesn't
# work; models are installed from their release wheels instead.
RUN cd /opt/runners/task-runner-python && \
    uv pip install "spacy>=3.8,<3.9" && \
    for m in $SPACY_MODELS; do \
      uv pip install "https://github.com/explosion/spacy-models/releases/download/${m}-${SPACY_MODELS_VERSION}/${m}-${SPACY_MODELS_VERSION}-py3-none-any.whl" || exit 1; \
    done

# Let Code nodes `import spacy` (blocked unless allow-listed).
COPY allow-spacy.py /tmp/allow-spacy.py
RUN /opt/runners/task-runner-python/.venv/bin/python /tmp/allow-spacy.py /etc/n8n-task-runners.json && \
    rm /tmp/allow-spacy.py

USER runner
