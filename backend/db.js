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

db.addMessage = async function(id, username, text, chat, time) {
  try {
    await db.query(
      "INSERT INTO messages (msg_id, username, text, chat, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, username, text, chat, time]
    );
    return true;
  } catch (err) {
    console.error("Failed to add message:", err);
    return false;
  }
};

db.getMessages = async function(chat) {
  try {
    const result = await db.query(
      "SELECT msg_id as id, username, text, chat, created_at as time FROM messages WHERE chat = $1 ORDER BY created_at ASC",
      [chat]
    );
    return result.rows;
  } catch (err) {
    console.error("Failed to get messages:", err);
    return [];
  }
};

db.deleteMessage = async function(id, chat) {
  try {
    await db.query(
      "DELETE FROM messages WHERE msg_id = $1 AND chat = $2",
      [id, chat]
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

    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        msg_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        chat TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    console.log("Tables initialized");
  } catch (err) {
    console.error("Failed to initialize tables:", err);
  }
}

initTables();

module.exports = db;
