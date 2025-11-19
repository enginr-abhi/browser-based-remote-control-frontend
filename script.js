const socket = io("https://browser-based-remote-control-backend.onrender.com");

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
    // 1. Enter Immersive View (CSS fix)
    document.body.classList.add('view-active');
    
    // 2. Hide fullscreen button initially if stream hasn't started, or keep it visible as the "Exit" button
    fullscreenBtn.style.display = 'block';
    
    // 3. Disable controls that shouldn't be accessible while viewing
    joinBtn.disabled = true;
    shareBtn.disabled = true;
    leaveBtn.disabled = true; // Preventing leaving during active session
    stopBtn.disabled = false;
    
    statusSpan.textContent = "Remote Viewing Active";
    console.log("Immersive viewing started.");
}

function stopViewing() {
    // 1. Exit Immersive View (CSS fix)
    document.body.classList.remove('view-active');
    
    // 2. Cleanup stream resources
    remoteScreen.src = "";
    if (lastUrl) {
        URL.revokeObjectURL(lastUrl);
        lastUrl = null;
    }

    // 3. Re-enable main controls
    joinBtn.disabled = true;
    shareBtn.disabled = false; // Allow requesting a new screen
    leaveBtn.disabled = false;
    stopBtn.disabled = true;

    statusSpan.textContent = "Joined";
    currentTarget = null; // Clear the target ID
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
// SHARE BUTTON (If used to start request flow, though usually user list buttons are used)
// =======================
shareBtn.onclick = () => {
    alert("Please select a user from the Online Users list to request access.");
};

// =======================
// STOP BUTTON (Viewer side to exit remote view)
// =======================
stopBtn.onclick = () => {
    // In a full implementation, you'd send a signal to the Agent to stop streaming.
    // socket.emit("stop-streaming", { target: currentTarget }); 
    stopViewing();
};

// =======================
// FULLSCREEN BUTTON (Used here as an alternative "Exit View" button)
// =======================
fullscreenBtn.onclick = () => {
    // If we are viewing, treat this button as the exit mechanism
    if (document.body.classList.contains('view-active')) {
        stopViewing();
    } else {
        // Handle native fullscreen if needed, but the CSS immersive view is better
        alert("Screen is already optimized for full window. Click 'Stop' or the fullscreen button again to exit the remote view.");
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
            div.querySelector(".btnConnect").onclick = (e) => {
                currentTarget = e.target.dataset.id;
                socket.emit("request-access", { target: currentTarget });
                // We shouldn't use alert() here. Using console log instead.
                console.log("Request sent to:", currentTarget);
                statusSpan.textContent = `Request sent to ${u.name}...`;
            };
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
    // OLD: alert("User accepted. Waiting for agent to start...");
    // 🎯 FIX 1: Start immersive view instantly (The agent will fill it later)
    startViewing();
});

// =======================
// AGENT DOWNLOAD POPUP
// =======================
function startAgentDownload() {
    const room = roomInput.value;
    const link = document.createElement("a");

    link.href = `/download-agent?room=${room}`;
    link.download = "RemoteAgent.exe";
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    // We shouldn't use alert() here. Using console log instead.
    console.log("Agent downloading… Run it to start remote control.");
}

// =======================
// RAW FRAME RECEIVER
// =======================
socket.on("agent-frame", data => {
    // data is ArrayBuffer → convert to blob image
    const blob = new Blob([data], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);

    // Set IMG tag source
    remoteScreen.src = url;

    // Revoke previous URL to prevent memory leak
    if (lastUrl) {
        URL.revokeObjectURL(lastUrl);
    }
    lastUrl = url;
});

// =======================
// REMOTE CONTROL EVENTS
// =======================

// 🛑 FIX 2 (CRITICAL FOR STABILITY): Disable Mouse Move event to prevent "Mouse Loop"
// Ab sirf clicks hi position ko update karenge.
// remoteScreen.onmousemove = (e) => sendMouse("move", e); // <--- THIS LINE IS REMOVED/NULLIFIED
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

// Bind focus events to IMG tag (remoteScreen)
remoteScreen.onmouseenter = () => remoteInFocus = true;
remoteScreen.onmouseleave = () => remoteInFocus = false;

function sendMouse(action, e) {
    const rect = remoteScreen.getBoundingClientRect();

    // Calculate normalized coordinates (0 to 1)
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

//
// =======================
// POINTER LOCK SECTION
// =======================

// 1. Click to lock pointer
remoteScreen.addEventListener("click", () => {
    if (!pointerLocked) remoteScreen.requestPointerLock();
});


// 2. Pointer lock status update
document.addEventListener("pointerlockchange", () => {
    pointerLocked = (document.pointerLockElement === remoteScreen);
});

// 3. Relative movement when locked
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

// =======================
// LEAVE ROOM
// =======================
leaveBtn.onclick = () => {
    // Stop view before reloading, if active
    if (document.body.classList.contains('view-active')) {
        stopViewing();
    }
    location.reload();
};