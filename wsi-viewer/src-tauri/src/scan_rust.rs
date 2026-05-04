use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use std::path::Path;
use walkdir::WalkDir;

use crate::embedded_label_thumbnail;
use crate::types::ScannedSlide;
use crate::zip_ops::{list_zip_entries, make_zip_entry_source, zip_basename};

fn id_for_string(s: &str) -> String {
    URL_SAFE_NO_PAD.encode(s.as_bytes())
}

fn is_wsi_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".svs")
        || lower.ends_with(".tif")
        || lower.ends_with(".tiff")
        || lower.ends_with(".gtiff")
        || lower.ends_with(".ndpi")
}

fn is_zip(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".zip")
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Subset of Electron `scanForSlides` — USB layouts + embedded label thumbnails.
pub fn scan_for_slides(
    slides_root: &Path,
    cache_root: &Path,
) -> Result<Vec<ScannedSlide>, Box<dyn std::error::Error + Send + Sync>> {
    let _ = std::fs::create_dir_all(slides_root);
    let root = slides_root.to_path_buf();

    fn push_plain(
        root: &Path,
        path: &Path,
        cache_root: &Path,
        out: &mut Vec<ScannedSlide>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let meta = std::fs::metadata(path)?;
        if !meta.is_file() {
            return Ok(());
        }
        let abs = path.to_string_lossy().to_string();
        let rel = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| abs.clone());
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let thumb =
            embedded_label_thumbnail::read_embedded_label_thumbnail_data_url(&abs, cache_root);
        out.push(ScannedSlide {
            id: id_for_string(&abs),
            label: file_name.clone(),
            specimen_id: None,
            stain: None,
            file_name: Some(file_name.clone()),
            absolute_path: abs,
            relative_to_slides: rel,
            ext: format!(".{}", ext_of(&file_name)),
            size_bytes: meta.len() as i64,
            source_type: None,
            zip_path: None,
            zip_entry: None,
            zip_compression_method: None,
            requires_extraction: None,
            thumbnail_data_url: thumb,
            unsupported_reason: None,
        });
        Ok(())
    }

    fn add_zip_slides(
        root: &Path,
        zip_path: &Path,
        cache_root: &Path,
        out: &mut Vec<ScannedSlide>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let entries = match list_zip_entries(zip_path) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        let zip_str = zip_path.to_string_lossy().to_string();
        let rel_zip = zip_path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| zip_str.clone());
        for entry in entries.iter().filter(|e| is_wsi_file(&e.file_name)) {
            let source = make_zip_entry_source(&zip_str, &entry.file_name);
            let file_name = zip_basename(&entry.file_name);
            let unsupported_reason = if entry.encrypted {
                Some("ZIP slide entry is encrypted. Use an unencrypted ZIP.".to_string())
            } else if entry.compression_method == 0 || entry.compression_method == 8 {
                None
            } else {
                Some(format!(
                    "Unsupported ZIP compression method: {}",
                    entry.compression_method
                ))
            };
            let requires_extraction = Some(entry.compression_method == 8);
            let thumb = embedded_label_thumbnail::read_embedded_label_thumbnail_data_url(
                &source, cache_root,
            );
            out.push(ScannedSlide {
                id: id_for_string(&source),
                label: file_name.clone(),
                specimen_id: None,
                stain: None,
                file_name: Some(file_name),
                absolute_path: source,
                relative_to_slides: format!("{}!/{}", rel_zip, entry.file_name),
                ext: format!(".{}", ext_of(&entry.file_name)),
                size_bytes: entry.uncompressed_size as i64,
                source_type: Some("zip".into()),
                zip_path: Some(zip_str.clone()),
                zip_entry: Some(entry.file_name.clone()),
                zip_compression_method: Some(entry.compression_method),
                requires_extraction,
                thumbnail_data_url: thumb,
                unsupported_reason,
            });
        }
        Ok(())
    }

    let mut out: Vec<ScannedSlide> = Vec::new();

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if is_zip(name) {
            add_zip_slides(&root, path, cache_root, &mut out)?;
        } else if is_wsi_file(name) {
            push_plain(&root, path, cache_root, &mut out)?;
        }
    }

    out.sort_by(|a, b| {
        a.relative_to_slides
            .to_ascii_lowercase()
            .cmp(&b.relative_to_slides.to_ascii_lowercase())
    });
    Ok(out)
}
