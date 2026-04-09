const bcrypt = require("bcrypt");
const db = require("../db");

// ===== CONSTANTS =====
const BCRYPT_ROUNDS = 12;  // ⬆️ увеличено с 10 для большей защиты от brute-force

// ===== REGISTER =====
/**
 * Register new user
 * @param {string} username - Unique username
 * @param {string} password - User password (min 6 chars)
 * @param {string} publicKey - Optional public key for encryption
 * @returns {Object} - {username}
 * @throws {Error} - EMPTY_FIELDS or USERNAME_TAKEN
 */
async function register(username, password, publicKey) {
  // Validate inputs
  if (!username || !password) {
    throw new Error("EMPTY_FIELDS");
  }
  
  // Check if username exists
  const check = await db.query(
    "SELECT id FROM users WHERE username = $1",
    [username]
  );
  
  if (check.rows.length > 0) {
    throw new Error("USERNAME_TAKEN");
  }
  
  try {
    // Hash password with bcrypt
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    
    // Insert user into database
    await db.query(
      "INSERT INTO users (username, password_hash, public_key) VALUES ($1, $2, $3)",
      [username, hash, publicKey || ""]
    );
    
    console.log(`[AUTH] User registered: ${username}`);
    
    return { username };
  } catch (err) {
    console.error("[AUTH] Registration error:", err);
    throw new Error("REGISTRATION_FAILED");
  }
}

// ===== LOGIN =====
/**
 * Login user and verify credentials
 * @param {string} username - Username
 * @param {string} password - User password
 * @returns {Object} - {username, publicKey}
 * @throws {Error} - USER_NOT_FOUND or WRONG_PASSWORD
 */
async function login(username, password) {
  try {
    // Fetch user from database
    const result = await db.query(
      "SELECT username, password_hash, public_key FROM users WHERE username = $1",
      [username]
    );
    
    const user = result.rows[0];
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }
    
    // Verify password with bcrypt
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      console.warn(`[AUTH] Failed login attempt: ${username}`);
      throw new Error("WRONG_PASSWORD");
    }
    
    console.log(`[AUTH] User logged in: ${username}`);
    
    return {
      username: user.username,
      publicKey: user.public_key
    };
  } catch (err) {
    console.error("[AUTH] Login error:", err.message);
    throw err;
  }
}

// ===== EXPORTS =====
module.exports = {
  register,
  login
};
