const crypto = require("crypto");

// ===== CONSTANTS =====
const IV_LENGTH = 12;           // GCM IV length
const SALT_LENGTH = 16;         // PBKDF2 salt length
const KEY_LENGTH = 32;          // AES-256 key length
const TAG_LENGTH = 16;          // GCM authentication tag
const ITERATIONS = 600000;      // PBKDF2 iterations (⬆️ увел��чено с 200k для Telegram-уровня)

// ===== KEY DERIVATION =====
/**
 * Derive encryption key using PBKDF2 with SHA-256
 * @param {string} password - User password
 * @param {Buffer} salt - Random salt
 * @returns {Buffer} - Derived key
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

// ===== ENCRYPTION =====
/**
 * Encrypt text using AES-256-GCM
 * Format: [salt(16)][iv(12)][tag(16)][encrypted_data]
 * @param {string} text - Plain text to encrypt
 * @param {string} password - Encryption password
 * @returns {string} - Base64 encoded ciphertext
 */
function encrypt(text, password) {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from password
  const key = deriveKey(password, salt);
  
  // Create cipher
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  // Encrypt text
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final()
  ]);
  
  // Get authentication tag
  const tag = cipher.getAuthTag();
  
  // Combine all parts: salt + iv + tag + encrypted
  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

// ===== DECRYPTION =====
/**
 * Decrypt AES-256-GCM ciphertext
 * @param {string} data - Base64 encoded ciphertext
 * @param {string} password - Decryption password
 * @returns {string|null} - Decrypted text or null if failed
 */
function decrypt(data, password) {
  try {
    // Decode from base64
    const raw = Buffer.from(data, "base64");
    
    // Extract components
    const salt = raw.slice(0, SALT_LENGTH);
    const iv = raw.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = raw.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.slice(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    
    // Derive key using same salt
    const key = deriveKey(password, salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("[CRYPTO] Decryption failed:", err.message);
    return null;
  }
}

// ===== EXPORTS =====
module.exports = {
  encrypt,
  decrypt,
  // Expose constants for reference
  ITERATIONS,
  KEY_LENGTH
};
