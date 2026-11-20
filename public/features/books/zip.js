/**
 * قارئ ZIP مصغّر — ميزة فرعية داخل "كتبي".
 * يستخدم واجهات المتصفح الأصلية (DecompressionStream) فلا حاجة لمكتبة خارجية.
 * يكفي لفتح EPUB و DOCX (وهما ملفات ZIP في الأصل).
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);

function decodeName(bytes, utf8) {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('متصفحك لا يدعم فك ضغط الملفات — جرّب Chrome أو Safari حديثًا');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function openZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('ملف غير صالح');

  // ابحث عن نهاية الدليل المركزي من آخر الملف (تعليق ZIP حتى 65535 بايت)
  let eocd = -1;
  const start = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (u32(view, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('لم أتعرف على الملف كأرشيف ZIP (EPUB/DOCX)');

  const count = u16(view, eocd + 10);
  const centralOffset = u32(view, eocd + 16);
  const entries = new Map();
  let cursor = centralOffset;

  for (let i = 0; i < count; i += 1) {
    if (u32(view, cursor) !== CENTRAL_SIG) break;
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLen = u16(view, cursor + 28);
    const extraLen = u16(view, cursor + 30);
    const commentLen = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const rawName = bytes.slice(cursor + 46, cursor + 46 + nameLen);
    let name = decodeName(rawName, Boolean(flags & 0x0800)).replace(/\\/g, '/');
    try {
      name = decodeURIComponent(name);
    } catch {
      /* بعض الملفات تحتوي % غير صالح */
    }
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  async function read(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry._data) return entry._data;
    if (u32(view, entry.localOffset) !== LOCAL_SIG) throw new Error(`رأس الملف تالف: ${name}`);
    const nameLen = u16(view, entry.localOffset + 26);
    const extraLen = u16(view, entry.localOffset + 28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    let data;
    if (entry.method === 0) data = raw.slice();
    else if (entry.method === 8) data = await inflateRaw(raw);
    else throw new Error(`طريقة ضغط غير مدعومة (${entry.method}) في ${name}`);
    entry._data = data;
    return data;
  }

  return {
    bytes,
    entries,
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    find: (re) => [...entries.keys()].find((name) => re.test(name)) || null,
    async text(name) {
      const data = await read(name);
      return data ? new TextDecoder('utf-8').decode(data) : null;
    },
    read,
  };
}
