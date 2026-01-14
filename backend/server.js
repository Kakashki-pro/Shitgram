const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const auth = require("./src/auth");
const db = require("./db");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.post("/api/register", async (req, res) => {
  const { username, password, publicKey } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "empty fields" });
  }

  try {
    await auth.register(username, password, publicKey || "");
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "empty fields" });
  }

  try {
    const user = await auth.login(username, password);
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get("/api/messages/:chat", async (req, res) => {
  const chat = req.params.chat;
  const dbMessages = await db.getMessages(chat);
  res.json(dbMessages);
});

app.get("/api/groups", async (req, res) => {
  try {
    const result = await db.query("SELECT name FROM groups");
    const groups = result.rows;
    res.json(groups);
  } catch (err) {
    res.json([]);
  }
});

io.on("connection", socket => {
  socket.on("send_message", async data => {
    const { username, text, chat } = data;

    if (!username || !text || !chat) return;

    if (chat === "settings" && text.startsWith("/")) {
      const reply = await handleCommand(username, text);

      const botMsg = {
        id: genMsgId(),
        username: "settings_bot",
        text: reply,
        chat: "settings",
        time: Date.now()
      };

      await db.addMessage(botMsg.id, botMsg.username, botMsg.text, botMsg.chat, botMsg.time);
      io.emit("new_message", botMsg);
      return;
    }

    const msg = {
      id: genMsgId(),
      username,
      text,
      chat,
      time: Date.now()
    };

    await db.addMessage(msg.id, msg.username, msg.text, msg.chat, msg.time);
    io.emit("new_message", msg);
  });

  socket.on("delete_message", async data => {
    const { id, chat } = data;
    if (!id || !chat) return;

    await db.deleteMessage(id, chat);
    io.emit("message_deleted", { id, chat });
  });

  socket.on("call_initiate", async data => {
    const { from, to, offer } = data;
    if (!from || !to || !offer) return;
    // Broadcast to all clients so the recipient can receive it
    io.emit("call_incoming", { from, to, offer });
  });

  socket.on("call_signal", data => {
    const { to, signal } = data;
    if (!to || !signal) return;
    // Broadcast ICE candidate to all clients
    io.emit("call_signal_received", { signal });
  });

  socket.on("call_accept", data => {
    const { caller, answer } = data;
    if (!caller || !answer) return;
    io.emit("call_accepted", { caller, answer });
  });

  socket.on("call_reject", data => {
    const { caller } = data;
    if (!caller) return;
    io.emit("call_rejected", { caller });
  });

  socket.on("call_end", data => {
    const { to } = data;
    if (!to) return;
    io.emit("call_ended", { to });
  });
});

async function handleCommand(username, text) {
  const parts = text.trim().split(" ");
  const cmd = parts[0];

  switch (cmd) {
    case "/help":
      return `Commands:
  /help - list commands
  /msg <username> - open DM with user
  /change_name <new_nick> - change username
  /Ucode - get user code
  /finduser <code> - find user by code
  /create_group <name> - create group
  /Gcode <group> - get group code
  /join_group <code> - join group
  /delete_group-channel <name> - delete group
  /ticket <text> - submit ticket
  /x - ???`;

    case "/change_name": {
      const newName = parts[1];
      if (!newName) return "Usage: /change_name <nick>";
      const ok = await db.changeUsername(username, newName);
      return ok ? `Username changed to ${newName}` : "Username taken";
    }

    case "/msg": {
      const otherUser = parts[1];
      if (!otherUser) return "Usage: /msg <username>";
      if (otherUser === username) return "Can't message yourself";
      
      const exists = await db.userExists(otherUser);
      if (!exists) return `User ${otherUser} not found`;
      
      // Create DM chat name (sorted to ensure consistency)
      const chatName = [username, otherUser].sort().join("-");
      
      // Emit event to create and open the chat (like groups)
      io.emit("chat_created", { chat: chatName, isDM: true, user2: otherUser });
      
      return `Opening chat with ${otherUser}...`;
    }

    case "/Ucode": {
      let code = await db.getUserCode(username);
      if (!code) {
        code = generateUserCode();
        await db.setUserCode(username, code);
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
        io.emit("chat_created", { chat: gname });
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

      io.emit("chat_created", { chat: g.name });

      return `Joined group ${g.name}`;
    }

    case "/delete_group-channel": {
      const delName = parts[1];
      if (!delName) return "Usage: /delete_group-channel <name>";
      const deleted = await db.deleteGroup(delName, username);
      return deleted ? "Group deleted" : "You are not owner";
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
      io.emit("new_message", ticketMsg);
      io.emit("chat_created", { chat: "tickets" });
      
      return "Ticket sent";
    }

    case "/x": {
      io.emit("easter_egg");
      return "";
    }

    default:
      return "Unknown command. Try /help";
  }
}

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
