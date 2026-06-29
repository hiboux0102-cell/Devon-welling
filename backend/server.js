// Lightweight static server only: backend contact/chat system disabled
// This server serves files from backend/public and no longer exposes contact or chat APIs.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Simple health endpoint
app.get('/health', (req, res) => res.json({ ok: true, note: 'Contact system disabled - static site only' }));

// Catch-all to index.html for simple SPA behavior (optional)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Not found');
});

server.listen(PORT, () => {
  console.log(`Static server started on http://localhost:${PORT}`);
});
