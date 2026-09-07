import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createOfficeServer } from './office.mjs';

function fixture(kind) {
  const mime = `application/vnd.oasis.opendocument.${kind}`;
  const body = {
    text: '<office:text><text:p>Local conversion integration test</text:p></office:text>',
    spreadsheet: '<office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>Revenue</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
    presentation: '<office:presentation><draw:page draw:name="Slide1"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="5cm"><draw:text-box><text:p>Local presentation conversion test</text:p></draw:text-box></draw:frame></draw:page></office:presentation>',
  }[kind];
  return zipSync({
    mimetype: [strToU8(mime), { level: 0 }],
    'content.xml': strToU8(`<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:body>${body}</office:body></office:document-content>`),
    'META-INF/manifest.xml': strToU8(`<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`),
  });
}

// Generate legacy and presentation test inputs from the tiny, trusted fixtures;
// the service itself never exposes these extra output formats.
async function exportFixture(kind, ext, filter) {
  const directory = await mkdtemp(path.join(tmpdir(), 'office-test-'));
  try {
    const sourceExt = { text: 'odt', spreadsheet: 'ods', presentation: 'odp' }[kind];
    const source = path.join(directory, `fixture.${sourceExt}`);
    await writeFile(source, fixture(kind));
    await promisify(execFile)(process.env.SOFFICE_PATH || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(path.join(directory, 'profile')).href}`,
      '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard',
      '--convert-to', `${ext}:${filter}`, '--outdir', directory, source,
    ], { timeout: 45000, maxBuffer: 1024 * 1024 });
    return await readFile(path.join(directory, `fixture.${ext}`));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('Local Office service: request guards and real LibreOffice conversions', async (t) => {
  const server = await createOfficeServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const convert = (ext, target, body, headers = {}) => fetch(`${base}/api/office/convert?ext=${ext}&target=${target}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body });
  const status = await (await fetch(`${base}/api/office/status`)).json();
  await t.test('unsupported formats and same-format requests reject', async () => {
    assert.equal((await convert('exe', 'pdf', 'junk')).status, 400);
    assert.equal((await convert('docx', 'docx', 'junk')).status, 400);
    assert.equal((await convert('xlsx', 'csv', 'junk')).status, 400);
  });
  await t.test('foreign origins and hosts reject', async () => {
    assert.equal((await convert('docx', 'pdf', 'junk', { Origin: 'https://untrusted.example' })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      http.get(`${base}/api/office/status`, { headers: { Host: 'untrusted.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
  });
  await t.test('wrong content type rejects', async () => {
    assert.equal((await convert('odt', 'pdf', 'junk', { 'Content-Type': 'text/plain' })).status, 415);
  });
  await t.test('LibreOffice is available for integration tests', () => {
    assert.equal(status.available, true, 'BLOCKED: install LibreOffice or set SOFFICE_PATH; real integration verification requires it.');
  });
  if (!status.available) return;
  await t.test('empty, invalid and mismatched inputs reject', async () => {
    assert.equal((await convert('odt', 'pdf', '')).status, 400);
    assert.equal((await convert('docx', 'pdf', 'junk')).status, 422);
    assert.equal((await convert('docx', 'pdf', fixture('text'))).status, 422);
    assert.equal((await convert('ods', 'pdf', fixture('text'))).status, 422);
    assert.equal((await convert('doc', 'pdf', 'junk')).status, 422);
    assert.equal((await convert('odt', 'pdf', new Uint8Array(25 * 1024 * 1024 + 1))).status, 413);
  });
  await t.test('real ODT → DOCX → PDF and ODT', async () => {
    const docx = await convert('odt', 'docx', fixture('text'));
    assert.equal(docx.status, 200, await docx.clone().text());
    const bytes = new Uint8Array(await docx.arrayBuffer());
    assert.ok(bytes.byteLength > 1000);
    assert.match(strFromU8(unzipSync(bytes)['word/document.xml']), /Local conversion integration test/);
    const pdf = await convert('docx', 'pdf', bytes);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const odt = await convert('docx', 'odt', bytes);
    assert.equal(odt.status, 200);
  });
  await t.test('real ODS → XLSX → PDF and ODS', async () => {
    const xlsx = await convert('ods', 'xlsx', fixture('spreadsheet'));
    assert.equal(xlsx.status, 200, await xlsx.clone().text());
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    assert.ok(bytes.byteLength > 1000);
    const workbook = unzipSync(bytes);
    assert.match(strFromU8(workbook['xl/sharedStrings.xml']), /Revenue/);
    assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /<v>42<\/v>/);
    const pdf = await convert('xlsx', 'pdf', bytes);
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const ods = await convert('xlsx', 'ods', bytes);
    assert.equal(ods.status, 200);
  });
  for (const [kind, ext, filter] of [['text', 'doc', 'MS Word 97'], ['spreadsheet', 'xls', 'MS Excel 97']]) {
    await t.test(`real legacy ${ext.toUpperCase()} → PDF`, async () => {
      const bytes = await exportFixture(kind, ext, filter);
      assert.ok(bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')));
      const pdf = await convert(ext, 'pdf', bytes);
      assert.equal(pdf.status, 200);
      const result = Buffer.from(await pdf.arrayBuffer());
      assert.ok(result.length > 1000);
      assert.equal(result.subarray(0, 5).toString(), '%PDF-');
    });
  }
  for (const [ext, filter] of [['odp', null], ['pptx', 'Impress MS PowerPoint 2007 XML'], ['ppt', 'MS PowerPoint 97']]) {
    await t.test(`real presentation ${ext.toUpperCase()} → PDF`, async () => {
      const bytes = filter ? await exportFixture('presentation', ext, filter) : fixture('presentation');
      const pdf = await convert(ext, 'pdf', bytes);
      assert.equal(pdf.status, 200, await pdf.clone().text());
      const result = Buffer.from(await pdf.arrayBuffer());
      assert.ok(result.length > 1000);
      assert.equal(result.subarray(0, 5).toString(), '%PDF-');
    });
  }
});

test('Unavailable LibreOffice is reported honestly', async (t) => {
  const server = await createOfficeServer({ executable: '/nonexistent/soffice' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/office/status`)).json(), { available: false });
  assert.equal((await fetch(`${base}/api/office/convert?ext=odt&target=pdf`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: fixture('text') })).status, 503);
});
