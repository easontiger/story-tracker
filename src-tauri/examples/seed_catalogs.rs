use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use story_tracker_lib::db::{Snapshot, Store};
use story_tracker_lib::importers::ImportResult;

fn seed(output: &Path, inputs: &[PathBuf]) -> Result<Snapshot, String> {
    if inputs.is_empty() {
        return Err("No initial catalogs supplied".into());
    }
    let mut catalogs = Vec::new();
    let mut games = HashSet::new();
    for input in inputs {
        let mut bytes = Vec::new();
        fs::File::open(input).map_err(|e| e.to_string())?
            .take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("Initial catalog exceeds size limit".into());
        }
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        let result: ImportResult = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if result.api_version != 1 || !games.insert(result.catalog.game.id.clone()) {
            return Err("Invalid API version or duplicate initial game".into());
        }
        result.catalog.validate()?;
        catalogs.push(result.catalog);
    }
    // Reserve a new output only. Existing portable databases must never be replaced.
    drop(OpenOptions::new().write(true).create_new(true).open(output).map_err(|e| e.to_string())?);
    let result = (|| {
        let mut store = Store::open(output)?;
        for catalog in &catalogs {
            let revision = store.preview(catalog)?.revision;
            store.apply(catalog, revision)?;
        }
        let snapshot = store.snapshot()?;
        if snapshot.games.len() != catalogs.len()
            || snapshot.nodes.iter().any(|n| n.watched_at.is_some())
            || !snapshot.orphaned_progress.is_empty()
        {
            return Err("Initial database verification failed".into());
        }
        Ok(snapshot)
    })();
    if result.is_err() {
        let _ = fs::remove_file(output);
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(format!("{}{suffix}", output.display()));
        }
    }
    result
}

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() < 2 {
        eprintln!("Usage: seed_catalogs NEW_DATABASE CATALOG_JSON...");
        std::process::exit(1);
    }
    match seed(Path::new(&args[0]), &args[1..].iter().map(PathBuf::from).collect::<Vec<_>>()) {
        Ok(data) => println!("{}", serde_json::json!({"games": data.games.len(), "nodes": data.nodes.len()})),
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(dir: &Path, game: &str) -> PathBuf {
        let file = dir.join(format!("{game}.json"));
        let value = serde_json::json!({
            "apiVersion": 1, "catalog": {
                "importerId": "local", "game": {"id": game, "title": game},
                "storyLines": [{"id": "main", "title": "Main", "order": 0}],
                "nodes": [{"sourceKey": "one", "storyLineId": "main", "parentKey": null,
                    "title": "One", "order": 0, "releasedAt": null, "sourceUrl": null}]
            }, "warnings": []
        });
        fs::write(&file, serde_json::to_vec(&value).unwrap()).unwrap();
        file
    }

    #[test]
    fn seed_is_persistent_and_cannot_replace_watched_database() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = vec![input(dir.path(), "first"), input(dir.path(), "second")];
        let output = dir.path().join("initial.sqlite3");
        let initial = seed(&output, &inputs).unwrap();
        assert_eq!(initial.games.len(), 2);
        assert_eq!(initial.nodes.len(), 2);
        assert!(initial.nodes.iter().all(|n| n.watched_at.is_none()));
        let mut store = Store::open(&output).unwrap();
        let id = initial.nodes[0].id.clone();
        store.set_watched(&id, true).unwrap();
        drop(store);
        assert!(seed(&output, &inputs).is_err());
        let reopened = Store::open(&output).unwrap().snapshot().unwrap();
        assert_eq!(reopened.games.len(), 2);
        assert!(reopened.nodes.iter().find(|n| n.id == id).unwrap().watched_at.is_some());
    }

    #[test]
    fn invalid_or_duplicate_inputs_do_not_create_database() {
        let dir = tempfile::tempdir().unwrap();
        let good = input(dir.path(), "first");
        let bad = dir.path().join("invalid.json");
        fs::write(&bad, b"{}").unwrap();
        let output = dir.path().join("initial.sqlite3");
        assert!(seed(&output, &[good.clone(), bad]).is_err());
        assert!(!output.exists());
        assert!(seed(&output, &[good.clone(), good]).is_err());
        assert!(!output.exists());
        assert!(seed(&output, &[]).is_err());
        assert!(!output.exists());
    }
}
