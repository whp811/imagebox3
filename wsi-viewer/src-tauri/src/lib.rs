mod commands;
mod embedded_label_thumbnail;
mod paths;
mod scan_rust;
mod types;
mod wsi;
mod zip_ops;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())
    .manage(commands::AppState {
      session_slides_root: std::sync::Mutex::new(None),
    })
    .setup(|_app| {
      let _ = paths::ensure_cache_dir();
      let _ = paths::ensure_slides_dir(None);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::slides_get_info,
      commands::slides_set_session_root,
      commands::slides_rescan,
      commands::wsi_path_to_url,
      commands::wsi_embedded_label_thumbnail,
    ])
    .register_asynchronous_uri_scheme_protocol("wsi", |_ctx, request, responder| {
      match wsi::handle_wsi_request(request) {
        Ok(http_response) => responder.respond(http_response),
        Err(e) => {
          let err = http::Response::builder()
            .status(http::status::StatusCode::INTERNAL_SERVER_ERROR)
            .header(http::header::CONTENT_TYPE, "text/plain")
            .body(e.as_bytes().to_vec())
            .unwrap_or_else(|_| {
              http::Response::builder()
                .status(http::status::StatusCode::INTERNAL_SERVER_ERROR)
                .body(vec![])
                .unwrap()
            });
          responder.respond(err);
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
