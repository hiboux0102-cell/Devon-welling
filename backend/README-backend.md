# Backend for Devon Welling site

This backend provides a minimal self-hosted contact + chat system using Express, Socket.IO and SQLite.

How to run
1. Install dependencies: npm install
2. Create data directory: mkdir data
3. Set environment variables:
   - ADMIN_PASSWORD (your admin password)
   - SESSION_SECRET (session secret)
   - PORT (optional, default 3000)
4. Start: npm start

The server serves files from the backend/public directory. You can replace those files with the site pages or adapt the paths.

Security notes
- Use HTTPS in production and set cookie `secure: true` in server.js.
- Keep ADMIN_PASSWORD and SESSION_SECRET secret (do not commit them).
