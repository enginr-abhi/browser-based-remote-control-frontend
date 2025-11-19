// script.js (fixed)
const BACKEND_ORIGIN = "https://browser-based-remote-control-backend.onrender.com";
const socket = io(BACKEND_ORIGIN, { transports: ["websocket", "polling"] });

const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");

const userListDiv = document.getElementById("userList");

const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const leaveBtn = document.getElementById("leaveBtn");

const permBox = document.getElementById("perm");
const permTextDiv = document.getElementById("permText");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");

const fullscreenBtn = document.getElementById("fullscreenBtn"); // New button for exiting view
const statusSpan = document.getElementById("status"); // Status element

// 🛑 Remote screen element
const remoteScreen = document.getElementById("remoteScreen"); 

let myId = null;
let currentTarget = null; // ID of the user whose screen we are viewing/requesting
let lastUrl = null; // Variable to track the last created blob URL
let remoteInFocus = false; // Track focus on remote screen
// pointer-lock state
let pointerLocked = false;

// =======================
// VIEW MANAGEMENT (IMMERSIVE FIX)
// =======================

function startViewing() {
    document.body.classList.add('view-active');
    fullscreenBtn.style.display = 'block';
    joinBtn.disabled = true;
    shareBtn.disabled = true;
    // leave should still be allowed while viewing if you want; keep current behavior
    leaveBtn.disabled = true;
    stopBtn.disabled = false;
    statusSpan.textContent = "Remote Viewing Active";
    console.log("Immersive viewing started.");
}

function stopViewing() {
    document.body.classList.remove('view-active');

    // cleanup stream resources
    remoteScreen.src = "";
    if (lastUrl) {
        URL.revokeObjectURL(lastUrl);
        lastUrl = null;
    }

    // Re-enable main controls (IMPORTANT: allow joining again)
    joinBtn.disabled = false;        // <-- FIX: was true before, preventing re-join
    shareBtn.disabled = false;
    leaveBtn.disabled = false;
    stopBtn.disabled = true;

    statusSpan.textContent = "Joined";
    currentTarget = null;
    console.log("Viewing stopped and UI reset.");
}

// =======================
// JOIN ROOM
// =======================
joinBtn.onclick = () => {
    if (!nameInput.value || !roomInput.value) return alert("Enter name & room");

    socket.emit("join", {
        name: nameInput.value,
        room: roomInput.value
    });

    joinBtn.disabled = true;
    shareBtn.disabled = false;
    leaveBtn.disabled = false;
    statusSpan.textContent = "Joined";

    console.log("Joined room:", roomInput.value);
};

// =======================
// SHARE BUTTON
// =======================
shareBtn.onclick = () => {
    alert("Please select a user from the Online Users list to request access.");
};

// =======================
// STOP BUTTON (Viewer side to exit remote view)
// =======================
stopBtn.onclick = () => {
    stopViewing();
};

// =======================
// FULLSCREEN BUTTON
// =======================
fullscreenBtn.onclick = () => {
    if (document.body.classList.contains('view-active')) {
        stopViewing();
    } else {
        alert("Screen is already optimized for full window. Click 'Stop' to exit remote view.");
    }
};

// =======================
// USER LIST UPDATE
// =======================
socket.on("user-list", users => {
    userListDiv.innerHTML = "";
    myId = socket.id;

    users.forEach(u => {
        let isMe = u.id === socket.id;

        let div = document.createElement("div");
        div.className = "user-item";

        let nameHTML = isMe ? `<span class="user-name">${u.name} (Me)</span>` : `<span class="user-name">${u.name}</span>`;

        let actionHTML = isMe 
            ? '<span class="status-dot status-online"></span>' 
            : `<button class="btnConnect" data-id="${u.id}">Request</button>`;

        div.innerHTML = `
            ${nameHTML}
            ${actionHTML}
        `;

        if (!isMe) {
            const btn = div.querySelector(".btnConnect");
            if (btn) {
                btn.onclick = (e) => {
                    currentTarget = e.target.dataset.id;
                    socket.emit("request-access", { target: currentTarget });
                    console.log("Request sent to:", currentTarget);
                    statusSpan.textContent = `Request sent to ${u.name}...`;
                };
            }
        }

        userListDiv.appendChild(div);
    });
});

// =======================
// INCOMING REQUEST
// =======================
socket.on("incoming-request", ({ from, name }) => {
    permTextDiv.innerHTML = `<strong>${name}</strong> wants to view your screen`;
    permBox.style.display = "block";
    permBox.classList.add("show");
    currentTarget = from;

    acceptBtn.onclick = () => {
        permBox.style.display = "none";
        socket.emit("accept-request", { from });
        startAgentDownload();
        statusSpan.textContent = "Agent accepted and starting...";
    };

    rejectBtn.onclick = () => {
        permBox.style.display = "none";
        currentTarget = null;
        statusSpan.textContent = "Request rejected.";
    };
});

// =======================
// USER1 gets "accepted"
// =======================
socket.on("request-accepted", () => {
    startViewing();
});

// =======================
// AGENT DOWNLOAD POPUP
// =======================
function startAgentDownload() {
    const room = roomInput.value;
    // Use BACKEND_ORIGIN so download goes to your backend (Render), not the frontend host
    const link = document.createElement("a");
    link.href = `${BACKEND_ORIGIN}/download-agent?room=${encodeURIComponent(room)}`;
    link.download = "RemoteAgent.exe";
    document.body.appendChild(link);
    link.click();
    link.remove();
    console.log("Agent downloading… Run it to start remote control.");
}

// =======================
// RAW FRAME RECEIVER
// =======================
socket.on("agent-frame", data => {
    const blob = new Blob([data], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);

    remoteScreen.src = url;

    if (lastUrl) {
        URL.revokeObjectURL(lastUrl);
    }
    lastUrl = url;
});

// =======================
// REMOTE CONTROL EVENTS
// =======================
remoteScreen.onmousedown = (e) => sendMouse("down", e);
remoteScreen.onmouseup = (e) => sendMouse("up", e);

remoteScreen.onwheel = (e) => {
    socket.emit("control", { type: "scroll", delta: e.deltaY });
};

document.onkeydown = (e) => {
    if (!remoteInFocus) return;
    socket.emit("control", { type: "key", key: e.key, state: "down" });
};

document.onkeyup = (e) => {
    if (!remoteInFocus) return;
    socket.emit("control", { type: "key", key: e.key, state: "up" });
};

remoteScreen.onmouseenter = () => remoteInFocus = true;
remoteScreen.onmouseleave = () => remoteInFocus = false;

function sendMouse(action, e) {
    const rect = remoteScreen.getBoundingClientRect();

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    socket.emit("control", {
        type: "mouse",
        action,
        x,
        y,
        button: e.button
    });
}

// POINTER LOCK SECTION
remoteScreen.addEventListener("click", () => {
    if (!pointerLocked) {
        // pointer lock requires user gesture; this is OK
        remoteScreen.requestPointerLock?.();
    }
});

document.addEventListener("pointerlockchange", () => {
    pointerLocked = (document.pointerLockElement === remoteScreen);
});

document.addEventListener("mousemove", (e) => {
    if (pointerLocked) {
        socket.emit("control", {
            type: "mouse",
            action: "move",
            dx: e.movementX,
            dy: e.movementY
        });
    }
});

// LEAVE ROOM
leaveBtn.onclick = () => {
    if (document.body.classList.contains('view-active')) {
        stopViewing();
    }
    location.reload();
};
