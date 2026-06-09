import os
import sqlite3
import bcrypt
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from PIL import Image

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change-this-to-a-long-random-string-before-deploying')
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'avatars')
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024  # 4MB

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')
login_manager = LoginManager(app)
login_manager.login_view = 'login'

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
DB_PATH = 'database.db'

# ─────────────── Database ───────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            avatar TEXT DEFAULT 'default.png',
            join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS friend_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user1_id INTEGER NOT NULL,
            user2_id INTEGER NOT NULL,
            FOREIGN KEY (user1_id) REFERENCES users(id),
            FOREIGN KEY (user2_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS main_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS direct_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read INTEGER DEFAULT 0,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        );
    ''')
    conn.commit()
    conn.close()

# ─────────────── User model ───────────────

class User(UserMixin):
    def __init__(self, row):
        self.id = row['id']
        self.username = row['username']
        self.email = row['email']
        self.avatar = row['avatar']
        self.join_date = row['join_date']

@login_manager.user_loader
def load_user(user_id):
    conn = get_db()
    row = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return User(row) if row else None

# ─────────────── Helpers ───────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def format_ts(ts):
    if isinstance(ts, str):
        try:
            dt = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            dt = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    else:
        dt = ts
    return dt.strftime('%b %d, %Y %I:%M %p')

online_users = {}  # {user_id: sid}

def is_online(user_id):
    return user_id in online_users

def get_user_by_id(uid):
    conn = get_db()
    row = conn.execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()
    conn.close()
    return User(row) if row else None

def are_friends(uid1, uid2):
    conn = get_db()
    r = conn.execute('''SELECT id FROM friends WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)''',
                     (uid1, uid2, uid2, uid1)).fetchone()
    conn.close()
    return r is not None

# ─────────────── Auth routes ───────────────

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    error = None
    if request.method == 'POST':
        identifier = request.form.get('identifier', '').strip()
        password = request.form.get('password', '').encode()
        conn = get_db()
        row = conn.execute('SELECT * FROM users WHERE username=? OR email=?', (identifier, identifier)).fetchone()
        conn.close()
        if row and bcrypt.checkpw(password, row['password_hash'].encode()):
            login_user(User(row), remember=True)
            return redirect(url_for('chat'))
        error = 'Invalid username/email or password.'
    return render_template('login.html', error=error)

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        confirm = request.form.get('confirm_password', '')

        if not username or not email or not password:
            error = 'All fields are required.'
        elif len(username) < 3:
            error = 'Username must be at least 3 characters.'
        elif len(password) < 6:
            error = 'Password must be at least 6 characters.'
        elif password != confirm:
            error = 'Passwords do not match.'
        else:
            conn = get_db()
            existing = conn.execute('SELECT id FROM users WHERE username=? OR email=?', (username, email)).fetchone()
            if existing:
                error = 'Username or email already taken.'
                conn.close()
            else:
                hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
                conn.execute('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                             (username, email, hashed))
                conn.commit()
                row = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                conn.close()
                login_user(User(row), remember=True)
                return redirect(url_for('chat'))
    return render_template('signup.html', error=error)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

# ─────────────── Main chat ───────────────

@app.route('/chat')
@login_required
def chat():
    conn = get_db()
    msgs = conn.execute('''
        SELECT mm.*, u.username, u.avatar FROM main_messages mm
        JOIN users u ON mm.sender_id = u.id
        ORDER BY mm.timestamp DESC LIMIT 100
    ''').fetchall()
    msgs = list(reversed(msgs))

    friends_rows = conn.execute('''
        SELECT u.* FROM friends f
        JOIN users u ON (f.user1_id=u.id OR f.user2_id=u.id)
        WHERE (f.user1_id=? OR f.user2_id=?) AND u.id != ?
    ''', (current_user.id, current_user.id, current_user.id)).fetchall()

    pending_in = conn.execute('''
        SELECT fr.*, u.username, u.avatar FROM friend_requests fr
        JOIN users u ON fr.sender_id=u.id
        WHERE fr.receiver_id=?
    ''', (current_user.id,)).fetchall()

    pending_out = conn.execute('''
        SELECT receiver_id FROM friend_requests WHERE sender_id=?
    ''', (current_user.id,)).fetchall()
    pending_out_ids = [r['receiver_id'] for r in pending_out]

    # DM conversations (last message per friend)
    dm_convos = []
    for f in friends_rows:
        last = conn.execute('''
            SELECT * FROM direct_messages
            WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
            ORDER BY timestamp DESC LIMIT 1
        ''', (current_user.id, f['id'], f['id'], current_user.id)).fetchone()
        unread = conn.execute('''
            SELECT COUNT(*) as cnt FROM direct_messages
            WHERE sender_id=? AND receiver_id=? AND is_read=0
        ''', (f['id'], current_user.id)).fetchone()['cnt']
        dm_convos.append({'user': f, 'last_msg': last, 'unread': unread})

    conn.close()
    return render_template('chat.html',
                           messages=msgs,
                           friends=friends_rows,
                           pending_in=pending_in,
                           pending_out_ids=pending_out_ids,
                           dm_convos=dm_convos,
                           format_ts=format_ts,
                           is_online=is_online)

# ─────────────── DM API ───────────────

@app.route('/api/dm/<int:friend_id>')
@login_required
def get_dm(friend_id):
    conn = get_db()
    # Mark as read
    conn.execute('UPDATE direct_messages SET is_read=1 WHERE sender_id=? AND receiver_id=?',
                 (friend_id, current_user.id))
    conn.commit()
    msgs = conn.execute('''
        SELECT dm.*, u.username, u.avatar FROM direct_messages dm
        JOIN users u ON dm.sender_id=u.id
        WHERE (dm.sender_id=? AND dm.receiver_id=?) OR (dm.sender_id=? AND dm.receiver_id=?)
        ORDER BY dm.timestamp ASC
    ''', (current_user.id, friend_id, friend_id, current_user.id)).fetchall()
    friend = conn.execute('SELECT * FROM users WHERE id=?', (friend_id,)).fetchone()
    conn.close()
    result = []
    for m in msgs:
        result.append({
            'id': m['id'],
            'sender_id': m['sender_id'],
            'content': m['content'],
            'timestamp': format_ts(m['timestamp']),
            'username': m['username'],
            'avatar': m['avatar'],
            'is_mine': m['sender_id'] == current_user.id
        })
    return jsonify({
        'messages': result,
        'friend': {'id': friend['id'], 'username': friend['username'], 'avatar': friend['avatar']}
    })

# ─────────────── Friend API ───────────────

@app.route('/api/search_users')
@login_required
def search_users():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])
    conn = get_db()
    rows = conn.execute('''
        SELECT id, username, avatar FROM users
        WHERE username LIKE ? AND id != ?
        LIMIT 10
    ''', (f'%{q}%', current_user.id)).fetchall()
    conn.close()
    result = []
    for r in rows:
        result.append({
            'id': r['id'],
            'username': r['username'],
            'avatar': r['avatar'],
            'is_friend': are_friends(current_user.id, r['id']),
            'is_online': is_online(r['id'])
        })
    return jsonify(result)

@app.route('/api/send_friend_request/<int:receiver_id>', methods=['POST'])
@login_required
def send_friend_request(receiver_id):
    if receiver_id == current_user.id:
        return jsonify({'error': 'Cannot add yourself'}), 400
    if are_friends(current_user.id, receiver_id):
        return jsonify({'error': 'Already friends'}), 400
    conn = get_db()
    existing = conn.execute('''
        SELECT id FROM friend_requests
        WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    ''', (current_user.id, receiver_id, receiver_id, current_user.id)).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'Request already sent'}), 400
    conn.execute('INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)',
                 (current_user.id, receiver_id))
    conn.commit()
    conn.close()
    # Notify receiver
    receiver = get_user_by_id(receiver_id)
    if receiver_id in online_users:
        socketio.emit('friend_request_received', {
            'sender_id': current_user.id,
            'sender_username': current_user.username,
            'sender_avatar': current_user.avatar
        }, room=online_users[receiver_id])
    return jsonify({'success': True})

@app.route('/api/accept_friend/<int:sender_id>', methods=['POST'])
@login_required
def accept_friend(sender_id):
    conn = get_db()
    req = conn.execute('''
        SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=?
    ''', (sender_id, current_user.id)).fetchone()
    if not req:
        conn.close()
        return jsonify({'error': 'No such request'}), 404
    conn.execute('DELETE FROM friend_requests WHERE sender_id=? AND receiver_id=?',
                 (sender_id, current_user.id))
    conn.execute('INSERT INTO friends (user1_id, user2_id) VALUES (?, ?)',
                 (current_user.id, sender_id))
    conn.commit()
    sender = conn.execute('SELECT * FROM users WHERE id=?', (sender_id,)).fetchone()
    conn.close()
    # Notify sender
    if sender_id in online_users:
        socketio.emit('friend_request_accepted', {
            'by_user_id': current_user.id,
            'by_username': current_user.username,
            'by_avatar': current_user.avatar
        }, room=online_users[sender_id])
    return jsonify({'success': True,
                    'friend': {'id': sender['id'], 'username': sender['username'], 'avatar': sender['avatar']}})

@app.route('/api/decline_friend/<int:sender_id>', methods=['POST'])
@login_required
def decline_friend(sender_id):
    conn = get_db()
    conn.execute('DELETE FROM friend_requests WHERE sender_id=? AND receiver_id=?',
                 (sender_id, current_user.id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/remove_friend/<int:friend_id>', methods=['POST'])
@login_required
def remove_friend(friend_id):
    conn = get_db()
    conn.execute('''DELETE FROM friends WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)''',
                 (current_user.id, friend_id, friend_id, current_user.id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

# ─────────────── Avatar upload ───────────────

@app.route('/api/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'avatar' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['avatar']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file'}), 400
    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f'user_{current_user.id}.{ext}'
    path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    img = Image.open(file.stream)
    img = img.convert('RGB')
    img.thumbnail((256, 256))
    img.save(path, quality=90)
    conn = get_db()
    conn.execute('UPDATE users SET avatar=? WHERE id=?', (filename, current_user.id))
    conn.commit()
    conn.close()
    # Broadcast update
    socketio.emit('user_avatar_updated', {'user_id': current_user.id, 'avatar': filename}, broadcast=True)
    return jsonify({'success': True, 'avatar': filename})

@app.route('/static/avatars/<path:filename>')
def serve_avatar(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ─────────────── Online users API ───────────────

@app.route('/api/online_users')
@login_required
def get_online_users():
    conn = get_db()
    result = []
    for uid in list(online_users.keys()):
        row = conn.execute('SELECT id, username, avatar FROM users WHERE id=?', (uid,)).fetchone()
        if row:
            result.append({'id': row['id'], 'username': row['username'], 'avatar': row['avatar']})
    conn.close()
    return jsonify(result)

# ─────────────── SocketIO events ───────────────

@socketio.on('connect')
def on_connect():
    if current_user.is_authenticated:
        online_users[current_user.id] = request.sid
        join_room('main')
        emit('online_status', {'user_id': current_user.id, 'status': 'online'}, broadcast=True)

@socketio.on('disconnect')
def on_disconnect():
    if current_user.is_authenticated:
        online_users.pop(current_user.id, None)
        emit('online_status', {'user_id': current_user.id, 'status': 'offline'}, broadcast=True)

@socketio.on('send_main_message')
def on_main_message(data):
    if not current_user.is_authenticated:
        return
    content = data.get('content', '').strip()
    if not content or len(content) > 2000:
        return
    conn = get_db()
    conn.execute('INSERT INTO main_messages (sender_id, content) VALUES (?, ?)',
                 (current_user.id, content))
    conn.commit()
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn.close()
    emit('new_main_message', {
        'sender_id': current_user.id,
        'username': current_user.username,
        'avatar': current_user.avatar,
        'content': content,
        'timestamp': format_ts(ts)
    }, room='main')

@socketio.on('send_dm')
def on_dm(data):
    if not current_user.is_authenticated:
        return
    receiver_id = data.get('receiver_id')
    content = data.get('content', '').strip()
    if not content or not receiver_id or len(content) > 2000:
        return
    if not are_friends(current_user.id, receiver_id):
        return
    conn = get_db()
    conn.execute('INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
                 (current_user.id, receiver_id, content))
    conn.commit()
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn.close()
    payload = {
        'sender_id': current_user.id,
        'receiver_id': receiver_id,
        'username': current_user.username,
        'avatar': current_user.avatar,
        'content': content,
        'timestamp': format_ts(ts)
    }
    emit('new_dm', payload)  # echo to sender
    if receiver_id in online_users:
        socketio.emit('new_dm', payload, room=online_users[receiver_id])

@socketio.on('typing')
def on_typing(data):
    if not current_user.is_authenticated:
        return
    receiver_id = data.get('receiver_id')
    if receiver_id and receiver_id in online_users:
        socketio.emit('user_typing', {
            'sender_id': current_user.id,
            'username': current_user.username
        }, room=online_users[receiver_id])

@socketio.on('stop_typing')
def on_stop_typing(data):
    if not current_user.is_authenticated:
        return
    receiver_id = data.get('receiver_id')
    if receiver_id and receiver_id in online_users:
        socketio.emit('user_stop_typing', {
            'sender_id': current_user.id
        }, room=online_users[receiver_id])

# ─────────────── Run ───────────────

if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    # Create default avatar placeholder
    default_path = os.path.join(app.config['UPLOAD_FOLDER'], 'default.png')
    if not os.path.exists(default_path):
        img = Image.new('RGB', (256, 256), color=(43, 45, 49))
        img.save(default_path)
    init_db()
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, debug=False, host='0.0.0.0', port=port)
