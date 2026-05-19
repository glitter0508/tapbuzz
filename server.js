const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 静态文件服务
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); }
    else { res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' }); res.end(data); }
  });
});

// WebSocket 房间
const wss = new WebSocketServer({ server });
const rooms = new Map(); // roomId -> Set<{ws, id}>

function genId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
  let myRoom = null;
  let myId = genId();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      // 创建房间
      myRoom = genId();
      rooms.set(myRoom, new Set([{ ws, id: myId }]));
      ws.send(JSON.stringify({ type: 'joined', roomId: myRoom }));
    }

    else if (msg.type === 'join') {
      myRoom = msg.roomId;
      if (!myRoom || !rooms.has(myRoom)) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }
      const clients = rooms.get(myRoom);
      clients.add({ ws, id: myId });
      // 通知双方
      broadcast(myRoom, { type: 'paired' });
      broadcast(myRoom, { type: 'joined', roomId: myRoom });
    }

    else if (msg.type === 'buzz' && myRoom) {
      broadcast(myRoom, { type: 'buzz', from: myId });
    }
  });

  ws.on('close', () => {
    if (myRoom && rooms.has(myRoom)) {
      const clients = rooms.get(myRoom);
      // 只删除自己的连接
      for (const c of clients) {
        if (c.ws === ws) { clients.delete(c); break; }
      }
      if (clients.size === 0) {
        rooms.delete(myRoom);
      }
    }
  });
});

function broadcast(roomId, msg) {
  const clients = rooms.get(roomId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const { ws } of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
