import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MAX_BYTES = 25 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet' };
const GROUPS = [['doc', 'docx', 'odt'], ['xls', 'xlsx', 'ods'], ['ppt', 'pptx', 'odp']];
const TARGETS = [['pdf', 'docx', 'odt'], ['pdf', 'xlsx', 'ods'], ['pdf']];
const ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const FILTERS = { pdf: 'pdf', docx: 'docx:Office Open XML Text', odt: 'odt:writer8', xlsx: 'xlsx:Calc MS Excel 2007 XML', ods: 'ods:calc8' };
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function run(executable, args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', shell: false, detached: process.platform !== 'win32' });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      // Kill the isolated process group as well as any launcher wrapper on Unix.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { child.kill('SIGKILL'); }
    }, timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (expired) reject(new RequestError(504, 'Office-Konvertierung hat das Zeitlimit überschritten.'));
      else if (code !== 0) reject(new RequestError(422, 'Office-Datei konnte nicht konvertiert werden.'));
      else resolve();
    });
  });
}

// Check the ZIP directory before LibreOffice sees the document: reject mismatched
// formats, encrypted archives and archives whose declared expansion exceeds 100 MiB.
function validateInput(bytes, ext) {
  if (['doc', 'xls', 'ppt'].includes(ext)) {
    if (!bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new RequestError(422, 'Ungültige Office-Datei.');
    return;
  }
  const required = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml', odt: 'content.xml', ods: 'content.xml', odp: 'content.xml' }[ext];
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  const invalid = () => { throw new RequestError(422, 'Ungültige, verschlüsselte oder zu große Office-Datei.'); };
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) invalid();
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16), expanded = 0;
  const names = new Set();
  let odfMime;
  if (!count || count > 10000 || cursor + bytes.readUInt32LE(end + 12) !== end) invalid();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50 || bytes.readUInt16LE(cursor + 8) & 1) invalid();
    expanded += bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (next > end || expanded > 100 * 1024 * 1024) invalid();
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (name.startsWith('/') || name.includes('..') || name.includes('\\')) invalid();
    names.add(name);
    if (name === 'mimetype') {
      const offset = bytes.readUInt32LE(cursor + 42);
      if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) invalid();
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      const finish = start + bytes.readUInt32LE(cursor + 20);
      if (finish > bytes.length || finish - start > 1024) invalid();
      try {
        const method = bytes.readUInt16LE(cursor + 10);
        if (![0, 8].includes(method)) invalid();
        odfMime = (method === 8 ? inflateRawSync(bytes.subarray(start, finish), { maxOutputLength: 200 }) : bytes.subarray(start, finish)).toString();
      } catch { invalid(); }
    }
    cursor = next;
  }
  if (cursor !== end || !names.has(required) || (!names.has('[Content_Types].xml') && !names.has('mimetype'))) invalid();
  const expectedMime = { odt: 'text', ods: 'spreadsheet', odp: 'presentation' }[ext];
  if (expectedMime && odfMime !== `application/vnd.oasis.opendocument.${expectedMime}`) invalid();
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BYTES) throw new RequestError(413, 'Maximal 25 MB pro Datei.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new RequestError(413, 'Maximal 25 MB pro Datei.');
    chunks.push(chunk);
  }
  if (!size) throw new RequestError(400, 'Die Datei ist leer.');
  return Buffer.concat(chunks);
}

export async function createOfficeServer({ executable = process.env.SOFFICE_PATH || 'soffice' } = {}) {
  let available = false;
  try { await run(executable, ['--version'], 10000); available = true; } catch { /* Status reports missing or unusable executable. */ }
  let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let directory;
    let acquired = false;
    try {
      const port = server.address()?.port;
      if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) throw new RequestError(403, 'Nicht erlaubter Host.');
      if (req.headers.origin && !ORIGINS.has(req.headers.origin)) throw new RequestError(403, 'Nicht erlaubter Ursprung.');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/office/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available }));
        return;
      }
      if (url.pathname !== '/api/office/convert') throw new RequestError(404, 'Nicht gefunden.');
      if (req.method !== 'POST') throw new RequestError(405, 'POST erforderlich.');
      const ext = url.searchParams.get('ext'), target = url.searchParams.get('target');
      const group = GROUPS.findIndex((formats) => formats.includes(ext));
      if (group < 0 || !TARGETS[group].includes(target) || ext === target) throw new RequestError(400, 'Nicht unterstützte Konvertierung.');
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') throw new RequestError(415, 'Binäre Datei als application/octet-stream erforderlich.');
      if (!available) throw new RequestError(503, 'LibreOffice ist lokal nicht verfügbar.');
      if (active >= 2) throw new RequestError(429, 'Office-Dienst ist ausgelastet. Bitte später erneut versuchen.');
      active++; acquired = true;
      const bytes = await readBody(req);
      validateInput(bytes, ext);
      directory = await mkdtemp(path.join(tmpdir(), 'local-office-'));
      const profile = path.join(directory, 'profile');
      const output = path.join(directory, 'output');
      await mkdir(path.join(profile, 'user'), { recursive: true });
      await mkdir(output);
      await writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
      const input = path.join(directory, `input.${ext}`);
      await writeFile(input, bytes, { mode: 0o600 });
      await run(executable, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard', '--convert-to', FILTERS[target], '--outdir', output, input]);
      const converted = path.join(output, `input.${target}`);
      let info;
      try { info = await stat(converted); } catch { throw new RequestError(422, 'Datei ist beschädigt, geschützt oder nicht konvertierbar.'); }
      if (!info.isFile() || !info.size) throw new RequestError(422, 'Office hat keine gültige Ausgabedatei erstellt.');
      if (info.size > MAX_BYTES) throw new RequestError(413, 'Die Ausgabedatei überschreitet 25 MB.');
      const result = await readFile(converted);
      if (target === 'pdf' && result.subarray(0, 5).toString() !== '%PDF-') throw new RequestError(422, 'Ungültige PDF-Ausgabe.');
      if (target !== 'pdf') validateInput(result, target);
      res.writeHead(200, { 'Content-Type': MIME[target], 'Content-Length': result.length, 'Content-Disposition': `attachment; filename="converted.${target}"` });
      res.end(result);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(error instanceof RequestError ? error.status : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof RequestError ? error.message : 'Office-Konvertierung fehlgeschlagen.' }));
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      if (acquired) active--;
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.timeout = 65000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await createOfficeServer();
  server.listen(8787, '127.0.0.1', () => console.log('Lokaler Office-Dienst: http://127.0.0.1:8787'));
  server.on('error', () => { console.error('Office-Dienst konnte nicht gestartet werden (Port 8787).'); process.exitCode = 1; });
}
