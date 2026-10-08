'use strict';
// EXEQ proof of concept (formerly VAMOS). No dependencies: needs Node 18 or newer.
// Keys are read from environment variables and never appear in this code.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const crm = require('./lib/crm-ghl');
const { transcribe } = require('./lib/transcribe-deepgram');
const { findMacros } = require('./lib/macros');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.VAMOS_PASSCODE || '';
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;
const NOTE_CHUNK = 50000;

const MACROS = JSON.parse(fs.readFileSync(path.join(__dirname, 'macros.json'), 'utf8'));
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));

// Home-screen install files (icon and app manifest). Fixed list, nothing else is served.
const STATIC = {
  '/manifest.webmanifest': 'application/manifest+json',
  '/icon-192.png': 'image/png',
  '/icon-512.png': 'image/png',
  '/apple-touch-icon.png': 'image/png'
};
const STATIC_FILES = {};
for (const name of Object.keys(STATIC)) STATIC_FILES[name] = fs.readFileSync(path.join(__dirname, 'public', name));

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function authed(req) {
  if (!PASSCODE) return false;
  const given = String(req.headers['x-vamos-passcode'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(PASSCODE).digest();
  return crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const parts = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 100000) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function splitText(text, size) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

async function saveTranscript(contactId, result) {
  const when = new Date().toLocaleString('en-US', { timeZone: process.env.VAMOS_TIMEZONE || 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
  const mins = Math.max(1, Math.round(result.durationSec / 60));
  const head = 'EXEQ meeting transcript\n' + when + ' · about ' + mins + ' min\nRecording consent confirmed in the app.\n\n';
  const chunks = splitText(result.formatted, NOTE_CHUNK);
  // Newest notes show first in the CRM, so save the last part first.
  for (let i = chunks.length - 1; i >= 0; i--) {
    const label = chunks.length > 1 ? '(part ' + (i + 1) + ' of ' + chunks.length + ')\n' : '';
    await crm.addNote(contactId, (i === 0 ? head : 'EXEQ meeting transcript, continued\n') + label + chunks[i]);
  }
  return chunks.length;
}

async function handleProcess(req, res, url) {
  const contactId = url.searchParams.get('contactId') || '';
  if (url.searchParams.get('consent') !== '1') return send(res, 400, { error: 'Recording consent must be confirmed first.' });
  if (!/^[A-Za-z0-9]{8,40}$/.test(contactId)) return send(res, 400, { error: 'Pick a customer first.' });
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_AUDIO_BYTES) return send(res, 413, { error: 'Recording is too large.' });

  const result = await transcribe(Readable.toWeb(req), req.headers['content-type'], MACROS.map(function (m) { return m.phrase; }));
  if (!result.text.trim()) return send(res, 422, { error: 'No speech was detected in the recording.' });

  let notesSaved = 0;
  let noteError = '';
  try { notesSaved = await saveTranscript(contactId, result); }
  catch (e) { noteError = e.message; }

  send(res, 200, {
    transcript: result.formatted,
    durationSec: result.durationSec,
    notesSaved: notesSaved,
    noteError: noteError,
    macros: findMacros(result.text, MACROS)
  });
}

function cleanPhone(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (text.charAt(0) === '+' && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return null;
}

async function handleNewContact(req, res) {
  const body = await readJson(req);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(body.email || '').trim().toLowerCase();
  const company = String(body.company || '').trim().replace(/\s+/g, ' ');
  const phone = cleanPhone(body.phone);
  if (name.length < 2 || name.length > 100) return send(res, 400, { error: 'Enter the contact\'s name.' });
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  if (phone === null) return send(res, 400, { error: 'Enter a 10-digit phone number, or leave it blank.' });
  if (company.length > 150) return send(res, 400, { error: 'Business name is too long.' });
  const result = await crm.createContact({ name: name, email: email, phone: phone, company: company });
  send(res, 200, result);
}

async function handleConfirm(req, res) {
  const body = await readJson(req);
  const macro = MACROS.find(function (m) { return m.id === body.macroId; });
  if (!macro) return send(res, 400, { error: 'Unknown macro.' });
  await crm.addTag(body.contactId, macro.tag);
  let noteError = '';
  const how = body.manual === true ? 'started by hand, with no recording' : 'confirmed by the salesman';
  try { await crm.addNote(body.contactId, 'EXEQ: "' + macro.label + '" ' + how + '. Tag ' + macro.tag + ' added.'); }
  catch (e) { noteError = e.message; }
  send(res, 200, { ok: true, label: macro.label, tag: macro.tag, noteError: noteError });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(INDEX);
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      res.writeHead(200, { 'Content-Type': STATIC[url.pathname], 'Cache-Control': 'public, max-age=3600' });
      return res.end(STATIC_FILES[url.pathname]);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    if (!PASSCODE) return send(res, 500, { error: 'Server is missing VAMOS_PASSCODE.' });
    if (!authed(req)) return send(res, 401, { error: 'Wrong passcode.' });

    if (req.method === 'GET' && url.pathname === '/api/macros') {
      return send(res, 200, { macros: MACROS.map(function (m) { return { id: m.id, label: m.label, phrase: m.phrase, description: m.description || '' }; }) });
    }
    if (req.method === 'GET' && url.pathname === '/api/contacts') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return send(res, 200, { contacts: [] });
      return send(res, 200, { contacts: await crm.searchContacts(q) });
    }
    if (req.method === 'POST' && url.pathname === '/api/contacts') return await handleNewContact(req, res);
    if (req.method === 'POST' && url.pathname === '/api/process') return await handleProcess(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/confirm') return await handleConfirm(req, res);
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Something went wrong.' });
    else res.end();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60000;
server.listen(PORT, function () { console.log('EXEQ listening on port ' + PORT); });
