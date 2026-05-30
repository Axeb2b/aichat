/**
 * AI Chat Frontend — Full-featured
 *
 * Features:
 *  1. File upload (image thumbnail / file preview), drag & drop
 *  2. Markdown rendering + syntax highlighting + copy button per code block
 *  3. Multi-turn conversation / chat threads (sidebar: new/rename/delete)
 *  4. Dark/Light theme toggle + system theme sync
 *  5. Typing indicator animation
 *  6. Streaming response (SSE word-by-word)
 *  7. Send file + prompt together (vision model for images)
 *  8. Mobile responsive (sidebar toggle)
 *  9. Error handling + retry button
 * 10. Font size, Enter-to-send toggle, edit/regenerate messages
 */

/* =====================================================================
   MARKED.JS CONFIGURATION
   ===================================================================== */
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
  });
}

/* =====================================================================
   DOM REFERENCES
   ===================================================================== */
const messagesContainer = document.getElementById("messages-container");
const typingIndicator    = document.getElementById("typing-indicator");
const userInput          = document.getElementById("user-input");
const sendButton         = document.getElementById("send-button");
const fileInput          = document.getElementById("file-input");
const attachBtn          = document.getElementById("attach-btn");
const filePreviewBar     = document.getElementById("file-preview-bar");
const filePreviewThumb   = document.getElementById("file-preview-thumb");
const filePreviewIcon    = document.getElementById("file-preview-icon");
const filePreviewName    = document.getElementById("file-preview-name");
const fileClearBtn       = document.getElementById("file-clear-btn");
const dropOverlay        = document.getElementById("drop-overlay");
const themeToggle        = document.getElementById("theme-toggle");
const themeIconSun       = document.getElementById("theme-icon-sun");
const themeIconMoon      = document.getElementById("theme-icon-moon");
const settingsToggle     = document.getElementById("settings-toggle");
const settingsPanel      = document.getElementById("settings-panel");
const fontSizeSlider     = document.getElementById("font-size-slider");
const fontSizeLabel      = document.getElementById("font-size-label");
const enterToSendToggle  = document.getElementById("enter-to-send");
const chatList           = document.getElementById("chat-list");
const newChatBtn         = document.getElementById("new-chat-btn");
const topbarTitle        = document.getElementById("topbar-title");
const menuToggle         = document.getElementById("menu-toggle");
const sidebar            = document.getElementById("sidebar");
const sidebarBackdrop    = document.getElementById("sidebar-backdrop");
const welcomeEl          = document.getElementById("welcome");
const inputHint          = document.getElementById("input-hint");

/* =====================================================================
   APP STATE
   ===================================================================== */
let chats = [];           // Array of { id, name, messages }
let activeChatId = null;
let isProcessing = false;
let attachedFile = null;  // { file: File, type: string, text?: string, previewUrl?: string }
let lastUserMessageIndex = -1; // for regenerate
let retryPayload = null;  // saved for retry

/* =====================================================================
   PERSISTENCE (localStorage)
   ===================================================================== */
function saveChats() {
  try {
    // Don't store file content in localStorage — just messages text
    const serializable = chats.map(c => ({
      id: c.id,
      name: c.name,
      messages: c.messages.map(m => ({
        role: m.role,
        content: m.content,
        hasAttachment: m.hasAttachment || false,
        attachmentName: m.attachmentName || null,
        attachmentType: m.attachmentType || null,
        isError: m.isError || false,
      })),
    }));
    localStorage.setItem("aichat_chats", JSON.stringify(serializable));
    localStorage.setItem("aichat_active", activeChatId || "");
  } catch (e) { /* ignore quota errors */ }
}

function loadChats() {
  try {
    const raw = localStorage.getItem("aichat_chats");
    if (raw) chats = JSON.parse(raw);
    const savedActive = localStorage.getItem("aichat_active");
    if (savedActive && chats.find(c => c.id === savedActive)) {
      activeChatId = savedActive;
    }
  } catch (e) { chats = []; }
}

/* =====================================================================
   CHAT THREAD MANAGEMENT
   ===================================================================== */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createNewChat() {
  const id = generateId();
  const chat = { id, name: "New Chat", messages: [] };
  chats.unshift(chat);
  activeChatId = id;
  renderSidebar();
  renderMessages();
  saveChats();
  userInput.focus();
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId) || null;
}

function switchChat(id) {
  activeChatId = id;
  renderSidebar();
  renderMessages();
  saveChats();
  closeSidebar();
}

function deleteChat(id) {
  chats = chats.filter(c => c.id !== id);
  if (activeChatId === id) {
    activeChatId = chats.length > 0 ? chats[0].id : null;
  }
  renderSidebar();
  renderMessages();
  saveChats();
}

function renameChat(id, newName) {
  const chat = chats.find(c => c.id === id);
  if (chat) {
    chat.name = newName.trim() || "Untitled Chat";
    renderSidebar();
    if (activeChatId === id) topbarTitle.textContent = chat.name;
    saveChats();
  }
}

function autoNameChat(chat, firstUserMsg) {
  if (chat.name === "New Chat" && firstUserMsg) {
    chat.name = firstUserMsg.slice(0, 40) + (firstUserMsg.length > 40 ? "…" : "");
    renderSidebar();
    if (activeChatId === chat.id) topbarTitle.textContent = chat.name;
    saveChats();
  }
}

/* =====================================================================
   SIDEBAR RENDER
   ===================================================================== */
function renderSidebar() {
  chatList.innerHTML = "";
  if (chats.length === 0) {
    chatList.innerHTML = `<div style="padding:16px;font-size:12px;color:var(--text-sidebar-muted);text-align:center;">No chats yet</div>`;
    return;
  }
  chats.forEach(chat => {
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");
    item.dataset.id = chat.id;

    item.innerHTML = `
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-name">${escapeHtml(chat.name)}</span>
      <span class="chat-item-actions">
        <button class="chat-item-action-btn rename-btn" title="Rename">✏️</button>
        <button class="chat-item-action-btn delete delete-btn" title="Delete">🗑️</button>
      </span>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".chat-item-actions")) return;
      switchChat(chat.id);
    });

    item.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${chat.name}"?`)) deleteChat(chat.id);
    });

    item.querySelector(".rename-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      startRenameInline(item, chat);
    });

    chatList.appendChild(item);
  });
}

function startRenameInline(item, chat) {
  const nameEl = item.querySelector(".chat-item-name");
  const actionsEl = item.querySelector(".chat-item-actions");
  const input = document.createElement("input");
  input.className = "chat-item-rename-input";
  input.value = chat.name;
  nameEl.replaceWith(input);
  actionsEl.style.display = "none";
  input.focus();
  input.select();

  const commit = () => {
    renameChat(chat.id, input.value);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = chat.name; input.blur(); }
  });
}

/* =====================================================================
   MESSAGES RENDER
   ===================================================================== */
function renderMessages() {
  const chat = getActiveChat();
  topbarTitle.textContent = chat ? chat.name : "New Chat";

  // Remove all message rows (keep typing indicator and welcome)
  const rows = messagesContainer.querySelectorAll(".message-row");
  rows.forEach(r => r.remove());

  if (!chat || chat.messages.length === 0) {
    welcomeEl.style.display = "flex";
    typingIndicator.remove && typingIndicator.remove();
    messagesContainer.appendChild(typingIndicator);
    return;
  }

  welcomeEl.style.display = "none";

  chat.messages.forEach((msg, idx) => {
    const row = buildMessageRow(msg, idx);
    messagesContainer.insertBefore(row, typingIndicator);
  });

  scrollToBottom();
}

function buildMessageRow(msg, idx) {
  const row = document.createElement("div");
  row.className = `message-row ${msg.role}`;
  row.dataset.idx = idx;

  // Role label
  const label = document.createElement("div");
  label.className = "message-role-label";
  label.textContent = msg.role === "user" ? "You" : "AI";
  row.appendChild(label);

  // File attachment preview (if any)
  if (msg.hasAttachment && msg.attachmentName) {
    const att = document.createElement("div");
    att.className = "file-attachment";
    const isImg = msg.attachmentType && msg.attachmentType.startsWith("image/");
    if (isImg && msg.attachmentPreviewUrl) {
      att.innerHTML = `<img src="${msg.attachmentPreviewUrl}" alt="${escapeHtml(msg.attachmentName)}" /><div class="file-attachment-info"><div class="file-attachment-name">${escapeHtml(msg.attachmentName)}</div></div>`;
    } else {
      att.innerHTML = `<span class="file-attachment-icon">${fileTypeIcon(msg.attachmentName)}</span><div class="file-attachment-info"><div class="file-attachment-name">${escapeHtml(msg.attachmentName)}</div></div>`;
    }
    row.appendChild(att);
  }

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = "message-bubble" + (msg.isError ? " error-bubble" : "");

  if (msg.role === "assistant" && !msg.isError) {
    bubble.innerHTML = renderMarkdown(msg.content);
    highlightCodeBlocks(bubble);
    addCopyButtons(bubble);
  } else {
    bubble.innerHTML = `<p>${escapeHtml(msg.content)}</p>`;
  }
  row.appendChild(bubble);

  // Actions
  const actions = document.createElement("div");
  actions.className = "message-actions";

  if (msg.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-action-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editUserMessage(idx, bubble, row));
    actions.appendChild(editBtn);
  }

  if (msg.role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.textContent = "Regenerate";
    regenBtn.addEventListener("click", () => regenerateMessage(idx));
    actions.appendChild(regenBtn);

    if (msg.isError) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "msg-action-btn retry";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => retryLastMessage());
      actions.appendChild(retryBtn);
    }
  }

  row.appendChild(actions);
  return row;
}

function appendMessageRow(msg, idx) {
  welcomeEl.style.display = "none";
  const row = buildMessageRow(msg, idx);
  messagesContainer.insertBefore(row, typingIndicator);
  scrollToBottom();
  return row;
}

/* =====================================================================
   MARKDOWN + SYNTAX HIGHLIGHTING
   ===================================================================== */
function renderMarkdown(text) {
  if (typeof marked === "undefined") return `<p>${escapeHtml(text)}</p>`;
  try {
    return marked.parse(text);
  } catch (e) {
    return `<p>${escapeHtml(text)}</p>`;
  }
}

function highlightCodeBlocks(container) {
  if (typeof hljs === "undefined") return;
  container.querySelectorAll("pre code").forEach(block => {
    hljs.highlightElement(block);
  });
}

function addCopyButtons(container) {
  container.querySelectorAll("pre").forEach(pre => {
    // Wrap in a relative container
    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";

    // Detect language from class
    const codeEl = pre.querySelector("code");
    let lang = "";
    if (codeEl) {
      const cls = [...codeEl.classList].find(c => c.startsWith("language-") || c.startsWith("hljs-"));
      if (cls) lang = cls.replace("language-", "").replace("hljs-", "");
    }

    const header = document.createElement("div");
    header.className = "code-block-header";
    header.innerHTML = `<span>${escapeHtml(lang || "code")}</span>`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "code-copy-btn";
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;

    copyBtn.addEventListener("click", () => {
      const code = codeEl ? codeEl.textContent : pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "✓ Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
          copyBtn.classList.remove("copied");
        }, 2000);
      }).catch(() => {
        copyBtn.textContent = "Error";
      });
    });

    header.appendChild(copyBtn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

/* =====================================================================
   FILE HANDLING
   ===================================================================== */
function fileTypeIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const icons = {
    pdf: "📄", docx: "📝", doc: "📝",
    txt: "📃", csv: "📊", json: "📋",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️",
  };
  return icons[ext] || "📎";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function attachFile(file) {
  const ALLOWED_TYPES = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf", "text/plain", "text/csv", "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|gif|webp|pdf|txt|csv|json|docx)$/i)) {
    showToast("Unsupported file type.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showToast("File too large (max 10 MB).");
    return;
  }

  const info = { file, type: file.type };

  // For images: create object URL for thumbnail
  if (file.type.startsWith("image/")) {
    info.previewUrl = URL.createObjectURL(file);
  }

  // For text-based files: read text content
  if (["text/plain", "text/csv", "application/json"].includes(file.type) ||
      file.name.endsWith(".txt") || file.name.endsWith(".csv") || file.name.endsWith(".json")) {
    try {
      info.text = await readFileText(file);
    } catch (e) {
      info.text = "";
    }
  }

  attachedFile = info;
  showFilePreview();
}

function showFilePreview() {
  if (!attachedFile) return;
  filePreviewBar.classList.add("visible");

  if (attachedFile.previewUrl) {
    filePreviewThumb.src = attachedFile.previewUrl;
    filePreviewThumb.style.display = "block";
    filePreviewIcon.style.display = "none";
  } else {
    filePreviewIcon.textContent = fileTypeIcon(attachedFile.file.name);
    filePreviewIcon.style.display = "inline";
    filePreviewThumb.style.display = "none";
  }

  filePreviewName.textContent = `${attachedFile.file.name} (${formatFileSize(attachedFile.file.size)})`;
}

function clearAttachedFile() {
  if (attachedFile?.previewUrl) URL.revokeObjectURL(attachedFile.previewUrl);
  attachedFile = null;
  fileInput.value = "";
  filePreviewBar.classList.remove("visible");
  filePreviewThumb.style.display = "none";
  filePreviewThumb.src = "";
  filePreviewIcon.style.display = "none";
}

/* =====================================================================
   SEND MESSAGE
   ===================================================================== */
async function sendMessage() {
  const text = userInput.value.trim();
  if ((!text && !attachedFile) || isProcessing) return;

  // Ensure active chat
  if (!activeChatId) createNewChat();
  const chat = getActiveChat();

  // Auto-name chat after first user message
  if (chat.messages.filter(m => m.role === "user").length === 0 && text) {
    autoNameChat(chat, text);
  }

  // Build user message object
  const userMsg = {
    role: "user",
    content: text || (attachedFile ? `[Attached: ${attachedFile.file.name}]` : ""),
    hasAttachment: !!attachedFile,
    attachmentName: attachedFile ? attachedFile.file.name : null,
    attachmentType: attachedFile ? attachedFile.type : null,
    attachmentPreviewUrl: attachedFile ? attachedFile.previewUrl : null,
  };

  chat.messages.push(userMsg);
  const userIdx = chat.messages.length - 1;
  appendMessageRow(userMsg, userIdx);

  // Capture file info before clearing
  const fileToSend = attachedFile ? { ...attachedFile } : null;
  clearAttachedFile();

  // Reset input
  userInput.value = "";
  userInput.style.height = "auto";

  // Save retry payload
  retryPayload = {
    chat,
    fileToSend,
    messages: [...chat.messages],
  };

  await performAIRequest(chat, fileToSend);
}

async function performAIRequest(chat, fileToSend) {
  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  typingIndicator.classList.add("visible");
  scrollToBottom();

  // Placeholder assistant row for streaming
  const assistantMsgObj = { role: "assistant", content: "", isError: false };
  chat.messages.push(assistantMsgObj);
  const assistantIdx = chat.messages.length - 1;

  const assistantRow = document.createElement("div");
  assistantRow.className = "message-row assistant";

  const label = document.createElement("div");
  label.className = "message-role-label";
  label.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = `<span class="streaming-cursor">▋</span>`;

  assistantRow.appendChild(label);
  assistantRow.appendChild(bubble);
  messagesContainer.insertBefore(assistantRow, typingIndicator);
  scrollToBottom();

  try {
    let response;

    if (fileToSend) {
      // Use file endpoint
      const formData = new FormData();
      // Send only text messages to the backend (strip attachment metadata)
      const msgPayload = chat.messages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content,
      }));
      formData.append("messages", JSON.stringify(msgPayload));
      formData.append("fileType", fileToSend.type || "");
      if (fileToSend.text) formData.append("fileText", fileToSend.text);
      if (fileToSend.file) formData.append("file", fileToSend.file);

      response = await fetch("/api/chat-with-file", {
        method: "POST",
        body: formData,
      });
    } else {
      // Plain text chat
      const msgPayload = chat.messages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content,
      }));
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgPayload }),
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Server error ${response.status}${errBody ? ": " + errBody : ""}`);
    }
    if (!response.body) throw new Error("Empty response");

    // Stream SSE
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    const flushBubble = () => {
      bubble.innerHTML = renderMarkdown(fullText) + `<span class="streaming-cursor">▋</span>`;
      highlightCodeBlocks(bubble);
      scrollToBottom();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush remaining
        const parsed = consumeSseEvents(buffer + "\n\n");
        for (const data of parsed.events) {
          if (data === "[DONE]") break;
          try {
            const json = JSON.parse(data);
            const chunk = extractChunk(json);
            if (chunk) { fullText += chunk; flushBubble(); }
          } catch (e) { /* ignore */ }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseEvents(buffer);
      buffer = parsed.buffer;

      let sawDone = false;
      for (const data of parsed.events) {
        if (data === "[DONE]") { sawDone = true; break; }
        try {
          const json = JSON.parse(data);
          const chunk = extractChunk(json);
          if (chunk) { fullText += chunk; flushBubble(); }
        } catch (e) { /* ignore */ }
      }
      if (sawDone) break;
    }

    // Final render without cursor
    assistantMsgObj.content = fullText || "(No response)";
    bubble.innerHTML = renderMarkdown(assistantMsgObj.content);
    highlightCodeBlocks(bubble);
    addCopyButtons(bubble);

    // Add actions to row
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.textContent = "Regenerate";
    regenBtn.addEventListener("click", () => regenerateMessage(assistantIdx));
    actions.appendChild(regenBtn);
    assistantRow.appendChild(actions);

  } catch (err) {
    console.error("Chat error:", err);

    // Check if it's a network/connectivity error
    const isNetwork = err.message.includes("fetch") || err.message.includes("network") ||
                      err.message.includes("Failed to fetch") || !navigator.onLine;

    const errorText = isNetwork
      ? "Network error — check your connection."
      : `Error: ${err.message}`;

    assistantMsgObj.content = errorText;
    assistantMsgObj.isError = true;
    bubble.className = "message-bubble error-bubble";
    bubble.innerHTML = `<p>${escapeHtml(errorText)}</p>`;

    // Add retry button
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.style.display = "flex";
    const retryBtn = document.createElement("button");
    retryBtn.className = "msg-action-btn retry";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => retryLastMessage());
    actions.appendChild(retryBtn);
    assistantRow.appendChild(actions);
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
    saveChats();
    scrollToBottom();
  }
}

function extractChunk(json) {
  if (typeof json.response === "string" && json.response.length > 0) return json.response;
  if (json.choices?.[0]?.delta?.content) return json.choices[0].delta.content;
  return null;
}

/* =====================================================================
   RETRY / REGENERATE / EDIT
   ===================================================================== */
function retryLastMessage() {
  if (isProcessing || !retryPayload) return;
  const { chat, fileToSend } = retryPayload;

  // Remove last assistant message if it was an error
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "assistant") {
    chat.messages.pop();
    const rows = messagesContainer.querySelectorAll(".message-row.assistant");
    if (rows.length > 0) rows[rows.length - 1].remove();
  }

  performAIRequest(chat, fileToSend || null);
}

function regenerateMessage(assistantIdx) {
  if (isProcessing) return;
  const chat = getActiveChat();
  if (!chat) return;

  // Remove the assistant message at assistantIdx and everything after
  chat.messages.splice(assistantIdx);

  // Remove DOM rows from assistantIdx onwards
  const rows = messagesContainer.querySelectorAll(".message-row");
  rows.forEach(row => {
    if (parseInt(row.dataset.idx) >= assistantIdx) row.remove();
  });

  performAIRequest(chat, null);
}

function editUserMessage(idx, bubble, row) {
  if (isProcessing) return;
  const chat = getActiveChat();
  if (!chat) return;

  const originalContent = chat.messages[idx].content;
  const input = document.createElement("textarea");
  input.value = originalContent;
  input.style.cssText = `
    width: 100%; min-height: 60px; background: transparent;
    border: 1px solid var(--border); border-radius: 6px;
    color: var(--user-bubble-text); font-size: var(--font-size);
    font-family: inherit; padding: 6px; resize: vertical; outline: none;
  `;

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save & Send";
  saveBtn.style.cssText = `
    margin-top: 6px; padding: 5px 12px; background: rgba(255,255,255,0.25);
    color: white; border-radius: 6px; font-size: 12px; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.4);
  `;

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = saveBtn.style.cssText + "margin-left:6px;";

  bubble.innerHTML = "";
  bubble.appendChild(input);
  const btnRow = document.createElement("div");
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  bubble.appendChild(btnRow);
  input.focus();

  cancelBtn.addEventListener("click", () => {
    bubble.innerHTML = `<p>${escapeHtml(originalContent)}</p>`;
  });

  saveBtn.addEventListener("click", () => {
    const newContent = input.value.trim();
    if (!newContent) return;
    chat.messages[idx].content = newContent;
    // Remove everything after this user message
    chat.messages.splice(idx + 1);
    const allRows = messagesContainer.querySelectorAll(".message-row");
    allRows.forEach(r => {
      if (parseInt(r.dataset.idx) > idx) r.remove();
    });
    bubble.innerHTML = `<p>${escapeHtml(newContent)}</p>`;
    saveChats();
    performAIRequest(chat, null);
  });
}

/* =====================================================================
   SSE PARSING
   ===================================================================== */
function consumeSseEvents(buffer) {
  let normalized = buffer.replace(/\r/g, "");
  const events = [];
  let idx;
  while ((idx = normalized.indexOf("\n\n")) !== -1) {
    const raw = normalized.slice(0, idx);
    normalized = normalized.slice(idx + 2);
    const dataLines = raw.split("\n")
      .filter(l => l.startsWith("data:"))
      .map(l => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    events.push(dataLines.join("\n"));
  }
  return { events, buffer: normalized };
}

/* =====================================================================
   THEME
   ===================================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("aichat_theme", theme);

  // Update highlight.js stylesheet
  const hlTheme = document.getElementById("hljs-theme");
  if (hlTheme) {
    hlTheme.href = theme === "dark"
      ? "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css"
      : "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css";
  }

  // Update theme icons
  if (theme === "dark") {
    themeIconSun.classList.add("hidden");
    themeIconMoon.classList.remove("hidden");
  } else {
    themeIconSun.classList.remove("hidden");
    themeIconMoon.classList.add("hidden");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
}

function initTheme() {
  const saved = localStorage.getItem("aichat_theme");
  if (saved) {
    applyTheme(saved);
  } else {
    // Auto-sync with system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
    if (!localStorage.getItem("aichat_theme")) {
      applyTheme(e.matches ? "dark" : "light");
    }
  });
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function initSettings() {
  // Font size
  const savedSize = localStorage.getItem("aichat_fontsize") || "15";
  fontSizeSlider.value = savedSize;
  fontSizeLabel.textContent = savedSize;
  document.documentElement.style.setProperty("--font-size", savedSize + "px");

  fontSizeSlider.addEventListener("input", () => {
    const size = fontSizeSlider.value;
    fontSizeLabel.textContent = size;
    document.documentElement.style.setProperty("--font-size", size + "px");
    localStorage.setItem("aichat_fontsize", size);
  });

  // Enter to send
  const savedEnter = localStorage.getItem("aichat_enter_send");
  if (savedEnter === "false") enterToSendToggle.checked = false;

  enterToSendToggle.addEventListener("change", () => {
    localStorage.setItem("aichat_enter_send", enterToSendToggle.checked);
    updateInputHint();
  });
}

function updateInputHint() {
  inputHint.textContent = enterToSendToggle.checked
    ? "Enter to send · Shift+Enter for new line"
    : "Shift+Enter to send · Enter for new line";
}

/* =====================================================================
   SCROLL
   ===================================================================== */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* =====================================================================
   UTILITIES
   ===================================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #1f2937; color: white; padding: 10px 20px;
    border-radius: 8px; font-size: 13px; z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: fadeIn 0.2s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* =====================================================================
   SIDEBAR (MOBILE)
   ===================================================================== */
function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("visible");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("visible");
}

/* =====================================================================
   EVENT LISTENERS
   ===================================================================== */

// Send
sendButton.addEventListener("click", sendMessage);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const sendOnEnter = enterToSendToggle.checked;
    if (sendOnEnter && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (!sendOnEnter && e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
});

// Auto-resize textarea
userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 160) + "px";
});

// File attach button
attachBtn.addEventListener("click", () => fileInput.click());
fileClearBtn.addEventListener("click", clearAttachedFile);

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await attachFile(file);
});

// Drag & drop
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropOverlay.classList.add("visible");
});
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null || !document.body.contains(e.relatedTarget)) {
    dropOverlay.classList.remove("visible");
  }
});
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropOverlay.classList.remove("visible");
  const file = e.dataTransfer?.files[0];
  if (file) await attachFile(file);
});

// Theme
themeToggle.addEventListener("click", toggleTheme);

// Settings panel
settingsToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle("visible");
});
document.addEventListener("click", (e) => {
  if (!settingsPanel.contains(e.target) && e.target !== settingsToggle) {
    settingsPanel.classList.remove("visible");
  }
});

// New chat
newChatBtn.addEventListener("click", createNewChat);

// Sidebar mobile toggle
menuToggle.addEventListener("click", openSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);

/* =====================================================================
   INIT
   ===================================================================== */
function init() {
  initTheme();
  initSettings();
  loadChats();

  if (chats.length === 0) {
    // Start fresh — don't auto-create, show welcome
    renderSidebar();
    topbarTitle.textContent = "New Chat";
    welcomeEl.style.display = "flex";
  } else {
    if (!activeChatId) activeChatId = chats[0].id;
    renderSidebar();
    renderMessages();
  }

  updateInputHint();
}

init();
