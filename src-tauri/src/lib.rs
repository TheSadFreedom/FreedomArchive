mod archive;
mod lookup;
mod net;

use std::collections::BTreeMap;

use archive::Archive;
use tauri::Manager;

fn placement_sub(subcategory: Option<String>) -> Option<String> {
    subcategory.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tauri::command]
fn list_entries(archive: tauri::State<Archive>) -> Result<Vec<archive::Entry>, String> {
    archive.list()
}

#[tauri::command]
fn add_entry(
    archive: tauri::State<Archive>,
    source_path: Option<String>,
    source_url: Option<String>,
    category: String,
    subcategory: Option<String>,
    rating: u8,
    title: String,
) -> Result<archive::Entry, String> {
    let sub = placement_sub(subcategory);
    let url = source_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(url) = url {
        let temp = archive::fetch_cover(url)?;
        let saved = archive.add(
            std::path::Path::new(&temp),
            &category,
            sub.as_deref(),
            rating,
            &title,
        );
        let _ = std::fs::remove_file(&temp);
        return saved;
    }
    let path = source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "выберите фото или вставьте ссылку".to_string())?;
    archive.add(
        std::path::Path::new(path),
        &category,
        sub.as_deref(),
        rating,
        &title,
    )
}

#[tauri::command]
fn update_card(
    archive: tauri::State<Archive>,
    relative_path: String,
    fields: BTreeMap<String, String>,
) -> Result<archive::Entry, String> {
    archive.update_card(&relative_path, fields)
}

#[tauri::command]
fn delete_entry(archive: tauri::State<Archive>, relative_path: String) -> Result<(), String> {
    archive.delete_entry(&relative_path)
}

#[tauri::command]
fn move_entry(
    archive: tauri::State<Archive>,
    relative_path: String,
    category: String,
    subcategory: Option<String>,
    rating: u8,
    title: String,
) -> Result<archive::Entry, String> {
    archive.move_entry(
        &relative_path,
        &category,
        placement_sub(subcategory).as_deref(),
        rating,
        &title,
    )
}

#[tauri::command]
fn lookup_meta(category: String, title: String) -> Result<BTreeMap<String, String>, String> {
    lookup::lookup(&category, &title)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let archive = Archive::open()?;
            archive.ensure_tree()?;
            app.asset_protocol_scope()
                .allow_directory(archive.root(), true)?;
            app.manage(archive);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            add_entry,
            update_card,
            move_entry,
            delete_entry,
            lookup_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
