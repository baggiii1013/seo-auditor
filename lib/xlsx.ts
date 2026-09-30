// A workbook Excel opens, written by hand. An .xlsx is a zip of a few XML
// files, and a fix report is text and numbers in plain sheets: no formulas, no
// dates, one bold header row frozen at the top. Not worth a dependency.

import { crc32, deflateRawSync } from 'node:zlib';

export type Sheet = { name: string; widths: number[]; rows: (string | number)[][] };

/** The most a cell holds; Excel refuses a file with more. */
const CELL = 32_767;

// Control characters are not allowed in XML at all — a build's output carries
// terminal colour codes.
const esc = (s: string) =>
  s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fit = (s: string) => (s.length > CELL ? `${s.slice(0, CELL - 60)}\n… cut here: a cell holds ${CELL} characters.` : s);

const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + col(i % 26));

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function sheetXml({ widths, rows }: Sheet): string {
  const cells = rows.map(
    (row, r) =>
      `<row r="${r + 1}">${row
        .map((v, c) => {
          const at = `r="${col(c)}${r + 1}" s="${r ? 2 : 1}"`;
          return typeof v === 'number'
            ? `<c ${at}><v>${v}</v></c>`
            : `<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(fit(v))}</t></is></c>`;
        })
        .join('')}</row>`,
  );
  return `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')}</cols><sheetData>${cells.join('')}</sheetData></worksheet>`;
}

// Styles: 0 the default, 1 the header (bold), 2 every other cell (wrapped, top).
const STYLES = `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Little-endian fields, each `[bytes, value]`. */
function le(...fields: [2 | 4, number][]): Buffer {
  const out = Buffer.alloc(fields.reduce((n, [size]) => n + size, 0));
  let at = 0;
  for (const [size, value] of fields) {
    if (size === 2) out.writeUInt16LE(value, at);
    else out.writeUInt32LE(value >>> 0, at);
    at += size;
  }
  return out;
}

/** A zip of `files`, deflated. No dates: every entry says 1 January 1980. */
function zip(files: [string, string][]): Buffer {
  const body: Buffer[] = [];
  const dir: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of files) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const name = Buffer.from(path);
    // version, UTF-8 names, deflate, time, date, crc, sizes, name length
    const common: [2 | 4, number][] = [[2, 20], [2, 0x0800], [2, 8], [2, 0], [2, 0x21], [4, crc32(raw)], [4, data.length], [4, raw.length], [2, name.length]];
    const head = Buffer.concat([le([4, 0x04034b50], ...common, [2, 0]), name]);
    dir.push(le([4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]), name);
    body.push(head, data);
    offset += head.length + data.length;
  }
  const central = Buffer.concat(dir);
  const end = le([4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, central.length], [4, offset], [2, 0]);
  return Buffer.concat([...body, central, end]);
}

/** An .xlsx of `sheets`, in order. Sheet names must be unique, 31 characters
 *  at most and free of `[]:*?/\`. */
export function xlsx(sheets: Sheet[]): Buffer {
  const n = sheets.length;
  return zip([
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}
