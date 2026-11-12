// n8n Code node: "Stage 2 skipped"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Runs only when "Stage 2 NLP" gets no good answer from the stage 2 server on
// your machine (machine off, server or tunnel not running, tunnel address
// changed, wrong key). Passes stage 1's terms through unchanged so the job
// still finishes; the reason goes into the run manifest and the job's note.
const { stage1 } = $('Stage 2 input').first().json;
const err = $input.first().json.error;
const reason = (err && (err.message || err.description)) || String(err || 'no answer');
const terms = (stage1.terms || []).map((t) => ({ ...t, lemma: null, pos: null, pos_filtered: false }));

return [{
  json: {
    ...stage1,
    stage: 'stage_2_skipped',
    log: {
      ...stage1.log,
      stage_2: {
        skipped: true,
        status: `Skipped: the stage 2 server didn't answer (${reason}). Terms passed through unchanged.`,
        terms_in: terms.length,
        terms_out: terms.length,
        merged_by_lemma: 0,
        dropped_by_pos: 0,
        dropped: [],
      },
    },
    terms,
  },
}];
