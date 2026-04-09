const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const auth = require("./src/auth");
const db = require("./db");

// ===== INIT =====
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ===== CODE ROTATION SYSTEM =====
const codeRefreshIntervals = new Map();

/**
 * Start automatic user code rotation (30 minutes)
 */
async function startUserCodeRotation(username) {
  if (codeRefreshIntervals.has(`user-${username}`)) {
    clearInterval(codeRefreshIntervals.get(`user-${username}`));
  }

  const interval = setInterval(async () => {
    try {
      const newCode = generateUserCode();
      await db.setUserCode(username, newCode);
      console.log(`[CODE ROTATION] User ${username} code updated`);
    } catch (err) {
      console.error(`[CODE ROTATION ERROR] User ${username}:`, err.message);
    }
  }, 30 * 60 * 1000);

  codeRefreshIntervals.set(`user-${username}`, interval);
}

/**
 * Start automatic group code rotation (2 hours)
 */
async function startGroupCodeRotation(groupName) {
  const key = `group-${groupName}`;
  
  if (codeRefreshIntervals.has(key)) {
    clearInterval(codeRefreshIntervals.get(key));
  }

  const interval = setInterval(async () => {
    try {
      const newCode = generateGroupCode();
      await db.setGroupCode(groupName, newCode);
      console.log(`[CODE ROTATION] Group ${groupName} code rotated`);
    } catch (err) {
      console.error(`[CODE ROTATION ERROR] Group ${groupName}:`, err.message);
    }
  }, 2 * 60 * 60 * 1000);

  codeRefreshIntervals.set(key, interval);
}

/**
 * Stop code rotation for user/group
 */
function stopCodeRotation(identifier) {
  if (codeRefreshIntervals.has(identifier)) {
    clearInterval(codeRefreshIntervals.get(identifier));
    codeRefreshIntervals.delete(identifier);
  }
}

// ===== REST API - AUTHENTICATION =====

/**
 * Register new user
 * POST /api/register
 */
app.post("/api/register", async (req, res) => {
  const { username, password, publicKey } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "empty fields" });
  }

  try {
    await auth.register(username, password, publicKey || "");
    await startUserCodeRotation(username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Login user
 * POST /api/login
 */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "empty fields" });
  }

  try {
    const user = await auth.login(username, password);
    await startUserCodeRotation(username);
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ===== REST API - MESSAGES =====

/**
 * Get chat messages
 * GET /api/messages/:chat?username=user
 */
app.get("/api/messages/:chat", async (req, res) => {
  const chat = req.params.chat;
  const username = req.query.username;

  if (!username) return res.json([]);

  try {
    // Check if group chat
    const groupResult = await db.query("SELECT * FROM groups WHERE name = $1", [chat]);
    
    if (groupResult.rows.length > 0) {
      const isMember = await db.isMember(chat, username);
      if (!isMember) return res.status(403).json({ error: "unauthorized" });
    }

    // Check if DM
    if (chat.includes("-")) {
      const [user1, user2] = chat.split("-").sort();
      if (user1 !== username && user2 !== username) {
        return res.status(403).json({ error: "unauthorized" });
      }
    }

    const dbMessages = await db.getMessages(chat);
    res.json(dbMessages);
  } catch (err) {
    console.error("Failed to fetch messages:", err);
    res.status(500).json({ error: "server error" });
  }
});

// ===== REST API - GROUPS =====

/**
 * Get user's groups
 * GET /api/groups?username=user
 */
app.get("/api/groups", async (req, res) => {
  const username = req.query.username;
  
  if (!username) return res.json([]);

  try {
    const result = await db.query(
      "SELECT DISTINCT g.name FROM groups g INNER JOIN group_members m ON g.name = m.group_name WHERE m.username = $1",
      [username]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch groups:", err);
    res.json([]);
  }
});

// ===== SOCKET.IO =====

const userSockets = new Map();

io.on("connection", socket => {
  // Set username for this socket
  socket.on("set_username", (username) => {
    if (!userSockets.has(username)) {
      userSockets.set(username, []);
    }
    userSockets.get(username).push(socket.id);
    console.log(`[CONNECT] ${username}`);
  });

  // Send message
  socket.on("send_message", async data => {
    const { username, text, chat } = data;

    if (!username || !text || !chat) return;

    // Validate authorization
    if (chat !== "settings" && chat !== "tickets") {
      try {
        const groupResult = await db.query("SELECT * FROM groups WHERE name = $1", [chat]);
        
        if (groupResult.rows.length > 0) {
          const isMember = await db.isMember(chat, username);
          if (!isMember) return;
        } else if (chat.includes("-")) {
          const [user1, user2] = chat.split("-").sort();
          if (user1 !== username && user2 !== username) return;
        }
      } catch (err) {
        console.error("Auth check error:", err);
        return;
      }
    }

    // Handle /settings commands
    if (chat === "settings" && text.startsWith("/")) {
      const reply = await handleCommand(username, text, io, socket);

      const botMsg = {
        id: genMsgId(),
        username: "settings_bot",
        text: reply,
        chat: "settings",
        time: Date.now()
      };

      await db.addMessage(botMsg.id, botMsg.username, botMsg.text, botMsg.chat, botMsg.time);
      socket.emit("new_message", botMsg);
      return;
    }

    // Regular message
    const msg = {
      id: genMsgId(),
      username,
      text,
      chat,
      time: Date.now()
    };

    await db.addMessage(msg.id, msg.username, msg.text, msg.chat, msg.time);
    io.to(`chat-${chat}`).emit("new_message", msg);
  });

  // Delete message
  socket.on("delete_message", async data => {
    const { id, chat, username } = data;
    
    if (!id || !chat || !username) return;

    try {
      const msgResult = await db.query(
        "SELECT username FROM messages WHERE msg_id = $1 AND chat = $2",
        [id, chat]
      );
      
      if (msgResult.rows.length === 0 || msgResult.rows[0].username !== username) return;

      await db.deleteMessage(id, chat);
      io.to(`chat-${chat}`).emit("message_deleted", { id, chat });
    } catch (err) {
      console.error("Delete error:", err);
    }
  });

  // ===== VOICE CALLS =====

  // Initiate call
  socket.on("call_initiate", async data => {
    const { from, to, offer } = data;
    if (!from || !to || !offer) return;
    
    const recipientSockets = userSockets.get(to) || [];
    recipientSockets.forEach(socketId => {
      io.to(socketId).emit("call_incoming", { from, to, offer });
    });
  });

  // WebRTC signal (ICE candidate)
  socket.on("call_signal", data => {
    const { to, signal, from } = data;
    if (!to || !signal) return;
    
    const recipientSockets = userSockets.get(to) || [];
    recipientSockets.forEach(socketId => {
      io.to(socketId).emit("call_signal_received", { signal, from });
    });
  });

  // Accept call
  socket.on("call_accept", data => {
    const { caller, answer } = data;
    if (!caller || !answer) return;
    
    const callerSockets = userSockets.get(caller) || [];
    callerSockets.forEach(socketId => {
      io.to(socketId).emit("call_accepted", { answer });
    });
  });

  // Reject call
  socket.on("call_reject", data => {
    const { caller } = data;
    if (!caller) return;
    
    const callerSockets = userSockets.get(caller) || [];
    callerSockets.forEach(socketId => {
      io.to(socketId).emit("call_rejected", { caller });
    });
  });

  // End call
  socket.on("call_end", data => {
    const { to } = data;
    if (!to) return;
    
    const recipientSockets = userSockets.get(to) || [];
    recipientSockets.forEach(socketId => {
      io.to(socketId).emit("call_ended", { to });
    });
  });

  // ===== CHAT ROOMS =====

  // Join chat room
  socket.on("join_chat", (data) => {
    const { chat } = data;
    if (!chat) return;
    socket.join(`chat-${chat}`);
  });

  // Leave chat room
  socket.on("leave_chat", (data) => {
    const { chat } = data;
    if (!chat) return;
    socket.leave(`chat-${chat}`);
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const [username, sockets] of userSockets.entries()) {
      const idx = sockets.indexOf(socket.id);
      if (idx > -1) {
        sockets.splice(idx, 1);
        if (sockets.length === 0) {
          userSockets.delete(username);
          stopCodeRotation(`user-${username}`);
          console.log(`[DISCONNECT] User ${username}`);
        }
      }
    }
  });
});

// ===== COMMAND HANDLER =====

async function handleCommand(username, text, io, socket) {
  const parts = text.trim().split(" ");
  const cmd = parts[0];

  switch (cmd) {
    case "/help":
      return `/help /msg /change_name /Ucode /finduser /create_group /Gcode /join_group /delete_group-channel /ticket /x`;

    case "/change_name": {
      const newName = parts[1];
      if (!newName) return "Usage: /change_name <nick>";
      const ok = await db.changeUsername(username, newName);
      if (ok) {
        stopCodeRotation(`user-${username}`);
        await startUserCodeRotation(newName);
        return `Username changed to ${newName}`;
      }
      return "Username taken";
    }

    case "/msg": {
      const otherUser = parts[1];
      if (!otherUser) return "Usage: /msg <username>";
      if (otherUser === username) return "Can't message yourself";
      const exists = await db.userExists(otherUser);
      if (!exists) return `User ${otherUser} not found`;
      
      const chatName = [username, otherUser].sort().join("-");
      
      const userSockets1 = userSockets.get(username) || [];
      const userSockets2 = userSockets.get(otherUser) || [];
      
      userSockets1.forEach(socketId => {
        io.to(socketId).emit("chat_created", { chat: chatName, isDM: true, user2: otherUser });
      });
      
      userSockets2.forEach(socketId => {
        io.to(socketId).emit("chat_created", { chat: chatName, isDM: true, user2: username });
      });
      
      return `Opening chat with ${otherUser}...`;
    }

    case "/Ucode": {
      let code = await db.getUserCode(username);
      if (!code) {
        code = generateUserCode();
        await db.setUserCode(username, code);
        await startUserCodeRotation(username);
      }
      return `Your code: ${code}`;
    }

    case "/finduser": {
      const ucode = parts[1];
      if (!ucode) return "Usage: /finduser <code>";
      const found = await db.findUserByCode(ucode);
      return found ? `Found: ${found}` : "User not found";
    }

    case "/create_group": {
      const gname = parts[1];
      if (!gname) return "Usage: /create_group <name>";
      const created = await db.createGroup(gname, username);
      if (created) {
        socket.emit("chat_created", { chat: gname });
        await startGroupCodeRotation(gname);
        return `Group ${gname} created`;
      }
      return "Group exists";
    }

    case "/Gcode": {
      const groupName = parts[1];
      if (!groupName) return "Usage: /Gcode <group>";
      const group = await db.getGroup(groupName);
      if (!group) return "Group not found";
      const isMember = await db.isMember(groupName, username);
      if (!isMember) return "You are not in this group";
      
      let gcode = group.group_code;
      if (!gcode) {
        gcode = generateGroupCode();
        await db.setGroupCode(groupName, gcode);
        await startGroupCodeRotation(groupName);
      }
      return `Group code: ${gcode}`;
    }

    case "/join_group": {
      const joinCode = parts[1];
      if (!joinCode) return "Usage: /join_group <code>";
      const g = await db.getGroupByCode(joinCode);
      if (!g) return "Group not found";
      const already = await db.isMember(g.name, username);
      if (already) return "Already in group";
      
      await db.addGroupMember(g.name, username);
      socket.emit("chat_created", { chat: g.name });
      
      io.to(`chat-${g.name}`).emit("new_message", {
        id: genMsgId(),
        username: "system",
        text: `${username} joined`,
        chat: g.name,
        time: Date.now()
      });

      return `Joined group ${g.name}`;
    }

    case "/delete_group-channel": {
      const delName = parts[1];
      if (!delName) return "Usage: /delete_group-channel <name>";
      const deleted = await db.deleteGroup(delName, username);
      if (deleted) {
        stopCodeRotation(`group-${delName}`);
        io.to(`chat-${delName}`).emit("group_deleted", { group: delName });
        return "Group deleted";
      }
      return "You are not owner";
    }

    case "/ticket": {
      const msg = parts.slice(1).join(" ");
      if (!msg) return "Usage: /ticket <text>";
      await db.addTicket(username, msg);
      
      const ticketMsg = {
        id: genMsgId(),
        username: username,
        text: `[TICKET] ${msg}`,
        chat: "tickets",
        time: Date.now()
      };
      
      await db.addMessage(ticketMsg.id, ticketMsg.username, ticketMsg.text, ticketMsg.chat, ticketMsg.time);
      io.to("chat-tickets").emit("new_message", ticketMsg);
      
      return "Ticket sent";
    }

    case "/x": {
      socket.emit("easter_egg");
      return "";
    }

    default:
      return "Unknown command. Try /help";
  }
}

// ===== UTILITY FUNCTIONS =====

function genMsgId() {
  return Date.now() + "_" + Math.random().toString(16).slice(2);
}

function generateUserCode() {
  const small = "abcdefghijklmnopqrstuvwxyz";
  const big = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";

  function r(str, n) {
    return Array.from({ length: n }, () => str[Math.floor(Math.random() * str.length)]).join("");
  }

  return r(small, 4) + r(big, 2) + "-" + r(digits, 4);
}

function generateGroupCode() {
  const digits = "0123456789";
  const big = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function r(str, n) {
    return Array.from({ length: n }, () => str[Math.floor(Math.random() * str.length)]).join("");
  }

  return r(digits, 3) + r(big, 3) + r(digits, 3) + r(big, 1);
}

// ===== START SERVER =====

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
