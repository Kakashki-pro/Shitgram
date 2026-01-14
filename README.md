# Shitgram

End-to-end encrypted messaging for web and desktop

Shitgram is a real-time chat platform with peer-to-peer encryption. Send messages that only you and your recipients can read, join group chats, and manage conversations from the browser or Electron desktop app

## What's included

**Private messaging** encrypts your conversations so only the recipient can read them. Messages stay encrypted even if transmitted through servers—each user decrypts with their own password-derived key

**Group chats** let you invite others via group codes. Group members can set a shared password to encrypt group messages, or skip encryption for open channels

**Desktop client** runs independently on Windows, or load the web version in any browser. Both connect to the same server

**Message management** lets you delete sent messages from all participants. Commands in the settings chat create groups, change your username, or submit support tickets

**Password-based encryption** uses PBKDF2 and AES-256-GCM to keep messages secure without managing keys. Your password never leaves your device

## Getting started

### Web version

Prerequisites: Node.js 20+ and PostgreSQL

```bash
cd backend
npm install
npm start
```

Open `http://localhost:5000` in your browser

### Desktop app

Prerequisites: Node.js 20+

```bash
cd app
npm install
npm start
```

To build for Windows:

```bash
npm run build:win
```

The app connects to the same server as the web version—all chats, groups, and messages sync across platforms

## Commands

Use these in the Settings chat:

- `/help` - list commands
- `/msg <username>` - open DM with user
- `/change_name <new_nick>` - change username
- `/Ucode` - get user code
- `/finduser <code>` - find user by code
- `/create_group <name>` - create group
- `/Gcode <group>` - get group code
- `/join_group <code>` - join group
- `/delete_group-channel <name>` - delete group
- `/ticket <text>` - submit ticket
- `/x` - ???

## Technical notes

**Encryption** uses PBKDF2 for key derivation and AES-256-GCM for encryption. Private chats compute a deterministic key from both usernames and the user's password, so both parties derive the same key and can decrypt. Group chats work the same way with an optional shared group password

**Real-time sync** uses Socket.io. Messages broadcast to active users instantly and persist in PostgreSQL, so you can load history anytime

**Client-side origin** means your password never reaches the server—only the hashed password for authentication. Encryption and decryption happen entirely in the browser or Electron app

This project builds on encryption patterns found in modern secure messaging platforms. The implementation is original and uses the Web Crypto API for in-browser cryptography

**Design inspiration**: Telegram Desktop (tdesktop) - GPLv3 licensed, open source

## License

GPLv3 License. See [LICENSE](LICENSE) file for details
