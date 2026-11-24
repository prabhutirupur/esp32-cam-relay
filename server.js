const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    esp32Connected: esp32Socket !== null && esp32Socket.readyState === 1,
    viewerCount: viewers.size
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let esp32Socket = null;
const viewers = new Set();
let latestFrame = null;

wss.on('connection', (ws, req) => {
  const url = req.url || '';
  const isEsp32 = url.includes('role=esp32') || url.includes('/esp32');

  if (isEsp32) {
    console.log('[ESP32] Camera connected from:', req.socket.remoteAddress);
    if (esp32Socket && esp32Socket !== ws && esp32Socket.readyState === 1) {
      esp32Socket.close();
    }
    esp32Socket = ws;

    // Notify all viewers that camera is online
    broadcastToViewers(JSON.stringify({ type: 'status', cameraOnline: true }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        latestFrame = data;
        // Broadcast video frame to all connected browser viewers
        for (const viewer of viewers) {
          if (viewer.readyState === 1) { // OPEN
            viewer.send(data, { binary: true });
          }
        }
      } else {
        // Text/JSON from ESP32 (e.g. file list, status, capture complete)
        const msgStr = data.toString();
        broadcastToViewers(msgStr);
      }
    });

    ws.on('close', () => {
      console.log('[ESP32] Camera disconnected');
      if (esp32Socket === ws) {
        esp32Socket = null;
        broadcastToViewers(JSON.stringify({ type: 'status', cameraOnline: false }));
      }
    });

    ws.on('error', (err) => {
      console.error('[ESP32] Error:', err.message);
    });

  } else {
    // Browser Viewer Client
    viewers.add(ws);
    console.log(`[Viewer] Browser connected (Total viewers: ${viewers.size})`);

    // Send initial status and latest frame if available
    ws.send(JSON.stringify({
      type: 'status',
      cameraOnline: esp32Socket !== null && esp32Socket.readyState === 1
    }));

    if (latestFrame && ws.readyState === 1) {
      ws.send(latestFrame, { binary: true });
    }

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const msgStr = data.toString();
        // Forward command from browser viewer to ESP32-CAM
        if (esp32Socket && esp32Socket.readyState === 1) {
          esp32Socket.send(msgStr);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'ESP32 Camera is offline' }));
        }
      }
    });

    ws.on('close', () => {
      viewers.delete(ws);
      console.log(`[Viewer] Browser disconnected (Remaining: ${viewers.size})`);
    });

    ws.on('error', (err) => {
      console.error('[Viewer] Error:', err.message);
    });
  }
});

function broadcastToViewers(msg) {
  for (const viewer of viewers) {
    if (viewer.readyState === 1) {
      viewer.send(msg);
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ESP32-CAM Cloud Relay Server running on port ${PORT}`);
});
