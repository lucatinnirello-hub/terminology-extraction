// n8n Code node: "Parse wildcard check"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// The model's JSON reply, from the Google Gemini node ("Simplify Output" on
// or off) or an Anthropic-style reply. { parsed } or { error }.
function readReply(response) {
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] || {} : response;
  let text = '';
  if (candidate.content && Array.isArray(candidate.content.parts)) {
    text = candidate.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  } else if (Array.isArray(response.content)) {
    text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } else if (typeof response.text === 'string') {
    text = response.text;
  }
  const finish = String(candidate.finishReason || '');
  if (finish === 'MAX_TOKENS') return { error: 'Reply was cut off: raise "Maximum Number of Tokens" on the AI node.' };
  if (finish && finish !== 'STOP') return { error: `The model stopped early (${finish}).` };
  try {
    return { parsed: JSON.parse(text.replace(/```json|```/g, '').trim()) };
  } catch (e) {
    return { error: `Could not parse the reply: ${e.message}` };
  }
}

const sent = $('Build check request').first().json.items;
const reply = readReply($input.first().json);
if (reply.error) return sent.map((t) => ({ json: { id: t.id, check_error: reply.error } }));

const byId = new Map((reply.parsed.results || []).map((r) => [String(r.id), r]));
return sent.map((t) => {
  const r = byId.get(String(t.id));
  if (!r) return { json: { id: t.id, check_error: 'no answer for this term' } };
  const forms = Array.isArray(r.forms) ? r.forms.filter((f) => typeof f === 'string' && f.trim()).slice(0, 30) : [];
  const corrected = r.verdict !== 'confirmed';
  if (corrected && !forms.length) return { json: { id: t.id, check_error: 'corrected, but no forms given' } };
  return {
    json: {
      id: t.id,
      ai_verdict: corrected ? 'corrected' : 'confirmed',
      ai_forms: corrected ? forms : [],
      ai_note: String(r.note || ''),
      term_suggestion: String(r.term_suggestion || '').trim(),
    },
  };
});
