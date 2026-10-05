use super::*;

fn fixture() -> Catalog {
    serde_json::from_str(include_str!("../../../importers/mock/catalog.json")).unwrap()
}

fn setup() -> (tempfile::TempDir, Store, Catalog) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(&dir.path().join("progress.sqlite3")).unwrap();
    let catalog = fixture();
    store.apply(&catalog, 0).unwrap();
    (dir, store, catalog)
}

fn id(store: &Store, key: &str) -> String {
    all_nodes(&store.conn)
        .unwrap()
        .into_iter()
        .find(|n| n.source_key == key)
        .unwrap()
        .id
}

fn progress(store: &Store) -> Vec<(String, String)> {
    let mut stmt = store
        .conn
        .prepare("SELECT stage_id,watched_at FROM watched_stages ORDER BY stage_id")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap()
}

#[test]
fn preview_is_read_only_and_imports_after_confirmation() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(&dir.path().join("data.db")).unwrap();
    let catalog = fixture();
    let plan = store.preview(&catalog).unwrap();
    assert_eq!(
        plan.changes
            .iter()
            .filter(|c| c.entity == "node" && c.kind == "add")
            .count(),
        9
    );
    assert!(store.snapshot().unwrap().games.is_empty());
    assert_eq!(store.snapshot().unwrap().revision, 0);
    let imported = store.apply(&catalog, plan.revision).unwrap();
    assert_eq!(imported.nodes.len(), 9);
    assert_eq!(imported.story_lines.len(), 2);
    assert!(progress(&store).is_empty());
}

#[test]
fn out_of_order_progress_survives_database_reopen() {
    let (dir, mut store, _) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    drop(store);
    let reopened = Store::open(&dir.path().join("progress.sqlite3")).unwrap();
    assert_eq!(progress(&reopened), saved);
    let data = reopened.snapshot().unwrap();
    assert!(data
        .nodes
        .iter()
        .find(|n| n.source_key == "main/ch1/1")
        .unwrap()
        .watched_at
        .is_none());
    assert!(data
        .nodes
        .iter()
        .find(|n| n.id == fourth)
        .unwrap()
        .watched_at
        .is_some());
}

#[test]
fn added_nodes_and_renames_keep_original_progress_and_ids() {
    let (_dir, mut store, mut catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    catalog.nodes.push(NodeInput {
        source_key: "main/ch2".into(),
        story_line_id: "main".into(),
        parent_key: None,
        title: "Chapter 2".into(),
        order: 1,
        released_at: None,
        source_url: None,
    });
    catalog.nodes.push(NodeInput {
        source_key: "main/ch2/1".into(),
        story_line_id: "main".into(),
        parent_key: Some("main/ch2".into()),
        title: "2-1".into(),
        order: 0,
        released_at: None,
        source_url: None,
    });
    catalog.nodes[4].title = "Renamed fourth stage".into();
    let plan = store.preview(&catalog).unwrap();
    assert_eq!(
        plan.changes
            .iter()
            .filter(|c| c.entity == "node" && c.kind == "add")
            .count(),
        2
    );
    store.apply(&catalog, plan.revision).unwrap();
    assert_eq!(store.snapshot().unwrap().nodes.len(), 11);
    assert_eq!(progress(&store), saved);
    assert_eq!(id(&store, "main/ch1/4"), fourth);
}

#[test]
fn missing_nodes_preserve_orphaned_progress_and_can_be_restored() {
    let (_dir, mut store, catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    let mut updated = catalog.clone();
    updated.nodes.retain(|n| n.source_key != "main/ch1/4");
    let plan = store.preview(&updated).unwrap();
    assert_eq!(plan.orphaned_progress.len(), 1);
    let data = store.apply(&updated, plan.revision).unwrap();
    assert_eq!(data.orphaned_progress[0].stage_id, fourth);
    assert_eq!(progress(&store), saved);
    assert!(store.set_watched(&fourth, false).is_err());
    let plan = store.preview(&catalog).unwrap();
    assert!(plan.changes.iter().any(|c| c.kind == "restore"));
    let data = store.apply(&catalog, plan.revision).unwrap();
    assert!(data.orphaned_progress.is_empty());
    assert_eq!(progress(&store), saved);
}

#[test]
fn changing_source_key_does_not_guess_identity_by_title() {
    let (_dir, mut store, mut catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    catalog.nodes[4].source_key = "different-key".into();
    let plan = store.preview(&catalog).unwrap();
    assert_eq!(plan.orphaned_progress.len(), 1);
    let data = store.apply(&catalog, plan.revision).unwrap();
    let new = data
        .nodes
        .iter()
        .find(|n| n.source_key == "different-key")
        .unwrap();
    assert_ne!(new.id, fourth);
    assert!(new.watched_at.is_none());
    assert_eq!(data.orphaned_progress[0].stage_id, fourth);
}

#[test]
fn leaf_becoming_parent_preserves_progress_without_counting_it_as_child_progress() {
    let (_dir, mut store, mut catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    catalog.nodes.push(NodeInput {
        source_key: "main/ch1/4/a".into(),
        story_line_id: "main".into(),
        parent_key: Some("main/ch1/4".into()),
        title: "Substage".into(),
        order: 0,
        released_at: None,
        source_url: None,
    });
    let plan = store.preview(&catalog).unwrap();
    let data = store.apply(&catalog, plan.revision).unwrap();
    assert_eq!(data.orphaned_progress.len(), 1);
    assert_eq!(progress(&store), saved);
    assert!(data
        .nodes
        .iter()
        .find(|n| n.source_key.ends_with("/a"))
        .unwrap()
        .watched_at
        .is_none());
}

#[test]
fn bulk_operations_only_change_descendant_leaves_and_are_idempotent() {
    let (_dir, mut store, _) = setup();
    let root = id(&store, "main/ch1");
    let event = id(&store, "event/summer/ep2");
    store.set_watched(&event, true).unwrap();
    store.set_watched(&root, true).unwrap();
    let saved = progress(&store);
    assert_eq!(saved.len(), 5);
    assert!(!saved.iter().any(|(id, _)| id == &root));
    store.set_watched(&root, true).unwrap();
    assert_eq!(progress(&store), saved);
    store.set_watched(&root, false).unwrap();
    assert_eq!(progress(&store).len(), 1);
    assert_eq!(progress(&store)[0].0, event);
}

#[test]
fn invalid_input_fails_without_catalog_or_progress_mutation() {
    let (_dir, mut store, catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    let revision = store.snapshot().unwrap().revision;
    for problem in 0..6 {
        let mut bad = catalog.clone();
        match problem {
            0 => bad.nodes.push(bad.nodes[0].clone()),
            1 => bad.nodes[1].parent_key = Some("missing".into()),
            2 => bad.nodes[0].parent_key = Some(bad.nodes[1].source_key.clone()),
            3 => bad.nodes[1].parent_key = Some("event/summer".into()),
            4 => bad.nodes.clear(),
            _ => bad.nodes[0].title = " ".into(),
        }
        assert!(store.preview(&bad).is_err());
        assert!(store.apply(&bad, revision).is_err());
        assert_eq!(store.snapshot().unwrap().revision, revision);
        assert_eq!(store.snapshot().unwrap().nodes.len(), 9);
        assert_eq!(progress(&store), saved);
    }
}

#[test]
fn stale_confirmation_is_rejected() {
    let (_dir, mut store, mut catalog) = setup();
    catalog.game.title = "Changed".into();
    let plan = store.preview(&catalog).unwrap();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    assert!(store
        .apply(&catalog, plan.revision)
        .unwrap_err()
        .contains("Data changed"));
    assert_ne!(store.snapshot().unwrap().games[0].title, "Changed");
}

#[test]
fn identical_catalog_is_noop() {
    let (_dir, mut store, catalog) = setup();
    let plan = store.preview(&catalog).unwrap();
    assert!(plan.changes.is_empty());
    let data = store.apply(&catalog, plan.revision).unwrap();
    assert_eq!(data.revision, plan.revision);
}

#[test]
fn database_error_rolls_back_entire_catalog_update() {
    let (_dir, mut store, mut catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    let revision = store.snapshot().unwrap().revision;
    catalog.game.title = "Should roll back".into();
    catalog.nodes[0].title = "Should roll back".into();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_update BEFORE UPDATE ON story_nodes
        BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END;",
        )
        .unwrap();
    assert!(store.apply(&catalog, revision).is_err());
    let data = store.snapshot().unwrap();
    assert_eq!(data.revision, revision);
    assert_ne!(data.games[0].title, "Should roll back");
    assert!(data.nodes.iter().all(|n| n.title != "Should roll back"));
    assert_eq!(progress(&store), saved);
}

#[test]
fn update_one_game_does_not_touch_another() {
    let (_dir, mut store, mut catalog) = setup();
    catalog.game.id = "second-game".into();
    catalog.game.title = "Second".into();
    let revision = store.snapshot().unwrap().revision;
    store.apply(&catalog, revision).unwrap();
    let data = store.snapshot().unwrap();
    assert_eq!(data.games.len(), 2);
    assert_eq!(data.nodes.len(), 18);
    let second = data
        .nodes
        .iter()
        .find(|n| n.game_id == "second-game" && n.source_key == "main/ch1/4")
        .unwrap()
        .id
        .clone();
    store.set_watched(&second, true).unwrap();
    let saved = progress(&store);
    let first = fixture();
    let plan = store.preview(&first).unwrap();
    store.apply(&first, plan.revision).unwrap();
    assert_eq!(progress(&store), saved);
}

#[test]
fn migrates_existing_database_without_losing_watched_rows() {
    let (dir, mut store, _) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    store
        .conn
        .execute_batch(
            "ALTER TABLE story_nodes DROP COLUMN released_at;
        ALTER TABLE story_nodes DROP COLUMN source_url; PRAGMA user_version=1;",
        )
        .unwrap();
    drop(store);
    let reopened = Store::open(&dir.path().join("progress.sqlite3")).unwrap();
    assert_eq!(progress(&reopened), saved);
    assert_eq!(id(&reopened, "main/ch1/4"), fourth);
    assert!(reopened
        .snapshot()
        .unwrap()
        .nodes
        .iter()
        .all(|n| n.released_at.is_none()));
}

#[test]
fn release_metadata_and_importer_changes_are_previewed_and_preserve_progress() {
    let (_dir, mut store, mut catalog) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    catalog.importer_id = Some("independent".into());
    catalog.nodes[0].released_at = Some("2019-05-30".into());
    catalog.nodes[0].source_url = Some("https://example.com/story".into());
    let plan = store.preview(&catalog).unwrap();
    assert!(plan.changes.iter().any(|c| c.detail.contains("releasedAt")));
    assert!(plan.changes.iter().any(|c| c.detail.contains("Importer")));
    let data = store.apply(&catalog, plan.revision).unwrap();
    assert_eq!(data.games[0].importer_id.as_deref(), Some("independent"));
    assert_eq!(progress(&store), saved);
    assert!(store.preview(&catalog).unwrap().changes.is_empty());
    catalog.nodes[0].released_at = Some("2019-05-30T16:00:00+08:00".into());
    assert!(store.preview(&catalog).is_ok());
    for value in [
        "invalid",
        "2023-02-29",
        "2024-02-30",
        "2024-2-29",
        "2024-13-01",
    ] {
        catalog.nodes[0].released_at = Some(value.into());
        assert!(store.preview(&catalog).is_err());
    }
    assert_eq!(progress(&store), saved);
}

fn append_fixture() -> Catalog {
    let original = fixture();
    Catalog {
        importer_id: Some("other-importer".into()),
        game: original.game,
        story_lines: original
            .story_lines
            .into_iter()
            .filter(|line| line.id == "event")
            .collect(),
        nodes: vec![
            NodeInput {
                source_key: "event/new".into(),
                story_line_id: "event".into(),
                parent_key: None,
                title: "新活动".into(),
                order: 2,
                released_at: Some("2026-10-04".into()),
                source_url: None,
            },
            NodeInput {
                source_key: "event/new/1".into(),
                story_line_id: "event".into(),
                parent_key: Some("event/new".into()),
                title: "开场".into(),
                order: 0,
                released_at: Some("2026-10-04".into()),
                source_url: None,
            },
        ],
    }
}

#[test]
fn append_keeps_old_nodes_progress_and_importer_and_is_idempotent() {
    let (dir, mut store, _) = setup();
    let fourth = id(&store, "main/ch1/4");
    store.set_watched(&fourth, true).unwrap();
    let saved = progress(&store);
    let before = store.snapshot().unwrap();
    let patch = append_fixture();
    let plan = store.preview_append(&patch).unwrap();
    assert_eq!(plan.changes.len(), 2);
    assert!(plan
        .changes
        .iter()
        .all(|c| c.kind == "add" && c.entity == "node"));
    assert_eq!(store.snapshot().unwrap().revision, before.revision);
    assert_eq!(store.snapshot().unwrap().nodes.len(), 9);
    let after = store.apply_append(&patch, plan.revision).unwrap();
    assert_eq!(after.nodes.len(), 11);
    assert!(after.nodes.iter().all(|node| node.active));
    assert_eq!(after.games[0].importer_id, before.games[0].importer_id);
    for old in before.nodes {
        let new = after.nodes.iter().find(|node| node.id == old.id).unwrap();
        assert_eq!(new.source_key, old.source_key);
        assert_eq!(new.title, old.title);
        assert_eq!(new.watched_at, old.watched_at);
        assert_eq!(new.parent_id, old.parent_id);
    }
    assert_eq!(progress(&store), saved);
    assert!(store.preview_append(&patch).unwrap().changes.is_empty());
    assert_eq!(
        store.apply_append(&patch, after.revision).unwrap().revision,
        after.revision
    );
    drop(store);
    let reopened = Store::open(&dir.path().join("progress.sqlite3")).unwrap();
    assert_eq!(reopened.snapshot().unwrap().nodes.len(), 11);
    assert_eq!(progress(&reopened), saved);
}

#[test]
fn append_can_add_children_to_existing_directory_without_archiving_siblings() {
    let (_, mut store, original) = setup();
    let mut patch = append_fixture();
    patch.nodes = vec![
        original
            .nodes
            .iter()
            .find(|n| n.source_key == "event/summer")
            .unwrap()
            .clone(),
        NodeInput {
            source_key: "event/summer/ep3".into(),
            story_line_id: "event".into(),
            parent_key: Some("event/summer".into()),
            title: "Episode 3".into(),
            order: 2,
            released_at: None,
            source_url: None,
        },
    ];
    let plan = store.preview_append(&patch).unwrap();
    assert_eq!(plan.changes.len(), 1);
    let after = store.apply_append(&patch, plan.revision).unwrap();
    assert_eq!(after.nodes.iter().filter(|n| n.active).count(), 10);
}

#[test]
fn append_conflicts_and_leaf_conversion_are_atomic() {
    let (_, mut store, original) = setup();
    store.set_watched(&id(&store, "event/extra"), true).unwrap();
    let before = store.snapshot().unwrap();
    let saved = progress(&store);
    let mut patch = append_fixture();
    patch.nodes.push(original.nodes[0].clone());
    patch.nodes.last_mut().unwrap().title = "覆盖旧标题".into();
    patch.story_lines.push(original.story_lines[0].clone());
    assert!(store.preview_append(&patch).is_err());
    assert!(store.apply_append(&patch, before.revision).is_err());
    patch = append_fixture();
    let leaf = original
        .nodes
        .iter()
        .find(|n| n.source_key == "event/extra")
        .unwrap()
        .clone();
    patch.nodes[0].parent_key = Some(leaf.source_key.clone());
    patch.nodes.push(leaf);
    assert!(store.apply_append(&patch, before.revision).is_err());
    assert_eq!(progress(&store), saved);
    assert_eq!(store.snapshot().unwrap().revision, before.revision);
    assert_eq!(store.snapshot().unwrap().nodes.len(), before.nodes.len());
}

#[test]
fn append_rejects_stale_previews_and_archived_keys() {
    let (_, mut store, mut original) = setup();
    let patch = append_fixture();
    let plan = store.preview_append(&patch).unwrap();
    store.set_watched(&id(&store, "main/ch1/4"), true).unwrap();
    assert!(store.apply_append(&patch, plan.revision).is_err());
    original.nodes.retain(|n| n.source_key != "event/extra");
    store
        .apply(&original, store.snapshot().unwrap().revision)
        .unwrap();
    let mut conflicting = patch.clone();
    conflicting.nodes.push(NodeInput {
        source_key: "event/extra".into(),
        story_line_id: "event".into(),
        parent_key: None,
        title: "番外".into(),
        order: 1,
        released_at: None,
        source_url: None,
    });
    let revision = store.snapshot().unwrap().revision;
    assert!(store.apply_append(&conflicting, revision).is_err());
    let after = store.apply_append(&patch, revision).unwrap();
    assert!(after.nodes.iter().all(|n| n.source_key != "event/extra"));
    assert!(
        !all_nodes(&store.conn)
            .unwrap()
            .iter()
            .find(|n| n.source_key == "event/extra")
            .unwrap()
            .active
    );
}
