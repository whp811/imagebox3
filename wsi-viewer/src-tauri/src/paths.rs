use regex::Regex;
use std::env;
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

fn home_dir() -> Option<PathBuf> {
  env::var_os("HOME")
    .or_else(|| env::var_os("USERPROFILE"))
    .map(PathBuf::from)
}

fn can_use_cache_root(path: &Path) -> bool {
  if fs::create_dir_all(path).is_err() {
    return false;
  }
  let probe = path.join(".write-test");
  if fs::write(&probe, b"ok").is_err() {
    return false;
  }
  let _ = fs::remove_file(probe);
  true
}

fn host_cache_root() -> Option<PathBuf> {
  if cfg!(target_os = "macos") {
    return home_dir().map(|home| home.join("Library").join("Caches").join("WSI Hive"));
  }
  if cfg!(target_os = "windows") {
    let base = env::var_os("LOCALAPPDATA")
      .map(PathBuf::from)
      .or_else(|| home_dir().map(|home| home.join("AppData").join("Local")))?;
    return Some(base.join("WSI Hive").join("Cache"));
  }
  let base = env::var_os("XDG_CACHE_HOME")
    .map(PathBuf::from)
    .or_else(|| home_dir().map(|home| home.join(".cache")))?;
  Some(base.join("wsi-hive"))
}

pub fn cache_root_dir() -> PathBuf {
  if let Ok(path) = env::var("WSI_HIVE_CACHE_ROOT") {
    let p = PathBuf::from(path);
    if can_use_cache_root(&p) {
      return p;
    }
  }

  let portable = application_root_dir().join(".wsi-hive-data");
  if env::var("WSI_HIVE_FORCE_PORTABLE_CACHE").ok().as_deref() != Some("1") {
    if let Some(host) = host_cache_root() {
      if can_use_cache_root(&host) {
        return host;
      }
    }
  }

  portable
}

pub fn ensure_cache_dir() -> std::io::Result<PathBuf> {
  let p = cache_root_dir();
  fs::create_dir_all(&p)?;
  fs::create_dir_all(p.join("zip-cache"))?;
  Ok(p)
}

pub fn clear_cache_dir() -> std::io::Result<()> {
  let p = cache_root_dir();
  if p.exists() {
    fs::remove_dir_all(p)?;
  }
  Ok(())
}
