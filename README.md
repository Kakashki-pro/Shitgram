# Shitgram

Encrypted messaging platform

## What it is

Shitgram is a chat application that lets you create encrypted group conversations and message privately with end-to-end encryption. Everything is encrypted with AES-GCM on the client side, so no one but you and your group members can read messages

## Getting started

### Prerequisites

- Node.js 16+
- PostgreSQL (for server)
- npm or yarn

### Installation

Backend (Server):

```bash
cd backend
npm install
```

Set up environment variables:

```bash
DATABASE_URL=your_postgres_url
PORT=3000
```

Start the server:

```bash
npm start
```

Frontend (Web):

Navigate to `http://localhost:3000` in your browser

Desktop App:

```bash
cd app
npm install
npm start
```

Build for Windows:

```bash
npm run build:win
```

## Features

- End-to-end encryption with AES-256-GCM
- Real-time messaging with WebSocket
- Group chat management
- User codes for finding and connecting with friends
- Group codes to join existing groups
- Message deletion (Ctrl+Del)
- Settings bot with helpful commands (/help)
- Support for tickets and feedback

## Commands

Use these commands in the Settings chat:

- `/help` - List all commands
- `/change_name <nick>` - Change your username
- `/Ucode` - Get your personal code
- `/finduser <code>` - Find user by code
- `/create_group <name>` - Create a new group
- `/Gcode <group>` - Get group code
- `/join_group <code>` - Join existing group
- `/delete_group-channel <name>` - Delete your group
- `/ticket <text>` - Submit feedback

## License

GPLv3 License. See [LICENSE](LICENSE) file for details
