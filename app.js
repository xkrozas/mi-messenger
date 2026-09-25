// --- CONFIGURACIÓN & ESTADO ---
const APP_PREFIX = "fastchat-v2-";
let peer = null;
let currentRoomId = null;
let myUsername = "Anónimo";
let myColor = "#6366f1";
let isHost = false;
let connections = []; // Solo para el Host: lista de clientes
let hostConnection = null; // Solo para invitados: conexión hacia el Host
let typingTimeout = null;

// --- ELEMENTOS DEL DOM ---
const lobbyScreen = document.getElementById("lobbyScreen");
const chatScreen = document.getElementById("chatScreen");
const usernameInput = document.getElementById("usernameInput");
const newRoomId = document.getElementById("newRoomId");
const joinRoomId = document.getElementById("joinRoomId");
const lobbyStatus = document.getElementById("lobbyStatus");
const displayRoomName = document.getElementById("displayRoomName");
const participantCount = document.getElementById("participantCount");
const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const typingIndicator = document.getElementById("typingIndicator");
const imageInput = document.getElementById("imageInput");

// --- SONIDOS NATIVOS (Web Audio API) ---
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(580, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (e) {}
}

// --- UTILIDADES ---
function escapeHTML(str) {
  const p = document.createElement("p");
  p.textContent = str;
  return p.innerHTML;
}

function getFormattedTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

// Selección de color de avatar
document.querySelectorAll(".color-opt").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".color-opt").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    myColor = opt.getAttribute("data-color");
  });
});

// Selector de pestañas Crear / Unirse
const tabCreate = document.getElementById("tabCreate");
const tabJoin = document.getElementById("tabJoin");
const createSection = document.getElementById("createSection");
const joinSection = document.getElementById("joinSection");

tabCreate.onclick = () => {
  tabCreate.classList.add("active");
  tabJoin.classList.remove("active");
  createSection.classList.add("active");
  joinSection.classList.remove("active");
};

tabJoin.onclick = () => {
  tabJoin.classList.add("active");
  tabCreate.classList.remove("active");
  joinSection.classList.add("active");
  createSection.classList.remove("active");
};

// Generador de código aleatorio
document.getElementById("btnRandomRoom").onclick = () => {
  newRoomId.value = Math.random().toString(36).substring(2, 8);
};

// Detectar si se abrió con ?room=codigo en la URL
window.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");
  if (roomParam) {
    tabJoin.click();
    joinRoomId.value = roomParam;
    lobbyStatus.textContent = `Invitación detectada para la sala: ${roomParam}`;
  }
});

// --- INICIAR SALA (HOST) ---
document.getElementById("btnCreateRoom").onclick = () => {
  const user = usernameInput.value.trim() || "Anfitrión";
  const room = (newRoomId.value.trim() || Math.random().toString(36).substring(2, 8)).toLowerCase();
  
  startHost(user, room);
};

function startHost(user, room) {
  myUsername = user;
  currentRoomId = room;
  isHost = true;
  lobbyStatus.textContent = "Conectando al servidor...";

  // El Host toma un ID fijo derivado del nombre de la sala
  const peerId = APP_PREFIX + room;
  peer = new Peer(peerId);

  peer.on("open", () => {
    enterChatRoom();
  });

  peer.on("connection", (conn) => {
    connections.push(conn);
    updateParticipants();

    conn.on("data", (data) => {
      handleIncomingData(data, conn);
    });

    conn.on("close", () => {
      connections = connections.filter(c => c !== conn);
      updateParticipants();
      broadcast({ type: "system", text: `${conn.peerName || "Alguien"} salió de la sala.` });
    });
  });

  peer.on("error", (err) => {
    if (err.type === "unavailable-id") {
      lobbyStatus.textContent = "La sala ya existe. Usa otro nombre o únete a ella.";
    } else {
      lobbyStatus.textContent = "Error: " + err.type;
    }
  });
}

// --- UNIRSE A SALA (INVITADO) ---
document.getElementById("btnJoinRoom").onclick = () => {
  const user = usernameInput.value.trim() || "Invitado";
  const room = joinRoomId.value.trim().toLowerCase();

  if (!room) {
    alert("Introduce un código de sala válido.");
    return;
  }

  startGuest(user, room);
};

function startGuest(user, room) {
  myUsername = user;
  currentRoomId = room;
  isHost = false;
  lobbyStatus.textContent = "Buscando anfitrión de la sala...";

  // El invitado obtiene un ID aleatorio y se conecta al ID del host
  peer = new Peer();

  peer.on("open", () => {
    const hostPeerId = APP_PREFIX + room;
    hostConnection = peer.connect(hostPeerId, {
      metadata: { username: myUsername, color: myColor }
    });

    hostConnection.on("open", () => {
      enterChatRoom();
      // Notificar al anfitrión
      hostConnection.send({
        type: "join",
        user: myUsername,
        color: myColor
      });
    });

    hostConnection.on("data", (data) => {
      handleIncomingData(data);
    });

    hostConnection.on("close", () => {
      appendSystemMessage("Se perdió la conexión con la sala (anfitrión desconectado).");
    });
  });

  peer.on("error", (err) => {
    lobbyStatus.textContent = "No se pudo conectar a la sala. Comprueba el código.";
  });
}

// --- PASAR A LA PANTALLA DE CHAT ---
function enterChatRoom() {
  lobbyScreen.classList.remove("active");
  chatScreen.classList.add("active");
  displayRoomName.textContent = "Sala: " + currentRoomId;
  updateParticipants();
}

function updateParticipants() {
  const count = isHost ? connections.length + 1 : 2; // Estimado para clientes
  participantCount.textContent = `${count} conectado(s)`;
}

// --- GESTIÓN DE MENSAJES RECIBIDOS ---
function handleIncomingData(data, senderConn = null) {
  if (isHost && senderConn && data.type !== "typing") {
    // Si somos host, retransmitimos a los demás clientes
    if (data.type === "join") senderConn.peerName = data.user;
    broadcast(data, senderConn);
  }

  switch (data.type) {
    case "join":
      appendSystemMessage(`${data.user} se unió a la sala.`);
      playNotificationSound();
      break;
    case "message":
      appendMessage(data.user, data.color, data.text, data.time, false);
      playNotificationSound();
      break;
    case "image":
      appendImage(data.user, data.color, data.dataUrl, data.time, false);
      playNotificationSound();
      break;
    case "typing":
      showTyping(data.user);
      break;
    case "system":
      appendSystemMessage(data.text);
      break;
  }
}

// Retransmisión solo del Host hacia todos los invitados
function broadcast(data, exceptConn = null) {
  connections.forEach(conn => {
    if (conn !== exceptConn && conn.open) {
      conn.send(data);
    }
  });
}

// --- ENVÍO DE MENSAJES Y ARCHIVOS ---
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  const payload = {
    type: "message",
    user: myUsername,
    color: myColor,
    text: text,
    time: getFormattedTime()
  };

  appendMessage(myUsername, myColor, text, payload.time, true);

  if (isHost) {
    broadcast(payload);
  } else if (hostConnection && hostConnection.open) {
    hostConnection.send(payload);
  }

  messageInput.value = "";
}

document.getElementById("btnSend").onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
  else sendTypingSignal();
});

// Enviar señal de "escribiendo..."
function sendTypingSignal() {
  const payload = { type: "typing", user: myUsername };
  if (isHost) broadcast(payload);
  else if (hostConnection && hostConnection.open) hostConnection.send(payload);
}

function showTyping(user) {
  typingIndicator.textContent = `${user} está escribiendo...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingIndicator.textContent = "";
  }, 2000);
}

// Enviar imágenes (máximo ~2MB recomendado para WebRTC fluido)
imageInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2.5 * 1024 * 1024) {
    alert("Por favor elige una imagen de menos de 2.5 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const payload = {
      type: "image",
      user: myUsername,
      color: myColor,
      dataUrl: reader.result,
      time: getFormattedTime()
    };

    appendImage(myUsername, myColor, reader.result, payload.time, true);

    if (isHost) broadcast(payload);
    else if (hostConnection && hostConnection.open) hostConnection.send(payload);
  };
  reader.readAsDataURL(file);
};

// --- RENDERIZADO EN EL DOM ---
function appendMessage(user, color, text, time, isMe) {
  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${isMe ? 'msg-me' : 'msg-other'}`;

  bubble.innerHTML = `
    ${!isMe ? `<div class="msg-author" style="color: ${color}">${escapeHTML(user)}</div>` : ''}
    <div>${escapeHTML(text)}</div>
    <span class="msg-time">${time}</span>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendImage(user, color, dataUrl, time, isMe) {
  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${isMe ? 'msg-me' : 'msg-other'}`;

  bubble.innerHTML = `
    ${!isMe ? `<div class="msg-author" style="color: ${color}">${escapeHTML(user)}</div>` : ''}
    <img src="${dataUrl}" class="msg-image" alt="Imagen enviada">
    <span class="msg-time">${time}</span>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  const bubble = document.createElement("div");
  bubble.className = "system-bubble";
  bubble.textContent = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- BOTONES SUPERIORES: COMPARTIR Y SALIR ---
document.getElementById("btnShare").onclick = () => {
  const inviteLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(inviteLink).then(() => {
    alert("¡Enlace copiado al portapapeles!\nEnvíalo a tus amigos para que entren directo.");
  });
};

document.getElementById("btnLeave").onclick = () => {
  if (confirm("¿Seguro que deseas salir del chat?")) {
    location.reload();
  }
};