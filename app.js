// --- CONFIGURACIÓN & ESTADO GENERAL ---
const APP_PREFIX = "fastchat-v2-";
let peer = null;
let currentRoomId = null;
let myUsername = "Anónimo";
let myColor = "#6366f1";
let isHost = false;
let connections = [];
let hostConnection = null;
let typingTimeout = null;

// --- ESTADO DE LLAMADAS P2P ---
let localStream = null;
let activeCall = null;
let incomingCallObj = null;
let ringtoneInterval = null;

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

// Elementos de llamada
const incomingCallModal = document.getElementById("incomingCallModal");
const activeCallModal = document.getElementById("activeCallModal");
const callerNameText = document.getElementById("callerNameText");
const callTypeText = document.getElementById("callTypeText");
const callStateLabel = document.getElementById("callStateLabel");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const btnToggleMic = document.getElementById("btnToggleMic");
const btnToggleCam = document.getElementById("btnToggleCam");

// --- GENERADOR DE TONO DE LLAMADA (Web Audio API) ---
function startRingtone() {
  stopRingtone();
  ringtoneInterval = setInterval(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch(e) {}
  }, 1800);
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}

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

function escapeHTML(str) {
  const p = document.createElement("p");
  p.textContent = str;
  return p.innerHTML;
}

function getFormattedTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

// Configuración visual del Lobby
document.querySelectorAll(".color-opt").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".color-opt").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    myColor = opt.getAttribute("data-color");
  });
});

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

document.getElementById("btnRandomRoom").onclick = () => {
  newRoomId.value = Math.random().toString(36).substring(2, 8);
};

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

  peer = new Peer(APP_PREFIX + room);

  peer.on("open", () => enterChatRoom());

  peer.on("connection", (conn) => {
    connections.push(conn);
    updateParticipants();

    conn.on("data", (data) => handleIncomingData(data, conn));

    conn.on("close", () => {
      connections = connections.filter(c => c !== conn);
      updateParticipants();
      broadcast({ type: "system", text: `${conn.peerName || "Alguien"} salió de la sala.` });
    });
  });

  setupPeerCalling();

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
  if (!room) return alert("Introduce un código de sala válido.");
  startGuest(user, room);
};

function startGuest(user, room) {
  myUsername = user;
  currentRoomId = room;
  isHost = false;
  lobbyStatus.textContent = "Buscando anfitrión de la sala...";

  peer = new Peer();

  peer.on("open", () => {
    const hostPeerId = APP_PREFIX + room;
    hostConnection = peer.connect(hostPeerId, {
      metadata: { username: myUsername, color: myColor }
    });

    hostConnection.on("open", () => {
      enterChatRoom();
      hostConnection.send({ type: "join", user: myUsername, color: myColor });
    });

    hostConnection.on("data", (data) => handleIncomingData(data));

    hostConnection.on("close", () => {
      appendSystemMessage("Se perdió la conexión con el anfitrión.");
    });
  });

  setupPeerCalling();

  peer.on("error", () => {
    lobbyStatus.textContent = "No se pudo conectar a la sala. Comprueba el código.";
  });
}

function enterChatRoom() {
  lobbyScreen.classList.remove("active");
  chatScreen.classList.add("active");
  displayRoomName.textContent = "Sala: " + currentRoomId;
  updateParticipants();
}

function updateParticipants() {
  const count = isHost ? connections.length + 1 : 2;
  participantCount.textContent = `${count} participante(s)`;
}

// --- MENSAJERÍA ---
function handleIncomingData(data, senderConn = null) {
  if (isHost && senderConn && data.type !== "typing") {
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

function broadcast(data, exceptConn = null) {
  connections.forEach(conn => {
    if (conn !== exceptConn && conn.open) conn.send(data);
  });
}

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

  if (isHost) broadcast(payload);
  else if (hostConnection && hostConnection.open) hostConnection.send(payload);

  messageInput.value = "";
}

document.getElementById("btnSend").onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
  else sendTypingSignal();
});

function sendTypingSignal() {
  const payload = { type: "typing", user: myUsername };
  if (isHost) broadcast(payload);
  else if (hostConnection && hostConnection.open) hostConnection.send(payload);
}

function showTyping(user) {
  typingIndicator.textContent = `${user} está escribiendo...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { typingIndicator.textContent = ""; }, 2000);
}

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

// ==========================================
// LÓGICA DE AUDIO & VIDEOLLAMADA
// ==========================================

function setupPeerCalling() {
  peer.on("call", (call) => {
    incomingCallObj = call;
    startRingtone();

    const isVideo = call.metadata?.video !== false;
    callerNameText.textContent = `${call.metadata?.callerName || "Un amigo"} te está llamando...`;
    callTypeText.textContent = isVideo ? "📹 Videollamada entrante" : "📞 Llamada de voz entrante";

    incomingCallModal.classList.add("active");
  });
}

// Iniciar llamada saliente
document.getElementById("btnVoiceCall").onclick = () => initiateCall(false);
document.getElementById("btnVideoCall").onclick = () => initiateCall(true);

async function initiateCall(withVideo) {
  const targetId = isHost ? connections[0]?.peer : (APP_PREFIX + currentRoomId);

  if (!targetId || (isHost && connections.length === 0)) {
    alert("Espera a que un amigo se conecte a la sala para poder llamarle.");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { width: 1280, height: 720 } : false
    });

    localVideo.srcObject = localStream;
    localVideo.style.display = withVideo ? "block" : "none";

    callStateLabel.textContent = "Llamando a tu amigo...";
    activeCallModal.classList.add("active");

    activeCall = peer.call(targetId, localStream, {
      metadata: { callerName: myUsername, video: withVideo }
    });

    setupCallEvents(activeCall);

  } catch (err) {
    alert("No se pudo acceder a la cámara/micrófono: " + err.message);
  }
}

// Aceptar llamada entrante
document.getElementById("btnAcceptCall").onclick = async () => {
  stopRingtone();
  incomingCallModal.classList.remove("active");

  const wantsVideo = incomingCallObj.metadata?.video !== false;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantsVideo ? { width: 1280, height: 720 } : false
    });

    localVideo.srcObject = localStream;
    localVideo.style.display = wantsVideo ? "block" : "none";

    incomingCallObj.answer(localStream);
    activeCall = incomingCallObj;

    callStateLabel.textContent = "Conectado";
    activeCallModal.classList.add("active");

    setupCallEvents(activeCall);

  } catch (err) {
    alert("Error al acceder a la cámara o micro: " + err.message);
    incomingCallObj.close();
  }
};

// Rechazar llamada entrante
document.getElementById("btnRejectCall").onclick = () => {
  stopRingtone();
  incomingCallModal.classList.remove("active");
  if (incomingCallObj) incomingCallObj.close();
};

// Escuchar stream remoto de la llamada
function setupCallEvents(call) {
  call.on("stream", (remoteStream) => {
    callStateLabel.textContent = "Llamada en curso";
    remoteVideo.srcObject = remoteStream;
  });

  call.on("close", () => endCall());
  call.on("error", () => endCall());
}

// Controles de llamada: Micro y Cámara
btnToggleMic.onclick = () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    btnToggleMic.classList.toggle("off", !audioTrack.enabled);
  }
};

btnToggleCam.onclick = () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    btnToggleCam.classList.toggle("off", !videoTrack.enabled);
    localVideo.style.opacity = videoTrack.enabled ? "1" : "0.2";
  }
};

// Colgar llamada
document.getElementById("btnEndCall").onclick = () => {
  if (activeCall) activeCall.close();
  endCall();
};

function endCall() {
  stopRingtone();
  incomingCallModal.classList.remove("active");
  activeCallModal.classList.remove("active");

  // Apagar la cámara y el micrófono por completo (Hardware off)
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  activeCall = null;
  incomingCallObj = null;

  btnToggleMic.classList.remove("off");
  btnToggleCam.classList.remove("off");
}

// Compartir y Salir
document.getElementById("btnShare").onclick = () => {
  const inviteLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(inviteLink).then(() => {
    alert("¡Enlace copiado!\nTus amigos entrarán directamente a tu sala al abrirlo.");
  });
};

document.getElementById("btnLeave").onclick = () => {
  if (confirm("¿Deseas salir del chat?")) location.reload();
};
