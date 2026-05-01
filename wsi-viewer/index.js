import { protocol, app, ipcMain, BrowserWindow, shell } from "electron";
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join, posix, basename, dirname, normalize, sep, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { stat, mkdir, unlink, rename, readFile, open, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import * as yauzl from "yauzl";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_SOURCE_PREFIX = "zip-entry:";
const enc$1 = {
  encode: (p) => Buffer.from(p, "utf8").toString("base64url"),
  decode: (b) => Buffer.from(b, "base64url").toString("utf8")
};
const zipEntryCache = /* @__PURE__ */ new Map();
const extractionRequests = /* @__PURE__ */ new Map();
function makeZipEntrySource(zipPath, entryName) {
  return `${ZIP_SOURCE_PREFIX}${enc$1.encode(zipPath)}:${enc$1.encode(entryName)}`;
}
function parseZipEntrySource(source) {
  if (!source.startsWith(ZIP_SOURCE_PREFIX)) {
    return null;
  }
  const parts = source.slice(ZIP_SOURCE_PREFIX.length).split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return {
    zipPath: enc$1.decode(parts[0]),
    entryName: enc$1.decode(parts[1])
  };
}
function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: false }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error(`Could not open ZIP: ${zipPath}`));
        return;
      }
      resolve(zipfile);
    });
  });
}
async function listZipEntries(zipPath) {
  const zipStat = await stat(zipPath);
  const cached = zipEntryCache.get(zipPath);
  if (cached && cached.size === zipStat.size && cached.mtimeMs === zipStat.mtimeMs) {
    return cached.entries;
  }
  const zipfile = await openZip(zipPath);
  const entries = await new Promise((resolve, reject) => {
    const out = [];
    zipfile.on("entry", (entry) => {
      if (!entry.fileName.endsWith("/")) {
        out.push({
          fileName: entry.fileName,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          compressionMethod: entry.compressionMethod,
          encrypted: entry.isEncrypted()
        });
      }
      zipfile.readEntry();
    });
    zipfile.once("end", () => {
      resolve(out);
    });
    zipfile.once("error", reject);
    zipfile.readEntry();
  }).finally(() => {
    zipfile.close();
  });
  zipEntryCache.set(zipPath, {
    size: zipStat.size,
    mtimeMs: zipStat.mtimeMs,
    entries
  });
  return entries;
}
async function getZipEntryInfo(zipPath, entryName) {
  const entries = await listZipEntries(zipPath);
  return entries.find((entry) => entry.fileName === entryName);
}
function openZipEntryReadStream(zipPath, entryName, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    openZip(zipPath).then((zipfile) => {
      function fail(err) {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        reject(err);
      }
      zipfile.on("entry", (entry) => {
        if (entry.fileName !== entryName) {
          zipfile.readEntry();
          return;
        }
        const streamOptions = {
          start: options?.start ?? null,
          end: options?.end ?? null,
          decompress: options?.decompress ?? null,
          decrypt: null
        };
        zipfile.openReadStream(entry, streamOptions, (err, stream) => {
          if (err || !stream) {
            fail(err || new Error(`Could not read ZIP entry: ${entryName}`));
            return;
          }
          settled = true;
          resolve({ zipfile, stream });
        });
      });
      zipfile.once("end", () => {
        fail(new Error(`ZIP entry not found: ${entryName}`));
      });
      zipfile.once("error", fail);
      zipfile.readEntry();
    }).catch(reject);
  });
}
async function streamToBuffer(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("ZIP entry is larger than allowed");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}
async function readZipTextEntry(zipPath, entryName, maxBytes) {
  const info = await getZipEntryInfo(zipPath, entryName);
  if (!info || info.encrypted || info.uncompressedSize > maxBytes) {
    return "";
  }
  const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName);
  try {
    return (await streamToBuffer(stream, maxBytes)).toString("utf8");
  } finally {
    zipfile.close();
  }
}
async function readZipEntryBuffer(zipPath, entryName, maxBytes) {
  const info = await getZipEntryInfo(zipPath, entryName);
  if (!info || info.encrypted || info.uncompressedSize > maxBytes) {
    return Buffer.alloc(0);
  }
  const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName);
  try {
    return await streamToBuffer(stream, maxBytes);
  } finally {
    zipfile.close();
  }
}
async function readStoredZipEntryRange(zipPath, entryName, start, endInclusive) {
  const info = await getZipEntryInfo(zipPath, entryName);
  if (!info) {
    throw new Error(`ZIP entry not found: ${entryName}`);
  }
  if (info.encrypted) {
    throw new Error(`ZIP entry is encrypted: ${entryName}`);
  }
  if (info.compressionMethod !== ZIP_STORED) {
    throw new Error("ZIP slide entries must be stored without compression for WSI range reads");
  }
  const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName, {
    start,
    end: endInclusive + 1,
    decompress: false
  });
  try {
    return await streamToBuffer(stream, endInclusive - start + 1);
  } finally {
    zipfile.close();
  }
}
function zipCachePath(cacheRoot, zipPath, entryName, info, zipFingerprint) {
  const digest = createHash("sha256").update(JSON.stringify([
    zipPath,
    zipFingerprint,
    entryName,
    info.compressedSize,
    info.uncompressedSize,
    info.compressionMethod
  ])).digest("hex").slice(0, 24);
  const ext = posix.extname(entryName) || ".wsi";
  return join(cacheRoot, "zip-cache", `${digest}${ext}`);
}
async function extractZipEntryToCache(zipPath, entryName, cacheRoot, info) {
  const zipStat = await stat(zipPath);
  const target = zipCachePath(cacheRoot, zipPath, entryName, info, `${zipStat.size}:${zipStat.mtimeMs}`);
  const existing = await stat(target).catch(() => null);
  if (existing?.isFile() && existing.size === info.uncompressedSize) {
    return target;
  }
  const inFlight = extractionRequests.get(target);
  if (inFlight) {
    return inFlight;
  }
  const request = (async () => {
    const dir = join(cacheRoot, "zip-cache");
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName);
    try {
      await pipeline(stream, createWriteStream(tmp));
      const extracted = await stat(tmp);
      if (extracted.size !== info.uncompressedSize) {
        throw new Error(`Extracted ZIP entry size mismatch: ${entryName}`);
      }
      await unlink(target).catch(() => void 0);
      await rename(tmp, target);
      return target;
    } catch (err) {
      await unlink(tmp).catch(() => void 0);
      throw err;
    } finally {
      zipfile.close();
    }
  })();
  extractionRequests.set(target, request);
  try {
    return await request;
  } finally {
    extractionRequests.delete(target);
  }
}
async function materializeZipEntrySourceForViewing(source, cacheRoot) {
  const zipSource = parseZipEntrySource(source);
  if (!zipSource) {
    return source;
  }
  const info = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName);
  if (!info) {
    throw new Error(`ZIP entry not found: ${zipSource.entryName}`);
  }
  if (info.encrypted) {
    throw new Error("ZIP slide entry is encrypted");
  }
  if (info.compressionMethod === ZIP_STORED) {
    return source;
  }
  if (info.compressionMethod !== ZIP_DEFLATED) {
    throw new Error(`Unsupported ZIP compression method: ${info.compressionMethod}`);
  }
  return extractZipEntryToCache(zipSource.zipPath, zipSource.entryName, cacheRoot, info);
}
const SCHEME = "wsi";
const PRIVILEGED = [
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
];
const MAX_OPEN_FILES = 16;
const MAX_FULL_FILE_BYTES = 16 * 1024 * 1024;
const openFiles = /* @__PURE__ */ new Map();
const enc = {
  encode: (p) => Buffer.from(p, "utf8").toString("base64url"),
  decode: (b) => Buffer.from(b, "base64url").toString("utf8")
};
function pathFromRequestUrl(requestUrl) {
  const u = new URL(requestUrl);
  const id = (u.pathname || "").replace(/^\//, "") || u.hostname;
  if (!id) return "";
  return enc.decode(id);
}
function displayNameFromSource(source) {
  const zipSource = parseZipEntrySource(source);
  return zipSource ? posix.basename(zipSource.entryName) : basename(source);
}
function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (m[1] === "" && m[2] !== "") {
    const suffix = parseInt(m[2], 10);
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (end >= size) end = size - 1;
  if (start < 0 || start > end) return null;
  return { start, end };
}
function closeCachedFile(entry) {
  if (entry.inUse > 0) {
    entry.closeAfterUse = true;
    return;
  }
  void entry.handle.close().catch(() => {
  });
}
function evictOpenFiles() {
  while (openFiles.size > MAX_OPEN_FILES) {
    const oldest = openFiles.entries().next().value;
    if (!oldest) return;
    openFiles.delete(oldest[0]);
    closeCachedFile(oldest[1]);
  }
}
async function acquireCachedFile(abs, st) {
  const cached = openFiles.get(abs);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    openFiles.delete(abs);
    openFiles.set(abs, cached);
    cached.inUse += 1;
    return cached;
  }
  if (cached) {
    openFiles.delete(abs);
    closeCachedFile(cached);
  }
  const entry = {
    handle: await open(abs, "r"),
    size: st.size,
    mtimeMs: st.mtimeMs,
    inUse: 1,
    closeAfterUse: false
  };
  openFiles.set(abs, entry);
  evictOpenFiles();
  return entry;
}
function releaseCachedFile(entry) {
  entry.inUse -= 1;
  if (entry.inUse <= 0 && entry.closeAfterUse) {
    void entry.handle.close().catch(() => {
    });
  }
}
function registerWsiSchemesEarly() {
  protocol.registerSchemesAsPrivileged(PRIVILEGED);
}
function registerWsiFileHandler() {
  protocol.handle(SCHEME, async (request) => {
    if (request.method === "HEAD") {
      const abs2 = pathFromRequestUrl(request.url);
      if (!abs2) return new Response(null, { status: 400 });
      const zipSource2 = parseZipEntrySource(abs2);
      if (zipSource2) {
        const entry = await getZipEntryInfo(zipSource2.zipPath, zipSource2.entryName);
        if (!entry) return new Response(null, { status: 404 });
        if (entry.encrypted || entry.compressionMethod !== ZIP_STORED) {
          return new Response(null, {
            status: 415,
            headers: {
              "content-type": "text/plain",
              "access-control-allow-origin": "*"
            }
          });
        }
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(entry.uncompressedSize),
            "content-type": "application/octet-stream",
            "accept-ranges": "bytes",
            "access-control-allow-origin": "*"
          }
        });
      }
      const st2 = await stat(abs2);
      if (!st2.isFile()) return new Response(null, { status: 400 });
      return new Response(null, {
        status: 200,
        headers: {
          "content-length": String(st2.size),
          "content-type": "application/octet-stream",
          "accept-ranges": "bytes",
          "access-control-allow-origin": "*"
        }
      });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const abs = pathFromRequestUrl(request.url);
    if (!abs) {
      return new Response("Bad wsi:// URL", { status: 400 });
    }
    const zipSource = parseZipEntrySource(abs);
    if (zipSource) {
      const entry = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName);
      if (!entry) {
        return new Response("ZIP entry not found", { status: 404 });
      }
      if (entry.encrypted) {
        return new Response("ZIP slide entry is encrypted", { status: 415 });
      }
      if (entry.compressionMethod !== ZIP_STORED) {
        return new Response("ZIP slide entry is compressed; rebuild the ZIP with store/no-compression mode", { status: 415 });
      }
      const fileSize2 = entry.uncompressedSize;
      const r2 = request.headers.get("range");
      const pr2 = parseRange(r2, fileSize2);
      if (!pr2) {
        if (fileSize2 > MAX_FULL_FILE_BYTES) {
          return new Response("Range header required for WSI files", {
            status: 416,
            headers: {
              "content-type": "text/plain",
              "content-range": `bytes */${fileSize2}`,
              "accept-ranges": "bytes",
              "access-control-allow-origin": "*"
            }
          });
        }
        const data2 = await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, 0, fileSize2 - 1);
        return new Response(new Uint8Array(data2), {
          status: 200,
          headers: {
            "content-length": String(data2.length),
            "content-type": "application/octet-stream",
            "accept-ranges": "bytes",
            "access-control-allow-origin": "*"
          }
        });
      }
      const { start: start2, end: end2 } = pr2;
      const data = await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, start2, end2);
      return new Response(new Uint8Array(data), {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(data.length),
          "content-range": `bytes ${start2}-${end2}/${fileSize2}`,
          "accept-ranges": "bytes",
          "access-control-allow-origin": "*"
        }
      });
    }
    const st = await stat(abs);
    if (!st.isFile()) {
      return new Response("Not a file", { status: 400 });
    }
    const fileSize = st.size;
    const r = request.headers.get("range");
    const pr = parseRange(r, fileSize);
    if (!pr) {
      if (fileSize > MAX_FULL_FILE_BYTES) {
        return new Response("Range header required for WSI files", {
          status: 416,
          headers: {
            "content-type": "text/plain",
            "content-range": `bytes */${fileSize}`,
            "accept-ranges": "bytes",
            "access-control-allow-origin": "*"
          }
        });
      }
      const data = await readFile(abs);
      return new Response(data, {
        status: 200,
        headers: {
          "content-length": String(data.length),
          "content-type": "application/octet-stream",
          "accept-ranges": "bytes",
          "access-control-allow-origin": "*"
        }
      });
    }
    const { start, end } = pr;
    const len = end - start + 1;
    const buf = Buffer.alloc(len);
    const file = await acquireCachedFile(abs, st);
    let bytesRead = 0;
    try {
      const result = await file.handle.read(buf, 0, len, start);
      bytesRead = result.bytesRead;
    } finally {
      releaseCachedFile(file);
    }
    const out = buf.subarray(0, bytesRead);
    return new Response(out, {
      status: 206,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(out.length),
        "content-range": `bytes ${start}-${end}/${fileSize}`,
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*"
      }
    });
  });
}
function toWsiUrl(absoluteFilePath) {
  const name = encodeURIComponent(displayNameFromSource(absoluteFilePath));
  return `${SCHEME}://local/${enc.encode(absoluteFilePath)}?name=${name}`;
}
function getBundleRootIfUnderPayloadLayout(exePath, fallback) {
  const norm = normalize(exePath);
  const m = norm.match(/^(.+)[/\\]\.wsi-usb[/\\]/i);
  if (m?.[1]) {
    let r = m[1];
    if (process.platform === "win32" && /^[A-Za-z]:$/.test(r)) {
      r = r + sep;
    }
    return r;
  }
  return fallback;
}
function getApplicationRootDir() {
  if (process.env.WSI_DEBUG_PORTABLE) {
    return process.env.WSI_DEBUG_PORTABLE;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (!app.isPackaged) {
    return process.cwd();
  }
  const exe = app.getPath("exe");
  let base;
  if (process.platform === "darwin") {
    base = dirname(dirname(dirname(dirname(exe))));
  } else {
    base = dirname(exe);
  }
  return getBundleRootIfUnderPayloadLayout(exe, base);
}
function getSlidesRootPath() {
  return join(getApplicationRootDir(), "Slides");
}
function ensureSlidesDir() {
  const p = getSlidesRootPath();
  if (!existsSync(p)) {
    try {
      mkdirSync(p, { recursive: true });
    } catch {
    }
  }
  return p;
}
function normalizePackageStain(value) {
  if (!value) {
    return void 0;
  }
  const cleaned = value.replace(/\0/g, "").replace(/^Protocol\s+Add\s+/i, "").replace(/[_-]+$/g, "").trim();
  if (/^h\s*(?:&|and|\+|-)\s*e$/i.test(cleaned)) {
    return "H&E";
  }
  if (/^movat$/i.test(cleaned)) {
    return "Movat";
  }
  if (/^red\s*hrt$/i.test(cleaned)) {
    return "REDHRT";
  }
  if (/^red\s*heart$/i.test(cleaned)) {
    return "REDheart";
  }
  return cleaned.replace(/\s+/g, " ");
}
function parseSlidePackageName(text) {
  const packageNamePattern = /(^|[/\\\s])([A-Z]\d{2}-\d{4,6})_([A-Z])_(\d+)_([^/\\]+?)_t[A-Z0-9]+(?:\.[A-Z0-9]+)?(?=$|[/\\\s])/gi;
  let meta = {};
  for (const match of text.matchAll(packageNamePattern)) {
    const specimenId = `${match[2].toUpperCase()}-${match[3].toUpperCase()}${match[4]}`;
    const stain = normalizePackageStain(match[5]);
    meta = {
      specimenId,
      stain
    };
  }
  return meta;
}
const TIFF_WSI_EXTS = /* @__PURE__ */ new Set([
  ".svs",
  ".tif",
  ".tiff",
  ".gtiff",
  ".ndpi"
]);
const WSI_EXTS = TIFF_WSI_EXTS;
const ZIP_EXT = ".zip";
const TEXT_META_EXTS = /* @__PURE__ */ new Set([
  ".csv",
  ".ini",
  ".json",
  ".txt",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml"
]);
const LABEL_IMAGE_EXTS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
]);
const MAX_TEXT_META_BYTES = 512 * 1024;
const MAX_LABEL_IMAGE_BYTES = 3 * 1024 * 1024;
function isWsiFile(name) {
  return WSI_EXTS.has(extname(name).toLowerCase());
}
function isZipFile(name) {
  return extname(name).toLowerCase() === ZIP_EXT;
}
function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return void 0;
}
function normalizeSpecimenId(value) {
  if (!value) {
    return void 0;
  }
  const cleaned = value.replace(/\0/g, "").replace(/_/g, "-").replace(/\s+/g, "").toUpperCase();
  return cleaned.replace(/^([A-Z]\d+-\d+)-([A-Z])-(\d+)-(\d+)$/, "$1-$2$3-$4").replace(/^([A-Z]\d+-\d+)-([A-Z])-(\d+)$/, "$1-$2$3");
}
function normalizeStain(value) {
  if (!value) {
    return void 0;
  }
  const cleaned = value.replace(/\0/g, "").replace(/[_-]+$/g, "").trim();
  if (/^h\s*(?:&|and|\+|-)\s*e$/i.test(cleaned)) {
    return "H&E";
  }
  if (/^movat$/i.test(cleaned)) {
    return "Movat";
  }
  if (/^red\s*(?:heart|hrt)$/i.test(cleaned)) {
    return "REDheart";
  }
  return cleaned.replace(/\s+/g, " ");
}
function parseKnownStainToken(text) {
  const clean = text.replace(/\0/g, "");
  if (/(^|[_\-\s/\\])H\s*(?:&|and|\+|-)\s*E(?=($|[_\-\s/\\]))/i.test(clean)) {
    return "H&E";
  }
  if (/(^|[_\-\s/\\])movat(?=($|[_\-\s/\\]))/i.test(clean)) {
    return "Movat";
  }
  if (/(^|[_\-\s/\\])red\s*(?:heart|hrt)(?=($|[_\-\s/\\]))/i.test(clean)) {
    return "REDheart";
  }
  return void 0;
}
function parseSpecimenId(text) {
  return normalizeSpecimenId(firstMatch(text, [
    /"?(?:Barcode|SpecimenId|Specimen_ID|Specimen ID|Specimen|SlideId|Slide_ID|Slide ID|Accession|CaseId|Case_ID|Case ID)"?\s*:\s*"?([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)"?/i,
    /<Barcode[^>]*>([^<]+)<\/Barcode>/i,
    /<(?:SpecimenId|Specimen_ID|Specimen|SlideId|Slide_ID|Slide|Accession|CaseId|Case_ID|Case)[^>]*>([^<]+)<\/(?:SpecimenId|Specimen_ID|Specimen|SlideId|Slide_ID|Slide|Accession|CaseId|Case_ID|Case)>/i,
    /\bBarcode\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\b(?:Slide|Case|Accession)(?:\s*Id|\s*ID)?\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\bSpecimen(?:\s*Id|\s*ID)?\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\b([A-Z]\d{2}-\d{4,6}[_-][A-Z][_-]?\d+(?:[_-]\d+)?)\b/i
  ]));
}
function parseStain(text) {
  const explicit = firstMatch(text, [
    /"?(?:Stain|Staining|SpecialStain|Special_Stain|Special Stain|StainName|Stain_Name|Procedure|Protocol)"?\s*:\s*"?([^",}|<>\r\n_]+(?:\s*&\s*[^",}|<>\r\n_]+)?)"?/i,
    /<Stain[^>]*>([^<]+)<\/Stain>/i,
    /<SpecialStain[^>]*>([^<]+)<\/SpecialStain>/i,
    /\b(?:Special\s*)?Stain(?:ing|Name)?\s*[:=]\s*([^|<>\r\n,_]+(?:\s*&\s*[^|<>\r\n,_]+)?)/i,
    /Protocol\s+Add\s+([^_/\\|<>\r\n]+)/i
  ]);
  const normalized = normalizeStain(explicit);
  if (normalized) {
    return normalized;
  }
  return parseKnownStainToken(text);
}
function mergeMeta(primary, fallback) {
  return {
    specimenId: primary.specimenId || fallback.specimenId,
    stain: primary.stain || fallback.stain
  };
}
async function readEvidenceLabelMeta(slidePath) {
  const evidenceDir = await findLocalEvidenceDir(dirname(slidePath));
  if (!evidenceDir) {
    return {};
  }
  let files = [];
  try {
    files = await listLocalEvidenceFiles(evidenceDir);
  } catch {
    return {};
  }
  let meta = {};
  for (const path of files) {
    if (!isTextMetaEntry(path)) {
      continue;
    }
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat || fileStat.size > MAX_TEXT_META_BYTES) {
      continue;
    }
    const text = await readFile(path, "utf8").catch(() => "");
    if (!text) {
      continue;
    }
    meta = mergeMeta(meta, {
      specimenId: parseSpecimenId(text),
      stain: parseStain(text)
    });
    if (meta.specimenId && meta.stain) {
      break;
    }
  }
  return meta;
}
async function readEvidenceThumbnailDataUrl(slidePath) {
  const evidenceDir = await findLocalEvidenceDir(dirname(slidePath));
  if (!evidenceDir) {
    return void 0;
  }
  const files = await listLocalEvidenceFiles(evidenceDir).catch(() => []);
  for (const path of sortLabelImageCandidates(files.filter(isLabelImageEntry), evidenceDir)) {
    const mime = imageMimeForEntry(path);
    if (!mime) {
      continue;
    }
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat || fileStat.size > MAX_LABEL_IMAGE_BYTES) {
      continue;
    }
    const data = await readFile(path).catch(() => Buffer.alloc(0));
    if (data.length > 0) {
      return `data:${mime};base64,${data.toString("base64")}`;
    }
  }
  return void 0;
}
function readPathLabelMeta(slidePath) {
  const pathText = `${dirname(slidePath)} ${basename(slidePath)}`;
  return mergeMeta(parseSlidePackageName(pathText), {
    specimenId: parseSpecimenId(pathText),
    stain: parseStain(pathText)
  });
}
async function readSlideLabelMeta(path) {
  const pathMeta = readPathLabelMeta(path);
  const evidenceMeta = await readEvidenceLabelMeta(path);
  return mergeMeta(evidenceMeta, pathMeta);
}
function isTextMetaEntry(name) {
  return TEXT_META_EXTS.has(posix.extname(name).toLowerCase());
}
function isLabelImageEntry(name) {
  return LABEL_IMAGE_EXTS.has(posix.extname(name).toLowerCase());
}
function isPreferredLabelImageName(name) {
  if (!LABEL_IMAGE_EXTS.has(posix.extname(name).toLowerCase())) {
    return false;
  }
  return /(^|[-_\s])(label|thumb|thumbnail)([-_\s.]|$)/i.test(zipBasename(name));
}
function imageMimeForEntry(name) {
  switch (posix.extname(name).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return void 0;
  }
}
async function findLocalEvidenceDir(slideDir) {
  const entries = await readdir(slideDir, { withFileTypes: true }).catch(() => []);
  const evidence = entries.find((entry) => entry.isDirectory() && isEvidenceDirName(entry.name));
  return evidence ? join(slideDir, evidence.name) : void 0;
}
async function listLocalEvidenceFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}
function sortLabelImageCandidates(names, evidenceRoot) {
  return [...names].sort((a, b) => {
    const aIsLabel = isPreferredLabelImageName(a);
    const bIsLabel = isPreferredLabelImageName(b);
    const aInEvidence = evidenceRoot ? a.startsWith(evidenceRoot) : isUnderAnyEvidenceDir(a);
    const bInEvidence = evidenceRoot ? b.startsWith(evidenceRoot) : isUnderAnyEvidenceDir(b);
    return Number(bIsLabel) - Number(aIsLabel) || Number(bInEvidence) - Number(aInEvidence) || a.localeCompare(b, void 0, { sensitivity: "base" });
  });
}
function splitZipPath(name) {
  return name.split(/[\\/]+/).filter(Boolean);
}
function zipDirname(name) {
  const normalized = name.replace(/\\/g, "/");
  return posix.dirname(normalized);
}
function zipBasename(name) {
  const normalized = name.replace(/\\/g, "/");
  return posix.basename(normalized);
}
function isEvidenceDirName(name) {
  return /^(evidence|evidance)$/i.test(name || "");
}
function hasPrefix(parts, prefix) {
  return prefix.every((part, index) => parts[index] === part);
}
function isUnderEvidenceDirForSlide(entryName, slideDir) {
  const entryParts = splitZipPath(entryName);
  const slideDirParts = slideDir === "." ? [] : splitZipPath(slideDir);
  return entryParts.length > slideDirParts.length + 1 && hasPrefix(entryParts, slideDirParts) && isEvidenceDirName(entryParts[slideDirParts.length]);
}
function isUnderAnyEvidenceDir(entryName) {
  const dirParts = splitZipPath(zipDirname(entryName));
  return dirParts.some(isEvidenceDirName);
}
function candidateZipSidecarEntries(slideEntryName, zipEntryNames, singleSlideInZip) {
  const slideDir = zipDirname(slideEntryName);
  return zipEntryNames.filter((name) => {
    if (name === slideEntryName) {
      return false;
    }
    const entryDir = zipDirname(name);
    return entryDir === slideDir || isUnderEvidenceDirForSlide(name, slideDir) || singleSlideInZip && (entryDir === "." || isUnderAnyEvidenceDir(name));
  });
}
function candidateZipMetaEntries(slideEntryName, zipEntryNames, singleSlideInZip) {
  return candidateZipSidecarEntries(slideEntryName, zipEntryNames, singleSlideInZip).filter(isTextMetaEntry);
}
function candidateZipLabelImageEntries(slideEntryName, zipEntryNames, singleSlideInZip) {
  const slideDir = zipDirname(slideEntryName);
  return sortLabelImageCandidates(candidateZipSidecarEntries(slideEntryName, zipEntryNames, singleSlideInZip).filter(isLabelImageEntry).filter((name) => isPreferredLabelImageName(name) || isUnderEvidenceDirForSlide(name, slideDir) || singleSlideInZip && isUnderAnyEvidenceDir(name)));
}
function readZipPathLabelMeta(zipPath, entryName) {
  const pathText = `${basename(zipPath)} ${entryName}`;
  return mergeMeta(parseSlidePackageName(pathText), {
    specimenId: parseSpecimenId(pathText),
    stain: parseStain(pathText)
  });
}
async function readZipSidecarLabelMeta(zipPath, slideEntryName, zipEntryNames, singleSlideInZip) {
  let meta = {};
  for (const entryName of candidateZipMetaEntries(slideEntryName, zipEntryNames, singleSlideInZip)) {
    const text = await readZipTextEntry(zipPath, entryName, MAX_TEXT_META_BYTES).catch(() => "");
    if (!text) {
      continue;
    }
    meta = mergeMeta(meta, {
      specimenId: parseSpecimenId(text),
      stain: parseStain(text)
    });
    if (meta.specimenId && meta.stain) {
      break;
    }
  }
  return meta;
}
async function readZipSlideLabelMeta(zipPath, slideEntryName, zipEntryNames, singleSlideInZip) {
  const pathMeta = readZipPathLabelMeta(zipPath, slideEntryName);
  return mergeMeta(await readZipSidecarLabelMeta(zipPath, slideEntryName, zipEntryNames, singleSlideInZip), pathMeta);
}
async function readZipLabelImageDataUrl(zipPath, slideEntryName, zipEntryNames, singleSlideInZip) {
  for (const entryName of candidateZipLabelImageEntries(slideEntryName, zipEntryNames, singleSlideInZip)) {
    const mime = imageMimeForEntry(entryName);
    if (!mime) {
      continue;
    }
    const data = await readZipEntryBuffer(zipPath, entryName, MAX_LABEL_IMAGE_BYTES).catch(() => Buffer.alloc(0));
    if (data.length > 0) {
      return `data:${mime};base64,${data.toString("base64")}`;
    }
  }
  return void 0;
}
async function scanForSlides(root) {
  const out = [];
  async function addZipSlides(zipPath) {
    const zipStat = await stat(zipPath).catch(() => null);
    if (!zipStat?.isFile()) {
      return;
    }
    const entries = await listZipEntries(zipPath).catch(() => []);
    const zipEntryNames = entries.map((entry) => entry.fileName);
    const wsiEntries = entries.filter((entry) => isWsiFile(entry.fileName));
    for (const entry of wsiEntries) {
      const fileName = zipBasename(entry.fileName);
      const source = makeZipEntrySource(zipPath, entry.fileName);
      const meta = await readZipSlideLabelMeta(zipPath, entry.fileName, zipEntryNames, wsiEntries.length === 1);
      const thumbnailDataUrl = await readZipLabelImageDataUrl(zipPath, entry.fileName, zipEntryNames, wsiEntries.length === 1);
      const unsupportedReason = entry.encrypted ? "ZIP slide entry is encrypted. Use an unencrypted ZIP." : entry.compressionMethod === ZIP_STORED || entry.compressionMethod === ZIP_DEFLATED ? void 0 : `Unsupported ZIP compression method: ${entry.compressionMethod}`;
      out.push({
        id: Buffer.from(source, "utf8").toString("base64url"),
        label: meta.specimenId || fileName,
        specimenId: meta.specimenId,
        stain: meta.stain,
        fileName,
        absolutePath: source,
        relativeToSlides: `${relative(root, zipPath)}!/${entry.fileName}`,
        ext: posix.extname(entry.fileName).toLowerCase(),
        sizeBytes: entry.uncompressedSize,
        sourceType: "zip",
        zipPath,
        zipEntry: entry.fileName,
        zipCompressionMethod: entry.compressionMethod,
        requiresExtraction: entry.compressionMethod === ZIP_DEFLATED,
        thumbnailDataUrl,
        unsupportedReason
      });
    }
  }
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && isZipFile(e.name)) {
        await addZipSlides(p);
      } else if (e.isFile() && isWsiFile(e.name)) {
        const s = await stat(p).catch(() => null);
        if (!s?.isFile()) {
          continue;
        }
        const rel = relative(root, p);
        const meta = await readSlideLabelMeta(p);
        const fileName = basename(p);
        out.push({
          id: Buffer.from(p, "utf8").toString("base64url"),
          label: meta.specimenId || fileName,
          specimenId: meta.specimenId,
          stain: meta.stain,
          fileName,
          absolutePath: p,
          relativeToSlides: rel,
          ext: extname(e.name).toLowerCase(),
          sizeBytes: s.size,
          thumbnailDataUrl: await readEvidenceThumbnailDataUrl(p)
        });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => a.relativeToSlides.localeCompare(b.relativeToSlides, void 0, { sensitivity: "base" }));
  return out;
}
const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_IMAGE_DESCRIPTION = 270;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_PLANAR_CONFIGURATION = 284;
const TAG_PREDICTOR = 317;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_LONG8 = 16;
const COMPRESSION_NONE = 1;
const COMPRESSION_LZW = 5;
const COMPRESSION_JPEG_OLD = 6;
const COMPRESSION_JPEG = 7;
const PHOTOMETRIC_WHITE_IS_ZERO = 0;
const MAX_IFDS = 32;
const MAX_IFD_ENTRIES = 512;
const MAX_TAG_BYTES = 64 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EMBEDDED_LABEL_PIXELS = 4e6;
class FileReader {
  constructor(handle) {
    this.handle = handle;
  }
  static async open(path) {
    return new FileReader(await open(path, "r"));
  }
  async read(position, length) {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, position);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  }
  async close() {
    await this.handle.close();
  }
}
class StoredZipReader {
  constructor(zipPath, entryName) {
    this.zipPath = zipPath;
    this.entryName = entryName;
  }
  async read(position, length) {
    if (length <= 0) {
      return Buffer.alloc(0);
    }
    return readStoredZipEntryRange(this.zipPath, this.entryName, position, position + length - 1);
  }
}
function typeSize(type) {
  switch (type) {
    case 1:
    case TYPE_ASCII:
    case 6:
    case 7:
      return 1;
    case TYPE_SHORT:
    case 8:
      return 2;
    case TYPE_LONG:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
    case TYPE_LONG8:
    case 17:
    case 18:
      return 8;
    default:
      return 1;
  }
}
function readUInt16(buffer, offset, endian) {
  return endian === "little" ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}
function readUInt32(buffer, offset, endian) {
  return endian === "little" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}
function readUInt64(buffer, offset, endian) {
  const value = endian === "little" ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
  return Number(value);
}
function readOffset(buffer, offset, endian, bigTiff) {
  return bigTiff ? readUInt64(buffer, offset, endian) : readUInt32(buffer, offset, endian);
}
function numberArrayFromTag(type, data, endian) {
  const size = typeSize(type);
  const count = Math.floor(data.length / size);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const offset = i * size;
    if (type === TYPE_SHORT) {
      out.push(readUInt16(data, offset, endian));
    } else if (type === TYPE_LONG) {
      out.push(readUInt32(data, offset, endian));
    } else if (type === TYPE_LONG8) {
      out.push(readUInt64(data, offset, endian));
    }
  }
  return out;
}
async function readTagData(reader, entry, type, count, endian, bigTiff, maxBytes = MAX_TAG_BYTES) {
  const inlineBytes = bigTiff ? 8 : 4;
  const valueOffset = bigTiff ? 12 : 8;
  const byteLength = Math.min(typeSize(type) * count, maxBytes);
  if (byteLength <= inlineBytes) {
    return entry.subarray(valueOffset, valueOffset + byteLength);
  }
  const dataOffset = readOffset(entry, valueOffset, endian, bigTiff);
  return reader.read(dataOffset, byteLength);
}
async function readHeader(reader) {
  const header = await reader.read(0, 16);
  if (header.length < 8) {
    return void 0;
  }
  const byteOrder = header.toString("ascii", 0, 2);
  const endian = byteOrder === "II" ? "little" : byteOrder === "MM" ? "big" : void 0;
  if (!endian) {
    return void 0;
  }
  const magic = readUInt16(header, 2, endian);
  if (magic === 42) {
    return { endian, bigTiff: false, firstIfdOffset: readUInt32(header, 4, endian) };
  }
  if (magic === 43 && header.length >= 16) {
    return { endian, bigTiff: true, firstIfdOffset: readUInt64(header, 8, endian) };
  }
  return void 0;
}
async function readIfds(reader) {
  const header = await readHeader(reader);
  if (!header) {
    return [];
  }
  const ifds = [];
  const { endian, bigTiff } = header;
  let ifdOffset = header.firstIfdOffset;
  for (let index = 0; ifdOffset > 0 && index < MAX_IFDS; index += 1) {
    const countBytes = bigTiff ? 8 : 2;
    const countBuffer = await reader.read(ifdOffset, countBytes);
    if (countBuffer.length < countBytes) {
      break;
    }
    const entryCount = bigTiff ? readUInt64(countBuffer, 0, endian) : readUInt16(countBuffer, 0, endian);
    if (entryCount <= 0 || entryCount > MAX_IFD_ENTRIES) {
      break;
    }
    const entrySize = bigTiff ? 20 : 12;
    const nextOffsetBytes = bigTiff ? 8 : 4;
    const directory = await reader.read(ifdOffset + countBytes, entryCount * entrySize + nextOffsetBytes);
    if (directory.length < entryCount * entrySize + nextOffsetBytes) {
      break;
    }
    const ifd = {
      index,
      bitsPerSample: [],
      stripOffsets: [],
      samplesPerPixel: 1,
      stripByteCounts: []
    };
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      const entry = directory.subarray(entryIndex * entrySize, (entryIndex + 1) * entrySize);
      const tag = readUInt16(entry, 0, endian);
      if (![
        TAG_IMAGE_WIDTH,
        TAG_IMAGE_LENGTH,
        TAG_BITS_PER_SAMPLE,
        TAG_COMPRESSION,
        TAG_PHOTOMETRIC,
        TAG_IMAGE_DESCRIPTION,
        TAG_STRIP_OFFSETS,
        TAG_SAMPLES_PER_PIXEL,
        TAG_ROWS_PER_STRIP,
        TAG_STRIP_BYTE_COUNTS,
        TAG_PLANAR_CONFIGURATION,
        TAG_PREDICTOR
      ].includes(tag)) {
        continue;
      }
      const type = readUInt16(entry, 2, endian);
      const count = bigTiff ? readUInt64(entry, 4, endian) : readUInt32(entry, 4, endian);
      const data = await readTagData(reader, entry, type, count, endian, bigTiff);
      if (tag === TAG_IMAGE_DESCRIPTION && type === TYPE_ASCII) {
        ifd.description = data.toString("utf8").replace(/\0.*$/g, "").trim();
        continue;
      }
      const values = numberArrayFromTag(type, data, endian);
      const first = values[0];
      if (typeof first !== "number") {
        continue;
      }
      switch (tag) {
        case TAG_IMAGE_WIDTH:
          ifd.width = first;
          break;
        case TAG_IMAGE_LENGTH:
          ifd.height = first;
          break;
        case TAG_BITS_PER_SAMPLE:
          ifd.bitsPerSample = values;
          break;
        case TAG_COMPRESSION:
          ifd.compression = first;
          break;
        case TAG_PHOTOMETRIC:
          ifd.photometric = first;
          break;
        case TAG_STRIP_OFFSETS:
          ifd.stripOffsets = values;
          break;
        case TAG_SAMPLES_PER_PIXEL:
          ifd.samplesPerPixel = first;
          break;
        case TAG_ROWS_PER_STRIP:
          ifd.rowsPerStrip = first;
          break;
        case TAG_STRIP_BYTE_COUNTS:
          ifd.stripByteCounts = values;
          break;
        case TAG_PLANAR_CONFIGURATION:
          ifd.planarConfiguration = first;
          break;
        case TAG_PREDICTOR:
          ifd.predictor = first;
          break;
      }
    }
    ifds.push(ifd);
    ifdOffset = readOffset(directory, entryCount * entrySize, endian, bigTiff);
  }
  return ifds;
}
function isSupportedCandidate(ifd) {
  if (!ifd.width || !ifd.height || !ifd.compression) {
    return false;
  }
  if (!ifd.stripOffsets.length || ifd.stripOffsets.length !== ifd.stripByteCounts.length) {
    return false;
  }
  if (ifd.planarConfiguration && ifd.planarConfiguration !== 1) {
    return false;
  }
  if (![1, 3, 4].includes(ifd.samplesPerPixel)) {
    return false;
  }
  const bits = ifd.bitsPerSample.length ? ifd.bitsPerSample : [8];
  if (bits.some((bit) => bit !== 8)) {
    return false;
  }
  if (![COMPRESSION_NONE, COMPRESSION_LZW, COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression)) {
    return false;
  }
  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression) && ifd.stripOffsets.length !== 1) {
    return false;
  }
  return ifd.width * ifd.height <= MAX_EMBEDDED_LABEL_PIXELS;
}
function scoreCandidate(ifd, base) {
  if (!isSupportedCandidate(ifd)) {
    return -1;
  }
  const description = (ifd.description || "").toLowerCase();
  let score = 0;
  if (/\b(label|barcode)\b/.test(description)) {
    score += 1e4;
  } else if (/\bmacro\b/.test(description)) {
    score += 5e3;
  } else {
    if (ifd.index === 0 || !ifd.width || !ifd.height) {
      return -1;
    }
    const ratio = ifd.width / ifd.height;
    const baseRatio = base?.width && base.height ? base.width / base.height : 0;
    const ratioDiff = baseRatio > 0 ? Math.abs(Math.log(ratio / baseRatio)) : 1;
    const elongated = ratio >= 2 || ratio <= 0.5;
    if (!elongated && ratioDiff < 0.2) {
      return -1;
    }
    score += 1e3;
    if (elongated) {
      score += 500;
    }
    score += Math.min(ifd.width * ifd.height / 1e3, 2e3);
  }
  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression || 0)) {
    score += 200;
  } else {
    score += 100;
  }
  return score;
}
function selectLabelIfd(ifds) {
  const base = ifds[0];
  return ifds.map((ifd) => ({ ifd, score: scoreCandidate(ifd, base) })).filter(({ score }) => score >= 0).sort((a, b) => b.score - a.score)[0]?.ifd;
}
function tiffLzwDecode(input, maxOutputBytes) {
  const clearCode = 256;
  const endCode = 257;
  let bitOffset = 0;
  let codeSize = 9;
  let nextCode = 258;
  let dictionary = [];
  function reset() {
    dictionary = Array.from({ length: 258 }, (_, index) => index < 256 ? [index] : []);
    codeSize = 9;
    nextCode = 258;
  }
  function readCode() {
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const byte = input[bitOffset >> 3];
      code = code << 1 | byte >> 7 - (bitOffset & 7) & 1;
      bitOffset += 1;
    }
    return code;
  }
  reset();
  let previous = null;
  const chunks = [];
  let total = 0;
  while (bitOffset + codeSize <= input.length * 8) {
    const code = readCode();
    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === endCode) {
      break;
    }
    let entry = dictionary[code];
    if (!entry?.length && previous && code === nextCode) {
      entry = previous.concat(previous[0]);
    }
    if (!entry?.length) {
      throw new Error("Invalid TIFF LZW data");
    }
    chunks.push(entry);
    total += entry.length;
    if (total > maxOutputBytes) {
      throw new Error("Embedded label image is larger than allowed");
    }
    if (previous && nextCode < 4096) {
      dictionary[nextCode] = previous.concat(entry[0]);
      nextCode += 1;
      if (nextCode === (1 << codeSize) - 1 && codeSize < 12) {
        codeSize += 1;
      }
    }
    previous = entry;
  }
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      out[offset] = chunk[index];
      offset += 1;
    }
  }
  return out;
}
async function readRasterData(reader, ifd) {
  const width = ifd.width || 0;
  const height = ifd.height || 0;
  const samples = ifd.samplesPerPixel || 1;
  const rowBytes = width * samples;
  const expectedBytes = rowBytes * height;
  if (expectedBytes <= 0 || expectedBytes > MAX_EMBEDDED_LABEL_PIXELS * 4) {
    return void 0;
  }
  const out = Buffer.alloc(expectedBytes);
  const rowsPerStrip = Math.max(1, ifd.rowsPerStrip || height);
  let outOffset = 0;
  for (let index = 0; index < ifd.stripOffsets.length; index += 1) {
    const rows = Math.min(rowsPerStrip, height - index * rowsPerStrip);
    const expectedStripBytes = Math.max(0, rows * rowBytes);
    if (expectedStripBytes <= 0) {
      break;
    }
    const strip = await reader.read(ifd.stripOffsets[index], ifd.stripByteCounts[index]);
    const decoded = ifd.compression === COMPRESSION_LZW ? tiffLzwDecode(strip, expectedStripBytes) : strip;
    if (decoded.length < expectedStripBytes) {
      return void 0;
    }
    decoded.copy(out, outOffset, 0, expectedStripBytes);
    outOffset += expectedStripBytes;
  }
  if (ifd.predictor === 2) {
    for (let row = 0; row < height; row += 1) {
      const rowOffset = row * rowBytes;
      for (let index = samples; index < rowBytes; index += 1) {
        out[rowOffset + index] = out[rowOffset + index] + out[rowOffset + index - samples] & 255;
      }
    }
  }
  return out;
}
function rasterToRgb(raster, ifd) {
  const width = ifd.width || 0;
  const height = ifd.height || 0;
  const samples = ifd.samplesPerPixel || 1;
  const rgb = Buffer.alloc(width * height * 3);
  let src = 0;
  let dst = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (samples === 1) {
      const value = ifd.photometric === PHOTOMETRIC_WHITE_IS_ZERO ? 255 - raster[src] : raster[src];
      rgb[dst] = value;
      rgb[dst + 1] = value;
      rgb[dst + 2] = value;
    } else {
      rgb[dst] = raster[src];
      rgb[dst + 1] = raster[src + 1];
      rgb[dst + 2] = raster[src + 2];
    }
    src += samples;
    dst += 3;
  }
  return rgb;
}
let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let c = index;
      for (let bit = 0; bit < 8; bit += 1) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      return c >>> 0;
    });
  }
  let crc = 4294967295;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}
async function rgbPngDataUrl(rgb, width, height) {
  const { deflateSync } = await import("node:zlib");
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * rowBytes;
    const dstOffset = y * (rowBytes + 1);
    raw[dstOffset] = 0;
    rgb.copy(raw, dstOffset + 1, srcOffset, srcOffset + rowBytes);
  }
  const png = Buffer.concat([
    header,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
async function imageDataUrlForIfd(reader, ifd) {
  if (!ifd.width || !ifd.height || !ifd.compression) {
    return void 0;
  }
  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression)) {
    const byteCount = ifd.stripByteCounts[0];
    if (byteCount > MAX_EMBEDDED_IMAGE_BYTES) {
      return void 0;
    }
    const data = await reader.read(ifd.stripOffsets[0], byteCount);
    if (data[0] === 255 && data[1] === 216) {
      return `data:image/jpeg;base64,${data.toString("base64")}`;
    }
    return void 0;
  }
  if (![COMPRESSION_NONE, COMPRESSION_LZW].includes(ifd.compression)) {
    return void 0;
  }
  const raster = await readRasterData(reader, ifd);
  if (!raster) {
    return void 0;
  }
  return rgbPngDataUrl(rasterToRgb(raster, ifd), ifd.width, ifd.height);
}
async function readFromReader(reader) {
  const ifds = await readIfds(reader);
  const labelIfd = selectLabelIfd(ifds);
  return labelIfd ? imageDataUrlForIfd(reader, labelIfd) : void 0;
}
async function readFromFile(path) {
  const reader = await FileReader.open(path);
  try {
    return await readFromReader(reader);
  } finally {
    await reader.close();
  }
}
async function readEmbeddedLabelThumbnailDataUrl(source, cacheRoot) {
  const zipSource = parseZipEntrySource(source);
  if (!zipSource) {
    return readFromFile(source);
  }
  const info = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName);
  if (!info || info.encrypted) {
    return void 0;
  }
  if (info.compressionMethod === ZIP_STORED) {
    return readFromReader(new StoredZipReader(zipSource.zipPath, zipSource.entryName));
  }
  const materializedPath = await materializeZipEntrySourceForViewing(source, cacheRoot);
  return materializedPath === source ? void 0 : readFromFile(materializedPath);
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = dirname(__filename$1);
if (app.isPackaged) {
  try {
    const root = getApplicationRootDir();
    const data = join(root, ".wsi-hive-data");
    mkdirSync(data, { recursive: true });
    if (process.platform === "win32") {
      execFile("attrib", ["+h", data], { windowsHide: true }, () => void 0);
    }
    app.setPath("userData", data);
    app.setPath("cache", join(data, "cache"));
  } catch (e) {
    console.warn("WSI Hive: could not set portable data paths", e);
  }
}
registerWsiSchemesEarly();
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
      preload: join(__dirname$1, "../preload/index.mjs")
    }
  });
  const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererDevUrl) {
    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.loadURL(rendererDevUrl);
  } else {
    mainWindow.loadFile(join(__dirname$1, "../renderer/index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler((d) => {
    shell.openExternal(d.url);
    return { action: "deny" };
  });
}
app.whenReady().then(() => {
  registerWsiFileHandler();
  ensureSlidesDir();
  createWindow();
  ipcMain.handle("slides:getInfo", () => {
    return {
      applicationRoot: getApplicationRootDir(),
      slidesRoot: getSlidesRootPath()
    };
  });
  ipcMain.handle("slides:rescan", async () => {
    return scanForSlides(ensureSlidesDir());
  });
  ipcMain.handle("wsi:pathToUrl", async (_e, { absolutePath }) => {
    const source = await materializeZipEntrySourceForViewing(absolutePath, app.getPath("userData"));
    return toWsiUrl(source);
  });
  ipcMain.handle("wsi:embeddedLabelThumbnail", async (_e, { absolutePath }) => {
    return await readEmbeddedLabelThumbnailDataUrl(absolutePath, app.getPath("userData")) || null;
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
