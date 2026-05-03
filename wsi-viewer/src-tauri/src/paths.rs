use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

fn bundle_root_if_under_wsi_usb(exe: &Path, fallback: PathBuf) -> PathBuf {
  let s = exe.to_string_lossy();
  let Ok(re) = Regex::new(r"(?i)^(.+)[/\\]\.wsi-usb[/\\]") else {
    return fallback;
  };
  if let Some(c) = re.captures(&s) {
    let mut r = c.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
    if cfg!(target_os = "windows") {
      let drive_only = Regex::new(r"(?i)^[a-z]:$").ok().map(|x| x.is_match(&r)).unwrap_or(false);
      if drive_only {
        r.push('\\');
      }
    }
    return PathBuf::from(r);
  }
  fallback
}

/// Matches Electron `getApplicationRootDir` / flash-drive layout.
pub fn application_root_dir() -> PathBuf {
  if let Ok(p) = std::env::var("WSI_DEBUG_PORTABLE") {
    return PathBuf::from(p);
  }
  if let Ok(p) = std::env::var("PORTABLE_EXECUTABLE_DIR") {
    return PathBuf::from(p);
  }
  if cfg!(debug_assertions) {
    return std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
  }
  let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
  let base = if cfg!(target_os = "macos") {
    exe.parent()
      .and_then(|p| p.parent())
      .and_then(|p| p.parent())
      .and_then(|p| p.parent())
      .map(Path::to_path_buf)
      .unwrap_or_else(|| exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf())
  } else {
    exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf()
  };
  bundle_root_if_under_wsi_usb(&exe, base)
}

pub fn slides_root(session_override: Option<&str>) -> PathBuf {
  if let Some(p) = session_override {
    if !p.is_empty() {
      return PathBuf::from(p);
    }
  }
  application_root_dir().join("Slides")
}

pub fn ensure_slides_dir(session_override: Option<&str>) -> PathBuf {
  let p = slides_root(session_override);
  let _ = fs::create_dir_all(&p);
  p
}

pub fn cache_root_dir() -> PathBuf {
  application_root_dir().join(".wsi-hive-data")
}

pub fn ensure_cache_dir() -> std::io::Result<PathBuf> {
  let p = cache_root_dir();
  fs::create_dir_all(&p)?;
  fs::create_dir_all(p.join("zip-cache"))?;
  Ok(p)
}
