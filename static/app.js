/* ═══════════════════════════════════════
   SnakeHub — Frontend JavaScript
   ═══════════════════════════════════════ */

const socket = io();

// ── State ──
let currentView = 'main';    // 'main' | dm user id (number)
let currentDmUser = null;    // { id, username, avatar }
let typingTimer = null;
let isTyping = false;
const pendingOutIds = new Set(window.PENDING_OUT_IDS || []);

// ── DOM refs ──
const mainMessages  = document.getElementById('mainMessages');
const dmMessages    = document.getElementById('dmMessages');
const messageInput  = document.getElementById('messageInput');
const sendBtn       = document.getElementById('sendBtn');
const channelTitle  = document.getElementById('channelTitle');
const onlineList    = document.getElementById('onlineList');
const onlineCount   = document.getElementById('onlineCount');
const typingIndicator = document.getElementById('typingIndicator');
const typingText    = document.getElementById('typingText');
const toastContainer = document.getElementById('toastContainer');
const friendSearch  = document.getElementById('friendSearch');
const searchResults = document.getElementById('searchResults');
const pendingLabel  = document.getElementById('pendingLabel');
const pendingRequests = document.getElementById('pendingRequests');
const friendsList   = document.getElementById('friendsList');
const dmList        = document.getElementById('dmList');

// ── Tab switching ──
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
  });
});

// ── Show MAIN ──
function showMain() {
  currentView = 'main';
  currentDmUser = null;
  channelTitle.textContent = 'MAIN';
  messageInput.placeholder = 'Message #MAIN';
  mainMessages.classList.add('active');
  dmMessages.classList.remove('active');
  document.querySelectorAll('.dm-item').forEach(d => d.classList.remove('active'));
  scrollToBottom(mainMessages.parentElement);
}

// ── Show DM ──
function showDm(userId, username, avatar) {
  currentView = userId;
  currentDmUser = { id: userId, username, avatar };
  channelTitle.textContent = '@' + username;
  messageInput.placeholder = `Message @${username}`;
  mainMessages.classList.remove('active');
  dmMessages.classList.add('active');
  dmMessages.innerHTML = '<div style="padding:20px;text-align:center;color:#4e5058;font-size:13px">Loading…</div>';

  // Clear unread
  const unreadEl = document.getElementById(`unread-${userId}`);
  if (unreadEl) unreadEl.remove();
  const dmItem = document.getElementById(`dm-${userId}`);
  if (dmItem) {
    dmItem.classList.remove('has-unread');
    dmItem.querySelectorAll('.dm-name').forEach(n => { n.style.fontWeight = ''; });
    document.querySelectorAll('.dm-item').forEach(d => d.classList.remove('active'));
    dmItem.classList.add('active');
  }

  fetch(`/api/dm/${userId}`)
    .then(r => r.json())
    .then(data => {
      dmMessages.innerHTML = '';
      const welcome = document.createElement('div');
      welcome.className = 'dm-welcome';
      welcome.innerHTML = `
        <img src="/static/avatars/${data.friend.avatar}" class="dm-welcome-avatar" onerror="this.src='/static/avatars/default.png'" />
        <h3>${escHtml(data.friend.username)}</h3>
        <p>This is the beginning of your direct message history with <strong>@${escHtml(data.friend.username)}</strong>.</p>
      `;
      dmMessages.appendChild(welcome);
      data.messages.forEach(m => appendDmMessage(m));
      scrollToBottom(dmMessages.parentElement);
    });
}

// ── Channel title click → back to MAIN ──
document.getElementById('channelTitle').addEventListener('click', () => {
  if (currentView !== 'main') showMain();
});

// ── DM list clicks ──
dmList.addEventListener('click', e => {
  const item = e.target.closest('.dm-item');
  if (!item) return;
  showDm(+item.dataset.id, item.dataset.name, item.dataset.avatar || 'default.png');
});

// ── DM button in friends list ──
document.addEventListener('click', e => {
  if (e.target.classList.contains('dm-btn')) {
    const id = +e.target.dataset.id;
    const name = e.target.dataset.name;
    // Switch to DMs tab first
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="dms"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-dms').classList.add('active');
    showDm(id, name, 'default.png');
  }
});

// ── Send message ──
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  messageInput.value = '';

  if (currentView === 'main') {
    socket.emit('send_main_message', { content });
  } else {
    socket.emit('send_dm', { receiver_id: currentDmUser.id, content });
    stopTypingSignal();
  }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Typing indicators ──
messageInput.addEventListener('input', () => {
  if (currentView === 'main') return;
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { receiver_id: currentDmUser.id });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTypingSignal, 2500);
});

function stopTypingSignal() {
  if (isTyping && currentDmUser) {
    isTyping = false;
    socket.emit('stop_typing', { receiver_id: currentDmUser.id });
  }
}

// ── Toggle right sidebar ──
document.getElementById('toggleOnlineBtn').addEventListener('click', () => {
  const sb = document.getElementById('sidebarRight');
  sb.classList.toggle('hidden');
});

// ── Friend search ──
let searchDebounce = null;
friendSearch.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = friendSearch.value.trim();
  if (!q) { searchResults.innerHTML = ''; return; }
  searchDebounce = setTimeout(() => {
    fetch(`/api/search_users?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(renderSearchResults);
  }, 300);
});

document.getElementById('searchBtn').addEventListener('click', () => {
  const q = friendSearch.value.trim();
  if (!q) return;
  fetch(`/api/search_users?q=${encodeURIComponent(q)}`)
    .then(r => r.json())
    .then(renderSearchResults);
});

function renderSearchResults(users) {
  if (!users.length) {
    searchResults.innerHTML = '<div class="empty-hint">No users found</div>';
    return;
  }
  searchResults.innerHTML = users.map(u => {
    let actionBtn = '';
    if (u.is_friend) {
      actionBtn = `<span style="font-size:11px;color:var(--accent)">Friends</span>`;
    } else if (pendingOutIds.has(u.id)) {
      actionBtn = `<span style="font-size:11px;color:var(--text-muted)">Pending</span>`;
    } else {
      actionBtn = `<button class="icon-btn green add-friend-btn" data-id="${u.id}" title="Add friend">➕</button>`;
    }
    const onlineDot = u.is_online ? 'online' : 'offline';
    return `
      <div class="search-result-item">
        <div class="avatar-status-wrap">
          <img src="/static/avatars/${escHtml(u.avatar)}" class="avatar-sm" onerror="this.src='/static/avatars/default.png'"/>
          <span class="status-dot ${onlineDot}"></span>
        </div>
        <span class="item-name">${escHtml(u.username)}</span>
        ${actionBtn}
      </div>
    `;
  }).join('');
}

// ── Add friend (delegated) ──
searchResults.addEventListener('click', e => {
  const btn = e.target.closest('.add-friend-btn');
  if (!btn) return;
  const id = +btn.dataset.id;
  fetch(`/api/send_friend_request/${id}`, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        pendingOutIds.add(id);
        btn.outerHTML = `<span style="font-size:11px;color:var(--text-muted)">Pending</span>`;
        showToast('Friend request sent!', '📨');
      } else {
        showToast(data.error || 'Error', '⚠️', true);
      }
    });
});

// ── Accept / Decline friend request ──
pendingRequests.addEventListener('click', e => {
  if (e.target.classList.contains('accept-btn')) {
    const id = +e.target.dataset.id;
    fetch(`/api/accept_friend/${id}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          document.getElementById(`req-${id}`)?.remove();
          updatePendingLabel();
          addFriendToList(data.friend);
          showToast(`You are now friends with ${data.friend.username}!`, '🤝');
        }
      });
  }
  if (e.target.classList.contains('decline-btn')) {
    const id = +e.target.dataset.id;
    fetch(`/api/decline_friend/${id}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          document.getElementById(`req-${id}`)?.remove();
          updatePendingLabel();
        }
      });
  }
});

// ── Remove friend ──
friendsList.addEventListener('click', e => {
  if (e.target.classList.contains('remove-btn')) {
    const id = +e.target.dataset.id;
    if (!confirm('Remove this friend?')) return;
    fetch(`/api/remove_friend/${id}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          document.getElementById(`friend-${id}`)?.remove();
          document.getElementById(`dm-${id}`)?.remove();
          if (currentView === id) showMain();
          showToast('Friend removed.', '👋', true);
        }
      });
  }
});

// ── Avatar upload ──
document.getElementById('avatarWrap').addEventListener('click', () => {
  document.getElementById('avatarInput').click();
});

document.getElementById('avatarInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  fetch('/api/upload_avatar', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        document.getElementById('myAvatar').src = `/static/avatars/${data.avatar}?t=${Date.now()}`;
        showToast('Avatar updated!', '🖼️');
      } else {
        showToast(data.error || 'Upload failed', '⚠️', true);
      }
    });
});

// ── Online users ──
function loadOnlineUsers() {
  fetch('/api/online_users')
    .then(r => r.json())
    .then(users => renderOnlineUsers(users));
}

function renderOnlineUsers(users) {
  onlineCount.textContent = users.length;
  onlineList.innerHTML = users.map(u => `
    <div class="online-user-item">
      <div class="avatar-status-wrap">
        <img src="/static/avatars/${escHtml(u.avatar)}" class="avatar-sm" onerror="this.src='/static/avatars/default.png'"/>
        <span class="status-dot online"></span>
      </div>
      <span>${escHtml(u.username)}</span>
    </div>
  `).join('') || '<div class="empty-hint">No one else online</div>';
}

// ── Helpers ──
function scrollToBottom(el) {
  if (!el) return;
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function showToast(msg, icon = 'ℹ️', isDanger = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isDanger ? ' danger' : ''}`;
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${escHtml(msg)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function updatePendingLabel() {
  const count = pendingRequests.querySelectorAll('.friend-request-item').length;
  if (count > 0) {
    pendingLabel.style.display = 'flex';
    document.getElementById('pendingCount').textContent = count;
  } else {
    pendingLabel.style.display = 'none';
  }
}

function addFriendToList(friend) {
  // Only add if not already there
  if (document.getElementById(`friend-${friend.id}`)) return;
  const div = document.createElement('div');
  div.className = 'friend-item';
  div.dataset.id = friend.id;
  div.id = `friend-${friend.id}`;
  div.innerHTML = `
    <div class="avatar-status-wrap">
      <img src="/static/avatars/${escHtml(friend.avatar)}" class="avatar-sm" onerror="this.src='/static/avatars/default.png'"/>
      <span class="status-dot offline" id="sdot-${friend.id}"></span>
    </div>
    <span class="friend-name">${escHtml(friend.username)}</span>
    <button class="icon-btn blue dm-btn" data-id="${friend.id}" data-name="${escHtml(friend.username)}" title="Message">💬</button>
    <button class="icon-btn red remove-btn" data-id="${friend.id}" title="Remove friend">✗</button>
  `;
  friendsList.appendChild(div);

  // Also add to DM list
  const dmDiv = document.createElement('div');
  dmDiv.className = 'dm-item';
  dmDiv.dataset.id = friend.id;
  dmDiv.dataset.name = friend.username;
  dmDiv.id = `dm-${friend.id}`;
  dmDiv.innerHTML = `
    <div class="avatar-status-wrap">
      <img src="/static/avatars/${escHtml(friend.avatar)}" class="avatar-sm" onerror="this.src='/static/avatars/default.png'"/>
      <span class="status-dot offline" id="sdot-${friend.id}-dm"></span>
    </div>
    <div class="dm-item-info">
      <span class="dm-name">${escHtml(friend.username)}</span>
    </div>
  `;
  dmList.appendChild(dmDiv);
}

function appendMainMessage(data) {
  const isMine = data.sender_id === window.CURRENT_USER_ID;
  const div = document.createElement('div');
  div.className = 'msg-row';
  div.innerHTML = `
    <img src="/static/avatars/${escHtml(data.avatar)}" class="avatar-msg" onerror="this.src='/static/avatars/default.png'"/>
    <div class="msg-content">
      <div class="msg-meta">
        <span class="msg-author" style="${isMine ? 'color:var(--accent)' : ''}">${escHtml(data.username)}</span>
        <span class="msg-time">${escHtml(data.timestamp)}</span>
      </div>
      <div class="msg-text">${escHtml(data.content)}</div>
    </div>
  `;
  mainMessages.appendChild(div);
  scrollToBottom(mainMessages.parentElement);
}

function appendDmMessage(data) {
  const isMine = data.sender_id === window.CURRENT_USER_ID || data.is_mine;
  const div = document.createElement('div');
  div.className = 'msg-row';
  div.innerHTML = `
    <img src="/static/avatars/${escHtml(data.avatar)}" class="avatar-msg" onerror="this.src='/static/avatars/default.png'"/>
    <div class="msg-content">
      <div class="msg-meta">
        <span class="msg-author" style="${isMine ? 'color:var(--accent)' : ''}">${escHtml(data.username)}</span>
        <span class="msg-time">${escHtml(data.timestamp)}</span>
      </div>
      <div class="msg-text">${escHtml(data.content)}</div>
    </div>
  `;
  dmMessages.appendChild(div);
  scrollToBottom(dmMessages.parentElement);
}

function updateDmPreview(senderId, content) {
  const dmItem = document.getElementById(`dm-${senderId}`);
  if (!dmItem) return;
  let previewEl = dmItem.querySelector('.dm-preview');
  if (!previewEl) {
    const infoDiv = dmItem.querySelector('.dm-item-info');
    if (infoDiv) {
      previewEl = document.createElement('span');
      previewEl.className = 'dm-preview';
      infoDiv.appendChild(previewEl);
    }
  }
  if (previewEl) previewEl.textContent = content.length > 40 ? content.slice(0, 40) + '…' : content;
}

// ── SocketIO events ──

socket.on('connect', () => {
  loadOnlineUsers();
});

socket.on('new_main_message', data => {
  appendMainMessage(data);
});

socket.on('new_dm', data => {
  const senderId = data.sender_id;
  const receiverId = data.receiver_id;
  const isMine = senderId === window.CURRENT_USER_ID;
  const otherId = isMine ? receiverId : senderId;

  if (currentView === otherId || (isMine && currentView === receiverId)) {
    appendDmMessage(data);
  } else if (!isMine) {
    // Unread notification
    const dmItem = document.getElementById(`dm-${senderId}`);
    if (dmItem) {
      dmItem.classList.add('has-unread');
      let badge = document.getElementById(`unread-${senderId}`);
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'unread-badge';
        badge.id = `unread-${senderId}`;
        badge.textContent = '1';
        dmItem.appendChild(badge);
      } else {
        badge.textContent = (parseInt(badge.textContent) || 0) + 1;
      }
    }
    showToast(`New message from ${data.username}`, '💬');
  }

  updateDmPreview(isMine ? receiverId : senderId, data.content);
  // Switch to dms tab hint
  if (!isMine) {
    const dmsTab = document.querySelector('[data-tab="dms"]');
    if (dmsTab && !dmsTab.classList.contains('active')) {
      dmsTab.style.color = 'var(--accent)';
      setTimeout(() => { dmsTab.style.color = ''; }, 3000);
    }
  }
});

socket.on('friend_request_received', data => {
  // Add to pending list
  const div = document.createElement('div');
  div.className = 'friend-request-item';
  div.dataset.sender = data.sender_id;
  div.id = `req-${data.sender_id}`;
  div.innerHTML = `
    <img src="/static/avatars/${escHtml(data.sender_avatar)}" class="avatar-sm" onerror="this.src='/static/avatars/default.png'"/>
    <span class="req-name">${escHtml(data.sender_username)}</span>
    <button class="icon-btn green accept-btn" data-id="${data.sender_id}" title="Accept">✓</button>
    <button class="icon-btn red decline-btn" data-id="${data.sender_id}" title="Decline">✗</button>
  `;
  pendingRequests.appendChild(div);
  pendingLabel.style.display = 'flex';
  const cnt = document.getElementById('pendingCount');
  cnt.textContent = pendingRequests.querySelectorAll('.friend-request-item').length;
  showToast(`${data.sender_username} sent you a friend request!`, '👋');
  // Highlight friends tab
  document.querySelector('[data-tab="friends"]').style.color = 'var(--accent)';
  setTimeout(() => { document.querySelector('[data-tab="friends"]').style.color = ''; }, 3000);
});

socket.on('friend_request_accepted', data => {
  showToast(`${data.by_username} accepted your friend request!`, '🎉');
  addFriendToList({ id: data.by_user_id, username: data.by_username, avatar: data.by_avatar });
});

socket.on('online_status', data => {
  const dot = document.getElementById(`sdot-${data.user_id}`);
  if (dot) {
    dot.className = `status-dot ${data.status}`;
  }
  loadOnlineUsers();
});

socket.on('user_avatar_updated', data => {
  if (data.user_id === window.CURRENT_USER_ID) return;
  document.querySelectorAll(`[src*="user_${data.user_id}"]`).forEach(img => {
    img.src = `/static/avatars/${data.avatar}?t=${Date.now()}`;
  });
});

socket.on('user_typing', data => {
  if (currentDmUser && data.sender_id === currentDmUser.id) {
    typingText.textContent = `${data.username} is typing…`;
    typingIndicator.style.display = 'flex';
  }
});

socket.on('user_stop_typing', data => {
  if (currentDmUser && data.sender_id === currentDmUser.id) {
    typingIndicator.style.display = 'none';
  }
});

// ── Init ──
updatePendingLabel();
scrollToBottom(document.getElementById('messagesWrap'));
loadOnlineUsers();
