// n8n Code node: "Normalise Drive files"
// Paste this whole file into that node, replacing everything in it.
// (Copy of the code in Terminology_extraction_webhook_v4.json.)

// ===========================================================================
// Turns Google Drive downloads into the shape stage 1 expects: TMX, XLIFF
// (including memoQ .mqxliff and .mqxlz packages) or plain text.
//
// Expects each incoming item to carry the downloaded file as binary property
// 'data'. If your Drive node names it differently, change BINARY_PROPERTY.
// ===========================================================================

const BINARY_PROPERTY = 'data';

// .xml can be TMX or XLIFF: decided from the content below.
// .mqxlz is memoQ's compressed bilingual export: a ZIP holding the .mqxliff.
const EXT_TO_TYPE = {
  tmx: 'tmx', xml: 'xml', txt: 'text', md: 'text',
  xlf: 'xliff', xliff: 'xliff', mqxliff: 'xliff', mqxlz: 'package',
};
const XLIFF_IN_PACKAGE = /\.(mqxliff|xliff|xlf)$/i;

// TMX exports (MemoQ, Trados) are often UTF-16, not UTF-8. Reading UTF-16 as
// UTF-8 interleaves NUL characters through the text and every regex in
// stage 1 then finds nothing. Detect by byte-order mark first, then by the
// pattern of zero bytes for files saved without one.
function detectEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf8-bom';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be';
  const sample = Math.min(buf.length, 4096);
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample; i += 1) {
    if (buf[i] === 0) { if (i % 2 === 0) evenZeros += 1; else oddZeros += 1; }
  }
  const half = sample / 2 || 1;
  if (oddZeros / half > 0.3 && evenZeros / half < 0.05) return 'utf16le';
  if (evenZeros / half > 0.3 && oddZeros / half < 0.05) return 'utf16be';
  return 'utf8';
}

function decodeText(buf) {
  const enc = detectEncoding(buf);
  if (enc === 'utf8-bom') return buf.subarray(3).toString('utf8');
  if (enc === 'utf16le') return buf.toString('utf16le').replace(/^\uFEFF/, '');
  if (enc === 'utf16be') {
    const even = buf.length - (buf.length % 2);
    const swapped = Buffer.from(buf.subarray(0, even));
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buf.toString('utf8');
}

// --- ZIP reading for memoQ .mqxlz packages ---------------------------------
// n8n's Code node can't load zlib by default, so this is a small, complete
// DEFLATE decoder (RFC 1951, after zlib's "puff") plus a ZIP directory reader.
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function inflateRaw(src, sizeHint) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint || src.length * 4));
  let outLen = 0;
  const ensure = (n) => {
    if (outLen + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('Damaged package: data ends early.');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const build = (lengths) => {
    const count = new Uint16Array(16);
    const symbol = new Uint16Array(lengths.length);
    for (let s = 0; s < lengths.length; s += 1) count[lengths[s]] += 1;
    count[0] = 0;
    const offs = new Uint16Array(16);
    for (let l = 1; l < 16; l += 1) offs[l] = offs[l - 1] + count[l - 1];
    for (let s = 0; s < lengths.length; s += 1) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
    return { count, symbol };
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len += 1) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('Damaged package: invalid compressed data.');
  };
  const codes = (lc, dc) => {
    for (;;) {
      let sym = decode(lc);
      if (sym < 256) {
        ensure(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        sym -= 257;
        if (sym >= 29) throw new Error('Damaged package: invalid length code.');
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dc);
        if (ds >= 30) throw new Error('Damaged package: invalid distance code.');
        const dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > outLen) throw new Error('Damaged package: distance too far back.');
        ensure(len);
        for (let i = 0; i < len; i += 1) { out[outLen] = out[outLen - dist]; outLen += 1; }
      }
    }
  };
  let fixed = null;
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;                       // skip to the byte boundary
      if (pos + 4 > src.length) throw new Error('Damaged package: data ends early.');
      const len = src[pos] | (src[pos + 1] << 8);
      const nlen = src[pos + 2] | (src[pos + 3] << 8);
      if (len !== (~nlen & 0xffff)) throw new Error('Damaged package: bad stored block.');
      pos += 4;
      if (pos + len > src.length) throw new Error('Damaged package: data ends early.');
      ensure(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    } else if (type === 1) {
      if (!fixed) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixed = [build(l), build(new Uint8Array(30).fill(5))];
      }
      codes(fixed[0], fixed[1]);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i += 1) cl[CL_ORDER[i]] = bits(3);
      const clh = build(cl);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(clh);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let rep;
        let val = 0;
        if (sym === 16) {
          if (i === 0) throw new Error('Damaged package: bad code lengths.');
          val = lengths[i - 1];
          rep = 3 + bits(2);
        } else if (sym === 17) {
          rep = 3 + bits(3);
        } else {
          rep = 11 + bits(7);
        }
        if (i + rep > nlen + ndist) throw new Error('Damaged package: bad code lengths.');
        while (rep--) lengths[i++] = val;
      }
      codes(build(lengths.subarray(0, nlen)), build(lengths.subarray(nlen)));
    } else {
      throw new Error('Damaged package: invalid block type.');
    }
  } while (!last);
  return Buffer.from(out.buffer, out.byteOffset, outLen);
}

// Lists and extracts entries from a ZIP buffer. Returns [{ name, data }].
function unzip(buf, wanted) {
  const u32 = (o) => buf.readUInt32LE(o);
  const u16 = (o) => buf.readUInt16LE(o);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP package (or it is damaged).');
  const entries = u16(eocd + 10);
  let p = u32(eocd + 16);
  const found = [];
  for (let e = 0; e < entries; e += 1) {
    if (u32(p) !== 0x02014b50) throw new Error('Damaged package: bad directory.');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !wanted(name)) continue;
    if (flags & 1) throw new Error(`"${name}" in the package is password-protected.`);
    if (u32(local) !== 0x04034b50) throw new Error('Damaged package: bad file header.');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRaw(raw, size);
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);
    found.push({ name, data });
  }
  return found;
}

const items = $input.all();
const out = [];

for (let i = 0; i < items.length; i += 1) {
  const item = items[i];
  const binary = (item.binary || {})[BINARY_PROPERTY];

  const name = (binary && binary.fileName) || item.json.name || `file_${i + 1}`;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const sourceType = EXT_TO_TYPE[ext];

  if (!sourceType) {
    // PDF and DOCX need an Extract from File node first; skipped, not failed.
    out.push({ json: { file_name: name, source_type: 'unsupported', content: '', skipped: `unsupported_extension:${ext}` } });
    continue;
  }

  if (!binary) {
    throw new Error(
      `Item ${i + 1} ("${name}") has no binary property "${BINARY_PROPERTY}". ` +
      `Check the Drive node is set to download the file, not just list it.`
    );
  }

  const buffer = await this.helpers.getBinaryDataBuffer(i, BINARY_PROPERTY);

  if (sourceType === 'package') {
    let entries;
    try {
      entries = unzip(buffer, (entryName) => XLIFF_IN_PACKAGE.test(entryName));
    } catch (e) {
      out.push({ json: { file_name: name, source_type: 'unsupported', content: '', skipped: `package_unreadable:${e.message}` } });
      continue;
    }
    if (!entries.length) {
      out.push({ json: { file_name: name, source_type: 'unsupported', content: '', skipped: 'package_has_no_xliff' } });
      continue;
    }
    for (const entry of entries) {
      out.push({ json: { file_name: `${name} > ${entry.name}`, source_type: 'xliff', content: decodeText(entry.data), encoding: detectEncoding(entry.data) } });
    }
    continue;
  }

  const content = decodeText(buffer);
  const type = sourceType === 'xml' ? (/<xliff\b/i.test(content.slice(0, 5000)) ? 'xliff' : 'tmx') : sourceType;
  out.push({ json: { file_name: name, source_type: type, content, encoding: detectEncoding(buffer) } });
}

return out;
