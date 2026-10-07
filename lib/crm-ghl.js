'use strict';
// CRM connector for GoHighLevel. VAMOS only needs these three calls from any
// CRM, so supporting another CRM means writing another file with this shape.

const BASE = 'https://services.leadconnectorhq.com';
const ID_RE = /^[A-Za-z0-9]{8,40}$/;

async function call(method, path, body) {
  const token = process.env.GHL_TOKEN;
  if (!token) throw new Error('GHL_TOKEN is not set');
  const headers = { Authorization: 'Bearer ' + token, Version: '2021-07-28', Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('; ') : (data.message || text.slice(0, 200));
    const err = new Error('CRM error (' + r.status + '): ' + msg);
    err.status = 502;
    throw err;
  }
  return data;
}

function checkId(id) {
  if (!ID_RE.test(String(id || ''))) {
    const err = new Error('Invalid contact id');
    err.status = 400;
    throw err;
  }
  return id;
}

async function searchContacts(query) {
  const loc = process.env.GHL_LOCATION_ID;
  if (!loc) throw new Error('GHL_LOCATION_ID is not set');
  const qs = new URLSearchParams({ locationId: loc, query: query, limit: '10' });
  const data = await call('GET', '/contacts/?' + qs.toString());
  return (data.contacts || []).map(function (c) {
    const name = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Unnamed contact';
    return { id: c.id, name: name, email: c.email || '', phone: c.phone || '' };
  });
}

async function addNote(contactId, text) {
  await call('POST', '/contacts/' + checkId(contactId) + '/notes', { body: text });
}

async function addTag(contactId, tag) {
  await call('POST', '/contacts/' + checkId(contactId) + '/tags', { tags: [tag] });
}

module.exports = { searchContacts, addNote, addTag };
