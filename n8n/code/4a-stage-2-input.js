// n8n Code node: "Stage 2 input"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// Bundles what the stage 2 server needs (stage 1's terms and the job's
// language) into one item, which "Stage 2 NLP" sends as the request body.
// Its direct input here would be the stage 1 spreadsheet.
const settings = $('Settings').first().json;
return [{
  json: {
    stage1: $('Stage 1 statistical extraction').first().json,
    source_lang: settings.source_lang,
    include_examples: settings.include_examples,
  },
}];
