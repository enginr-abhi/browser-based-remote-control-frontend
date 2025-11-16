// script.js (canvas-based viewer)
const socket = io("https://browser-based-remote-control-backend.onrender.com", {
  transports: ["websocket"]
});

// UI elements
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const permBox = document.getElementById("perm");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");
const localEl = document.getElementById("local");
const remoteCanvas = document.getElementById("remoteCanvas");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const userListEl = document.getElementById("userList");

let leaveBtn = document.getElementById("leaveBtn");
if (!leaveBtn) {
  leaveBtn = document.createElement("button");
  leaveBtn.id = "leaveBtn";
  leaveBtn.textContent = "Leave";
  leaveBtn.disabled = true;
  document.querySelector(".row").appendChild(leaveBtn);
}

// state
let roomId = null;
let currentUser = null;
let canvasWidth = 0, canvasHeight = 0;
let autoFullscreenDone = false;
let isControlling = false;
let controlToken = localStorage.getItem("controlToken") || null;
const ctx = remoteCanvas.getContext("2d");

// UI helpers
function hideInputs() {
  nameInput.style.display = "none";
  roomInput.style.display = "none";
  document.querySelector('label[for="name"]').style.display = 'none';
  document.querySelector('label[for="room"]').style.display = 'none';
  joinBtn.style.display = 'none';
  shareBtn.disabled = false;
  leaveBtn.disabled = false;
}
function showInputs() {
  nameInput.style.display = "";
  roomInput.style.display = "";
  document.querySelector('label[for="name"]').style.display = '';
  document.querySelector('label[for="room"]').style.display = '';
  joinBtn.style.display = '';
  shareBtn.disabled = true;
  stopBtn.disabled = true;
  leaveBtn.disabled = true;
  statusEl.textContent = "";
}
function updateUserList(users) {
  if (!userListEl) return;
  userListEl.innerHTML = users.map(u => `
    <div class="user-item" data-id="${u.id}">
      <div>
        <div class="user-name">${u.name}</div>
        <div class="user-room">Room: ${u.roomId}</div>
        <div style="font-size:11px;color:#999;margin-top:4px">id: ${u.id}</div>
      </div>
      <div class="status-dot ${u.isOnline ? "status-online" : "status-offline"}"></div>
    </div>
  `).join("");
}

// join
joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  roomId = roomInput.value.trim();
  if (!name || !roomId) return alert("Enter name and room");
  currentUser = name;
  socket.emit("set-name", { name });
  socket.emit("join-room", { roomId, name, isAgent: false });
  hideInputs();
  statusEl.textContent = `✅ ${name} Joined ${roomId}`;
  // try resume with token if exists
  if (controlToken) {
    socket.emit("resume-with-token", { token: controlToken });
  }
};

// request screen (viewer asks owner/agent)
shareBtn.onclick = () => {
  socket.emit("request-screen", { roomId, from: socket.id });
  statusEl.textContent = "⏳ Requesting screen...";
};

// stop (viewer stops viewing)
stopBtn.onclick = () => {
  socket.emit("stop-share", { roomId, name: currentUser || nameInput.value.trim() });
  clearCanvas();
  statusEl.textContent = "🛑 Stopped";
  stopBtn.disabled = true;
  shareBtn.disabled = false;
  isControlling = false;
};

// leave
leaveBtn.onclick = () => {
  if (!roomId) return;
  const name = currentUser || nameInput.value.trim();
  socket.emit("leave-room", { roomId, name });
  showInputs();
  userListEl.innerHTML = "";
  roomId = null;
  currentUser = null;
  clearCanvas();
  statusEl.textContent = "🚪 Left the room";
};

// permission box (owner side) - viewer doesn't need this, but keep handlers
socket.on("screen-request", ({ from, name }) => {
  if (!permBox) return;
  permBox.style.display = "block";
  document.getElementById("permText").textContent = `${name} wants to view your screen`;
  acceptBtn.onclick = () => {
    permBox.style.display = "none";
    socket.emit("permission-response", { to: from, accepted: true });
  };
  rejectBtn.onclick = () => {
    permBox.style.display = "none";
    socket.emit("permission-response", { to: from, accepted: false });
  };
});

// permission result (viewer side)
socket.on("permission-result", accepted => {
  if (!accepted) {
    statusEl.textContent = "❌ Request denied";
    return;
  }
  statusEl.textContent = "✅ Request accepted — waiting for stream";
  stopBtn.disabled = false;
  shareBtn.disabled = true;
});

// server gives a token so viewer can resume control after reconnect
socket.on("control-token", token => {
  try {
    controlToken = token;
    localStorage.setItem("controlToken", token);
    console.log("Received control token:", token);
  } catch (e) { console.warn("Failed to store token", e); }
});

// frame (binary) from server/agent
socket.on("frame", async (buffer) => {
  // buffer may be ArrayBuffer, Blob, or Buffer depending on client/server
  try {
    let blob;
    if (buffer instanceof Blob) blob = buffer;
    else if (buffer instanceof ArrayBuffer) blob = new Blob([buffer], { type: 'image/jpeg' });
    else if (buffer && buffer.data) { // socket.io-node Buffer wrapped
      // browser socket.io-v4 might deliver Uint8Array-like
      blob = new Blob([buffer], { type: 'image/jpeg' });
    } else blob = new Blob([buffer], { type: 'image/jpeg' });

    const imgBitmap = await createImageBitmap(blob);
    canvasWidth = imgBitmap.width;
    canvasHeight = imgBitmap.height;

    // resize canvas to image natural size (keeps 1:1 mapping for control)
    // but visually we want it to fill wrapper — we'll scale drawing while retaining ratio mapping
    const wrapper = document.querySelector(".remote-wrapper");
    if (wrapper) {
      // fit canvas to wrapper but keep internal resolution equal to image size
      remoteCanvas.style.width = "100%";
      remoteCanvas.style.height = "100%";
    }
    // set internal canvas resolution to image size for pixel-perfect mapping
    if (remoteCanvas.width !== canvasWidth || remoteCanvas.height !== canvasHeight) {
      remoteCanvas.width = canvasWidth;
      remoteCanvas.height = canvasHeight;
    }

    // draw to canvas
    ctx.drawImage(imgBitmap, 0, 0, canvasWidth, canvasHeight);

    // auto fullscreen once (best-effort; may require user gesture in some browsers)
    if (!autoFullscreenDone) {
      autoFullscreenDone = true;
      const remoteWrapper = document.querySelector(".remote-wrapper");
      if (remoteWrapper && remoteWrapper.requestFullscreen) {
        remoteWrapper.requestFullscreen().catch(err => console.warn("Auto-fullscreen failed:", err));
      }
    }
  } catch (err) {
    console.error("Frame draw error:", err);
  }
});

function clearCanvas() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
}

// control emitter helper — include capture dims so agent maps correctly
function emitControl(data) {
  if (canvasWidth && canvasHeight) {
    data.captureWidth = canvasWidth;
    data.captureHeight = canvasHeight;
  }
  socket.emit("control", data);
}

// normalize mouse coords from canvas client rect to relative (0..1)
function canvasClientToRatio(e) {
  const rect = remoteCanvas.getBoundingClientRect();
  // compute coordinates relative to displayed canvas size then map to internal resolution
  const clientX = e.clientX - rect.left;
  const clientY = e.clientY - rect.top;
  const relX = clientX / rect.width; // 0..1 on displayed size
  const relY = clientY / rect.height;
  // we send relative ratios; agent will multiply by captureWidth/Height
  return { x: relX, y: relY };
}

// mouse events
remoteCanvas.addEventListener("mousemove", e => {
  const { x, y } = canvasClientToRatio(e);
  emitControl({ type: "mousemove", x, y });
});
["click", "dblclick", "mousedown", "mouseup"].forEach(evt => {
  remoteCanvas.addEventListener(evt, e => {
    emitControl({ type: evt, button: e.button });
  });
});
remoteCanvas.addEventListener("wheel", e => {
  emitControl({ type: "wheel", deltaY: e.deltaY });
});

// keyboard events (global)
document.addEventListener("keydown", e => {
  // avoid typing into input fields causing unintended control — only when controls are active
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
  emitControl({ type: "keydown", key: e.key });
});
document.addEventListener("keyup", e => {
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
  emitControl({ type: "keyup", key: e.key });
});

// fullscreen button
fullscreenBtn.onclick = () => {
  const remoteWrapper = document.querySelector(".remote-wrapper");
  if (remoteWrapper && remoteWrapper.requestFullscreen) remoteWrapper.requestFullscreen();
};

// peer list updates
socket.on("peer-list", users => updateUserList(users));
socket.on("peer-joined", () => socket.emit("get-peers"));
socket.on("peer-left", () => socket.emit("get-peers"));

// resume-with-token response
socket.on("resume-result", res => {
  if (res && res.ok) {
    statusEl.textContent = "🔁 Resumed control session";
    stopBtn.disabled = false;
    shareBtn.disabled = true;
  } else {
    console.warn("Resume failed:", res && res.reason);
  }
});

// optional: show simple status from server
socket.on("connect", () => console.log("socket connected:", socket.id));
socket.on("disconnect", () => console.log("socket disconnected"));
