// ====== Socket.io Connection ======
const socket = io("https://browser-based-remote-control-backend.onrender.com", {
  transports: ["websocket"],
});

// ====== UI elements ======
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

// ====== Replace remote <video> with <canvas> for drawing frames ======
let remoteCanvas = document.createElement("canvas");
remoteCanvas.id = "remoteCanvas";
remoteCanvas.style.cssText =
  "width:100%;height:100%;display:block;background:black;border-radius:6px;";
remoteVideo.parentNode.replaceChild(remoteCanvas, remoteVideo);
const ctx = remoteCanvas.getContext("2d");

// ====== State variables ======
let roomId, currentUser;
let canFullscreen = false;
let viewing = false;

// ====== Helper functions ======
function hideInputs() {
  ["name", "room"].forEach((id) => {
    const el = document.getElementById(id);
    el.style.display = "none";
    document.querySelector(`label[for='${id}']`).style.display = "none";
  });
  joinBtn.style.display = "none";
  shareBtn.disabled = false;
  stopBtn.disabled = true;
}

function showInputs() {
  ["name", "room"].forEach((id) => {
    const el = document.getElementById(id);
    el.style.display = "";
    document.querySelector(`label[for='${id}']`).style.display = "";
  });
  joinBtn.style.display = "";
  shareBtn.disabled = true;
  stopBtn.disabled = true;
  statusEl.textContent = "";
}

function updateUserList(users) {
  userListEl.innerHTML = users
    .map(
      (u) => `
      <div class="user-item">
        <div>
          <div class="user-name">${u.name}</div>
          <div class="user-room">Room: ${u.roomId}</div>
        </div>
        <div class="status-dot ${u.isOnline ? "status-online" : "status-offline"}"></div>
      </div>
    `
    )
    .join("");
}

function clearCanvas() {
  ctx.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  viewing = false;
}

// ====== JOIN ROOM ======
joinBtn.onclick = () => {
  const name = nameInput.value.trim();
  roomId = roomInput.value.trim();
  if (!name || !roomId) return alert("Enter name and room");

  currentUser = name;
  socket.emit("set-name", { name });
  socket.emit("join-room", { roomId, name, isAgent: false });

  hideInputs();
  statusEl.textContent = `✅ ${name} joined room: ${roomId}`;
};

// ====== REQUEST SCREEN ======
shareBtn.onclick = () => {
  if (!roomId) return alert("Join a room first");
  socket.emit("request-screen", { roomId, from: socket.id });
  statusEl.textContent = "⏳ Requesting remote screen...";
  canFullscreen = true;
};

// ====== STOP SHARE ======
stopBtn.onclick = () => {
  socket.emit("stop-share", { roomId, name: currentUser });
  clearCanvas();
  statusEl.textContent = "🛑 Sharing stopped";
  stopBtn.disabled = true;
  shareBtn.disabled = false;
};

// ====== LEAVE ROOM ======
document.getElementById("leaveBtn").onclick = () => {
  if (!roomId) return;
  socket.emit("leave-room", { roomId, name: currentUser });
  clearCanvas();
  showInputs();
  userListEl.innerHTML = "";
  roomId = null;
  currentUser = null;
  statusEl.textContent = "🚪 Left the room";
};

// ====== PERMISSION REQUEST ======
socket.on("screen-request", ({ from, name }) => {
  permBox.style.display = "block";
  document.getElementById("permText").textContent = `${name} wants to view your screen`;

  acceptBtn.onclick = () => {
    permBox.style.display = "none";
    if (confirm("Full remote control requires agent.exe. Download now?")) {
      const encodedRoom = encodeURIComponent(roomId || "room1");
      window.open(
        `https://browser-based-remote-control-backend.onrender.com/download-agent?room=${encodedRoom}`,
        "_blank"
      );
    }
    socket.emit("permission-response", { to: from, accepted: true });
    statusEl.textContent = "✅ Accepted — waiting for agent to stream";
    stopBtn.disabled = false;
    shareBtn.disabled = true;
  };

  rejectBtn.onclick = () => {
    permBox.style.display = "none";
    socket.emit("permission-response", { to: from, accepted: false });
    statusEl.textContent = "❌ Request rejected";
  };
});

// ====== PERMISSION RESULT ======
socket.on("permission-result", (accepted) => {
  if (!accepted) {
    statusEl.textContent = "❌ Request denied";
    return;
  }
  statusEl.textContent = "✅ Target accepted (waiting for agent stream)";
  alert("Target accepted. Click ⛶ for fullscreen once stream starts.");
});

// ====== STOP SHARE ======
socket.on("stop-share", ({ name }) => {
  clearCanvas();
  statusEl.textContent = `🛑 ${name} stopped sharing`;
  stopBtn.disabled = true;
  shareBtn.disabled = false;
});

// ====== RECEIVE FRAMES (Aspect Ratio Fix) ======
socket.on("screen-frame", ({ agentId, image }) => {
  if (!image) return;
  const img = new Image();
  img.onload = () => {
    // Maintain proper aspect ratio
    const aspect = img.width / img.height;
    const cw = remoteCanvas.clientWidth || 1280;
    const ch = cw / aspect;
    remoteCanvas.width = cw;
    remoteCanvas.height = ch;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    // Auto fullscreen once
    if (canFullscreen && !viewing) {
      const wrapper = document.querySelector(".remote-wrapper");
      try {
        wrapper?.requestFullscreen?.();
      } catch (err) {
        console.warn("Fullscreen error", err);
      }
      viewing = true;
      canFullscreen = false;
      statusEl.textContent = "📺 Viewing fullscreen";
    }
  };
  img.src = `data:image/png;base64,${image}`;
});

// ====== REMOTE CONTROL EVENTS ======
function enableRemoteControl() {
  const emitCtrl = (type, data) => socket.emit("control", { type, ...data, roomId });

  remoteCanvas.addEventListener("mousemove", (e) => {
    const rect = remoteCanvas.getBoundingClientRect();
    emitCtrl("mousemove", {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  });

  ["click", "dblclick", "mousedown", "mouseup"].forEach((evt) => {
    remoteCanvas.addEventListener(evt, (e) => {
      const rect = remoteCanvas.getBoundingClientRect();
      emitCtrl(evt, {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        button: e.button,
      });
    });
  });

  remoteCanvas.addEventListener("wheel", (e) => emitCtrl("wheel", { deltaY: e.deltaY }));

  document.addEventListener("keydown", (e) => emitCtrl("keydown", { key: e.key }));
  document.addEventListener("keyup", (e) => emitCtrl("keyup", { key: e.key }));
}
enableRemoteControl();

// ====== FULLSCREEN BUTTON ======
fullscreenBtn.onclick = () => {
  document.querySelector(".remote-wrapper")?.requestFullscreen?.();
};

// ====== PEER LIST UPDATES ======
socket.on("peer-list", (users) => updateUserList(users));
socket.on("peer-joined", () => socket.emit("get-peers"));
socket.on("peer-left", () => socket.emit("get-peers"));
