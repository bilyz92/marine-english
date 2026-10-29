// Máy chủ xem giao diện trên máy: node serve.js, rồi mở http://localhost:5173/
// Chỉ nghe ở 127.0.0.1, chỉ phục vụ tệp trong thư mục này. Không cần cài thêm gì.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (name === '/') name = '/index.html';
  const file = path.normalize(path.join(ROOT, name));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Đang mở giao diện tại ${url} (Ctrl+C để dừng)`);
  if (process.argv.includes('--open') && process.platform === 'win32') require('node:child_process').exec(`start "" "${url}"`);
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang bận. Đặt PORT khác, ví dụ: set PORT=5174` : e.message); process.exitCode = 1; });
