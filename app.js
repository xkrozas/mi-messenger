// --- CONFIGURACIÓN & ESTADO GENERAL ---
const APP_PREFIX = "fastchat-v2-";
let peer = null;
let currentRoomId = null;
let myUsername = "Anónimo";
let myColor = "#6366f1";
let isHost = false;

// Host: mapa de conexiones de datos
let connections = [];
// Invitado: conexión de datos hacia el host
let hostConnection = null;

// Lista de todos los miembros en la sala (sincronizada en todos los clientes)
// Cada elemento: { peerId, username, color, inCall }
let roomMembers = [];

// --- ESTADO DE LLAMADAS GRUPALES (P2P MESH) ---
let localStream = null;
let screenStream = null;
let isScreenSharing = false;
let amIInCall = false;

// Mapa de llamadas activas con cada amigo: Map<remotePeerId, MediaConnection>
let activeCalls = new Map();
let ringtoneInterval = null;
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

// Elementos de llamada grupal
const activeCallBanner = document.getElementById("activeCallBanner");
const bannerCallCount = document.getElementById("bannerCallCount");
const btnJoinActiveCall = document.getElementById("btnJoinActiveCall");
const incomingCallModal = document.getElementById("incomingCallModal");
const activeCallModal = document.getElementById("activeCallModal");
const callerNameText = document.getElementById("callerNameText");
const callTypeText = document.getElementById("callTypeText");
const videoGrid = document.getElementById("videoGrid");
const btnToggleMic = document.getElementById("btnToggleMic");
const btnToggleCam = document.getElementById("btnToggleCam");
const btnToggleScreen = document.getElementById("btnToggleScreen");

// --- TONO Y NOTIFICACIONES ---
function startRingtone() {
  stopRingtone();
  ringtoneInterval = setInterval(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
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

// Configuración Lobby
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

  peer.on("open", (id) => {
    roomMembers = [{ peerId: id, username: myUsername, color: myColor, inCall: false }];
    enterChatRoom();
  });

  peer.on("connection", (conn) => {
    connections.push(conn);

    conn.on("data", (data) => handleIncomingData(data, conn));

    conn.on("close", () => {
      connections = connections.filter(c => c !== conn);
      const leavingMember = roomMembers.find(m => m.peerId === conn.peer);
      roomMembers = roomMembers.filter(m => m.peerId !== conn.peer);
      broadcastMembers();
      if (leavingMember) {
        broadcast({ type: "system", text: `${leavingMember.username} salió de la sala.` });
      }
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

  peer.on("open", (myId) => {
    const hostPeerId = APP_PREFIX + room;
    hostConnection = peer.connect(hostPeerId, {
      metadata: { username: myUsername, color: myColor }
    });

    hostConnection.on("open", () => {
      enterChatRoom();
      hostConnection.send({
        type: "join",
        user: myUsername,
        color: myColor,
        peerId: myId
      });
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
  updateMembersUI();
}

// El anfitrión sincroniza la lista de miembros con todos
function broadcastMembers() {
  if (!isHost) return;
  broadcast({ type: "member_list", members: roomMembers });
  updateMembersUI();
}

function updateMembersUI() {
  participantCount.textContent = `${roomMembers.length} participante(s)`;

  // Contar cuántos están en llamada
  const inCallCount = roomMembers.filter(m => m.inCall).length;
  bannerCallCount.textContent = inCallCount;

  if (inCallCount > 0 && !amIInCall) {
    activeCallBanner.classList.add("active");
  } else {
    activeCallBanner.classList.remove("active");
  }
}

// --- MENSAJERÍA ---
function handleIncomingData(data, senderConn = null) {
  if (isHost && senderConn && data.type !== "typing") {
    // Si un invitado se une, lo añadimos a la lista oficial
    if (data.type === "join") {
      senderConn.peerName = data.user;
      if (!roomMembers.some(m => m.peerId === data.peerId)) {
        roomMembers.push({
          peerId: data.peerId,
          username: data.user,
          color: data.color,
          inCall: false
        });
      }
      broadcastMembers();
    }
    // Reenviar a todos los demás invitados
    broadcast(data, senderConn);
  }

  switch (data.type) {
    case "join":
      appendSystemMessage(`${data.user} se unió a la sala.`);
      playNotificationSound();
      break;

    case "member_list":
      roomMembers = data.members;
      updateMembersUI();
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

    case "call_started":
      if (!amIInCall) {
        startRingtone();
        callerNameText.textContent = `${data.callerName} ha iniciado una llamada`;
        callTypeText.textContent = data.mode === "video" ? "📹 Videollamada grupal" : "📞 Llamada de voz grupal";
        incomingCallModal.classList.add("active");
      }
      break;

    case "call_status_update":
      // Actualizar estado de llamada de un usuario
      const target = roomMembers.find(m => m.peerId === data.peerId);
      if (target) target.inCall = data.inCall;
      updateMembersUI();
      break;

    case "system":
      appendSystemMessage(data.text);
      break;
  }
}

function broadcast(data, exceptConn = null) {
  if (isHost) {
    connections.forEach(conn => {
      if (conn !== exceptConn && conn.open) conn.send(data);
    });
  } else if (hostConnection && hostConnection.open) {
    hostConnection.send(data);
  }
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
  broadcast(payload);
  messageInput.value = "";
}

document.getElementById("btnSend").onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
  else sendTypingSignal();
});

function sendTypingSignal() {
  broadcast({ type: "typing", user: myUsername });
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
    broadcast(payload);
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

// ========================================================
// SISTEMA DE LLAMADAS GRUPALES P2P (MESH TOPOLOGY)
// ========================================================

function setupPeerCalling() {
  peer.on("call", (incomingCall) => {
    if (amIInCall && localStream) {
      // Si ya estamos en la llamada, contestamos automáticamente con nuestro stream
      incomingCall.answer(localStream);
      registerActiveCall(incomingCall);
    } else {
      // Guardamos la llamada si estamos fuera de la llamada
      startRingtone();
      callerNameText.textContent = `${incomingCall.metadata?.callerName || "Un amigo"} te está llamando...`;
      incomingCallModal.classList.add("active");

      document.getElementById("btnAcceptCall").onclick = async () => {
        stopRingtone();
        incomingCallModal.classList.remove("active");
        await joinGroupCall({ video: incomingCall.metadata?.video !== false });
        incomingCall.answer(localStream);
        registerActiveCall(incomingCall);
      };
    }
  });
}

// Botones para iniciar llamada
document.getElementById("btnVoiceCall").onclick = () => startCallSession({ video: false });
document.getElementById("btnVideoCall").onclick = () => startCallSession({ video: true });
document.getElementById("btnScreenCall").onclick = () => startCallSession({ video: true, screen: true });
btnJoinActiveCall.onclick = () => joinGroupCall({ video: true });

async function startCallSession({ video, screen = false }) {
  if (roomMembers.length < 2) {
    alert("Espera a que al menos un amigo entre a la sala para poder llamarle.");
    return;
  }

  // Notificar a todos que se inició la llamada
  broadcast({
    type: "call_started",
    callerName: myUsername,
    mode: screen ? "screen" : (video ? "video" : "voice")
  });

  await joinGroupCall({ video, screen });
}

// Unirse activamente a la llamada grupal
async function joinGroupCall({ video, screen = false }) {
  try {
    if (screen) {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);
      isScreenSharing = true;
      btnToggleScreen.classList.add("active-share");
      screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { width: 1280, height: 720 } : false
      });
    }

    amIInCall = true;
    activeCallModal.classList.add("active");
    activeCallBanner.classList.remove("active");

    // Limpiar grid y añadir mi propio vídeo
    videoGrid.innerHTML = "";
    addVideoTile(peer.id, localStream, `${myUsername} (Tú)`, true, screen);

    // Notificar a todos que me he unido a la llamada
    updateMyCallStatus(true);

    // Llamar en malla a todos los demás amigos que estén ya en la llamada
    roomMembers.forEach(member => {
      if (member.peerId !== peer.id && member.inCall) {
        callPeerInMesh(member.peerId, member.username);
      }
    });

  } catch (err) {
    console.error("Error al unirse a la llamada:", err);
    alert("No se pudo acceder a los dispositivos: " + err.message);
    leaveCall();
  }
}

// Conectar con un miembro específico en la malla
function callPeerInMesh(remotePeerId, remoteName) {
  if (activeCalls.has(remotePeerId)) return;

  const call = peer.call(remotePeerId, localStream, {
    metadata: { callerName: myUsername, video: true }
  });

  registerActiveCall(call, remoteName);
}

function registerActiveCall(call, fallbackName = "Amigo") {
  const remotePeerId = call.peer;
  activeCalls.set(remotePeerId, call);

  call.on("stream", (remoteStream) => {
    const member = roomMembers.find(m => m.peerId === remotePeerId);
    const name = member ? member.username : (call.metadata?.callerName || fallbackName);
    addVideoTile(remotePeerId, remoteStream, name, false, false);
  });

  call.on("close", () => {
    removeVideoTile(remotePeerId);
    activeCalls.delete(remotePeerId);
  });

  call.on("error", () => {
    removeVideoTile(remotePeerId);
    activeCalls.delete(remotePeerId);
  });
}

function updateMyCallStatus(inCall) {
  const me = roomMembers.find(m => m.peerId === peer.id);
  if (me) me.inCall = inCall;
  updateMembersUI();

  broadcast({
    type: "call_status_update",
    peerId: peer.id,
    inCall: inCall
  });

  if (isHost) broadcastMembers();
}

// Aceptar / Rechazar llamada desde el popup
document.getElementById("btnAcceptCall").onclick = () => {
  stopRingtone();
  incomingCallModal.classList.remove("active");
  joinGroupCall({ video: true });
};

document.getElementById("btnRejectCall").onclick = () => {
  stopRingtone();
  incomingCallModal.classList.remove("active");
};

// --- GESTIÓN DINÁMICA DE LA CUADRÍCULA DE VÍDEOS ---
function addVideoTile(peerId, stream, displayName, isLocal, isScreen) {
  let tile = document.getElementById(`tile-${peerId}`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = `tile-${peerId}`;

    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    if (isLocal) {
      videoEl.muted = true;
      if (!isScreen) videoEl.classList.add("local-mirror");
    }
    videoEl.srcObject = stream;

    const label = document.createElement("div");
    label.className = "tile-label";
    label.textContent = displayName;

    tile.appendChild(videoEl);
    tile.appendChild(label);
    videoGrid.appendChild(tile);
  } else {
    const videoEl = tile.querySelector("video");
    videoEl.srcObject = stream;
    if (isScreen) {
      videoEl.classList.add("screen-sharing");
      videoEl.classList.remove("local-mirror");
    } else if (isLocal) {
      videoEl.classList.remove("screen-sharing");
      videoEl.classList.add("local-mirror");
    }
  }
}

function removeVideoTile(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
}

// --- CONTROLES DE LA LLAMADA (COMPARTIR PANTALLA, MUTE, CÁMARA) ---
btnToggleScreen.onclick = async () => {
  if (!amIInCall) return;

  if (isScreenSharing) {
    await stopScreenShare();
  } else {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Reemplazar la pista de vídeo en todas las conexiones activas de la llamada
      activeCalls.forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(screenTrack);
      });

      isScreenSharing = true;
      btnToggleScreen.classList.add("active-share");

      // Actualizar mi vídeo en el mosaico
      addVideoTile(peer.id, screenStream, `${myUsername} (Tu pantalla)`, true, true);

      screenTrack.onended = () => stopScreenShare();
    } catch (e) {
      console.log("Compartir pantalla cancelado.");
    }
  }
};

async function stopScreenShare() {
  if (!isScreenSharing) return;

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  isScreenSharing = false;
  btnToggleScreen.classList.remove("active-share");

  try {
    if (!localStream || localStream.getVideoTracks().length === 0) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }

    const camTrack = localStream.getVideoTracks()[0];

    // Restaurar la cámara en todas las conexiones activas
    activeCalls.forEach(call => {
      const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender && camTrack) sender.replaceTrack(camTrack);
    });

    addVideoTile(peer.id, localStream, `${myUsername} (Tú)`, true, false);
  } catch (err) {
    console.error("No se pudo restaurar la cámara web:", err);
  }
}

btnToggleMic.onclick = () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    btnToggleMic.classList.toggle("off", !audioTrack.enabled);
  }
};

btnToggleCam.onclick = () => {
  if (!localStream || isScreenSharing) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    btnToggleCam.classList.toggle("off", !videoTrack.enabled);
  }
};

// Colgar / Salir de la llamada
document.getElementById("btnEndCall").onclick = leaveCall;

function leaveCall() {
  stopRingtone();
  incomingCallModal.classList.remove("active");
  activeCallModal.classList.remove("active");

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  isScreenSharing = false;
  btnToggleScreen.classList.remove("active-share");

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Cerrar todas las llamadas de la malla
  activeCalls.forEach(call => call.close());
  activeCalls.clear();

  videoGrid.innerHTML = "";
  amIInCall = false;

  updateMyCallStatus(false);
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
