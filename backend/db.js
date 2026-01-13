const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = {
  query: (text, params) => pool.query(text, params)
};

db.changeUsername = async function(oldName, newName) {
  try {
    await db.query(
      "UPDATE users SET username = $1 WHERE username = $2",
      [newName, oldName]
    );
    return true;
  } catch {
    return false;
  }
};

db.getUserCode = async function(username) {
  const result = await db.query(
    "SELECT user_code FROM users WHERE username = $1",
    [username]
  );
  return result.rows[0]?.user_code || null;
};

db.setUserCode = async function(username, code) {
  try {
    await db.query(
      "UPDATE users SET user_code = $1 WHERE username = $2",
      [code, username]
    );
    return true;
  } catch {
    return false;
  }
};

db.findUserByCode = async function(code) {
  const result = await db.query(
    "SELECT username FROM users WHERE user_code = $1",
    [code]
  );
  return result.rows[0]?.username || null;
};

db.createGroup = async function(name, owner) {
  try {
    await db.query(
      "INSERT INTO groups (name, owner) VALUES ($1, $2)",
      [name, owner]
    );

    await db.query(
      "INSERT INTO group_members (group_name, username) VALUES ($1, $2)",
      [name, owner]
    );

    return true;
  } catch {
    return false;
  }
};

db.getGroup = async function(name) {
  const result = await db.query(
    "SELECT * FROM groups WHERE name = $1",
    [name]
  );
  return result.rows[0] || null;
};

db.getGroupByCode = async function(code) {
  const result = await db.query(
    "SELECT * FROM groups WHERE group_code = $1",
    [code]
  );
  return result.rows[0] || null;
};

db.setGroupCode = async function(name, code) {
  try {
    await db.query(
      "UPDATE groups SET group_code = $1 WHERE name = $2",
      [code, name]
    );
    return true;
  } catch {
    return false;
  }
};

db.isMember = async function(groupName, username) {
  const result = await db.query(
    "SELECT * FROM group_members WHERE group_name = $1 AND username = $2",
    [groupName, username]
  );
  return result.rows.length > 0;
};

db.addGroupMember = async function(groupName, username) {
  try {
    await db.query(
      "INSERT INTO group_members (group_name, username) VALUES ($1, $2)",
      [groupName, username]
    );
    return true;
  } catch {
    return false;
  }
};

db.deleteGroup = async function(name, owner) {
  const result = await db.query(
    "SELECT owner FROM groups WHERE name = $1",
    [name]
  );

  if (!result.rows[0] || result.rows[0].owner !== owner) return false;

  await db.query("DELETE FROM groups WHERE name = $1", [name]);
  await db.query("DELETE FROM group_members WHERE group_name = $1", [name]);

  return true;
};

db.addTicket = async function(username, text) {
  try {
    await db.query(
      "INSERT INTO tickets (username, text) VALUES ($1, $2)",
      [username, text]
    );
    return true;
  } catch {
    return false;
  }
};

async function initTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        public_key TEXT,
        user_code TEXT UNIQUE
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        owner TEXT NOT NULL,
        group_code TEXT UNIQUE
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id SERIAL PRIMARY KEY,
        group_name TEXT NOT NULL,
        username TEXT NOT NULL
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        text TEXT NOT NULL
      );
    `);

    console.log("Tables initialized");
  } catch (err) {
    console.error("Failed to initialize tables:", err);
  }
}

initTables();

module.exports = db;
