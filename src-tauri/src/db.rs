use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameInput {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineInput {
    pub id: String,
    pub title: String,
    pub order: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeInput {
    pub source_key: String,
    pub story_line_id: String,
    pub parent_key: Option<String>,
    pub title: String,
    pub order: i64,
    pub released_at: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub importer_id: Option<String>,
    pub game: GameInput,
    pub story_lines: Vec<LineInput>,
    pub nodes: Vec<NodeInput>,
}

impl Catalog {
    pub fn validate(&self) -> Result<()> {
        fn text(s: &str) -> bool {
            !s.trim().is_empty() && s.len() <= 1000 && !s.contains('\0')
        }
        if !text(&self.game.id) || !text(&self.game.title) {
            return Err("Game id and title must be nonempty strings".into());
        }
        if self.story_lines.is_empty() || self.nodes.is_empty() || self.nodes.len() > 10_000 {
            return Err("Catalog must contain story lines and 1–10000 nodes".into());
        }
        if self.importer_id.as_ref().is_some_and(|id| {
            id.is_empty()
                || id.len() > 64
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        }) {
            return Err("Invalid importerId".into());
        }
        let mut lines = HashSet::new();
        for line in &self.story_lines {
            if !text(&line.id) || !text(&line.title) || line.order < 0 || !lines.insert(&line.id) {
                return Err("Invalid or duplicate story line".into());
            }
        }
        let mut nodes = HashMap::new();
        for node in &self.nodes {
            if node.released_at.as_ref().is_some_and(|date| {
                let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                    .is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == *date);
                !day && chrono::DateTime::parse_from_rfc3339(date).is_err()
            }) {
                return Err("Invalid releasedAt date".into());
            }
            if node
                .source_url
                .as_ref()
                .is_some_and(|url| !text(url) || !url.starts_with("https://"))
            {
                return Err("sourceUrl must be an HTTPS URL".into());
            }
            if !text(&node.source_key)
                || !text(&node.title)
                || node.order < 0
                || !lines.contains(&node.story_line_id)
                || nodes.insert(&node.source_key, node).is_some()
            {
                return Err("Invalid node, duplicate sourceKey, or unknown story line".into());
            }
        }
        for node in &self.nodes {
            let mut path = HashSet::new();
            let mut cur = node;
            loop {
                if !path.insert(&cur.source_key) || path.len() > 256 {
                    return Err("Catalog has a cycle or exceeds maximum tree depth (256)".into());
                }
                match &cur.parent_key {
                    None => break,
                    Some(key) => {
                        let parent = nodes.get(key).ok_or("Unknown parentKey")?;
                        if parent.story_line_id != node.story_line_id {
                            return Err(
                                "Parent and child must belong to the same story line".into()
                            );
                        }
                        cur = parent;
                    }
                }
            }
        }
        for line in &self.story_lines {
            if !self.nodes.iter().any(|n| n.story_line_id == line.id) {
                return Err("Each story line must contain a node".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub title: String,
    pub importer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryLine {
    pub id: String,
    pub game_id: String,
    pub title: String,
    pub order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub game_id: String,
    pub story_line_id: String,
    pub parent_id: Option<String>,
    pub source_key: String,
    pub title: String,
    pub order: i64,
    pub active: bool,
    pub watched_at: Option<String>,
    pub released_at: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub stage_id: String,
    pub game_id: String,
    pub title: String,
    pub watched_at: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: i64,
    pub games: Vec<Game>,
    pub story_lines: Vec<StoryLine>,
    pub nodes: Vec<Node>,
    pub orphaned_progress: Vec<Orphan>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: String,
    pub entity: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPreview {
    pub revision: i64,
    pub changes: Vec<Change>,
    pub orphaned_progress: Vec<Orphan>,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(err)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(err)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version > 2 {
            return Err("Database was created by a newer application version".into());
        }
        if version == 0 {
            conn.execute_batch("BEGIN;
                CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT NOT NULL);
                CREATE TABLE story_lines (
                    id TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id),
                    title TEXT NOT NULL, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (game_id, id));
                CREATE TABLE story_nodes (
                    id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id),
                    story_line_id TEXT NOT NULL, parent_id TEXT REFERENCES story_nodes(id),
                    source_key TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1, UNIQUE(game_id, source_key),
                    FOREIGN KEY(game_id, story_line_id) REFERENCES story_lines(game_id, id));
                CREATE TABLE watched_stages (
                    stage_id TEXT PRIMARY KEY REFERENCES story_nodes(id), watched_at TEXT NOT NULL);
                CREATE TABLE wiki_sources (
                    game_id TEXT PRIMARY KEY REFERENCES games(id), adapter TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
                INSERT INTO metadata VALUES(1, 0);
                CREATE INDEX nodes_parent ON story_nodes(parent_id);
                PRAGMA user_version=1;
                COMMIT;").map_err(err)?;
        }
        if version < 2 {
            conn.execute_batch(
                "BEGIN;
                ALTER TABLE story_nodes ADD COLUMN released_at TEXT;
                ALTER TABLE story_nodes ADD COLUMN source_url TEXT;
                PRAGMA user_version=2;
                COMMIT;",
            )
            .map_err(err)?;
        }
        Ok(Self { conn })
    }

    pub fn snapshot(&self) -> Result<Snapshot> {
        snapshot(&self.conn)
    }

    pub fn preview(&self, catalog: &Catalog) -> Result<DiffPreview> {
        catalog.validate()?;
        preview(&self.conn, catalog)
    }

    pub fn preview_append(&self, catalog: &Catalog) -> Result<DiffPreview> {
        self.preview(&merge_append(&self.conn, catalog)?)
    }

    pub fn apply_append(&mut self, catalog: &Catalog, expected_revision: i64) -> Result<Snapshot> {
        self.apply(&merge_append(&self.conn, catalog)?, expected_revision)
    }

    pub fn apply(&mut self, catalog: &Catalog, expected_revision: i64) -> Result<Snapshot> {
        catalog.validate()?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        if revision(&tx)? != expected_revision {
            return Err(
                "Data changed since preview. Generate a new preview before confirming.".into(),
            );
        }
        let diff = preview(&tx, catalog)?;
        if diff.changes.is_empty() {
            tx.commit().map_err(err)?;
            return self.snapshot();
        }
        let game_id = &catalog.game.id;
        tx.execute(
            "INSERT INTO games(id,title) VALUES(?1,?2)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title",
            params![game_id, catalog.game.title],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE story_lines SET active=0 WHERE game_id=?1",
            [game_id],
        )
        .map_err(err)?;
        for line in &catalog.story_lines {
            tx.execute("INSERT INTO story_lines(id,game_id,title,sort_order,active) VALUES(?1,?2,?3,?4,1)
                ON CONFLICT(game_id,id) DO UPDATE SET title=excluded.title,sort_order=excluded.sort_order,active=1",
                params![line.id, game_id, line.title, line.order]).map_err(err)?;
        }
        let existing = all_nodes(&tx)?;
        let mut ids: HashMap<String, String> = existing
            .iter()
            .filter(|n| n.game_id == *game_id)
            .map(|n| (n.source_key.clone(), n.id.clone()))
            .collect();
        for node in &catalog.nodes {
            ids.entry(node.source_key.clone())
                .or_insert_with(|| uuid::Uuid::new_v4().to_string());
        }
        // Keep every old node and watched row; absence only archives Catalog nodes.
        tx.execute(
            "UPDATE story_nodes SET active=0 WHERE game_id=?1",
            [game_id],
        )
        .map_err(err)?;
        for node in &catalog.nodes {
            tx.execute("INSERT INTO story_nodes(id,game_id,story_line_id,parent_id,source_key,title,sort_order,active,released_at,source_url)
                VALUES(?1,?2,?3,NULL,?4,?5,?6,1,?7,?8)
                ON CONFLICT(game_id,source_key) DO UPDATE SET story_line_id=excluded.story_line_id,
                    parent_id=NULL,title=excluded.title,sort_order=excluded.sort_order,active=1,
                    released_at=excluded.released_at,source_url=excluded.source_url",
                params![ids[&node.source_key], game_id, node.story_line_id, node.source_key, node.title, node.order, node.released_at, node.source_url]).map_err(err)?;
        }
        for node in &catalog.nodes {
            let parent_id = node.parent_key.as_ref().map(|k| &ids[k]);
            tx.execute(
                "UPDATE story_nodes SET parent_id=?1 WHERE id=?2",
                params![parent_id, ids[&node.source_key]],
            )
            .map_err(err)?;
        }
        tx.execute("INSERT INTO wiki_sources(game_id,adapter,updated_at) VALUES(?1,?2,?3)
            ON CONFLICT(game_id) DO UPDATE SET adapter=excluded.adapter,updated_at=excluded.updated_at",
            params![game_id, catalog.importer_id.as_deref().unwrap_or("file"), chrono::Utc::now().to_rfc3339()]).map_err(err)?;
        tx.execute("UPDATE metadata SET revision=revision+1 WHERE id=1", [])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.snapshot()
    }

    pub fn set_watched(&mut self, node_id: &str, watched: bool) -> Result<Snapshot> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let nodes = all_nodes(&tx)?;
        let nodes: Vec<&Node> = nodes.iter().filter(|n| n.active).collect();
        if !nodes.iter().any(|n| n.id == node_id) {
            return Err("Unknown or archived node".into());
        }
        let mut subtree = HashSet::new();
        let mut stack = vec![node_id.to_string()];
        while let Some(id) = stack.pop() {
            if !subtree.insert(id.clone()) {
                return Err("Invalid stored tree".into());
            }
            stack.extend(
                nodes
                    .iter()
                    .filter(|n| n.parent_id.as_deref() == Some(&id))
                    .map(|n| n.id.clone()),
            );
        }
        let parents: HashSet<&str> = nodes
            .iter()
            .filter_map(|n| n.parent_id.as_deref())
            .collect();
        let time = chrono::Utc::now().to_rfc3339();
        for node in nodes
            .iter()
            .filter(|n| subtree.contains(&n.id) && !parents.contains(n.id.as_str()))
        {
            if watched {
                // Idempotent: marking a watched leaf again preserves its original timestamp.
                tx.execute(
                    "INSERT INTO watched_stages(stage_id,watched_at) VALUES(?1,?2)
                    ON CONFLICT(stage_id) DO NOTHING",
                    params![node.id, time],
                )
                .map_err(err)?;
            } else {
                tx.execute("DELETE FROM watched_stages WHERE stage_id=?1", [&node.id])
                    .map_err(err)?;
            }
        }
        tx.execute("UPDATE metadata SET revision=revision+1 WHERE id=1", [])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.snapshot()
    }
}

fn revision(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT revision FROM metadata WHERE id=1", [], |r| r.get(0))
        .map_err(err)
}

fn all_nodes(conn: &Connection) -> Result<Vec<Node>> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id,n.game_id,n.story_line_id,n.parent_id,n.source_key,
        n.title,n.sort_order,n.active,w.watched_at,n.released_at,n.source_url FROM story_nodes n
        LEFT JOIN watched_stages w ON w.stage_id=n.id ORDER BY n.sort_order,n.source_key",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Node {
                id: r.get(0)?,
                game_id: r.get(1)?,
                story_line_id: r.get(2)?,
                parent_id: r.get(3)?,
                source_key: r.get(4)?,
                title: r.get(5)?,
                order: r.get(6)?,
                active: r.get(7)?,
                watched_at: r.get(8)?,
                released_at: r.get(9)?,
                source_url: r.get(10)?,
            })
        })
        .map_err(err)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)
}

fn orphan(node: &Node, reason: &str) -> Orphan {
    Orphan {
        stage_id: node.id.clone(),
        game_id: node.game_id.clone(),
        title: node.title.clone(),
        watched_at: node.watched_at.clone().unwrap_or_default(),
        reason: reason.into(),
    }
}

fn snapshot(conn: &Connection) -> Result<Snapshot> {
    let mut stmt = conn
        .prepare("SELECT g.id,g.title,s.adapter FROM games g LEFT JOIN wiki_sources s ON s.game_id=g.id ORDER BY g.title,g.id")
        .map_err(err)?;
    let games = stmt
        .query_map([], |r| {
            Ok(Game {
                id: r.get(0)?,
                title: r.get(1)?,
                importer_id: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut stmt = conn.prepare("SELECT id,game_id,title,sort_order FROM story_lines WHERE active=1 ORDER BY sort_order,id").map_err(err)?;
    let story_lines = stmt
        .query_map([], |r| {
            Ok(StoryLine {
                id: r.get(0)?,
                game_id: r.get(1)?,
                title: r.get(2)?,
                order: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let nodes = all_nodes(conn)?;
    let parents: HashSet<&str> = nodes
        .iter()
        .filter(|n| n.active)
        .filter_map(|n| n.parent_id.as_deref())
        .collect();
    let orphaned_progress = nodes
        .iter()
        .filter(|n| n.watched_at.is_some())
        .filter_map(|n| {
            if !n.active {
                Some(orphan(n, "Catalog node missing; progress retained"))
            } else if parents.contains(n.id.as_str()) {
                Some(orphan(n, "Node is no longer a leaf; progress retained"))
            } else {
                None
            }
        })
        .collect();
    Ok(Snapshot {
        revision: revision(conn)?,
        games,
        story_lines,
        nodes: nodes.into_iter().filter(|n| n.active).collect(),
        orphaned_progress,
    })
}

fn preview(conn: &Connection, catalog: &Catalog) -> Result<DiffPreview> {
    let snapshot = snapshot(conn)?;
    let existing = all_nodes(conn)?;
    let old: HashMap<&str, &Node> = existing
        .iter()
        .filter(|n| n.game_id == catalog.game.id)
        .map(|n| (n.source_key.as_str(), n))
        .collect();
    let ids: HashMap<&str, &str> = existing
        .iter()
        .map(|n| (n.id.as_str(), n.source_key.as_str()))
        .collect();
    let new: HashMap<&str, &NodeInput> = catalog
        .nodes
        .iter()
        .map(|n| (n.source_key.as_str(), n))
        .collect();
    let mut changes = Vec::new();
    let mut add = |kind: &str, entity: &str, title: &str, detail: String| {
        changes.push(Change {
            kind: kind.into(),
            entity: entity.into(),
            title: title.into(),
            detail,
        });
    };
    match snapshot.games.iter().find(|g| g.id == catalog.game.id) {
        None => add("add", "game", &catalog.game.title, catalog.game.id.clone()),
        Some(g) if g.title != catalog.game.title => add(
            "change",
            "game",
            &catalog.game.title,
            format!("Title: {} → {}", g.title, catalog.game.title),
        ),
        _ => (),
    }
    if let Some(game) = snapshot.games.iter().find(|g| g.id == catalog.game.id) {
        let importer = catalog.importer_id.as_deref().unwrap_or("file");
        if game.importer_id.as_deref() != Some(importer) {
            add(
                "change",
                "game",
                &catalog.game.title,
                format!(
                    "Importer: {} → {}",
                    game.importer_id.as_deref().unwrap_or("unknown"),
                    importer
                ),
            );
        }
    }
    for line in &catalog.story_lines {
        match snapshot
            .story_lines
            .iter()
            .find(|l| l.game_id == catalog.game.id && l.id == line.id)
        {
            None => add("add", "storyLine", &line.title, line.id.clone()),
            Some(old) if old.title != line.title || old.order != line.order => add(
                "change",
                "storyLine",
                &line.title,
                format!(
                    "Title/order: {} / {} → {} / {}",
                    old.title, old.order, line.title, line.order
                ),
            ),
            _ => (),
        }
    }
    for line in snapshot
        .story_lines
        .iter()
        .filter(|l| l.game_id == catalog.game.id)
    {
        if !catalog.story_lines.iter().any(|l| l.id == line.id) {
            add("archive", "storyLine", &line.title, line.id.clone());
        }
    }
    for node in &catalog.nodes {
        match old.get(node.source_key.as_str()) {
            None => add("add", "node", &node.title, node.source_key.clone()),
            Some(old) => {
                let old_parent = old.parent_id.as_deref().and_then(|id| ids.get(id).copied());
                if !old.active {
                    add("restore", "node", &node.title, node.source_key.clone());
                }
                if old.title != node.title
                    || old.order != node.order
                    || old.story_line_id != node.story_line_id
                    || old_parent != node.parent_key.as_deref()
                    || old.released_at != node.released_at
                    || old.source_url != node.source_url
                {
                    add(
                        "change",
                        "node",
                        &node.title,
                        format!(
                            "{}: title {} → {}; order {} → {}; line {} → {}; parent {} → {}; releasedAt {} → {}; sourceUrl {} → {}",
                            node.source_key,
                            old.title,
                            node.title,
                            old.order,
                            node.order,
                            old.story_line_id,
                            node.story_line_id,
                            old_parent.unwrap_or("root"),
                            node.parent_key.as_deref().unwrap_or("root"),
                            old.released_at.as_deref().unwrap_or("unknown"),
                            node.released_at.as_deref().unwrap_or("unknown"),
                            old.source_url.as_deref().unwrap_or("none"),
                            node.source_url.as_deref().unwrap_or("none")
                        ),
                    );
                }
            }
        }
    }
    // Iterate the ordered vector, so previews remain deterministic.
    for node in existing
        .iter()
        .filter(|n| n.game_id == catalog.game.id && n.active)
    {
        if !new.contains_key(node.source_key.as_str()) {
            add(
                "archive",
                "node",
                &node.title,
                format!("{}; retained in database", node.source_key),
            );
        }
    }
    let parents: HashSet<&str> = catalog
        .nodes
        .iter()
        .filter_map(|n| n.parent_key.as_deref())
        .collect();
    let orphaned_progress = existing
        .iter()
        .filter(|n| n.game_id == catalog.game.id && n.watched_at.is_some())
        .filter_map(|n| {
            if !new.contains_key(n.source_key.as_str()) {
                Some(orphan(n, "Catalog node missing; progress will be retained"))
            } else if parents.contains(n.source_key.as_str()) {
                Some(orphan(
                    n,
                    "Node will no longer be a leaf; progress will be retained",
                ))
            } else {
                None
            }
        })
        .collect();
    Ok(DiffPreview {
        revision: snapshot.revision,
        changes,
        orphaned_progress,
    })
}

fn merge_append(conn: &Connection, patch: &Catalog) -> Result<Catalog> {
    patch.validate()?;
    let data = snapshot(conn)?;
    let game = data
        .games
        .iter()
        .find(|g| g.id == patch.game.id)
        .ok_or("请先导入游戏，再追加记录")?;
    let all = all_nodes(conn)?;
    let old_nodes: Vec<&Node> = all.iter().filter(|n| n.game_id == game.id).collect();
    let by_id: HashMap<&str, &Node> = old_nodes.iter().map(|n| (n.id.as_str(), *n)).collect();
    let existing_parents: HashSet<&str> = old_nodes
        .iter()
        .filter(|n| n.active)
        .filter_map(|n| n.parent_id.as_deref())
        .collect();
    let mut nodes: Vec<NodeInput> = old_nodes
        .iter()
        .filter(|n| n.active)
        .map(|n| NodeInput {
            source_key: n.source_key.clone(),
            story_line_id: n.story_line_id.clone(),
            parent_key: n
                .parent_id
                .as_deref()
                .and_then(|id| by_id.get(id))
                .map(|p| p.source_key.clone()),
            title: n.title.clone(),
            order: n.order,
            released_at: n.released_at.clone(),
            source_url: n.source_url.clone(),
        })
        .collect();
    for node in &patch.nodes {
        if let Some(old) = old_nodes.iter().find(|n| n.source_key == node.source_key) {
            let parent = old
                .parent_id
                .as_deref()
                .and_then(|id| by_id.get(id))
                .map(|p| p.source_key.clone());
            if !old.active
                || old.title != node.title
                || old.story_line_id != node.story_line_id
                || parent != node.parent_key
                || old.order != node.order
                || old.released_at != node.released_at
                || old.source_url != node.source_url
            {
                return Err(format!(
                    "已有记录与追加内容冲突：{}。如需修改，请使用完整更新。",
                    node.title
                ));
            }
            continue;
        }
        if let Some(parent) = node
            .parent_key
            .as_deref()
            .and_then(|key| old_nodes.iter().find(|n| n.source_key == key))
        {
            if !existing_parents.contains(parent.id.as_str()) {
                return Err("不能在已有剧情叶节点下追加，请选择上级目录".into());
            }
        }
        nodes.push(node.clone());
    }
    let mut story_lines: Vec<LineInput> = data
        .story_lines
        .iter()
        .filter(|l| l.game_id == game.id)
        .map(|l| LineInput {
            id: l.id.clone(),
            title: l.title.clone(),
            order: l.order,
        })
        .collect();
    for line in &patch.story_lines {
        if let Some(old) = story_lines.iter().find(|l| l.id == line.id) {
            if old.title != line.title || old.order != line.order {
                return Err(format!("已有分类与追加内容冲突：{}", line.title));
            }
        } else {
            story_lines.push(line.clone());
        }
    }
    let full = Catalog {
        importer_id: game.importer_id.clone(),
        game: GameInput {
            id: game.id.clone(),
            title: game.title.clone(),
        },
        story_lines,
        nodes,
    };
    full.validate()?;
    Ok(full)
}

#[cfg(test)]
mod tests;
