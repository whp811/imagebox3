use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use http::header::{
  ACCESS_CONTROL_ALLOW_ORIGIN, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
};
use http::status::StatusCode;
use http::{Method, Response};
use http_range::HttpRange;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::zip_ops::{get_zip_entry_info, parse_zip_entry_source, read_stored_zip_entry_range};

/// Plain-path GET-without-Range reads whole file up to this cap (materialized slides; some webviews omit Range on custom schemes).
const MAX_PLAIN_READ_ALL_BYTES: u64 = 12 * 1024 * 1024 * 1024;

fn path_from_uri(uri: &http::Uri) -> Result<String, ()> {
  let p = uri.path().trim_start_matches('/');
  let host = uri.host().unwrap_or("");
  let id = if p.is_empty() { host } else { p };
  if id.is_empty() {
    return Err(());
  }
  let bytes = URL_SAFE_NO_PAD.decode(id).map_err(|_| ())?;
  String::from_utf8(bytes).map_err(|_| ())
}

fn display_name_from_source(source: &str) -> String {
  if let Some((_, ref entry)) = parse_zip_entry_source(source) {
    Path::new(entry)
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or(entry)
      .to_string()
  } else {
    Path::new(source)
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("")
      .to_string()
  }
}

/// Same string shape as Electron `toWsiUrl` (for OpenSlide/fetch + Range).
pub fn to_wsi_url(absolute_file_path: &str) -> String {
  let display_name = display_name_from_source(absolute_file_path);
  let name = urlencoding::encode(&display_name);
  let enc = URL_SAFE_NO_PAD.encode(absolute_file_path.as_bytes());
  format!("wsi://local/{enc}?name={name}")
}

fn parse_range_header(range_header: &str, size: u64) -> Option<(u64, u64)> {
  if !range_header.starts_with("bytes=") {
    return None;
  }
  let re = regex::Regex::new(r"bytes=(\d*)-(\d*)").ok()?;
  let m = re.captures(range_header)?;
  let mut start = m.get(1)?.as_str().parse::<u64>().unwrap_or(0);
  let end_part = m.get(2)?.as_str();
  let mut end = if end_part.is_empty() {
    size.saturating_sub(1)
  } else {
    end_part.parse::<u64>().ok()?
  };
  if m.get(1)?.as_str().is_empty() && !end_part.is_empty() {
    let suffix = end_part.parse::<u64>().ok()?;
    start = size.saturating_sub(suffix);
    end = size.saturating_sub(1);
  }
  if end >= size {
    end = size.saturating_sub(1);
  }
  if start > end {
    return None;
  }
  Some((start, end))
}

pub fn handle_wsi_request<B>(request: http::Request<B>) -> Result<Response<Vec<u8>>, String> {
  match request.method() {
    &Method::HEAD => head_response(&request),
    &Method::GET => get_response(&request),
    _ => response_plain(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed"),
  }
}

fn cors_builder(builder: http::response::Builder) -> http::response::Builder {
  builder
    .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    .header(
      "Access-Control-Expose-Headers",
      "Content-Range, Content-Length, Accept-Ranges",
    )
}

fn response_plain(status: StatusCode, msg: &str) -> Result<Response<Vec<u8>>, String> {
  Ok(
    cors_builder(Response::builder().status(status).header(CONTENT_TYPE, "text/plain"))
      .body(msg.as_bytes().to_vec())
      .map_err(|e| e.to_string())?,
  )
}

fn head_response<B>(request: &http::Request<B>) -> Result<Response<Vec<u8>>, String> {
  let uri = request.uri();
  let abs = path_from_uri(uri).map_err(|_| "Bad wsi URL".to_string())?;
  if let Some((zip_path, entry_name)) = parse_zip_entry_source(&abs) {
    let zp = PathBuf::from(&zip_path);
    let entry = get_zip_entry_info(&zp, &entry_name)
      .map_err(|e| e.to_string())?
      .ok_or_else(|| "ZIP entry not found".to_string())?;
    if entry.encrypted {
      return Ok(
        cors_builder(Response::builder().status(StatusCode::UNSUPPORTED_MEDIA_TYPE))
          .body(vec![])
          .unwrap(),
      );
    }
    if entry.compression_method != 0 {
      return Ok(
        cors_builder(Response::builder().status(StatusCode::UNSUPPORTED_MEDIA_TYPE))
          .body(vec![])
          .unwrap(),
      );
    }
    return Ok(
      cors_builder(Response::builder().status(StatusCode::OK))
        .header(CONTENT_LENGTH, entry.uncompressed_size.to_string())
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(ACCEPT_RANGES, "bytes")
        .body(vec![])
        .unwrap(),
    );
  }
  let meta = fs::metadata(&abs).map_err(|_| "Not found".to_string())?;
  if !meta.is_file() {
    return response_plain(StatusCode::BAD_REQUEST, "Not a file");
  }
  let len = meta.len();
  Ok(
    cors_builder(Response::builder().status(StatusCode::OK))
      .header(CONTENT_LENGTH, len.to_string())
      .header(CONTENT_TYPE, "application/octet-stream")
      .header(ACCEPT_RANGES, "bytes")
      .body(vec![])
      .unwrap(),
  )
}

fn get_response<B>(request: &http::Request<B>) -> Result<Response<Vec<u8>>, String> {
  let uri = request.uri();
  let abs = path_from_uri(uri).map_err(|_| "Bad wsi URL".to_string())?;
  let range_hdr = request
    .headers()
    .get("range")
    .and_then(|v| v.to_str().ok());

  if let Some((zip_path, entry_name)) = parse_zip_entry_source(&abs) {
    return get_zip_response(&zip_path, &entry_name, range_hdr);
  }

  get_plain_file_response(Path::new(&abs), range_hdr)
}

fn get_zip_response(
  zip_path: &str,
  entry_name: &str,
  range_hdr: Option<&str>,
) -> Result<Response<Vec<u8>>, String> {
  let zp = PathBuf::from(zip_path);
  let entry = get_zip_entry_info(&zp, entry_name)
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "ZIP entry not found".to_string())?;
  if entry.encrypted {
    return response_plain(StatusCode::UNSUPPORTED_MEDIA_TYPE, "ZIP slide entry is encrypted");
  }
  if entry.compression_method != 0 {
    return response_plain(
      StatusCode::UNSUPPORTED_MEDIA_TYPE,
      "ZIP slide entry is compressed; rebuild the ZIP with store/no-compression mode",
    );
  }
  let file_size = entry.uncompressed_size;
  if let Some(rh) = range_hdr {
    let pr = parse_range_header(rh, file_size).ok_or_else(|| "Bad range".to_string())?;
    let (start, end) = pr;
    let data = read_stored_zip_entry_range(&zp, entry_name, start, end).map_err(|e| e.to_string())?;
    return Ok(
      cors_builder(Response::builder().status(StatusCode::PARTIAL_CONTENT))
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, data.len().to_string())
        .header(
          CONTENT_RANGE,
          format!("bytes {start}-{end}/{file_size}"),
        )
        .header(ACCEPT_RANGES, "bytes")
        .body(data)
        .unwrap(),
    );
  }
  if file_size > MAX_PLAIN_READ_ALL_BYTES {
    return response_plain(
      StatusCode::RANGE_NOT_SATISFIABLE,
      "ZIP slide too large for full read without Range; use stored ZIP or Range-capable client",
    );
  }
  let data =
    read_stored_zip_entry_range(&zp, entry_name, 0, file_size - 1).map_err(|e| e.to_string())?;
  Ok(
    cors_builder(Response::builder().status(StatusCode::OK))
      .header(CONTENT_TYPE, "application/octet-stream")
      .header(CONTENT_LENGTH, data.len().to_string())
      .header(ACCEPT_RANGES, "bytes")
      .body(data)
      .unwrap(),
  )
}

fn get_plain_file_response(path: &Path, range_hdr: Option<&str>) -> Result<Response<Vec<u8>>, String> {
  let meta = fs::metadata(path).map_err(|_| "Not found".to_string())?;
  if !meta.is_file() {
    return response_plain(StatusCode::BAD_REQUEST, "Not a file");
  }
  let file_size = meta.len();
  if file_size == 0 {
    return Ok(
      cors_builder(Response::builder().status(StatusCode::OK))
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, "0")
        .header(ACCEPT_RANGES, "bytes")
        .body(vec![])
        .unwrap(),
    );
  }
  if let Some(rh) = range_hdr {
    let ranges = HttpRange::parse(rh, file_size).map_err(|_| "Bad range".to_string())?;
    let r = ranges.get(0).ok_or_else(|| "Bad range".to_string())?;
    if r.length == 0 {
      return Err("Bad range".to_string());
    }
    if r.start >= file_size {
      return Ok(
        cors_builder(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
          .header(CONTENT_TYPE, "text/plain")
          .header(CONTENT_RANGE, format!("bytes */{file_size}"))
          .header(ACCEPT_RANGES, "bytes")
          .body(vec![])
          .unwrap(),
      );
    }
    let start = r.start;
    let raw_end = r.start.saturating_add(r.length).saturating_sub(1);
    let end = raw_end.min(file_size - 1);
    if start > end {
      return Ok(
        cors_builder(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
          .header(CONTENT_TYPE, "text/plain")
          .header(CONTENT_RANGE, format!("bytes */{file_size}"))
          .header(ACCEPT_RANGES, "bytes")
          .body(vec![])
          .unwrap(),
      );
    }
    let len = (end - start + 1) as usize;
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    return Ok(
      cors_builder(Response::builder().status(StatusCode::PARTIAL_CONTENT))
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, buf.len().to_string())
        .header(CONTENT_RANGE, format!("bytes {start}-{end}/{file_size}"))
        .header(ACCEPT_RANGES, "bytes")
        .body(buf)
        .unwrap(),
    );
  }
  if file_size > MAX_PLAIN_READ_ALL_BYTES {
    return response_plain(
      StatusCode::RANGE_NOT_SATISFIABLE,
      "Slide file too large for GET without Range on this build",
    );
  }
  let mut f = File::open(path).map_err(|e| e.to_string())?;
  let mut buf = Vec::with_capacity(file_size as usize);
  f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
  Ok(
    cors_builder(Response::builder().status(StatusCode::OK))
      .header(CONTENT_TYPE, "application/octet-stream")
      .header(CONTENT_LENGTH, buf.len().to_string())
      .header(ACCEPT_RANGES, "bytes")
      .body(buf)
      .unwrap(),
  )
}
