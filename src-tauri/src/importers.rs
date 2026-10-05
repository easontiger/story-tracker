use crate::db::Catalog;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

type Result<T> = std::result::Result<T, String>;
const OUTPUT_LIMIT: u64 = 16 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub game_id: String,
    pub runtime: String,
    pub entry: String,
    #[serde(default)]
    pub progress_story_lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub modules: Vec<Manifest>,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportResult {
    pub api_version: u32,
    pub catalog: Catalog,
    #[serde(default)]
    pub warnings: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn read_manifest(dir: &Path) -> Result<Manifest> {
    let path = dir.join("manifest.json");
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 * 1024 {
        return Err("Module manifest exceeds size limit".into());
    }
    let manifest: Manifest = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid module manifest: {e}"))?;
    if manifest.api_version != 1 || !matches!(manifest.runtime.as_str(), "node" | "json") {
        return Err("Unsupported module API version or runtime".into());
    }
    if !valid_id(&manifest.id)
        || dir.file_name().and_then(|s| s.to_str()) != Some(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.name.len() > 200
        || manifest.game_id.trim().is_empty()
        || manifest.game_id.len() > 1000
    {
        return Err("Invalid module id, name, or gameId".into());
    }
    if manifest.progress_story_lines.len() > 64
        || manifest
            .progress_story_lines
            .iter()
            .any(|id| id.trim().is_empty() || id.len() > 1000)
        || manifest
            .progress_story_lines
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != manifest.progress_story_lines.len()
    {
        return Err("Invalid progressStoryLines".into());
    }
    entry_path(dir, &manifest.entry)?;
    Ok(manifest)
}

fn entry_path(dir: &Path, entry: &str) -> Result<PathBuf> {
    let path = Path::new(entry);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Module entry must be a relative path within its directory".into());
    }
    let root = fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let entry =
        fs::canonicalize(dir.join(path)).map_err(|e| format!("Module entry unavailable: {e}"))?;
    if !entry.starts_with(&root) || !entry.is_file() {
        return Err("Module entry must be a file within its directory".into());
    }
    Ok(entry)
}

pub fn module_root() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("STORY_TRACKER_IMPORTERS_DIR") {
        let root = PathBuf::from(path);
        if !root.is_absolute() {
            return Err("Module directory must be absolute".into());
        }
        return Ok(root);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .parent()
        .ok_or("Unable to locate application directory")?
        .join("importers"))
}

pub fn discover(root: &Path) -> Result<Registry> {
    let mut registry = Registry {
        modules: Vec::new(),
        errors: Vec::new(),
    };
    if !root.exists() {
        return Ok(registry);
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let dir = entry.map_err(|e| e.to_string())?.path();
        if !dir.is_dir() || !dir.join("manifest.json").exists() {
            continue;
        }
        match read_manifest(&dir) {
            Ok(manifest) => registry.modules.push(manifest),
            Err(error) => registry.errors.push(format!(
                "{}: {error}",
                dir.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    registry.modules.sort_by(|a, b| a.name.cmp(&b.name));
    registry.errors.sort();
    Ok(registry)
}

pub fn run_module(root: &Path, id: &str) -> Result<ImportResult> {
    if !valid_id(id) {
        return Err("Invalid module id".into());
    }
    let dir = root.join(id);
    let manifest = read_manifest(&dir)?;
    let entry = entry_path(&dir, &manifest.entry)?;
    if manifest.runtime == "json" {
        let mut bytes = Vec::new();
        fs::File::open(entry)
            .map_err(|e| format!("Unable to read local catalog: {e}"))?
            .take(OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        return parse_output(&bytes, manifest);
    }
    let bundled_node = root
        .join(".runtime")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let runtime = if bundled_node.is_file() {
        bundled_node.into_os_string()
    } else {
        std::ffi::OsString::from(if cfg!(windows) { "node.exe" } else { "node" })
    };
    let mut command = Command::new(runtime);
    // Validate the canonical path above, but pass a relative path to Node:
    // Windows extended-length canonical paths are not accepted by every runtime.
    command
        .arg(&manifest.entry)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Unable to start module (Node.js required): {e}"))?;
    let stdout = child.stdout.take().ok_or("Module stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Module stderr unavailable")?;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(90);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Import module timed out after 90 seconds".to_string());
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| "Module output reader failed")?
        .map_err(|e| e.to_string())?;
    let stderr = errors
        .join()
        .map_err(|_| "Module error reader failed")?
        .map_err(|e| e.to_string())?;
    let status = status?;
    if !status.success() {
        return Err(format!(
            "Import module failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    parse_output(&stdout, manifest)
}

fn parse_output(bytes: &[u8], manifest: Manifest) -> Result<ImportResult> {
    if bytes.len() as u64 > OUTPUT_LIMIT {
        return Err("Module output exceeds size limit".into());
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let mut result: ImportResult =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid module output: {e}"))?;
    if result.api_version != 1 || result.catalog.game.id != manifest.game_id {
        return Err("Module output API version or gameId does not match its manifest".into());
    }
    if result.warnings.len() > 10_000 || result.warnings.iter().any(|s| s.len() > 4000) {
        return Err("Module warnings exceed size limit".into());
    }
    result.catalog.importer_id = Some(manifest.id);
    result.catalog.validate()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_module(root: &Path, id: &str, game_id: &str, script: &str) {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("manifest.json"), serde_json::json!({
            "apiVersion": 1, "id": id, "name": id, "gameId": game_id, "runtime": "node", "entry": "index.mjs"
        }).to_string()).unwrap();
        fs::write(dir.join("index.mjs"), script).unwrap();
    }

    #[test]
    fn discovers_added_and_removed_modules_without_registration() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover(dir.path()).unwrap().modules.is_empty());
        fixture_module(dir.path(), "test", "game", "");
        assert_eq!(discover(dir.path()).unwrap().modules[0].id, "test");
        fs::remove_dir_all(dir.path().join("test")).unwrap();
        assert!(discover(dir.path()).unwrap().modules.is_empty());
    }

    #[test]
    fn broken_manifest_does_not_hide_working_module() {
        let dir = tempfile::tempdir().unwrap();
        fixture_module(dir.path(), "good", "game", "");
        fixture_module(dir.path(), "bad", "game", "");
        fs::write(dir.path().join("bad/manifest.json"), "not json").unwrap();
        let registry = discover(dir.path()).unwrap();
        assert_eq!(registry.modules.len(), 1);
        assert_eq!(registry.errors.len(), 1);
        assert!(run_module(dir.path(), "../good").is_err());
    }

    #[test]
    fn executes_independent_module_and_validates_output() {
        let dir = tempfile::tempdir().unwrap();
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../importers/mock/catalog.json")).unwrap();
        let output = serde_json::json!({ "apiVersion": 1, "catalog": catalog, "warnings": [] });
        fixture_module(
            dir.path(),
            "test",
            "mock-game",
            &format!("process.stdout.write({:?});", output.to_string()),
        );
        let result = run_module(dir.path(), "test").unwrap();
        assert_eq!(result.catalog.importer_id.as_deref(), Some("test"));
        assert_eq!(result.catalog.game.id, "mock-game");
        fixture_module(
            dir.path(),
            "badgame",
            "different",
            &format!("process.stdout.write({:?});", output.to_string()),
        );
        assert!(run_module(dir.path(), "badgame")
            .unwrap_err()
            .contains("gameId"));
        fixture_module(dir.path(), "badoutput", "game", "console.log('not json');");
        assert!(run_module(dir.path(), "badoutput").is_err());
        fixture_module(
            dir.path(),
            "failure",
            "game",
            "console.error('Source unavailable'); process.exit(1);",
        );
        assert!(run_module(dir.path(), "failure")
            .unwrap_err()
            .contains("Source unavailable"));
    }
    #[test]
    fn validates_optional_progress_story_lines() {
        let dir = tempfile::tempdir().unwrap();
        fixture_module(dir.path(), "test", "game", "");
        let path = dir.path().join("test/manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["progressStoryLines"] = serde_json::json!(["main"]);
        fs::write(&path, manifest.to_string()).unwrap();
        assert_eq!(
            discover(dir.path()).unwrap().modules[0].progress_story_lines,
            vec!["main"]
        );
        for invalid in [serde_json::json!([""]), serde_json::json!(["main", "main"])] {
            manifest["progressStoryLines"] = invalid;
            fs::write(&path, manifest.to_string()).unwrap();
            assert!(!discover(dir.path()).unwrap().errors.is_empty());
        }
    }
    #[test]
    fn reads_local_json_without_node_and_preserves_progress_metadata() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("local");
        fs::create_dir(&dir).unwrap();
        let manifest = serde_json::json!({
            "apiVersion":1,"id":"local","name":"Local","gameId":"mock-game",
            "runtime":"json","entry":"catalog.json","progressStoryLines":["main"]
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../importers/mock/catalog.json")).unwrap();
        let output =
            serde_json::json!({"apiVersion":1,"catalog":catalog,"warnings":["Local data"]});
        fs::write(dir.join("catalog.json"), format!("\u{feff}{output}")).unwrap();
        let registry = discover(root.path()).unwrap();
        assert!(registry.errors.is_empty());
        assert_eq!(registry.modules[0].progress_story_lines, vec!["main"]);
        let result = run_module(root.path(), "local").unwrap();
        assert_eq!(result.catalog.importer_id.as_deref(), Some("local"));
        assert_eq!(result.warnings, vec!["Local data"]);
        let mut wrong = output.clone();
        wrong["catalog"]["game"]["id"] = serde_json::json!("other");
        fs::write(dir.join("catalog.json"), wrong.to_string()).unwrap();
        assert!(run_module(root.path(), "local")
            .unwrap_err()
            .contains("gameId"));
        fs::write(dir.join("catalog.json"), "not JSON").unwrap();
        assert!(run_module(root.path(), "local").is_err());
        fs::File::create(dir.join("catalog.json"))
            .unwrap()
            .set_len(OUTPUT_LIMIT + 1)
            .unwrap();
        assert!(run_module(root.path(), "local")
            .unwrap_err()
            .contains("size limit"));
        let mut outside = manifest;
        outside["entry"] = serde_json::json!("../catalog.json");
        fs::write(dir.join("manifest.json"), outside.to_string()).unwrap();
        assert!(!discover(root.path()).unwrap().errors.is_empty());
    }

    #[test]
    fn packaged_local_catalogs_import_into_temporary_database() {
        let Some(path) = std::env::var_os("STORY_TRACKER_RELEASE_DIR") else {
            return;
        };
        let root = PathBuf::from(path).join("importers");
        let registry = discover(&root).unwrap();
        assert!(registry.errors.is_empty());
        assert_eq!(registry.modules.len(), 4);
        let temporary = tempfile::tempdir().unwrap();
        let mut store = crate::db::Store::open(&temporary.path().join("test.sqlite3")).unwrap();
        for manifest in registry.modules {
            assert_eq!(manifest.runtime, "json");
            let result = run_module(&root, &manifest.id).unwrap();
            let preview = store.preview(&result.catalog).unwrap();
            store.apply(&result.catalog, preview.revision).unwrap();
            let snapshot = store.snapshot().unwrap();
            assert!(snapshot
                .games
                .iter()
                .any(|game| game.id == manifest.game_id));
        }
        assert_eq!(store.snapshot().unwrap().games.len(), 4);
    }
}
