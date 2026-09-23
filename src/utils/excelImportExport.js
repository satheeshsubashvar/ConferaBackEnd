// Shared "download template / export / import" plumbing for every
// Admin list that supports bulk Excel add — Exhibitor Manager, Sponsor
// Manager, Announcements, Meet-ups, Discussion Topics, Social Groups,
// and Surveys. Speaker Center pioneered this pattern (see
// routes/speakerCenter.js); this module is the same logic pulled out
// so the other seven features don't each re-implement it.
//
// The exported ".xls" is really an HTML <table> wearing an .xls
// extension — Excel opens that fine, and it's simple enough to both
// write and parse reliably. extractRows() below additionally handles
// a REAL binary spreadsheet (via SheetJS), which is what you get back
// if someone opens our .xls in real Excel and hits Save — see the
// comment on extractRows for why that matters.

import * as XLSX from 'xlsx';

export function excelCell(value) {
  const text = value == null ? '' : String(value);
  return `<td>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</td>`;
}

// headers: string[]. For a template, `rows` is omitted and a single
// placeholder row is generated instead — `placeholders`, if given,
// lets a column show a more useful hint (e.g. "Yes/No", an example
// date) than just repeating its own header text.
export function buildExcelHtml({ headers, rows, template = false, placeholders }) {
  const body = template
    ? `<tr>${headers.map((h, i) => excelCell(placeholders?.[i] ?? h)).join('')}</tr>`
    : rows.map((r) => `<tr>${r.map(excelCell).join('')}</tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table>
  </body></html>`;
}

function parseDelimited(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((line) => {
    const cells = [];
    let current = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        cells.push(current.trim()); current = '';
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

function parseHtmlTable(text) {
  return [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    )
  );
}

// Turns an uploaded file's raw bytes into an array of row arrays,
// however it was actually saved: a real binary spreadsheet (including
// one that started life as our own HTML-flavored .xls template, then
// got opened and re-saved in real Excel), plain CSV/TSV, or our own
// HTML-table export/template left untouched.
export function extractRows(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (sheetName) {
      const rows = XLSX.utils
        .sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' })
        .map((row) => row.map((cell) => String(cell ?? '').trim()))
        .filter((row) => row.some((cell) => cell !== ''));
      if (rows.length) return rows;
    }
  } catch {
    // Not a format SheetJS recognizes — fall through to the text-based
    // readers below.
  }

  const text = buffer.toString('utf8');
  return /<table/i.test(text) ? parseHtmlTable(text) : parseDelimited(text);
}

// rows[0] is the header row. Returns one plain object per data row,
// keyed by a lowercased/normalized version of each header (e.g. "Push
// Notification (Yes/No)" -> "push notification yes no"), so a lookup
// helper like get(o, 'push notification') can match regardless of
// minor punctuation differences between the template and what someone
// re-typed.
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return rows.slice(1).map((cells) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] || ''; });
    return o;
  });
}

// Reads a field from a row object, trying each candidate header
// (already-normalized, see rowsToObjects) in turn, tolerant of the
// normalized header only starting with the given text — so
// get(o, 'push notification') matches a column normalized to
// "push notification yes no".
export function getCell(o, ...names) {
  for (const name of names) {
    if (o[name]) return o[name];
    const key = Object.keys(o).find((k) => k.startsWith(name));
    if (key && o[key]) return o[key];
  }
  return '';
}

// '' (blank cell) -> undefined, so a caller can fall back to its own
// default (matching how the equivalent "Add" form's own default
// applies when a field is simply omitted from the request body).
// Anything recognizable as yes/no/true/false/1/0 -> that boolean.
export function parseBoolCell(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return undefined;
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return undefined;
}
