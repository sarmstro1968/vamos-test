'use strict';
// Finds spoken macro phrases in a transcript. Fuzzy, so small transcription
// slips ("initiate sale sequence bravo") still count.

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

// Returns one hit per macro whose phrase was heard, best match only.
function findMacros(transcript, macros, threshold = 0.82) {
  const words = normalize(transcript).split(' ').filter(Boolean);
  const hits = [];
  for (const m of macros) {
    const phrase = normalize(m.phrase);
    const n = phrase.split(' ').length;
    let best = { score: 0, index: 0, len: n, heard: '' };
    for (const len of [n - 1, n, n + 1]) {
      if (len < 1) continue;
      for (let i = 0; i + len <= words.length; i++) {
        const win = words.slice(i, i + len).join(' ');
        if (Math.abs(win.length - phrase.length) > phrase.length * 0.4) continue;
        const score = 1 - levenshtein(win, phrase) / Math.max(win.length, phrase.length);
        if (score > best.score) best = { score, index: i, len, heard: win };
      }
    }
    if (best.score >= threshold) {
      const from = Math.max(0, best.index - 8);
      const to = Math.min(words.length, best.index + best.len + 8);
      hits.push({
        id: m.id,
        label: m.label,
        description: m.description || '',
        heard: best.heard,
        context: words.slice(from, to).join(' '),
        score: Math.round(best.score * 100) / 100
      });
    }
  }
  return hits;
}

module.exports = { findMacros, normalize, levenshtein };
