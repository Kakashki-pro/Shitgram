const bcrypt = require("bcrypt");
const db = require("../db");

async function register(username, password, publicKey) {
  if (!username || !password) {
    throw new Error("EMPTY_FIELDS");
  }

  const check = await db.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  if (check.rows.length > 0) {
    throw new Error("USERNAME_TAKEN");
  }

  const hash = await bcrypt.hash(password, 10);

  await db.query(
    "INSERT INTO users (username, password_hash, public_key) VALUES ($1, $2, $3)",
    [username, hash, publicKey || ""]
  );

  return { username };
}

async function login(username, password) {
  const result = await db.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  const user = result.rows[0];
  if (!user) throw new Error("USER_NOT_FOUND");

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error("WRONG_PASSWORD");

  return {
    username: user.username,
    publicKey: user.public_key
  };
}

module.exports = { register, login };
