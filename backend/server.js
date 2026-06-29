// Backend minimal: Express + Socket.IO + better-sqlite3
// Usage: set ADMIN_PASSWORD and SESSION_SECRET env vars, then `npm install` and `npm start`

const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { nanoid } = require('nanoid');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-session-secret';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set true if using HTTPS
}));

// Static files (serve the public folder inside backend)
app.use(express.static(path.join(__dirname, 'public')));

// Database init (file data/db.sqlite)
const dbPath = path.join(__dirname, 'data', 'db.sqlite');
const fs = require('fs');
if(!fs.existsSync(path.join(__dirname, 'data'))){ fs.mkdirSync(path.join(__dirname, 'data')); }
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables if not exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    subject TEXT,
    token TEXT,
    createdAt INTEGER,
    updatedAt INTEGER
  )`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    convId TEXT,
    sender TEXT,
    text TEXT,
    createdAt INTEGER
  )`).run();

// Prepared statements
const insertConv = db.prepare(`INSERT INTO conversations (id,name,email,subject,token,createdAt,updatedAt) VALUES (@id,@name,@email,@subject,@token,@createdAt,@updatedAt)`);
const getConvById = db.prepare(`SELECT * FROM conversations WHERE id = ?`);
const getConvByIdAndToken = db.prepare(`SELECT * FROM conversations WHERE id = ? AND token = ?`);
const updateConvTs = db.prepare(`UPDATE conversations SET updatedAt = @updatedAt WHERE id = @id`);
const insertMsg = db.prepare(`INSERT INTO messages (convId,sender,text,createdAt) VALUES (@convId,@sender,@text,@createdAt)`);
const getMessagesForConv = db.prepare(`SELECT * FROM messages WHERE convId = ? ORDER BY createdAt ASC`);
const listConversations = db.prepare(`SELECT id, name, email, subject, createdAt, updatedAt FROM conversations ORDER BY updatedAt DESC`);

// API routes

// Create conversation (contact form)
app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if(!name || !email || !message) return res.status(400).json({ error: 'name, email and message required' });

  const id = nanoid(12);
  const token = nanoid(64);
  const now = Date.now();

  insertConv.run({ id, name, email, subject: subject || '', token, createdAt: now, updatedAt: now });
  insertMsg.run({ convId: id, sender: 'user', text: message, createdAt: now });

  // Return conversation id and token (link for user)
  const link = `${req.protocol}://${req.get('host')}/chat.html?id=${id}&token=${token}`;
  res.json({ id, token, link });
});

// Get conversation (visitor uses token)
app.get('/api/conversation/:id', (req, res) => {
  const id = req.params.id;
  const token = req.query.token;
  if(!token) return res.status(403).json({ error: 'token required' });
  const conv = getConvByIdAndToken.get(id, token);
  if(!conv) return res.status(404).json({ error: 'conversation not found' });
  const messages = getMessagesForConv.all(id);
  res.json({ conversation: conv, messages });
});

// Admin login (simple)
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if(password === ADMIN_PASSWORD){
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(403).json({ error: 'invalid' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// List conversations (admin only)
app.get('/admin/conversations', (req, res) => {
  if(!req.session.admin) return res.status(403).json({ error: 'auth' });
  const convs = listConversations.all();
  res.json({ conversations: convs });
});

// Get messages for a conv (admin)
app.get('/admin/conversations/:id/messages', (req, res) => {
  if(!req.session.admin) return res.status(403).json({ error: 'auth' });
  const id = req.params.id;
  const conv = getConvById.get(id);
  if(!conv) return res.status(404).json({ error: 'not found' });
  const messages = getMessagesForConv.all(id);
  res.json({ conversation: conv, messages });
});

// POST message (used by admin via API fallback)
app.post('/api/conversation/:id/message', (req, res) => {
  const id = req.params.id;
  const { sender, text, token } = req.body;
  if(!text || !sender) return res.status(400).json({ error: 'sender and text required' });

  // Accept either admin session or valid token
  const conv = req.session.admin ? getConvById.get(id) : (token ? getConvByIdAndToken.get(id, token) : null);
  if(!conv) return res.status(403).json({ error: 'not authorized' });

  const now = Date.now();
  insertMsg.run({ convId: id, sender, text, createdAt: now });
  updateConvTs.run({ id, updatedAt: now });

  // Emit event via socket.io to room
  io.to(id).emit('message', { convId: id, sender, text, createdAt: now });
  res.json({ ok: true });
});

// Socket.IO realtime
io.on('connection', (socket) => {
  // join room with query {convId, token, admin}
  const { convId, token, admin } = socket.handshake.query;

  if(convId){
    if(token){
      const conv = getConvByIdAndToken.get(convId, token);
      if(!conv) { socket.emit('error', 'invalid token'); socket.disconnect(); return; }
    } else if(admin === '1'){
      // allow admin to join any room (assume session validated earlier via REST)
    } else {
      socket.emit('error', 'auth required');
      socket.disconnect(); return;
    }
    socket.join(convId);
  }

  socket.on('sendMessage', (data) => {
    try{
      const { convId, sender, text, token } = data;
      if(!convId || !sender || !text) return;
      const conv = token ? getConvByIdAndToken.get(convId, token) : getConvById.get(convId);
      if(!conv) return;
      const now = Date.now();
      insertMsg.run({ convId, sender, text, createdAt: now });
      updateConvTs.run({ id: convId, updatedAt: now });
      io.to(convId).emit('message', { convId, sender, text, createdAt: now });
    }catch(e){ console.error(e); }
  });
});

server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
