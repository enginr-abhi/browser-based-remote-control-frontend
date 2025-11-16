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
let isControlling = false; // <-- only true when server grants control
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
  if (!roomId) return alert("Join a room first");
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

// -----------------------------
// permission box (OWNER side)
// -----------------------------
socket.on("screen-request", ({ from, name }) => {
  if (!permBox) return;
  permBox.style.display = "block";
  document.getElementById("permText").textContent = `${name} wants to view your screen`;

  // Prevent stacking handlers
  acceptBtn.onclick = null;
  rejectBtn.onclick = null;

  // Accept: owner chooses whether to accept AND optionally download agent
  acceptBtn.onclick = () => {
    permBox.style.display = "none";

    // Show owner the download prompt if they need the agent
    // (This confirm is owner-only because server sends screen-request only to owner)
    if (confirm("For full remote control please download & run the Agent app.\nDo you want to download it now?")) {
      const encodedRoom = encodeURIComponent(roomId || roomInput.value || "room1");
      window.open(
        `https://browser-based-remote-control-backend.onrender.com/download-agent?room=${encodedRoom}`,
        "_blank"
      );
    }

    // Send permission response back to server (to the requesting viewer)
    socket.emit("permission-response", { to: from, accepted: true });
  };

  // Reject
  rejectBtn.onclick = () => {
    permBox.style.display = "none";
    socket.emit("permission-response", { to: from, accepted: false });
  };
});

// -----------------------------
// permission result (VIEWER side)
// -----------------------------
socket.on("permission-result", accepted => {
  // Viewer receives this to know if owner accepted
  if (!accepted) {
    statusEl.textContent = "❌ Request denied";
    return;
  }

  // Owner accepted — viewer should wait for stream / possible agent
  statusEl.textContent = "✅ Request accepted — waiting for stream";
  stopBtn.disabled = false;
  shareBtn.disabled = true;

  // Note: DO NOT show download popup here (that was the bug earlier)
  // Viewer will receive 'no-agent' or later a 'frame' or 'control-token'
});

// If server tells viewer there's no agent available
socket.on("no-agent", payload => {
  console.warn("no-agent:", payload);
  statusEl.textContent = payload && payload.message ? payload.message : "No agent available";
});

// Server offers owner a download link (owner-only) - also handled if received
socket.on("offer-download-agent", ({ roomId: offeredRoom, url }) => {
  console.log("offer-download-agent", { offeredRoom, url });
  // offer may reach owner - show confirm and open url if owner accepts
  if (confirm("Agent not installed. Download & run the Agent app now?")) {
    const link = url || (`/download-agent?room=${encodeURIComponent(offeredRoom || roomId || roomInput.value || "room1")}`);
    window.open(link, "_blank");
  }
});

// Server may notify that agent is available in the room
socket.on("agent-available", ({ roomId: r, url }) => {
  console.log("agent-available", { roomId: r, url });
  if (r === (roomId || roomInput.value)) {
    statusEl.textContent = "🟢 Agent available in this room";
  }
});

// server gives a token so viewer can resume control after reconnect
socket.on("control-token", token => {
  try {
    controlToken = token;
    localStorage.setItem("controlToken", token);
    console.log("Received control token:", token);
    // Receiving a control token usually means viewer was granted control
    isControlling = true;
    statusEl.textContent = "🔑 Control granted";
  } catch (e) { console.warn("Failed to store token", e); }
});

// server instructs viewer/agent revoke control
socket.on("revoke-control", () => {
  isControlling = false;
  statusEl.textContent = "⛔ Control revoked";
});

// server tells agent to grant control (agent-only) - we keep a listener for debug
socket.on("grant-control", ({ viewerId }) => {
  console.log("grant-control received (agent):", viewerId);
  // agent-side should act on this; viewer side doesn't need to do anything here
});

// frame (binary) from server/agent
socket.on("frame", async (buffer) => {
  // Safety: only draw frames if viewer is either waiting for stream or already viewing.
  try {
    let blob;
    if (buffer instanceof Blob) blob = buffer;
    else if (buffer instanceof ArrayBuffer) blob = new Blob([buffer], { type: 'image/jpeg' });
    else if (buffer && buffer.data) { // socket.io-node Buffer wrapped / Uint8Array-like
      blob = new Blob([buffer], { type: 'image/jpeg' });
    } else blob = new Blob([buffer], { type: 'image/jpeg' });

    const imgBitmap = await createImageBitmap(blob);
    canvasWidth = imgBitmap.width;
    canvasHeight = imgBitmap.height;

    // fit canvas visually to wrapper, keep internal resolution equal to image size
    const wrapper = document.querySelector(".remote-wrapper");
    if (wrapper) {
      remoteCanvas.style.width = "100%";
      remoteCanvas.style.height = "100%";
    }
    if (remoteCanvas.width !== canvasWidth || remoteCanvas.height !== canvasHeight) {
      remoteCanvas.width = canvasWidth;
      remoteCanvas.height = canvasHeight;
    }

    // draw to canvas
    ctx.drawImage(imgBitmap, 0, 0, canvasWidth, canvasHeight);

    // auto fullscreen once (best-effort)
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
  // Only send control events if this viewer has been granted control by the server
  if (!isControlling) return;
  if (canvasWidth && canvasHeight) {
    data.captureWidth = canvasWidth;
    data.captureHeight = canvasHeight;
  }
  socket.emit("control", data);
}

// normalize mouse coords from canvas client rect to relative (0..1)
function canvasClientToRatio(e) {
  const rect = remoteCanvas.getBoundingClientRect();
  const clientX = e.clientX - rect.left;
  const clientY = e.clientY - rect.top;
  const relX = clientX / rect.width; // 0..1 on displayed size
  const relY = clientY / rect.height;
  return { x: relX, y: relY };
}

// mouse events (only emit when isControlling true inside emitControl)
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
    isControlling = true;
  } else {
    console.warn("Resume failed:", res && res.reason);
  }
});

// optional: show simple status from server
socket.on("connect", () => console.log("socket connected:", socket.id));
socket.on("disconnect", () => {
  console.log("socket disconnected");
  isControlling = false;
});
