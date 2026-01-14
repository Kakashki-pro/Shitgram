const SERVER_URL = "https://shitgram.onrender.com";
const socket = io(SERVER_URL, { transports: ["websocket"] });

let username = null;
let userPassword = null;
let currentChat = "settings";
let selectedMessageId = null;
let typingTimeout = null;
let isTyping = false;
let groupPasswords = {};

// Voice call state
let inCall = false;
let callPartner = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let callStartTime = null;

const authOverlay = document.getElementById("authOverlay");
const authError = document.getElementById("authError");
const messagesEl = document.getElementById("messages");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const chatHeader = document.getElementById("chatHeader");
const chatList = document.getElementById("chatList");

// Easter egg trigger function
function triggerKakiEasterEgg() {
    // 40% chance for bass version, 60% for normal
    const musicFile = Math.random() < 0.4 ? "/assets/easter_msg_bass.mp3" : "/assets/easter_msg.mp3";
    
    // Play music
    const audio = new Audio(musicFile);
    audio.play().catch(() => {});

    // Create falling fire images
    const fireFall = setInterval(() => {
        const fire = document.createElement("img");
        fire.src = "/assets/fire_shit.png";
        fire.className = "fire-falling";
        fire.style.left = Math.random() * window.innerWidth + "px";
        fire.style.width = (30 + Math.random() * 40) + "px";
        fire.style.height = "auto";

        const animDuration = 4 + Math.random() * 4;
        fire.style.animationDuration = animDuration + "s";

        document.body.appendChild(fire);

        // Remove after animation
        setTimeout(() => fire.remove(), animDuration * 1000);
    }, 200); // Create new fire every 200ms

    // Stop creating fires when music ends
    audio.addEventListener("ended", () => clearInterval(fireFall));
}

const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 200000;

// Validation limits
const LIMITS = {
  username: 32,
  chatName: 50,
  message: 2000,
  groupPassword: 256
};

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plainText, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plainText)
  );

  const encryptedBytes = new Uint8Array(encrypted);

  const full = new Uint8Array(SALT_LENGTH + IV_LENGTH + encryptedBytes.length);
  full.set(salt, 0);
  full.set(iv, SALT_LENGTH);
  full.set(encryptedBytes, SALT_LENGTH + IV_LENGTH);

  return btoa(String.fromCharCode(...full));
}

async function decryptText(data, password) {
  try {
    const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0));

    const salt = raw.slice(0, SALT_LENGTH);
    const iv = raw.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const encrypted = raw.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch {
    return null;
  }
}

function validateUsername(u) {
  if (!u || u.length < 2) return "Username must be 2+ characters";
  if (u.length > LIMITS.username) return `Username max ${LIMITS.username} chars`;
  if (!/^[a-zA-Z0-9_\-]+$/.test(u)) return "Only letters, numbers, _, - allowed";
  return null;
}

function validateMessage(msg) {
  if (!msg || msg.length === 0) return "Message is empty";
  if (msg.length > LIMITS.message) return `Max ${LIMITS.message} characters`;
  return null;
}

function validateChatName(name) {
  if (!name || name.length < 1) return "Chat name required";
  if (name.length > LIMITS.chatName) return `Max ${LIMITS.chatName} characters`;
  if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return "Only letters, numbers, _, - allowed";
  return null;
}

function getEncryptionPassword(chatName) {
  // For private chats (format: user1-user2), create deterministic key from both usernames
  if (chatName.includes("-") && !chatName.includes("group") && chatName !== "settings" && chatName !== "tickets") {
    const parts = chatName.split("-").sort();
    return userPassword + ":" + parts.join("|");
  }
  // For group chats, use the group password
  if (groupPasswords[chatName]) {
    return groupPasswords[chatName];
  }
  // Default to user password
  return userPassword;
}

async function register() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  
  const uErr = validateUsername(u);
  if (uErr) {
    authError.textContent = uErr;
    return;
  }
  
  if (!p || p.length < 6) {
    authError.textContent = "Password must be 6+ characters";
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p, publicKey: "" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    authError.textContent = "Success, now sign in";
  } catch (e) {
    authError.textContent = e.message;
  }
}

async function login() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  
  const uErr = validateUsername(u);
  if (uErr) {
    authError.textContent = uErr;
    return;
  }
  
  if (!p) {
    authError.textContent = "Enter password";
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    username = data.username;
    userPassword = p;
    authOverlay.style.display = "none";

    ensureSettingsChat();
    await loadGroupsFromServer();
    setActiveChat("settings");
  } catch (e) {
    authError.textContent = e.message;
  }
}

window.register = register;
window.login = login;

async function loadGroupsFromServer() {
  try {
    const res = await fetch(`${SERVER_URL}/api/groups`);
    if (!res.ok) return;

    const groups = await res.json();
    groups.forEach(g => {
      addChatToMenu(g.name, g.name);
    });
  } catch (e) {
    console.error("Failed to load groups:", e);
  }
}

function ensureSettingsChat() {
  if (!document.querySelector('.chat-item[data-chat="settings"]')) {
    addChatToMenu("settings", "⚙ Settings");
  }
}

function addChatToMenu(chatName, label) {
  if (document.querySelector(`.chat-item[data-chat="${chatName}"]`)) return;

  const div = document.createElement("div");
  div.className = "chat-item";
  div.dataset.chat = chatName;
  div.textContent = label || chatName;

  div.addEventListener("click", () => {
    document.querySelectorAll(".chat-item").forEach(i => i.classList.remove("active"));
    div.classList.add("active");
    setActiveChat(chatName);
  });

  chatList.appendChild(div);
}

async function setActiveChat(chatName) {
  if (chatName === "tickets" && username !== "Admin01") {
    authError.textContent = "Access denied";
    setTimeout(() => { authError.textContent = ""; }, 3000);
    return;
  }
  currentChat = chatName;
  chatHeader.textContent = chatName;
  selectedMessageId = null;

  // Show call button only for private chats
  const callBtn = document.getElementById("callBtn");
  if (chatName.includes("-") && !chatName.includes("group") && chatName !== "settings" && chatName !== "tickets") {
    callBtn.style.display = "block";
  } else {
    callBtn.style.display = "none";
  }

  await loadChatHistory(chatName);
}

chatList.addEventListener("click", e => {
  const item = e.target.closest(".chat-item");
  if (!item) return;
  document.querySelectorAll(".chat-item").forEach(i => i.classList.remove("active"));
  item.classList.add("active");
  setActiveChat(item.dataset.chat);
});

async function loadChatHistory(chatName) {
  try {
    const res = await fetch(`${SERVER_URL}/api/messages/${encodeURIComponent(chatName)}`);
    if (!res.ok) {
      messagesEl.innerHTML = "";
      return;
    }
    const msgs = await res.json();
    messagesEl.innerHTML = "";

    for (const m of msgs) {
      await renderMessage(m);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch {
    messagesEl.innerHTML = "";
  }
}

function showTypingIndicator() {
  if (isTyping) return;
  isTyping = true;
  socket.emit("typing", { chat: currentChat, username });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isTyping = false;
    socket.emit("stop_typing", { chat: currentChat });
  }, 3000);
}

msgInput.addEventListener("input", showTypingIndicator);

async function sendMessage() {
  const text = msgInput.value.trim();
  
  const msgErr = validateMessage(text);
  if (msgErr) {
    authError.textContent = msgErr;
    setTimeout(() => { authError.textContent = ""; }, 3000);
    return;
  }
  
  if (!username) return;

  if (currentChat === "tickets" && username !== "Admin01") {
    authError.textContent = "Access denied";
    setTimeout(() => { authError.textContent = ""; }, 3000);
    return;
  }

  let payloadText = text;

  // Encrypt for non-system chats
  if (currentChat !== "settings" && currentChat !== "tickets" && userPassword) {
    const encryptPass = getEncryptionPassword(currentChat);
    payloadText = await encryptText(text, encryptPass);
  }

  socket.emit("send_message", {
    username,
    text: payloadText,
    chat: currentChat
  });

  msgInput.value = "";
  isTyping = false;
}

msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);

async function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = "message";
  if (msg.id) div.dataset.id = msg.id;

  const time = msg.time ? new Date(msg.time) : null;
  const timeStr = time
    ? time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "";

  let textToShow = msg.text;

  // Decrypt for non-system chats
  if (msg.chat !== "settings" && msg.chat !== "tickets" && userPassword) {
    const decryptPass = getEncryptionPassword(msg.chat);
    const decrypted = await decryptText(msg.text, decryptPass);
    if (decrypted === null) {
      textToShow = "[unable to decrypt]";
    } else {
      textToShow = decrypted;
    }
  }

  const isOwnMessage = msg.username === username;

  div.innerHTML = `
    <div class="message-wrapper ${isOwnMessage ? 'own' : 'other'}">
      <div class="message-meta">${msg.username}${timeStr ? " • " + timeStr : ""}</div>
      <div class="message-text">${escapeHtml(textToShow)}</div>
    </div>
  `;

  div.addEventListener("click", () => {
    document.querySelectorAll(".message").forEach(m => m.classList.remove("selected"));
    div.classList.add("selected");
    selectedMessageId = msg.id || null;
  });

  messagesEl.appendChild(div);
}

socket.on("new_message", async msg => {
  if (msg.chat !== currentChat) return;
  await renderMessage(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  
  // Check if message contains "kaki"
  if (msg.text && msg.text.toLowerCase().includes("kaki")) {
    triggerKakiEasterEgg();
  }
});

socket.on("message_deleted", data => {
  if (data.chat !== currentChat) return;
  const el = document.querySelector(`.message[data-id="${data.id}"]`);
  if (el) el.remove();
});

socket.on("chat_created", data => {
  if (!data || !data.chat) return;
  if (data.chat === "tickets" && username !== "Admin01") return;
  addChatToMenu(data.chat, data.user2 ? `💬 ${data.user2}` : data.chat);
  if (data.isDM) setActiveChat(data.chat);
});

socket.on("user_typing", data => {
  if (data.chat !== currentChat || data.username === username) return;
  const indicator = document.querySelector(".typing-indicator") || document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.textContent = `${data.username} is typing...`;
  if (!indicator.parentNode) messagesEl.appendChild(indicator);
});

socket.on("user_stopped_typing", data => {
  if (data.chat !== currentChat) return;
  const indicator = document.querySelector(".typing-indicator");
  if (indicator) indicator.remove();
});

document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key === "Delete") {
    if (!selectedMessageId || !username) return;
    socket.emit("delete_message", {
      id: selectedMessageId,
      chat: currentChat,
      username
    });
  }
});

// Call button handler
document.getElementById("callBtn").addEventListener("click", () => {
  const parts = currentChat.split("-");
  const recipient = parts[0] === username ? parts[1] : parts[0];
  if (inCall) {
    endCall();
  } else {
    initiateCall(recipient);
  }
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Voice call functions
const ICE_SERVERS = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ]
};

async function initiateCall(recipientUsername) {
  if (inCall) {
    authError.textContent = "Already in a call";
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    });

    callPartner = recipientUsername;
    inCall = true;
    callStartTime = Date.now();

    document.getElementById("callBtn").classList.add("in-call");

    peerConnection = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
      remoteStream = event.streams[0];
      playRemoteAudio(remoteStream);
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit("call_signal", {
          to: recipientUsername,
          signal: event.candidate
        });
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("call_initiate", {
      from: username,
      to: recipientUsername,
      offer: offer
    });

    authError.textContent = `Calling ${recipientUsername}...`;
  } catch (err) {
    authError.textContent = "Microphone access denied";
    inCall = false;
  }
}

async function acceptCall(caller, offer) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    });

    callPartner = caller;
    inCall = true;
    callStartTime = Date.now();

    document.getElementById("callBtn").classList.add("in-call");

    peerConnection = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
      remoteStream = event.streams[0];
      playRemoteAudio(remoteStream);
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit("call_signal", {
          to: caller,
          signal: event.candidate
        });
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("call_accept", {
      caller: caller,
      answer: answer
    });

    authError.textContent = `In call with ${caller}`;
  } catch (err) {
    authError.textContent = "Call failed";
    rejectCall(caller);
  }
}

function rejectCall(caller) {
  socket.emit("call_reject", { caller });
  inCall = false;
}

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  remoteStream = null;
  inCall = false;
  callPartner = null;
  callStartTime = null;

  document.getElementById("callBtn").classList.remove("in-call");

  socket.emit("call_end", { to: callPartner });
  authError.textContent = "Call ended";
}

function playRemoteAudio(stream) {
  const audioElement = document.createElement("audio");
  audioElement.srcObject = stream;
  audioElement.autoplay = true;
  audioElement.style.display = "none";
  document.body.appendChild(audioElement);
}

// Call event listeners
socket.on("call_incoming", data => {
  if (data.to !== username) return;

  const accepted = confirm(`${data.from} is calling you. Accept?`);
  if (accepted) {
    acceptCall(data.from, data.offer);
  } else {
    rejectCall(data.from);
  }
});

socket.on("call_signal_received", data => {
  if (peerConnection && data.signal && typeof data.signal === 'object') {
    try {
      peerConnection.addIceCandidate(new RTCIceCandidate(data.signal));
    } catch (err) {
      // Ignore if candidate is invalid
    }
  }
});

socket.on("call_accepted", data => {
  if (peerConnection && data.answer) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(err => {
      authError.textContent = "Error accepting call";
    });
  }
});

socket.on("call_rejected", data => {
  endCall();
  authError.textContent = `${callPartner} declined the call`;
});

socket.on("call_ended", data => {
  if (inCall) {
    endCall();
    authError.textContent = `${callPartner} ended the call`;
  }
});

socket.on("easter_egg", () => {
  const overlay = document.getElementById("easterEggOverlay");
  const video = document.getElementById("easterEggVideo");
  
  // 40% chance for secret2.mp4, 60% for secret.mp4
  const videoFile = Math.random() < 0.4 ? "/assets/secret2.mp4" : "/assets/secret.mp4";
  
  video.src = videoFile;
  overlay.classList.add("active");
  
  // Close on click
  overlay.addEventListener("click", () => {
    video.pause();
    overlay.classList.remove("active");
  }, { once: true });
  
  // Close on escape key
  const closeOnEscape = (e) => {
    if (e.key === "Escape") {
      video.pause();
      overlay.classList.remove("active");
      document.removeEventListener("keydown", closeOnEscape);
    }
  };
  document.addEventListener("keydown", closeOnEscape);
});

window.initiateCall = initiateCall;
window.endCall = endCall;