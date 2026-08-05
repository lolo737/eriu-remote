/**
 * Signaling server for the custom remote access tool.
 *
 * Responsibilities (this server NEVER sees screen/control data — that
 * travels peer-to-peer over WebRTC once the connection is set up):
 *   1. Host connects, gets a random 6-digit PIN.
 *   2. Viewer connects with a PIN, gets matched to that host.
 *   3. Host must explicitly approve the viewer before anything proceeds.
 *   4. Server relays WebRTC offer/answer/ICE messages between the two.
 *
 * Run:  npm install && npm start
 * Env:  PORT (default 8080)
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// pin -> { hostWs, pendingViewers: Map<viewerId, ws>, approvedViewerId, approvedWs }
const sessions = new Map();

function generatePin() {
  let pin;
  do {
    pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  } while (sessions.has(pin));
  return pin;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function cleanupSession(pin) {
  const s = sessions.get(pin);
  if (!s) return;
  for (const [, vws] of s.pendingViewers) send(vws, { type: 'session-ended' });
  if (s.approvedWs) send(s.approvedWs, { type: 'session-ended' });
  sessions.delete(pin);
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.pin = null;
  ws.viewerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // ---- HOST SIDE ----
      case 'host-register': {
        const pin = generatePin();
        ws.role = 'host';
        ws.pin = pin;
        sessions.set(pin, {
          hostWs: ws,
          pendingViewers: new Map(),
          approvedViewerId: null,
          approvedWs: null,
        });
        send(ws, { type: 'registered', pin });
        break;
      }

      case 'approve': {
        const s = sessions.get(ws.pin);
        if (!s || ws.role !== 'host') return;
        const vws = s.pendingViewers.get(msg.viewerId);
        if (!vws) return;
        s.pendingViewers.delete(msg.viewerId);
        s.approvedViewerId = msg.viewerId;
        s.approvedWs = vws;
        send(vws, { type: 'approved' });
        send(ws, { type: 'viewer-approved', viewerId: msg.viewerId });
        break;
      }

      case 'deny': {
        const s = sessions.get(ws.pin);
        if (!s || ws.role !== 'host') return;
        const vws = s.pendingViewers.get(msg.viewerId);
        s.pendingViewers.delete(msg.viewerId);
        send(vws, { type: 'denied' });
        break;
      }

      // ---- VIEWER SIDE ----
      case 'join': {
        const s = sessions.get(msg.pin);
        if (!s) {
          send(ws, { type: 'join-error', reason: 'No host found for that code.' });
          return;
        }
        if (s.approvedWs) {
          send(ws, { type: 'join-error', reason: 'Someone is already connected to this session.' });
          return;
        }
        const viewerId = crypto.randomUUID();
        ws.role = 'viewer';
        ws.pin = msg.pin;
        ws.viewerId = viewerId;
        s.pendingViewers.set(viewerId, ws);
        send(ws, { type: 'joined', viewerId });
        send(s.hostWs, { type: 'viewer-request', viewerId });
        break;
      }

      // ---- SHARED: WebRTC signaling relay ----
      case 'signal': {
        const s = sessions.get(ws.pin);
        if (!s) return;
        if (ws.role === 'host' && s.approvedWs) {
          send(s.approvedWs, { type: 'signal', data: msg.data });
        } else if (ws.role === 'viewer' && ws.viewerId === s.approvedViewerId) {
          send(s.hostWs, { type: 'signal', viewerId: ws.viewerId, data: msg.data });
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.pin) return;
    const s = sessions.get(ws.pin);
    if (!s) return;
    if (ws.role === 'host') {
      cleanupSession(ws.pin);
    } else if (ws.role === 'viewer') {
      s.pendingViewers.delete(ws.viewerId);
      if (s.approvedViewerId === ws.viewerId) {
        s.approvedViewerId = null;
        s.approvedWs = null;
        send(s.hostWs, { type: 'viewer-disconnected' });
      }
    }
  });
});

console.log(`Signaling server listening on ws://0.0.0.0:${PORT}`);
