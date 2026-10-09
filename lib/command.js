'use strict';
// Voice commands: "Send Ian Armstrong the onboarding sequence."
// Finds which macro was named, and treats the words that are left as the person's name.

const { normalize, levenshtein } = require('./macros');

// Words that carry no name or macro meaning in a spoken command.
const FILLER = new Set(('send run start initiate execute trigger kick off launch begin fire please the a an to for on ' +
  'with and sequence macro workflow automation exeq hey ok okay now him her them their his our my go ahead can you ' +
  'could would i want need like lets let us do just over out of s this that new also then to too').split(' '));

function similarity(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// The spoken names a macro answers to. "commands" in macros.json wins; otherwise
// use the label and the meeting phrase without its leading verb.
function commandTerms(m) {
  const terms = (m.commands && m.commands.length ? m.commands : [m.label, m.phrase.replace(/^\s*(initiate|start|run|execute)\s+/i, '')])
    .map(normalize).filter(Boolean);
  return Array.from(new Set(terms));
}

// Best place a term appears in the word list, allowing small transcription slips.
function bestWindow(words, term) {
  const n = term.split(' ').length;
  let best = null;
  for (const len of [n - 1, n, n + 1]) {
    if (len < 1) continue;
    for (let i = 0; i + len <= words.length; i++) {
      const win = words.slice(i, i + len).join(' ');
      const score = similarity(win, term);
      if (!best || score > best.score) best = { score, index: i, len };
    }
  }
  return best;
}

function parseCommand(text, macros) {
  const words = normalize(text).split(' ').filter(Boolean);
  let pick = null;
  for (const m of macros) {
    for (const term of commandTerms(m)) {
      const w = bestWindow(words, term);
      if (!w) continue;
      // One short word ("bravo") has to be nearly exact; longer terms may slip a little.
      const need = term.indexOf(' ') < 0 ? (term.length < 4 ? 1 : 0.85) : 0.8;
      if (w.score < need) continue;
      // Prefer the stronger match, then the longer term.
      const rank = w.score * 100 + term.length / 100;
      if (!pick || rank > pick.rank) pick = { macro: m, rank, index: w.index, len: w.len, score: w.score };
    }
  }
  const rest = pick ? words.slice(0, pick.index).concat(words.slice(pick.index + pick.len)) : words;
  let left = rest.filter(function (w, i, a) { return !FILLER.has(w) && w !== a[i - 1]; });
  // A repeated name ("Ian Armstrong ... Ian Armstrong") counts once.
  const half = left.length / 2;
  if (half >= 1 && left.slice(0, half).join(' ') === left.slice(half).join(' ')) left = left.slice(0, half);
  const name = left.join(' ');
  return { heard: text.trim(), macro: pick ? pick.macro : null, name: name };
}

// Score CRM contacts against the spoken name, best first.
function rankContacts(name, contacts) {
  const said = normalize(name);
  const saidWords = said.split(' ').filter(Boolean);
  return contacts.map(function (c) {
    const full = normalize(c.name);
    const theirs = full.split(' ').filter(Boolean);
    // Word by word, so "Ian Armstrong" still fits "Ian M Armstrong".
    const perWord = saidWords.length ? saidWords.reduce(function (sum, w) {
      return sum + Math.max.apply(null, theirs.map(function (t) { return similarity(w, t); }).concat([0]));
    }, 0) / saidWords.length : 0;
    // Average of whole-name and word-by-word, so "Sean" does not pass for "Ian".
    const score = (similarity(said, full) + perWord) / 2;
    return Object.assign({}, c, { score: Math.round(score * 100) / 100 });
  }).sort(function (a, b) { return b.score - a.score; });
}

module.exports = { parseCommand, rankContacts, commandTerms };
