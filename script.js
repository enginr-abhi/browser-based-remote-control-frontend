// script.js — Final cleaned & safe version

// ----- Backend selection (local dev vs prod) -----
const BACKEND_URL = (window.location.hostname.includes("localhost") || window.location.hostname === "127.0.0.1")
  ? "http://localhost:9000"
  : "https://browser-based-remote-control-backend.onrender.com";

// ----- Socket.io connection -----
const socket = io(BACKEND_URL, { transports: ["websocket"], withCredentials: true });

// ----- UI elements -----
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusEl = document.getElementById("status");
const permBox = document.getElementById("perm");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");
const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const remoteWrapper = document.getElementById("remoteWrapper") || document.querySelector(".remote-wrapper");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const userListEl = document.getElementById("userList");

// ----- Canvas & context (use existing canvas element) -----
const remoteCanvas = document.getElementById("screenCanvas");
const ctx = remoteCanvas && remoteCanvas.getContext ? remoteCanvas.getContext("2d") : null;
if (!ctx) console.warn("Canvas context not available — rendering disabled.");

// ----- State -----
let roomId = null;
let currentUser = null;
let viewing = false;
let remoteControlEnabled = false; // only true once first frame arrives
let agentSocketId = null;

// ----- Helpers -----
function hideInputs() {
  ["name", "room"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
    const lbl = document.querySelector(`label[for='${id}']`);
    if (lbl) lbl.style.display = "none";
  });
  if (joinBtn) joinBtn.style.display = "none";
  if (shareBtn) shareBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (leaveBtn) leaveBtn.disabled = false;
}

function showInputs() {
  ["name", "room"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "";
    const lbl = document.querySelector(`label[for='${id}']`);
    if (lbl) lbl.style.display = "";
  });
  if (joinBtn) joinBtn.style.display = "";
  if (shareBtn) shareBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  if (leaveBtn) leaveBtn.disabled = true;
  statusEl.textContent = "";
}

function updateUserList(users = []) {
  userListEl.innerHTML = users.map(u => `
    <div class="user-item">
      <div>
        <div class="user-name">${u.name}</div>
        <div class="user-room">${u.isAgent ? "Agent" : ""}</div>
      </div>
      <div class="status-dot ${u.isOnline ? "status-online" : "status-offline"}"></div>
    </div>
  `).join("");
}

function clearCanvas() {
  if (!ctx || !remoteCanvas) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,remoteCanvas.width, remoteCanvas.height);
  viewing = false;
  remoteControlEnabled = false;
  agentSocketId = null;
  remoteWrapper?.classList?.remove("active");
  stopBtn.disabled = true;
  shareBtn.disabled = false;
}

// set canvas backing size for crisp drawing
function setCanvasSizeFromDOM(clientW, clientH) {
  if (!ctx || !remoteCanvas) return;
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(clientW * ratio));
  const h = Math.max(1, Math.floor(clientH * ratio));
  if (remoteCanvas.width !== w || remoteCanvas.height !== h) {
    remoteCanvas.width = w;
    remoteCanvas.height = h;
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
}

// ----- Join room -----
joinBtn.addEventListener("click", () => {
  const name = (nameInput.value || "").trim();
  const room = (roomInput.value || "").trim();
  if (!name || !room) return alert("Enter name and room");
  currentUser = name;
  roomId = room;
  socket.emit("set-name", { name });
  socket.emit("join-room", { roomId, name, isAgent: false });
  hideInputs();
  statusEl.textContent = `✅ ${name} joined room: ${roomId}`;
  socket.emit("get-peers");
});

// ----- Request access -----
shareBtn.addEventListener("click", () => {
  if (!roomId) return alert("Join a room first");
  statusEl.textContent = "⏳ Requesting remote screen...";
  socket.emit("request-screen", { roomId, from: socket.id });
});

// ----- Stop & Leave -----
stopBtn.addEventListener("click", () => {
  if (!roomId) return;
  socket.emit("stop-share", { roomId, name: currentUser });
  clearCanvas();
  statusEl.textContent = "🛑 Sharing stopped";
});

leaveBtn.addEventListener("click", () => {
  if (!roomId) return;
  socket.emit("leave-room", { roomId, name: currentUser });
  clearCanvas();
  showInputs();
  userListEl.innerHTML = "";
  roomId = null;
  currentUser = null;
  statusEl.textContent = "🚪 Left the room";
});

// ----- Permission request handler (target receives) -----
socket.on("screen-request", ({ from, name }) => {
  if (!permBox) return;
  permBox.hidden = false;
  permBox.classList.add("show");
  document.getElementById("permText").textContent = `${name} wants to view your screen`;

  // attach once-only handlers
  acceptBtn.addEventListener("click", function onAccept() {
    permBox.classList.remove("show");
    permBox.hidden = true;
    // optionally open download link
    if (confirm("Full remote control requires agent.exe. Download now?")) {
      const encodedRoom = encodeURIComponent(roomId || "room1");
      window.open(`${BACKEND_URL}/download-agent?room=${encodedRoom}`, "_blank");
    }
    socket.emit("permission-response", { to: from, accepted: true, roomId });
    statusEl.textContent = "✅ Accepted — waiting for agent to stream";
    stopBtn.disabled = false;
    shareBtn.disabled = true;
  }, { once: true });

  rejectBtn.addEventListener("click", function onReject() {
    permBox.classList.remove("show");
    permBox.hidden = true;
    socket.emit("permission-response", { to: from, accepted: false, roomId });
    statusEl.textContent = "❌ Request rejected";
  }, { once: true });
});

// ----- Permission result (requester) -----
socket.on("permission-result", ({ accepted, agentId }) => {
  if (!accepted) {
    statusEl.textContent = "❌ Request denied";
    return;
  }
  statusEl.textContent = "✅ Target accepted — waiting for agent stream";
  agentSocketId = agentId || null;
  alert("Target accepted. When screen appears, click ⛶ to fullscreen.");
});

// ----- Stop share (server) -----
socket.on("stop-share", ({ name }) => {
  clearCanvas();
  statusEl.textContent = `🛑 ${name} stopped sharing`;
});

// ----- Receive frames (agent -> server -> viewers) -----
socket.on("screen-frame", ({ agentId, image, width, height }) => {
  if (!image || !ctx || !remoteWrapper) return;

  // update agent id
  agentSocketId = agentId || agentSocketId;

  // compute CSS client size
  const clientW = remoteWrapper.clientWidth || 1280;
  let clientH = remoteWrapper.clientHeight || 720;
  if (width && height) clientH = Math.floor(clientW * (height / width));

  // show canvas (CSS) and set backing size
  remoteWrapper.classList.add("active");
  setCanvasSizeFromDOM(clientW, clientH);

  // draw frame
  const img = new Image();
  img.onload = () => {
    try {
      ctx.clearRect(0, 0, clientW, clientH);
      ctx.drawImage(img, 0, 0, clientW, clientH);
    } catch (err) {
      console.warn("Draw error:", err);
    }
    if (!viewing) {
      viewing = true;
      remoteControlEnabled = true;
      statusEl.textContent = "📺 Viewing (click ⛶ to fullscreen)";
      stopBtn.disabled = false;
      shareBtn.disabled = true;
    }
  };
  img.onerror = () => console.warn("Failed to decode frame");
  img.src = `data:image/jpeg;base64,${image}`;
});

// ----- Remote control (mouse/keys) -----
function enableRemoteControl() {
  if (!remoteCanvas) return;

  const emitCtrl = (type, data) => {
    if (!roomId || !agentSocketId) return;
    socket.emit("control", { type, ...data, roomId, toAgent: agentSocketId });
  };

  const normCoords = (e) => {
    const rect = remoteCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  remoteCanvas.addEventListener("mousemove", (e) => {
    if (!remoteControlEnabled) return;
    const { x, y } = normCoords(e);
    emitCtrl("mousemove", { x, y });
  });

  ["click", "mousedown", "mouseup", "dblclick"].forEach(evt => {
    remoteCanvas.addEventListener(evt, (e) => {
      if (!remoteControlEnabled) return;
      const rect = remoteCanvas.getBoundingClientRect();
      emitCtrl(evt, {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        button: e.button
      });
    });
  });

  remoteCanvas.addEventListener("wheel", (e) => {
    if (!remoteControlEnabled) return;
    e.preventDefault();
    emitCtrl("wheel", { deltaY: e.deltaY });
  }, { passive: false });

  // send keyboard events only when viewing is active
  window.addEventListener("keydown", (e) => {
    if (!remoteControlEnabled) return;
    emitCtrl("keydown", { key: e.key, code: e.code });
  });
  window.addEventListener("keyup", (e) => {
    if (!remoteControlEnabled) return;
    emitCtrl("keyup", { key: e.key, code: e.code });
  });
}
enableRemoteControl();

// ----- Fullscreen -----
fullscreenBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (document.fullscreenElement) document.exitFullscreen();
  else remoteWrapper?.requestFullscreen?.().catch(err => {
    console.warn("Fullscreen blocked:", err);
    alert("Fullscreen blocked by browser. Try again.");
  });
});

// ----- Peer list updates -----
socket.on("peer-list", users => updateUserList(users));
socket.on("peer-joined", () => socket.emit("get-peers"));
socket.on("peer-left", () => socket.emit("get-peers"));

// ----- Connection status -----
socket.on("connect", () => {
  statusEl.textContent = "🟢 Connected to signaling server";
  if (currentUser) socket.emit("set-name", { name: currentUser });
});
socket.on("disconnect", reason => {
  statusEl.textContent = `🔴 Disconnected (${reason})`;
  clearCanvas();
  userListEl.innerHTML = "";
});
socket.on("connect_error", err => {
  statusEl.textContent = `⚠️ Connection error: ${err?.message || err}`;
});

// ----- Resize handling -----
window.addEventListener("resize", () => {
  if (!remoteWrapper) return;
  setCanvasSizeFromDOM(remoteWrapper.clientWidth, remoteWrapper.clientHeight);
});
