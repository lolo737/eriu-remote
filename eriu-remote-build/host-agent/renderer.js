// ---- CONFIGURE THIS to point at your signaling server ----
const SIGNALING_URL = 'wss://signal.eriu.tech';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // Add a TURN server here for reliability across strict NATs.
];

const pinEl = document.getElementById('pin');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const requestBox = document.getElementById('request');
const requestText = document.getElementById('requestText');
const acceptBtn = document.getElementById('accept');
const denyBtn = document.getElementById('deny');

let ws = null;
let pc = null;
let dataChannel = null;
let localStream = null;
let pendingViewerId = null;

function setStatus(text, live = false) {
  statusText.textContent = text;
  statusDot.classList.toggle('live', live);
}

function connectSignaling() {
  ws = new WebSocket(SIGNALING_URL);

  ws.onopen = () => {
    setStatus('Registering session…');
    ws.send(JSON.stringify({ type: 'host-register' }));
  };

  ws.onclose = () => setStatus('Disconnected from server');
  ws.onerror = () => setStatus('Server connection error');

  ws.onmessage = async (evt) => {
    const msg = JSON.parse(evt.data);

    switch (msg.type) {
      case 'registered':
        pinEl.textContent = msg.pin;
        setStatus('Waiting for a connection…');
        break;

      case 'viewer-request':
        pendingViewerId = msg.viewerId;
        requestText.textContent = 'Someone wants to view and control this screen.';
        requestBox.style.display = 'block';
        break;

      case 'viewer-approved':
        requestBox.style.display = 'none';
        setStatus('Setting up video…');
        await startSharing();
        break;

      case 'signal':
        await handleSignal(msg.data);
        break;

      case 'viewer-disconnected':
        setStatus('Viewer disconnected. Waiting…');
        cleanupCall();
        break;
    }
  };
}

acceptBtn.addEventListener('click', () => {
  if (!pendingViewerId) return;
  ws.send(JSON.stringify({ type: 'approve', viewerId: pendingViewerId }));
});

denyBtn.addEventListener('click', () => {
  if (!pendingViewerId) return;
  ws.send(JSON.stringify({ type: 'deny', viewerId: pendingViewerId }));
  requestBox.style.display = 'none';
  pendingViewerId = null;
});

async function startSharing() {
  const source = await window.hostBridge.getScreenSource();
  if (!source) {
    setStatus('No screen source available');
    return;
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        maxFrameRate: 15,
      },
    },
  });

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  dataChannel = pc.createDataChannel('control');
  dataChannel.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    window.hostBridge.sendRemoteInput(msg);
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: evt.candidate } }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') setStatus('Live', true);
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      setStatus('Waiting…', false);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'signal', data: { sdp: pc.localDescription } }));
}

async function handleSignal(data) {
  if (!pc) return;
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (e) {
      console.warn('ICE candidate error', e);
    }
  }
}

function cleanupCall() {
  if (dataChannel) dataChannel.close();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  pc = null;
  dataChannel = null;
  localStream = null;
}

connectSignaling();
