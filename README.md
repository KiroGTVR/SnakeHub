# 🐍 SnakeHub

A Discord-inspired real-time chat platform built with Python, Flask, and Socket.IO.

---

## 📁 Folder Structure

```
snakehub/
├── app.py                  # Main Flask application
├── requirements.txt        # Python dependencies
├── database.db             # SQLite database (auto-created on first run)
├── setup.sh                # Setup script
├── templates/
│   ├── login.html          # Login page
│   ├── signup.html         # Sign up page
│   └── chat.html           # Main chat interface
└── static/
    ├── style.css           # All styles
    ├── app.js              # Frontend JavaScript
    └── avatars/            # User avatar uploads (auto-created)
```

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- Python 3.8 or newer
- pip

### 2. Install dependencies

```bash
# Create a virtual environment (recommended)
python3 -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install packages
pip install -r requirements.txt
```

### 3. Run

```bash
python app.py
```

### 4. Open in browser

```
http://localhost:5000
```

The database (`database.db`) and the `static/avatars/` folder are created automatically on first run.

---

## 🚀 Features

| Feature | Details |
|---|---|
| **Authentication** | Sign up, log in, log out, persistent sessions |
| **MAIN Channel** | One global public channel for all users |
| **Direct Messages** | Real-time DMs between friends |
| **Friend System** | Send, accept, decline friend requests |
| **Online Status** | Live online/offline indicators |
| **Typing Indicators** | Shows when someone is typing a DM |
| **Avatar Upload** | Upload and crop profile pictures |
| **Notifications** | Toast notifications for friend requests & DMs |
| **Real-Time** | All updates via WebSocket (no page refresh) |

---

## 🛠 Tech Stack

- **Backend:** Python 3, Flask, Flask-SocketIO, Flask-Login
- **Database:** SQLite (via Python's built-in `sqlite3`)
- **Auth:** bcrypt password hashing
- **Real-time:** Socket.IO (eventlet async mode)
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Image handling:** Pillow

---

## 🔧 Configuration

The app uses a random `SECRET_KEY` generated at startup. For production, set a fixed key:

```python
app.secret_key = 'your-fixed-secret-key-here'
```

To run on a different port:
```bash
# Edit the last line of app.py:
socketio.run(app, debug=True, host='0.0.0.0', port=8080)
```
