/**
 * src/db.js — SQLite data layer
 * Uses Node.js 22+ built-in node:sqlite (no external deps)
 *
 * Tables:
 *   studio_journal  — operation log
 *   project_rules   — user-defined rules for AI
 *   ai_lessons      — AI error memory
 *   asset_registry  — uploaded/linked image assets
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "studio.db");
const DATA_DIR = path.join(__dirname, "..", "data");

// ─── Open database ────────────────────────────────────────────────────────────

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  initSchema(_db);
  return _db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_journal (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      level       TEXT NOT NULL DEFAULT 'info',
      area        TEXT NOT NULL DEFAULT 'general',
      title       TEXT NOT NULL DEFAULT '',
      message     TEXT NOT NULL DEFAULT '',
      meta_json   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_journal_created ON studio_journal(created_at DESC);

    CREATE TABLE IF NOT EXISTS project_rules (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      text        TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'manual',
      active      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ai_lessons (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'general',
      mistake     TEXT NOT NULL,
      correction  TEXT NOT NULL,
      tags_json   TEXT NOT NULL DEFAULT '[]',
      source      TEXT NOT NULL DEFAULT 'user'
    );

    CREATE INDEX IF NOT EXISTS idx_lessons_created ON ai_lessons(created_at DESC);

    CREATE TABLE IF NOT EXISTS asset_registry (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      key         TEXT NOT NULL UNIQUE,
      url         TEXT NOT NULL,
      local_path  TEXT NOT NULL DEFAULT '',
      file_name   TEXT NOT NULL DEFAULT '',
      label       TEXT NOT NULL DEFAULT '',
      alt         TEXT NOT NULL DEFAULT '',
      placement   TEXT NOT NULL DEFAULT '',
      width       INTEGER NOT NULL DEFAULT 0,
      height      INTEGER NOT NULL DEFAULT 0,
      notes       TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS generation_history (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '',
      mail_id     TEXT NOT NULL DEFAULT '',
      locale      TEXT NOT NULL DEFAULT '',
      subject     TEXT NOT NULL DEFAULT '',
      preheader   TEXT NOT NULL DEFAULT '',
      mode        TEXT NOT NULL DEFAULT 'draft',
      source      TEXT NOT NULL DEFAULT 'ai',
      brief_json  TEXT NOT NULL DEFAULT '{}',
      html_head   TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_genhistory_created ON generation_history(created_at DESC);
  `);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(prefix = "item") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return new Date().toISOString();
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ─── Studio Journal ───────────────────────────────────────────────────────────

export function journalAppend({ level = "info", area = "general", title = "", message = "", meta = {} }) {
  const db = getDb();
  const id = genId("log");
  const stmt = db.prepare(`
    INSERT INTO studio_journal (id, created_at, level, area, title, message, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, now(), level, area, String(title), String(message), JSON.stringify(meta));

  // Keep only last 500 entries
  db.exec(`DELETE FROM studio_journal WHERE id NOT IN (
    SELECT id FROM studio_journal ORDER BY created_at DESC LIMIT 500
  )`);
  return id;
}

export function journalList(limit = 250) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM studio_journal ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  return rows.map(rowToJournalEntry);
}

export function journalClear() {
  getDb().exec("DELETE FROM studio_journal");
}

function rowToJournalEntry(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    level: row.level,
    area: row.area,
    title: row.title,
    message: row.message,
    meta: safeJson(row.meta_json, {})
  };
}

// ─── Project Rules ────────────────────────────────────────────────────────────

export function rulesGetAll() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM project_rules ORDER BY created_at DESC
  `).all();
  return rows.map(rowToRule);
}

export function rulesAppend(text, source = "manual") {
  const clean = String(text).trim();
  if (!clean) throw new Error("Rule text is empty");
  const db = getDb();
  const ts = now();

  // Upsert by normalised text
  const existing = db.prepare(`
    SELECT id FROM project_rules WHERE lower(text) = lower(?)
  `).get(clean);

  if (existing) {
    db.prepare(`UPDATE project_rules SET updated_at=?, active=1 WHERE id=?`)
      .run(ts, existing.id);
    return existing.id;
  }

  const id = genId("rule");
  db.prepare(`
    INSERT INTO project_rules (id, created_at, updated_at, text, source, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, ts, ts, clean, source);

  // Keep max 200
  db.exec(`DELETE FROM project_rules WHERE id NOT IN (
    SELECT id FROM project_rules ORDER BY created_at DESC LIMIT 200
  )`);
  return id;
}

export function rulesClear() {
  getDb().exec("DELETE FROM project_rules");
}

function rowToRule(row) {
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: Boolean(row.active)
  };
}

// ─── AI Lessons ───────────────────────────────────────────────────────────────

export function lessonsGetAll() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM ai_lessons ORDER BY created_at DESC
  `).all();
  return rows.map(rowToLesson);
}

export function lessonsAppend({ category = "general", mistake, correction, tags = [], source = "user" }) {
  const cleanMistake = String(mistake || "").trim();
  const cleanCorrection = String(correction || "").trim();
  if (!cleanMistake || !cleanCorrection) throw new Error("Both mistake and correction are required");

  const db = getDb();
  const id = genId("lesson");
  db.prepare(`
    INSERT INTO ai_lessons (id, created_at, category, mistake, correction, tags_json, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, now(), category, cleanMistake, cleanCorrection, JSON.stringify(tags), source);

  // Keep max 300
  db.exec(`DELETE FROM ai_lessons WHERE id NOT IN (
    SELECT id FROM ai_lessons ORDER BY created_at DESC LIMIT 300
  )`);
  return { id, category, mistake: cleanMistake, correction: cleanCorrection, tags, source };
}

export function lessonsDelete(id) {
  const result = getDb().prepare("DELETE FROM ai_lessons WHERE id = ?").run(id);
  return { deleted: result.changes > 0 };
}

export function lessonsClear() {
  getDb().exec("DELETE FROM ai_lessons");
}

function rowToLesson(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    category: row.category,
    mistake: row.mistake,
    correction: row.correction,
    tags: safeJson(row.tags_json, []),
    source: row.source
  };
}

// ─── Asset Registry ───────────────────────────────────────────────────────────

export function assetsGetAll() {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM asset_registry ORDER BY created_at DESC`).all();
  return rows.map(rowToAsset);
}

export function assetsUpsert(entry) {
  const db = getDb();
  const ts = now();
  const id = entry.id || genId("asset");

  const existing = db.prepare("SELECT id FROM asset_registry WHERE id = ?").get(id);
  if (existing) {
    db.prepare(`
      UPDATE asset_registry
      SET updated_at=?, key=?, url=?, local_path=?, file_name=?, label=?, alt=?,
          placement=?, width=?, height=?, notes=?
      WHERE id=?
    `).run(
      ts,
      String(entry.key || ""),
      String(entry.url || ""),
      String(entry.localPath || entry.local_path || ""),
      String(entry.fileName || entry.file_name || ""),
      String(entry.label || ""),
      String(entry.alt || ""),
      String(entry.placement || ""),
      Number(entry.width || 0),
      Number(entry.height || 0),
      String(entry.notes || ""),
      id
    );
  } else {
    db.prepare(`
      INSERT INTO asset_registry
        (id, created_at, updated_at, key, url, local_path, file_name, label, alt, placement, width, height, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, ts, ts,
      String(entry.key || ""),
      String(entry.url || ""),
      String(entry.localPath || entry.local_path || ""),
      String(entry.fileName || entry.file_name || ""),
      String(entry.label || ""),
      String(entry.alt || ""),
      String(entry.placement || ""),
      Number(entry.width || 0),
      Number(entry.height || 0),
      String(entry.notes || "")
    );
  }
  return id;
}

export function assetsUpdate(id, patch) {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM asset_registry WHERE id = ?").get(id);
  if (!existing) return null;
  const merged = { ...rowToAsset(existing), ...patch, id, updatedAt: now() };
  assetsUpsert(merged);
  return merged;
}

export function assetsClear() {
  getDb().exec("DELETE FROM asset_registry");
}

function rowToAsset(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    key: row.key,
    url: row.url,
    localPath: row.local_path,
    fileName: row.file_name,
    label: row.label,
    alt: row.alt,
    placement: row.placement,
    width: row.width,
    height: row.height,
    notes: row.notes
  };
}

// ─── Migration from JSON ──────────────────────────────────────────────────────

function tryReadJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export function migrateFromJson(options = {}) {
  const verbose = Boolean(options.verbose);
  const log = verbose ? (msg) => console.log(`[migrate] ${msg}`) : () => {};
  const db = getDb();
  const results = { journal: 0, rules: 0, lessons: 0, assets: 0 };

  // Check if already migrated
  const hasMigrationFlag = db.prepare(`
    SELECT id FROM studio_journal WHERE id = 'migration-complete' LIMIT 1
  `).get();
  if (hasMigrationFlag && !options.force) {
    log("Already migrated — skipping. Pass force:true to re-migrate.");
    return results;
  }

  // Journal
  const journalData = tryReadJson(path.join(DATA_DIR, "studio-journal.json"), { entries: [] });
  const journalEntries = Array.isArray(journalData?.entries) ? journalData.entries : [];
  for (const entry of journalEntries.slice(0, 500)) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO studio_journal (id, created_at, level, area, title, message, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id || genId("log"),
        entry.createdAt || now(),
        entry.level || "info",
        entry.area || "general",
        String(entry.title || ""),
        String(entry.message || ""),
        JSON.stringify(entry.meta || {})
      );
      results.journal++;
    } catch { /* skip duplicate */ }
  }
  log(`Journal: migrated ${results.journal} entries`);

  // Project rules
  const rulesData = tryReadJson(path.join(DATA_DIR, "project-rules.json"), { items: [] });
  const rulesItems = Array.isArray(rulesData?.items) ? rulesData.items : [];
  for (const rule of rulesItems) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO project_rules (id, created_at, updated_at, text, source, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        rule.id || genId("rule"),
        rule.createdAt || now(),
        rule.updatedAt || now(),
        String(rule.text || ""),
        String(rule.source || "manual"),
        rule.active !== false ? 1 : 0
      );
      results.rules++;
    } catch { /* skip */ }
  }
  log(`Rules: migrated ${results.rules} items`);

  // AI Lessons
  const lessonsData = tryReadJson(path.join(DATA_DIR, "ai-lessons.json"), { items: [] });
  const lessonsItems = Array.isArray(lessonsData?.items) ? lessonsData.items : [];
  for (const lesson of lessonsItems) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO ai_lessons (id, created_at, category, mistake, correction, tags_json, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        lesson.id || genId("lesson"),
        lesson.createdAt || now(),
        lesson.category || "general",
        String(lesson.mistake || ""),
        String(lesson.correction || ""),
        JSON.stringify(lesson.tags || []),
        lesson.source || "user"
      );
      results.lessons++;
    } catch { /* skip */ }
  }
  log(`AI Lessons: migrated ${results.lessons} items`);

  // Asset registry
  const assetData = tryReadJson(path.join(DATA_DIR, "asset-registry.json"), { items: [] });
  const assetItems = Array.isArray(assetData?.items) ? assetData.items : [];
  for (const asset of assetItems) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO asset_registry
          (id, created_at, updated_at, key, url, local_path, file_name, label, alt, placement, width, height, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asset.id || genId("asset"),
        asset.createdAt || now(),
        asset.updatedAt || now(),
        String(asset.key || ""),
        String(asset.url || ""),
        String(asset.localPath || asset.local_path || ""),
        String(asset.fileName || asset.file_name || ""),
        String(asset.label || ""),
        String(asset.alt || ""),
        String(asset.placement || ""),
        Number(asset.width || 0),
        Number(asset.height || 0),
        String(asset.notes || "")
      );
      results.assets++;
    } catch { /* skip */ }
  }
  log(`Assets: migrated ${results.assets} items`);

  // Mark as migrated
  db.prepare(`INSERT OR REPLACE INTO studio_journal (id, created_at, level, area, title, message, meta_json)
    VALUES ('migration-complete', ?, 'info', 'system', 'Migration complete', 'Migrated from JSON files', ?)`
  ).run(now(), JSON.stringify(results));

  log(`Migration complete: ${JSON.stringify(results)}`);
  return results;
}

// ─── Generation History ───────────────────────────────────────────────────────

/**
 * Saves a generation record.
 * html_head: first 8 KB of the generated HTML (enough for preview metadata).
 */
export function historyAppend({ category, mailId, locale, subject, preheader, mode, source, brief, html }) {
  const db = getDb();
  const id = genId("gen");
  const htmlHead = typeof html === "string" ? html.slice(0, 8192) : "";
  db.prepare(`
    INSERT INTO generation_history
      (id, created_at, category, mail_id, locale, subject, preheader, mode, source, brief_json, html_head)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, now(),
    String(category || ""),
    String(mailId || ""),
    String(locale || ""),
    String(subject || ""),
    String(preheader || ""),
    String(mode || "draft"),
    String(source || "ai"),
    JSON.stringify(brief || {}),
    htmlHead
  );
  // Keep only last 200 records
  db.exec(`DELETE FROM generation_history WHERE id NOT IN (
    SELECT id FROM generation_history ORDER BY created_at DESC LIMIT 200
  )`);
  return id;
}

export function historyList(limit = 50) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, created_at, category, mail_id, locale, subject, preheader, mode, source, brief_json
    FROM generation_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map(rowToHistoryEntry);
}

export function historyGetHtml(id) {
  const db = getDb();
  const row = db.prepare(`SELECT html_head FROM generation_history WHERE id = ?`).get(id);
  return row ? row.html_head : null;
}

export function historyDelete(id) {
  const result = getDb().prepare("DELETE FROM generation_history WHERE id = ?").run(id);
  return { deleted: result.changes > 0 };
}

export function historyClear() {
  getDb().exec("DELETE FROM generation_history");
}

function rowToHistoryEntry(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    category: row.category,
    mailId: row.mail_id,
    locale: row.locale,
    subject: row.subject,
    preheader: row.preheader,
    mode: row.mode,
    source: row.source,
    brief: safeJson(row.brief_json, {})
  };
}
