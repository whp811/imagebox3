use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{copy, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use zip::read::ZipArchive;
use zip::CompressionMethod;

const ZIP_SOURCE_PREFIX: &str = "zip-entry:";
const DEFAULT_MAX_ZIP_CACHE_BYTES: u64 = 6 * 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MIN_ZIP_CACHE_PRUNE_AGE: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct ZipEntryInfo {
    pub file_name: String,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub compression_method: u16,
    pub encrypted: bool,
}

pub fn compression_as_u16(c: CompressionMethod) -> u16 {
    match c {
        CompressionMethod::Stored => 0,
        CompressionMethod::Deflated => 8,
        _ => u16::MAX,
    }
}

pub fn make_zip_entry_source(zip_path: &str, entry_name: &str) -> String {
    format!(
        "{}{}:{}",
        ZIP_SOURCE_PREFIX,
        URL_SAFE_NO_PAD.encode(zip_path.as_bytes()),
        URL_SAFE_NO_PAD.encode(entry_name.as_bytes())
    )
}

pub fn parse_zip_entry_source(source: &str) -> Option<(String, String)> {
    if !source.starts_with(ZIP_SOURCE_PREFIX) {
        return None;
    }
    let rest = &source[ZIP_SOURCE_PREFIX.len()..];
    let mut split = rest.splitn(2, ':');
    let a = split.next()?;
    let b = split.next()?;
    let zip_bytes = URL_SAFE_NO_PAD.decode(a).ok()?;
    let entry_bytes = URL_SAFE_NO_PAD.decode(b).ok()?;
    Some((
        String::from_utf8(zip_bytes).ok()?,
        String::from_utf8(entry_bytes).ok()?,
    ))
}

pub fn list_zip_entries(
    zip_path: &Path,
) -> Result<Vec<ZipEntryInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let z = archive.by_index(i)?;
        if z.is_dir() {
            continue;
        }
        out.push(ZipEntryInfo {
            file_name: z.name().to_string(),
            compressed_size: z.compressed_size(),
            uncompressed_size: z.size(),
            compression_method: compression_as_u16(z.compression()),
            encrypted: z.encrypted(),
        });
    }
    Ok(out)
}

pub fn get_zip_entry_info(
    zip_path: &Path,
    entry_name: &str,
) -> Result<Option<ZipEntryInfo>, Box<dyn std::error::Error + Send + Sync>> {
    for e in list_zip_entries(zip_path)? {
        if e.file_name == entry_name {
            return Ok(Some(e));
        }
    }
    Ok(None)
}

fn zip_cache_path(
    cache_root: &Path,
    zip_path: &Path,
    entry_name: &str,
    info: &ZipEntryInfo,
    zip_fingerprint: &str,
) -> PathBuf {
    let json = serde_json::json!([
        zip_path.to_string_lossy(),
        zip_fingerprint,
        entry_name,
        info.compressed_size,
        info.uncompressed_size,
        info.compression_method,
    ])
    .to_string();
    let mut h = Sha256::new();
    h.update(json.as_bytes());
    let digest = hex::encode(h.finalize());
    let digest24: String = digest.chars().take(24).collect();
    let ext = Path::new(entry_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{}", s))
        .unwrap_or_else(|| ".wsi".to_string());
    cache_root
        .join("zip-cache")
        .join(format!("{digest24}{ext}"))
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn prune_zip_cache(
    cache_root: &Path,
    keep_path: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let max_bytes = env_u64("WSI_HIVE_MAX_ZIP_CACHE_BYTES", DEFAULT_MAX_ZIP_CACHE_BYTES);
    let min_free = env_u64("WSI_HIVE_MIN_FREE_BYTES", DEFAULT_MIN_FREE_BYTES);
    let dir = cache_root.join("zip-cache");
    let oldest_prunable = SystemTime::now()
        .checked_sub(MIN_ZIP_CACHE_PRUNE_AGE)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut total = 0_u64;
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();

    let Ok(read_dir) = fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in read_dir {
        let path = entry?.path();
        if path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.ends_with(".tmp"))
            .unwrap_or(false)
        {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(meta) if meta.is_file() => meta,
            _ => continue,
        };
        total += meta.len();
        if path != keep_path {
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if modified <= oldest_prunable {
                entries.push((path, meta.len(), modified));
            }
        }
    }

    entries.sort_by_key(|(_, _, modified)| *modified);
    let mut free = fs2::available_space(cache_root).ok();
    for (path, size, _) in entries {
        if total <= max_bytes && free.map(|bytes| bytes >= min_free).unwrap_or(true) {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
            if let Some(bytes) = free.as_mut() {
                *bytes = bytes.saturating_add(size);
            }
        }
    }
    Ok(())
}

fn extract_deflated_to_cache(
    zip_path: &Path,
    entry_name: &str,
    cache_root: &Path,
    info: &ZipEntryInfo,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let meta = fs::metadata(zip_path)?;
    let fingerprint = format!(
        "{}:{}",
        meta.len(),
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let target = zip_cache_path(cache_root, zip_path, entry_name, info, &fingerprint);
    if target.exists() {
        if let Ok(m) = fs::metadata(&target) {
            if m.is_file() && m.len() == info.uncompressed_size {
                let _ = prune_zip_cache(cache_root, &target);
                return Ok(target.to_string_lossy().to_string());
            }
        }
    }
    let mut zipf = File::open(zip_path)?;
    let mut archive = ZipArchive::new(&mut zipf)?;
    let mut z = archive.by_name(entry_name)?;
    let tmp = target.with_extension(format!("{}.tmp", std::process::id()));
    {
        let mut out = File::create(&tmp)?;
        copy(&mut z, &mut out)?;
    }
    drop(z);
    drop(archive);
    let tm = fs::metadata(&tmp)?;
    if tm.len() != info.uncompressed_size {
        let _ = fs::remove_file(&tmp);
        return Err("Extracted ZIP entry size mismatch".into());
    }
    let _ = fs::remove_file(&target);
    fs::rename(&tmp, &target)?;
    let _ = prune_zip_cache(cache_root, &target);
    Ok(target.to_string_lossy().to_string())
}

/// Mirrors Electron `materializeZipEntrySourceForViewing`.
pub fn materialize_zip_entry_source_for_viewing(
    source: &str,
    cache_root: &Path,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let Some((zip_path, entry_name)) = parse_zip_entry_source(source) else {
        return Ok(source.to_string());
    };
    let zip_path = PathBuf::from(&zip_path);
    let info = get_zip_entry_info(&zip_path, &entry_name)?;
    let Some(info) = info else {
        return Err(format!("ZIP entry not found: {entry_name}").into());
    };
    if info.encrypted {
        return Err("ZIP slide entry is encrypted".into());
    }
    if info.compression_method == 0 {
        return Ok(source.to_string());
    }
    if info.compression_method != 8 {
        return Err(format!(
            "Unsupported ZIP compression method: {}",
            info.compression_method
        )
        .into());
    }
    extract_deflated_to_cache(&zip_path, &entry_name, cache_root, &info)
}

/// STORED zip entries only — matches Electron guard for range reads.
pub fn read_stored_zip_entry_range(
    zip_path: &Path,
    entry_name: &str,
    start: u64,
    end_inclusive: u64,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mut zipf = File::open(zip_path)?;
    let mut archive = ZipArchive::new(&mut zipf)?;
    let data_start = {
        let z = archive.by_name(entry_name)?;
        if z.encrypted() {
            return Err("encrypted zip entry".into());
        }
        if z.compression() != CompressionMethod::Stored {
            return Err(
                "ZIP slide entries must be stored without compression for WSI range reads".into(),
            );
        }
        Some(z.data_start()).ok_or("missing data_start offset")?
    };
    drop(archive);
    let len = (end_inclusive - start + 1) as usize;
    let mut raw = File::open(zip_path)?;
    raw.seek(SeekFrom::Start(data_start + start))?;
    let mut buf = vec![0u8; len];
    raw.read_exact(&mut buf)?;
    Ok(buf)
}

pub fn zip_basename(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    Path::new(&normalized)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_string()
}
