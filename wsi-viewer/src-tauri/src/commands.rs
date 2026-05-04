use crate::embedded_label_thumbnail;
use crate::paths;
use crate::scan_rust;
use crate::types::{ScannedSlide, SlidesInfo};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
  pub session_slides_root: Mutex<Option<String>>,
}

#[tauri::command]
pub fn slides_get_info(state: State<'_, AppState>) -> Result<SlidesInfo, String> {
  let session = state.session_slides_root.lock().map_err(|e| e.to_string())?;
  let root = paths::slides_root(session.as_deref());
  Ok(SlidesInfo {
    application_root: paths::application_root_dir().to_string_lossy().to_string(),
    slides_root: root.to_string_lossy().to_string(),
  })
}

#[tauri::command]
pub fn slides_set_session_root(path: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
  let mut g = state.session_slides_root.lock().map_err(|e| e.to_string())?;
  *g = path;
  Ok(())
}

#[tauri::command]
pub fn slides_rescan(state: State<'_, AppState>) -> Result<Vec<ScannedSlide>, String> {
  let session = state.session_slides_root.lock().map_err(|e| e.to_string())?;
  paths::ensure_slides_dir(session.as_deref());
  let root = paths::slides_root(session.as_deref());
  let _ = paths::ensure_cache_dir();
  let cache = paths::cache_root_dir();
  scan_rust::scan_for_slides(&root, &cache).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wsi_path_to_url(absolute_path: String) -> Result<String, String> {
  paths::ensure_cache_dir().map_err(|e| e.to_string())?;
  let cache = paths::cache_root_dir();
  let materialized =
    crate::zip_ops::materialize_zip_entry_source_for_viewing(&absolute_path, &cache).map_err(|e| e.to_string())?;
  Ok(crate::wsi::to_wsi_url(&materialized))
}

#[tauri::command]
pub fn wsi_embedded_label_thumbnail(absolute_path: String) -> Option<String> {
  let _ = paths::ensure_cache_dir();
  embedded_label_thumbnail::read_embedded_label_thumbnail_data_url(&absolute_path, &paths::cache_root_dir())
}
