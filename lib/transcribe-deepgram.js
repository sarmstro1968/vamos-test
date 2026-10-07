'use strict';
// Speech-to-text connector. Swap this file to change transcription provider.
// The audio is streamed straight through to Deepgram and never written to disk.

async function transcribe(audioStream, contentType, keyterms) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set');
  const qs = new URLSearchParams({ model: 'nova-3', smart_format: 'true', paragraphs: 'true' });
  for (const k of keyterms || []) qs.append('keyterm', k);

  const r = await fetch('https://api.deepgram.com/v1/listen?' + qs.toString(), {
    method: 'POST',
    headers: {
      Authorization: 'Token ' + key,
      'Content-Type': contentType || 'application/octet-stream'
    },
    body: audioStream,
    duplex: 'half'
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = {}; }
  if (!r.ok) {
    const err = new Error('Transcription failed (' + r.status + '): ' + (data.err_msg || data.message || text.slice(0, 200)));
    err.status = 502;
    throw err;
  }
  const alt = (((data.results || {}).channels || [])[0] || {}).alternatives;
  const first = (alt && alt[0]) || {};
  return {
    text: first.transcript || '',
    formatted: ((first.paragraphs && first.paragraphs.transcript) || first.transcript || '').trim(),
    durationSec: Math.round((data.metadata && data.metadata.duration) || 0)
  };
}

module.exports = { transcribe };
