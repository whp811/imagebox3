use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlidesInfo {
  pub application_root: String,
  pub slides_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSlide {
  pub id: String,
  pub label: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub specimen_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub stain: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub file_name: Option<String>,
  pub absolute_path: String,
  pub relative_to_slides: String,
  pub ext: String,
  pub size_bytes: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub source_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub zip_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub zip_entry: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub zip_compression_method: Option<u16>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub requires_extraction: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub thumbnail_data_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub unsupported_reason: Option<String>,
}
