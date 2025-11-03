// script.js (UPDATED — agent-based streaming, no browser sandbox)
const socket = io("https://browser-based-remote-control-backend.onrender.com", { transports: ["websocket"] });

const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const permBox = document.getElementById("perm");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");
const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const userListEl = document.getElementById("userList");

// create Leave button if missing
let leaveBtn = document.getElementById("leaveBtn");
if (!leaveBtn) {
  leaveBtn = document.createElement("button");
  leaveBtn.id = "leaveBtn";
  leaveBtn.textContent = "Leave";
  leaveBtn.disabled = true;
  document.querySelector(".row").appendChild(leaveBtn);
}

// Replace <video id="remote"> with a canvas to draw base64 frames
let remoteCanvas = document.createElement("canvas");
remoteCanvas.id = "remoteCanvas";
remoteCanvas.style.width = "100%";
remoteCanvas.style.height = "100%";
remoteCanvas.style.display = "block";
remoteCanvas.style.background = "black";
remoteVideo.parentNode.replaceChild(remoteCanvas, remoteVideo);
const ctx = remoteCanvas.getContext("2d");

let pc, localStream;
let roomId;
let canFullscreen = false;
let currentUser = null;
let viewing = false; // user gesture done
let agentPresent = false;

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
    <div class="user-item">
      <div>
        <div class="user-name">${u.name}</div>
        <div class="user-room">Room: ${u.roomId}</div>
      </div>
      <div class="status-dot ${u.isOnline ? "status-online" : "status-offline"}"></div>
    </div>
  `).join("");
}

// JOIN
joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  roomId = roomInput.value.trim();
  if (!name || !roomId) return alert("Enter name and room");

  currentUser = name;
  socket.emit("set-name", { name });
  socket.emit("join-room", { roomId, name, isAgent: false });
  hideInputs();
  statusEl.textContent = `✅ ${name} joined ${roomId}`;
};

// REQUEST (controller)
shareBtn.onclick = () => {
  if (!roomId) return alert("Join a room first");
  socket.emit("request-screen", { roomId, from: socket.id });
  statusEl.textContent = "⏳ Requesting screen...";
  // this click is a user gesture we can use later to request fullscreen
  canFullscreen = true;
};

// STOP
stopBtn.onclick = () => {
  const name = currentUser || nameInput.value.trim();
  socket.emit("stop-share", { roomId, name });
  clearCanvas();
  statusEl.textContent = "🛑 Stopped";
  stopBtn.disabled = true;
  shareBtn.disabled = false;
};

// LEAVE
leaveBtn.onclick = () => {
  if (!roomId) return;
  const name = currentUser || nameInput.value.trim();
  socket.emit("leave-room", { roomId, name });

  // reset
  clearCanvas();
  try { if (pc) { pc.close(); pc = null; } } catch (e) {}
  showInputs();
  userListEl.innerHTML = "";
  roomId = null;
  currentUser = null;
  statusEl.textContent = "🚪 Left the room";
};

function clearCanvas() {
  ctx.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  viewing = false;
}

// === Incoming request on target UI ===
socket.on("screen-request", ({ from, name }) => {
  permBox.style.display = "block";
  document.getElementById("permText").textContent = `${name} wants to view your screen`;

  // Accept handler: do NOT call getDisplayMedia() — instruct to download/run agent and tell server accepted
  acceptBtn.onclick = () => {
    permBox.style.display = "none";

    // prompt to download/run agent
    if (confirm("Full remote control requires the agent. Download agent now?")) {
      const encodedRoom = encodeURIComponent(roomId || roomInput.value || "room1");
      window.open(`https://browser-based-remote-control-backend.onrender.com/download-agent?room=${encodedRoom}`, "_blank");
    }

    // Tell server target accepted. Server will instruct agents in the room to start streaming.
    socket.emit("permission-response", { to: from, accepted: true });
    statusEl.textContent = "Accepted — start agent on this machine to stream";
    stopBtn.disabled = false;
    shareBtn.disabled = true;
  };

  rejectBtn.onclick = () => {
    permBox.style.display = "none";
    socket.emit("permission-response", { to: from, accepted: false });
    statusEl.textContent = "You rejected the request";
  };
});

// Permission result to requester (controller)
socket.on("permission-result", (accepted) => {
  if (!accepted) {
    statusEl.textContent = "❌ Request denied";
    return;
  }
  statusEl.textContent = "✅ Request accepted by target (agent will stream when run)";
  // advise user to click fullscreen button (user gesture) to allow auto fullscreen when frames arrive
  alert('Target accepted. Click the ⛶ fullscreen button now (one click) to allow full-screen display when stream starts.');
});

// Stop share
socket.on("stop-share", ({ name }) => {
  clearCanvas();
  statusEl.textContent = `🛑 ${name} stopped sharing`;
  stopBtn.disabled = true;
  shareBtn.disabled = false;
});

// Receive base64 frames from server (agent -> server -> controllers)
socket.on("screen-frame", ({ agentId, image }) => {
  if (!image) return;
  const img = new Image();
  img.onload = () => {
    // resize canvas to image natural size (preserve quality)
    remoteCanvas.width = img.width;
    remoteCanvas.height = img.height;
    ctx.drawImage(img, 0, 0, remoteCanvas.width, remoteCanvas.height);

    // on first frame after user gesture, enter fullscreen automatically (allowed because user clicked earlier)
    if (canFullscreen && !viewing) {
      const remoteWrapper = document.querySelector(".remote-wrapper");
      try {
        if (remoteWrapper.requestFullscreen) remoteWrapper.requestFullscreen();
        else if (remoteWrapper.webkitRequestFullscreen) remoteWrapper.webkitRequestFullscreen();
      } catch (e) {
        console.warn("Fullscreen request failed", e);
      }
      viewing = true;
      canFullscreen = false;
      statusEl.textContent = "Viewing (fullscreen)";
    }
  };
  img.src = 'data:image/png;base64,' + image;
});

// Control events: use canvas to compute normalized coordinates
function enableRemoteControl() {
  // mouse move + click events on canvas
  remoteCanvas.addEventListener("mousemove", e => {
    const rect = remoteCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    socket.emit("control", { type: "mousemove", x, y });
  });

  ["click", "dblclick", "mousedown", "mouseup"].forEach(evt => {
    remoteCanvas.addEventListener(evt, e => {
      const rect = remoteCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      socket.emit("control", { type: evt, x, y, button: e.button });
    });
  });

  remoteCanvas.addEventListener("wheel", e => {
    socket.emit("control", { type: "wheel", deltaY: e.deltaY });
  });

  document.addEventListener("keydown", e => socket.emit("control", { type: "keydown", key: e.key }));
  document.addEventListener("keyup", e => socket.emit("control", { type: "keyup", key: e.key }));
}
enableRemoteControl(); // enable by default

// Fullscreen button (manual)
fullscreenBtn.onclick = () => {
  const remoteWrapper = document.querySelector(".remote-wrapper");
  if (remoteWrapper.requestFullscreen) remoteWrapper.requestFullscreen();
};

// Online users
socket.on("peer-list", users => updateUserList(users));
socket.on("peer-joined", () => socket.emit("get-peers"));
socket.on("peer-left", () => socket.emit("get-peers"));
