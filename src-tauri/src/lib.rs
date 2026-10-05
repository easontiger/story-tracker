pub mod db;
pub mod importers;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::db::{Catalog, DiffPreview, Snapshot, Store};
    use std::io::Read;
    use std::sync::Mutex;
    use tauri::{Manager, State};
    use tauri_plugin_dialog::DialogExt;

    type Db = Mutex<Store>;

    #[tauri::command]
    fn get_snapshot(db: State<'_, Db>) -> Result<Snapshot, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .snapshot()
    }

    #[tauri::command]
    fn preview_catalog(catalog: Catalog, db: State<'_, Db>) -> Result<DiffPreview, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .preview(&catalog)
    }

    #[tauri::command]
    fn apply_catalog(
        catalog: Catalog,
        expected_revision: i64,
        db: State<'_, Db>,
    ) -> Result<Snapshot, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .apply(&catalog, expected_revision)
    }

    #[tauri::command]
    fn preview_append_catalog(catalog: Catalog, db: State<'_, Db>) -> Result<DiffPreview, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .preview_append(&catalog)
    }

    #[tauri::command]
    fn apply_append_catalog(
        catalog: Catalog,
        expected_revision: i64,
        db: State<'_, Db>,
    ) -> Result<Snapshot, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .apply_append(&catalog, expected_revision)
    }

    #[tauri::command]
    fn set_watched(node_id: String, watched: bool, db: State<'_, Db>) -> Result<Snapshot, String> {
        db.lock()
            .map_err(|_| "Database lock unavailable")?
            .set_watched(&node_id, watched)
    }

    #[tauri::command]
    fn list_import_modules() -> Result<crate::importers::Registry, String> {
        crate::importers::discover(&crate::importers::module_root()?)
    }

    #[tauri::command]
    async fn import_module(id: String) -> Result<crate::importers::ImportResult, String> {
        let root = crate::importers::module_root()?;
        tauri::async_runtime::spawn_blocking(move || crate::importers::run_module(&root, &id))
            .await
            .map_err(|e| e.to_string())?
    }

    fn export_directory() -> Result<std::path::PathBuf, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let directory = exe
            .parent()
            .ok_or("Unable to locate application directory")?
            .join("export");
        std::fs::create_dir_all(&directory).map_err(|e| format!("无法创建导入导出目录：{e}"))?;
        Ok(directory)
    }

    #[tauri::command]
    async fn import_json(
        app: tauri::AppHandle,
        window: tauri::WebviewWindow,
    ) -> Result<Option<serde_json::Value>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let Some(file) = app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("导入 JSON")
                .set_directory(export_directory()?)
                .add_filter("JSON", &["json"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            let path = file.into_path().map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            std::fs::File::open(path)
                .map_err(|e| format!("读取失败：{e}"))?
                .take(16 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| format!("读取失败：{e}"))?;
            if bytes.len() > 16 * 1024 * 1024 {
                return Err("导入文件超过大小限制".into());
            }
            let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
            let value = serde_json::from_slice(bytes).map_err(|e| format!("JSON 格式无效：{e}"))?;
            Ok(Some(value))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn export_catalog(
        app: tauri::AppHandle,
        window: tauri::WebviewWindow,
        output: crate::importers::ImportResult,
    ) -> Result<Option<String>, String> {
        if output.api_version != 1 {
            return Err("Unsupported export format".into());
        }
        output.catalog.validate()?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut bytes = serde_json::to_vec_pretty(&output).map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            if bytes.len() > 16 * 1024 * 1024 {
                return Err("导出文件超过大小限制".into());
            }
            let name: String = output
                .catalog
                .game
                .id
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .take(100)
                .collect();
            let name = name.trim().trim_end_matches('.');
            let name = if name.is_empty() { "catalog" } else { name };
            let Some(file) = app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("导出 JSON")
                .set_directory(export_directory()?)
                .add_filter("JSON", &["json"])
                .set_file_name(format!("{name}.json"))
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let path = file.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| format!("导出失败：{e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub fn run() {
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .setup(|app| {
                let dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&dir)?;
                let db = Store::open(&dir.join("story-tracker.sqlite3"))
                    .map_err(std::io::Error::other)?;
                app.manage(Mutex::new(db));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                get_snapshot,
                preview_catalog,
                apply_catalog,
                preview_append_catalog,
                apply_append_catalog,
                set_watched,
                list_import_modules,
                import_module,
                export_catalog,
                import_json
            ])
            .run(tauri::generate_context!())
            .expect("Unable to run Story Tracker");
    }
}

#[cfg(feature = "desktop")]
pub use desktop::run;
