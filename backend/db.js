// Required Postgres tables and columns (expected schema):
//
// messages: id (BIGINT, SERIAL), sender_name (TEXT), text_content (TEXT, nullable), media_url (TEXT, nullable), chat (VARCHAR(100)), created_at (TIMESTAMP DEFAULT now())
// users: username (TEXT, unique), password_hash (TEXT), public_key (TEXT), user_code (TEXT, unique)
// groups: name (TEXT, unique), owner (TEXT), group_code (TEXT, unique)
// group_members: group_name (TEXT), username (TEXT)
// tickets: username (TEXT), text (TEXT)

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set DATABASE_URL to your Postgres connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Generic query export — returns the full result from pg (so callers can use .rows)
async function query(text, params) {
  return pool.query(text, params);
}

// Messages API adapted to new schema
async function addMessage(username, text, mediaUrl, chat) {
  const sql = 'INSERT INTO messages (sender_name, text_content, media_url, chat) VALUES ($1, $2, $3, $4) RETURNING id';
  try {
    const res = await query(sql, [username, text, mediaUrl, chat]);
    return res.rows[0]?.id ?? null;
  } catch (err) {
    console.error('addMessage error:', err);
    return null;
  }
}

async function getMessages(chat) {
  const sql = 'SELECT id, sender_name as username, text_content as text, media_url, chat, created_at as time FROM messages WHERE chat = $1 ORDER BY created_at ASC';
  try {
    const res = await query(sql, [chat]);
    return res.rows;
  } catch (err) {
    console.error('getMessages error:', err);
    return [];
  }
}

async function deleteMessage(id) {
  const sql = 'DELETE FROM messages WHERE id = $1';
  try {
    await query(sql, [id]);
    return true;
  } catch (err) {
    console.error('deleteMessage error:', err);
    return false;
  }
}

async function userExists(username) {
  const sql = 'SELECT 1 FROM users WHERE username = $1 LIMIT 1';
  const res = await query(sql, [username]);
  return res.rows.length > 0;
}

async function getUserCode(username) {
  const sql = 'SELECT user_code FROM users WHERE username = $1';
  const res = await query(sql, [username]);
  return res.rows[0]?.user_code ?? null;
}

async function setUserCode(username, code) {
  const sql = 'UPDATE users SET user_code = $1 WHERE username = $2';
  try {
    await query(sql, [code, username]);
    return true;
  } catch (err) {
    console.error('setUserCode error:', err);
    return false;
  }
}

async function findUserByCode(code) {
  const sql = 'SELECT username FROM users WHERE user_code = $1 LIMIT 1';
  const res = await query(sql, [code]);
  return res.rows[0]?.username ?? null;
}

async function createGroup(name, owner) {
  // Return false if name already taken
  const exists = await query('SELECT 1 FROM groups WHERE name = $1 LIMIT 1', [name]);
  if (exists.rows.length > 0) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO groups (name, owner) VALUES ($1, $2)', [name, owner]);
    await client.query('INSERT INTO group_members (group_name, username) VALUES ($1, $2)', [name, owner]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createGroup error:', err);
    return false;
  } finally {
    client.release();
  }
}

async function getGroup(name) {
  const res = await query('SELECT * FROM groups WHERE name = $1 LIMIT 1', [name]);
  return res.rows[0] ?? null;
}

async function getGroupByCode(code) {
  const res = await query('SELECT * FROM groups WHERE group_code = $1 LIMIT 1', [code]);
  return res.rows[0] ?? null;
}

async function setGroupCode(groupName, code) {
  try {
    await query('UPDATE groups SET group_code = $1 WHERE name = $2', [code, groupName]);
    return true;
  } catch (err) {
    console.error('setGroupCode error:', err);
    return false;
  }
}

async function isMember(groupName, username) {
  const res = await query('SELECT 1 FROM group_members WHERE group_name = $1 AND username = $2 LIMIT 1', [groupName, username]);
  return res.rows.length > 0;
}

async function addGroupMember(groupName, username) {
  // avoid duplicate membership
  const exists = await query('SELECT 1 FROM group_members WHERE group_name = $1 AND username = $2 LIMIT 1', [groupName, username]);
  if (exists.rows.length > 0) return true;

  try {
    await query('INSERT INTO group_members (group_name, username) VALUES ($1, $2)', [groupName, username]);
    return true;
  } catch (err) {
    console.error('addGroupMember error:', err);
    return false;
  }
}

async function deleteGroup(name, owner) {
  const res = await query('SELECT owner FROM groups WHERE name = $1 LIMIT 1', [name]);
  if (!res.rows[0] || res.rows[0].owner !== owner) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM group_members WHERE group_name = $1', [name]);
    await client.query('DELETE FROM groups WHERE name = $1', [name]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteGroup error:', err);
    return false;
  } finally {
    client.release();
  }
}

async function changeUsername(oldName, newName) {
  // Return false if newName is taken
  const conflict = await query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [newName]);
  if (conflict.rows.length > 0) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Update users table
    const upd = await client.query('UPDATE users SET username = $1 WHERE username = $2', [newName, oldName]);
    // Update other references
    await client.query('UPDATE messages SET sender_name = $1 WHERE sender_name = $2', [newName, oldName]);
    await client.query('UPDATE group_members SET username = $1 WHERE username = $2', [newName, oldName]);
    await client.query('UPDATE groups SET owner = $1 WHERE owner = $2', [newName, oldName]);
    await client.query('COMMIT');

    // If no rows in users were updated, treat it as failure
    return upd.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('changeUsername error:', err);
    return false;
  } finally {
    client.release();
  }
}

async function addTicket(username, text) {
  try {
    await query('INSERT INTO tickets (username, text) VALUES ($1, $2)', [username, text]);
    return true;
  } catch (err) {
    console.error('addTicket error:', err);
    return false;
  }
}

module.exports = {
  query,
  addMessage,
  getMessages,
  deleteMessage,
  userExists,
  getUserCode,
  setUserCode,
  findUserByCode,
  createGroup,
  getGroup,
  getGroupByCode,
  setGroupCode,
  isMember,
  addGroupMember,
  deleteGroup,
  changeUsername,
  addTicket
};
