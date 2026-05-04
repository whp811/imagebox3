//! Embedded TIFF/NDPI label strip → data URL (parity with Electron `embedded-label-thumbnail.ts`).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::zip_ops::{
  get_zip_entry_info, materialize_zip_entry_source_for_viewing, parse_zip_entry_source,
  read_stored_zip_entry_range,
};

const MAX_IFDS: usize = 32;
const MAX_IFD_ENTRIES: u64 = 512;
const MAX_TAG_BYTES: usize = 64 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_EMBEDDED_LABEL_PIXELS: u64 = 4_000_000;
const TIFF_SCAN_BYTES: u64 = 256 * 1024;

const TAG_IMAGE_WIDTH: u16 = 256;
const TAG_IMAGE_LENGTH: u16 = 257;
const TAG_BITS_PER_SAMPLE: u16 = 258;
const TAG_COMPRESSION: u16 = 259;
const TAG_PHOTOMETRIC: u16 = 262;
const TAG_IMAGE_DESCRIPTION: u16 = 270;
const TAG_STRIP_OFFSETS: u16 = 273;
const TAG_SAMPLES_PER_PIXEL: u16 = 277;
const TAG_ROWS_PER_STRIP: u16 = 278;
const TAG_STRIP_BYTE_COUNTS: u16 = 279;
const TAG_PLANAR_CONFIGURATION: u16 = 284;
const TAG_PREDICTOR: u16 = 317;

const TYPE_ASCII: u16 = 2;
const TYPE_SHORT: u16 = 3;
const TYPE_LONG: u16 = 4;
const TYPE_LONG8: u16 = 16;

const COMPRESSION_NONE: u16 = 1;
const COMPRESSION_LZW: u16 = 5;
const COMPRESSION_JPEG_OLD: u16 = 6;
const COMPRESSION_JPEG: u16 = 7;

const PHOTOMETRIC_WHITE_IS_ZERO: u16 = 0;

#[derive(Clone, Copy)]
enum Endian {
  Little,
  Big,
}

fn read_u16(buf: &[u8], o: usize, e: Endian) -> u16 {
  match e {
    Endian::Little => u16::from_le_bytes(buf[o..o + 2].try_into().unwrap_or([0, 0])),
    Endian::Big => u16::from_be_bytes(buf[o..o + 2].try_into().unwrap_or([0, 0])),
  }
}

fn read_u32(buf: &[u8], o: usize, e: Endian) -> u32 {
  match e {
    Endian::Little => u32::from_le_bytes(buf[o..o + 4].try_into().unwrap_or([0; 4])),
    Endian::Big => u32::from_be_bytes(buf[o..o + 4].try_into().unwrap_or([0; 4])),
  }
}

fn read_u64(buf: &[u8], o: usize, e: Endian) -> u64 {
  match e {
    Endian::Little => u64::from_le_bytes(buf[o..o + 8].try_into().unwrap_or([0; 8])),
    Endian::Big => u64::from_be_bytes(buf[o..o + 8].try_into().unwrap_or([0; 8])),
  }
}

fn type_size(ty: u16) -> usize {
  match ty {
    1 | TYPE_ASCII | 6 | 7 => 1,
    TYPE_SHORT | 8 => 2,
    TYPE_LONG | 9 | 11 => 4,
    5 | 10 | 12 | TYPE_LONG8 | 17 | 18 => 8,
    _ => 1,
  }
}

fn read_offset(buf: &[u8], o: usize, e: Endian, big_tiff: bool) -> u64 {
  if big_tiff {
    read_u64(buf, o, e)
  } else {
    read_u32(buf, o, e) as u64
  }
}

#[derive(Debug, Clone)]
struct TiffIfd {
  index: usize,
  width: Option<u32>,
  height: Option<u32>,
  bits_per_sample: Vec<u32>,
  compression: Option<u16>,
  photometric: Option<u16>,
  description: String,
  strip_offsets: Vec<u64>,
  samples_per_pixel: u32,
  rows_per_strip: Option<u32>,
  strip_byte_counts: Vec<u64>,
  planar_configuration: Option<u16>,
  predictor: Option<u16>,
}

enum SourceKind {
  File(PathBuf),
  ZipStored { zip_path: PathBuf, entry_name: String },
}

fn read_at(kind: &SourceKind, pos: u64, len: usize) -> std::io::Result<Vec<u8>> {
  match kind {
    SourceKind::File(path) => {
      let mut f = File::open(path)?;
      f.seek(SeekFrom::Start(pos))?;
      let mut buf = vec![0u8; len];
      f.read_exact(&mut buf)?;
      Ok(buf)
    }
    SourceKind::ZipStored { zip_path, entry_name } => {
      if len == 0 {
        return Ok(vec![]);
      }
      let end = pos.saturating_add(len as u64).saturating_sub(1);
      read_stored_zip_entry_range(zip_path, entry_name, pos, end).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
      })
    }
  }
}

fn sniff_tiff_base(head: &[u8]) -> u64 {
  let n = head.len().saturating_sub(8);
  for i in 0..n {
    if head[i] == b'I' && head[i + 1] == b'I' {
      let magic = read_u16(head, i + 2, Endian::Little);
      if magic == 42 || magic == 43 {
        return i as u64;
      }
    }
    if head[i] == b'M' && head[i + 1] == b'M' {
      let magic = read_u16(head, i + 2, Endian::Big);
      if magic == 42 || magic == 43 {
        return i as u64;
      }
    }
  }
  0
}

fn read_header_at(kind: &SourceKind, tiff_base: u64) -> Option<(Endian, bool, u64)> {
  let h = read_at(kind, tiff_base, 16).ok()?;
  if h.len() < 8 {
    return None;
  }
  let endian = match &h[0..2] {
    b"II" => Endian::Little,
    b"MM" => Endian::Big,
    _ => return None,
  };
  let magic = read_u16(&h, 2, endian);
  if magic == 42 && h.len() >= 8 {
    return Some((endian, false, read_u32(&h, 4, endian) as u64));
  }
  if magic == 43 && h.len() >= 16 {
    return Some((endian, true, read_u64(&h, 8, endian)));
  }
  None
}

fn number_array_from_tag(ty: u16, data: &[u8], e: Endian) -> Vec<u64> {
  let sz = type_size(ty);
  if sz == 0 || data.is_empty() {
    return vec![];
  }
  let count = data.len() / sz;
  let mut out = Vec::with_capacity(count);
  for i in 0..count {
    let o = i * sz;
    if o + sz > data.len() {
      break;
    }
    let v = match ty {
      TYPE_SHORT | 8 => read_u16(data, o, e) as u64,
      TYPE_LONG | 9 | 11 => read_u32(data, o, e) as u64,
      5 | 10 | 12 | TYPE_LONG8 | 17 | 18 => read_u64(data, o, e),
      _ => 0,
    };
    out.push(v);
  }
  out
}

fn read_tag_data(
  kind: &SourceKind,
  tiff_base: u64,
  entry: &[u8],
  ty: u16,
  count: u64,
  e: Endian,
  big_tiff: bool,
) -> Option<Vec<u8>> {
  let inline_bytes = if big_tiff { 8 } else { 4 };
  let value_offset = if big_tiff { 12 } else { 8 };
  let byte_len = (type_size(ty) as u64).saturating_mul(count).min(MAX_TAG_BYTES as u64) as usize;
  if byte_len <= inline_bytes {
    return Some(entry[value_offset..value_offset + byte_len].to_vec());
  }
  let data_offset = read_offset(entry, value_offset, e, big_tiff);
  read_at(kind, tiff_base.saturating_add(data_offset), byte_len).ok()
}

fn read_ifds(kind: &SourceKind, tiff_base: u64) -> Vec<TiffIfd> {
  let Some((endian, big_tiff, mut first_ifd)) = read_header_at(kind, tiff_base) else {
    return vec![];
  };
  first_ifd = first_ifd.saturating_add(tiff_base);

  let mut ifds = Vec::new();
  let mut ifd_offset = first_ifd;
  for index in 0..MAX_IFDS {
    if ifd_offset == 0 {
      break;
    }
    let count_bytes = if big_tiff { 8usize } else { 2usize };
    let count_buf = match read_at(kind, ifd_offset, count_bytes) {
      Ok(b) => b,
      Err(_) => break,
    };
    if count_buf.len() < count_bytes {
      break;
    }
    let entry_count = if big_tiff {
      read_u64(&count_buf, 0, endian)
    } else {
      read_u16(&count_buf, 0, endian) as u64
    };
    if entry_count == 0 || entry_count > MAX_IFD_ENTRIES {
      break;
    }
    let entry_size = if big_tiff { 20usize } else { 12usize };
    let next_offset_bytes = if big_tiff { 8usize } else { 4usize };
    let dir_len = entry_count as usize * entry_size + next_offset_bytes;
    let directory = match read_at(kind, ifd_offset + count_bytes as u64, dir_len) {
      Ok(b) => b,
      Err(_) => break,
    };
    if directory.len() < entry_count as usize * entry_size + next_offset_bytes {
      break;
    }

    let mut ifd = TiffIfd {
      index,
      width: None,
      height: None,
      bits_per_sample: vec![],
      compression: None,
      photometric: None,
      description: String::new(),
      strip_offsets: vec![],
      samples_per_pixel: 1,
      rows_per_strip: None,
      strip_byte_counts: vec![],
      planar_configuration: None,
      predictor: None,
    };

    for entry_index in 0..entry_count as usize {
      let o = entry_index * entry_size;
      let entry = &directory[o..o + entry_size];
      let tag = read_u16(entry, 0, endian);
      if !matches!(
        tag,
        TAG_IMAGE_WIDTH
          | TAG_IMAGE_LENGTH
          | TAG_BITS_PER_SAMPLE
          | TAG_COMPRESSION
          | TAG_PHOTOMETRIC
          | TAG_IMAGE_DESCRIPTION
          | TAG_STRIP_OFFSETS
          | TAG_SAMPLES_PER_PIXEL
          | TAG_ROWS_PER_STRIP
          | TAG_STRIP_BYTE_COUNTS
          | TAG_PLANAR_CONFIGURATION
          | TAG_PREDICTOR
      ) {
        continue;
      }
      let ty = read_u16(entry, 2, endian);
      let count = if big_tiff {
        read_u64(entry, 4, endian)
      } else {
        read_u32(entry, 4, endian) as u64
      };

      if tag == TAG_IMAGE_DESCRIPTION && ty == TYPE_ASCII {
        if let Some(data) = read_tag_data(kind, tiff_base, entry, ty, count, endian, big_tiff) {
          let s = String::from_utf8_lossy(&data);
          ifd.description = s.split('\0').next().unwrap_or("").trim().to_string();
        }
        continue;
      }

      let Some(data) = read_tag_data(kind, tiff_base, entry, ty, count, endian, big_tiff) else {
        continue;
      };
      let values = number_array_from_tag(ty, &data, endian);
      let first = *values.first().unwrap_or(&0);

      match tag {
        TAG_IMAGE_WIDTH => ifd.width = Some(first as u32),
        TAG_IMAGE_LENGTH => ifd.height = Some(first as u32),
        TAG_BITS_PER_SAMPLE => ifd.bits_per_sample = values.iter().map(|&v| v as u32).collect(),
        TAG_COMPRESSION => ifd.compression = Some(first as u16),
        TAG_PHOTOMETRIC => ifd.photometric = Some(first as u16),
        TAG_STRIP_OFFSETS => ifd.strip_offsets = values,
        TAG_SAMPLES_PER_PIXEL => ifd.samples_per_pixel = first as u32,
        TAG_ROWS_PER_STRIP => ifd.rows_per_strip = Some(first as u32),
        TAG_STRIP_BYTE_COUNTS => ifd.strip_byte_counts = values,
        TAG_PLANAR_CONFIGURATION => ifd.planar_configuration = Some(first as u16),
        TAG_PREDICTOR => ifd.predictor = Some(first as u16),
        _ => {}
      }
    }

    ifds.push(ifd);
    let next_off_pos = entry_count as usize * entry_size;
    ifd_offset = tiff_base.saturating_add(read_offset(
      &directory[next_off_pos..next_off_pos + next_offset_bytes],
      0,
      endian,
      big_tiff,
    ));
  }
  ifds
}

fn is_supported_candidate(ifd: &TiffIfd) -> bool {
  let Some(w) = ifd.width else { return false };
  let Some(h) = ifd.height else { return false };
  let Some(c) = ifd.compression else { return false };
  if ifd.strip_offsets.is_empty() || ifd.strip_offsets.len() != ifd.strip_byte_counts.len() {
    return false;
  }
  if ifd.planar_configuration.is_some_and(|p| p != 1) {
    return false;
  }
  let spp = ifd.samples_per_pixel;
  if ![1, 3, 4].contains(&spp) {
    return false;
  }
  let bits = if ifd.bits_per_sample.is_empty() {
    vec![8]
  } else {
    ifd.bits_per_sample.clone()
  };
  if bits.iter().any(|&b| b != 8) {
    return false;
  }
  if ![COMPRESSION_NONE, COMPRESSION_LZW, COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].contains(&c) {
    return false;
  }
  if matches!(c, COMPRESSION_JPEG_OLD | COMPRESSION_JPEG) && ifd.strip_offsets.len() != 1 {
    return false;
  }
  (w as u64) * (h as u64) <= MAX_EMBEDDED_LABEL_PIXELS
}

fn score_candidate(ifd: &TiffIfd, base: Option<&TiffIfd>) -> i64 {
  if !is_supported_candidate(ifd) {
    return -1;
  }
  let desc = ifd.description.to_lowercase();
  let mut score: i64 = 0;
  if desc.contains("label") || desc.contains("barcode") {
    score += 10_000;
  } else if desc.contains("macro") {
    score += 5_000;
  } else {
    if ifd.index == 0 {
      return -1;
    }
    let (Some(w), Some(h)) = (ifd.width, ifd.height) else {
      return -1;
    };
    let ratio = w as f64 / h as f64;
    let base_ratio = base.and_then(|b| {
      let bw = b.width?;
      let bh = b.height?;
      Some(bw as f64 / bh as f64)
    });
    let ratio_diff = base_ratio.map(|br| (ratio / br).ln().abs()).unwrap_or(1.0);
    let elongated = ratio >= 2.0 || ratio <= 0.5;
    if !elongated && ratio_diff < 0.2 {
      return -1;
    }
    score += 1_000;
    if elongated {
      score += 500;
    }
    score += ((w as i64) * (h as i64) / 1000).min(2000);
  }
  if matches!(
    ifd.compression.unwrap_or(0),
    COMPRESSION_JPEG_OLD | COMPRESSION_JPEG
  ) {
    score += 200;
  } else {
    score += 100;
  }
  score
}

fn select_label_ifd(ifds: &[TiffIfd]) -> Option<&TiffIfd> {
  let base = ifds.first();
  let mut best: Option<(&TiffIfd, i64)> = None;
  for ifd in ifds {
    let s = score_candidate(ifd, base);
    if s < 0 {
      continue;
    }
    if best.map(|(_, bs)| s > bs).unwrap_or(true) {
      best = Some((ifd, s));
    }
  }
  best.map(|(ifd, _)| ifd)
}

fn tiff_lzw_decode(input: &[u8], max_output_bytes: usize) -> Option<Vec<u8>> {
  const CLEAR_CODE: u32 = 256;
  const END_CODE: u32 = 257;
  let mut bit_offset: usize = 0;
  let mut code_size: u32 = 9;
  let mut next_code: u32 = 258;
  let mut dictionary: Vec<Vec<u8>> = (0..256).map(|i| vec![i as u8]).collect();
  dictionary.push(vec![]);
  dictionary.push(vec![]);

  let reset = |dict: &mut Vec<Vec<u8>>, cs: &mut u32, nc: &mut u32| {
    dict.clear();
    dict.extend((0..256).map(|i| vec![i as u8]));
    dict.push(vec![]);
    dict.push(vec![]);
    *cs = 9;
    *nc = 258;
  };

  let read_code = |input: &[u8], bit_offset: &mut usize, code_size: u32| -> Option<u32> {
    let mut code: u32 = 0;
    for bit in 0..code_size {
      let bo = *bit_offset + bit as usize;
      let byte = *input.get(bo >> 3)?;
      code = (code << 1) | (((byte >> (7 - (bo & 7))) & 1) as u32);
    }
    *bit_offset += code_size as usize;
    Some(code)
  };

  reset(&mut dictionary, &mut code_size, &mut next_code);
  let mut previous: Option<Vec<u8>> = None;
  let mut chunks: Vec<Vec<u8>> = vec![];
  let mut total: usize = 0;

  while bit_offset + code_size as usize <= input.len() * 8 {
    let code = read_code(input, &mut bit_offset, code_size)?;
    if code == CLEAR_CODE {
      reset(&mut dictionary, &mut code_size, &mut next_code);
      previous = None;
      continue;
    }
    if code == END_CODE {
      break;
    }

    let mut entry = dictionary.get(code as usize).cloned().filter(|e| !e.is_empty());
    if entry.is_none() {
      if let Some(prev) = &previous {
        if code == next_code {
          let mut e = prev.clone();
          e.push(*prev.first()?);
          entry = Some(e);
        }
      }
    }
    let entry = entry?;

    total = total.saturating_add(entry.len());
    if total > max_output_bytes {
      return None;
    }
    chunks.push(entry.clone());

    if let Some(prev) = &previous {
      if (next_code as usize) < 4096 {
        let mut n = prev.clone();
        n.push(*entry.first()?);
        dictionary.push(n);
        next_code += 1;
        if next_code == (1u32 << code_size) - 1 && code_size < 12 {
          code_size += 1;
        }
      }
    }
    previous = Some(entry);
  }

  let mut out = vec![0u8; total];
  let mut offset = 0usize;
  for chunk in chunks {
    let end = offset + chunk.len();
    if end > out.len() {
      return None;
    }
    out[offset..end].copy_from_slice(&chunk);
    offset = end;
  }
  Some(out)
}

fn read_raster_data(kind: &SourceKind, tiff_base: u64, ifd: &TiffIfd) -> Option<Vec<u8>> {
  let w = ifd.width? as usize;
  let h = ifd.height? as usize;
  let samples = ifd.samples_per_pixel.max(1) as usize;
  let row_bytes = w.checked_mul(samples)?;
  let expected_bytes = row_bytes.checked_mul(h)?;
  if expected_bytes == 0 || expected_bytes > (MAX_EMBEDDED_LABEL_PIXELS * 4) as usize {
    return None;
  }
  let mut out = vec![0u8; expected_bytes];
  let rows_per_strip = ifd.rows_per_strip.unwrap_or(h as u32).max(1) as usize;
  let compression = ifd.compression?;
  let mut out_offset = 0usize;
  for index in 0..ifd.strip_offsets.len() {
    let rows = rows_per_strip.min(h.saturating_sub(index * rows_per_strip));
    let expected_strip_bytes = rows.checked_mul(row_bytes)?;
    let strip_off = tiff_base.saturating_add(ifd.strip_offsets.get(index)?.to_owned());
    let strip_len = *ifd.strip_byte_counts.get(index)? as usize;
    let strip = read_at(kind, strip_off, strip_len).ok()?;
    let decoded = if compression == COMPRESSION_LZW {
      tiff_lzw_decode(&strip, expected_strip_bytes)?
    } else {
      strip
    };
    if decoded.len() < expected_strip_bytes {
      return None;
    }
    let end = out_offset + expected_strip_bytes;
    out[out_offset..end].copy_from_slice(&decoded[..expected_strip_bytes]);
    out_offset = end;
  }
  if ifd.predictor == Some(2) {
    for row in 0..h {
      let row_offset = row * row_bytes;
      for i in samples..row_bytes {
        let a = out[row_offset + i];
        let b = out[row_offset + i - samples];
        out[row_offset + i] = a.wrapping_add(b);
      }
    }
  }
  Some(out)
}

fn raster_to_rgb(raster: &[u8], ifd: &TiffIfd) -> Option<Vec<u8>> {
  let w = ifd.width? as usize;
  let h = ifd.height? as usize;
  let samples = ifd.samples_per_pixel.max(1) as usize;
  let photometric = ifd.photometric.unwrap_or(1);
  let mut rgb = vec![0u8; w * h * 3];
  let mut src = 0usize;
  let mut dst = 0usize;
  for _ in 0..(w * h) {
    if samples == 1 {
      let v = raster.get(src).copied()?;
      let value = if photometric == PHOTOMETRIC_WHITE_IS_ZERO {
        255u8.saturating_sub(v)
      } else {
        v
      };
      rgb[dst] = value;
      rgb[dst + 1] = value;
      rgb[dst + 2] = value;
      src += 1;
    } else {
      rgb[dst] = *raster.get(src)?;
      rgb[dst + 1] = *raster.get(src + 1)?;
      rgb[dst + 2] = *raster.get(src + 2)?;
      src += samples;
    }
    dst += 3;
  }
  Some(rgb)
}

fn rgb_png_data_url(rgb: &[u8], width: u32, height: u32) -> Option<String> {
  let mut buf = Vec::new();
  {
    let mut enc = png::Encoder::new(&mut buf, width, height);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().ok()?;
    w.write_image_data(rgb).ok()?;
  }
  Some(format!("data:image/png;base64,{}", STANDARD.encode(&buf)))
}

fn image_data_url_for_ifd(kind: &SourceKind, tiff_base: u64, ifd: &TiffIfd) -> Option<String> {
  let w = ifd.width?;
  let h = ifd.height?;
  let compression = ifd.compression?;

  if matches!(compression, COMPRESSION_JPEG_OLD | COMPRESSION_JPEG) {
    let byte_count = *ifd.strip_byte_counts.first()?;
    if byte_count > MAX_EMBEDDED_IMAGE_BYTES {
      return None;
    }
    let off = tiff_base.saturating_add(*ifd.strip_offsets.first()?);
    let data = read_at(kind, off, byte_count as usize).ok()?;
    if data.len() >= 2 && data[0] == 0xff && data[1] == 0xd8 {
      return Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(&data)));
    }
    return None;
  }

  if !matches!(compression, COMPRESSION_NONE | COMPRESSION_LZW) {
    return None;
  }
  let raster = read_raster_data(kind, tiff_base, ifd)?;
  let rgb = raster_to_rgb(&raster, ifd)?;
  rgb_png_data_url(&rgb, w, h)
}

fn read_from_source(kind: &SourceKind) -> Option<String> {
  let head_len = match kind {
    SourceKind::File(p) => {
      let len = std::fs::metadata(p).ok()?.len();
      len.min(TIFF_SCAN_BYTES) as usize
    }
    SourceKind::ZipStored { zip_path, entry_name } => {
      let info = get_zip_entry_info(zip_path, entry_name).ok()??;
      info.uncompressed_size.min(TIFF_SCAN_BYTES) as usize
    }
  };
  let head = read_at(kind, 0, head_len).ok()?;
  let tiff_base = sniff_tiff_base(&head);
  let ifds = read_ifds(kind, tiff_base);
  let label = select_label_ifd(&ifds)?;
  image_data_url_for_ifd(kind, tiff_base, label)
}

/// Same contract as Electron `readEmbeddedLabelThumbnailDataUrl`.
pub fn read_embedded_label_thumbnail_data_url(source: &str, cache_root: &Path) -> Option<String> {
  if let Some((zip_path, entry_name)) = parse_zip_entry_source(source) {
    let zip_pb = PathBuf::from(&zip_path);
    let info = get_zip_entry_info(&zip_pb, &entry_name).ok()??;
    if info.encrypted {
      return None;
    }
    if info.compression_method == 0 {
      let sk = SourceKind::ZipStored {
        zip_path: zip_pb,
        entry_name,
      };
      return read_from_source(&sk);
    }
    let materialized = materialize_zip_entry_source_for_viewing(source, cache_root).ok()?;
    if materialized == source {
      return None;
    }
    return read_from_source(&SourceKind::File(PathBuf::from(materialized)));
  }

  read_from_source(&SourceKind::File(PathBuf::from(source)))
}
