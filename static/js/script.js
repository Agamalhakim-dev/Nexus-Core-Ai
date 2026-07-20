let currentSessionId = null;
let pendingFiles = [];
let currentModel = "default";
let isWebSearchEnabled = false;
let currentPersona = "standard";

// Konfigurasi Custom Renderer untuk Marked.js (Canvas Kode)
const renderer = new marked.Renderer();
renderer.code = function(code, language) {
    const validLang = !!(language && hljs.getLanguage(language));
    const langLabel = validLang ? language : 'Code';
    const highlighted = validLang ? hljs.highlight(code, { language }).value : hljs.highlightAuto(code).value;
    
    // Generate ID unik untuk fungsi copy
    const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
    
    return `
    <div class="code-canvas">
        <div class="code-header">
            <span class="code-lang">${langLabel}</span>
            <button class="copy-btn" onclick="copyCodeToClipboard('${codeId}', this)">
                <i class="fa-regular fa-copy"></i> Copy
            </button>
        </div>
        <pre><code id="${codeId}" class="hljs ${language}">${highlighted}</code></pre>
    </div>
    `;
};
marked.setOptions({
    renderer: renderer,
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    }
});

// Fungsi untuk menyalin kode
window.copyCodeToClipboard = function(codeId, btnElement) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    // Fallback copy approach
    const textArea = document.createElement("textarea");
    textArea.value = codeElement.innerText || codeElement.textContent;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        const originalText = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        btnElement.classList.add('copied');
        setTimeout(() => {
            btnElement.innerHTML = originalText;
            btnElement.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy', err);
    }
    document.body.removeChild(textArea);
};

// Toggle Model Menu
function toggleModelMenu() {
    const menu = document.getElementById("model-menu");
    const btn = document.getElementById("model-selector-btn");
    if (menu) {
        menu.classList.toggle("hidden");
        if(btn) btn.classList.toggle("open");
    }
}

// Select Model
function selectModel(modelId, modelName, element) {
    currentModel = modelId;
    document.getElementById("current-model-text").innerText = modelName;
    
    // Update active state in UI
    const options = document.querySelectorAll(".model-option");
    options.forEach(opt => opt.classList.remove("active"));
    
    // Find the clicked option and set active
    if (element) {
        element.classList.add("active");
    }
    
    // Hide menu
    document.getElementById("model-menu").classList.add("hidden");
    const btn = document.getElementById("model-selector-btn");
    if(btn) btn.classList.remove("open");
}

// Close model menu when clicking outside
document.addEventListener("click", function(e) {
    const container = document.querySelector(".model-selector-container");
    const menu = document.getElementById("model-menu");
    if (container && !container.contains(e.target) && menu && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
        const btn = document.getElementById("model-selector-btn");
        if(btn) btn.classList.remove("open");
    }
});

// Konfigurasi Worker untuk PDF.js
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Fungsi untuk mengekstrak teks dari PDF
async function extractTextFromPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
        let fullText = '';
        
        // Batasan aman jumlah halaman agar tidak terlalu berat
        const maxPages = Math.min(pdf.numPages, 100); 
        
        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
            
            // Potong teks jika sudah melebihi 100.000 karakter (kira-kira 30.000 kata)
            if (fullText.length > 100000) {
                fullText = fullText.substring(0, 100000) + '\n\n[...Teks PDF dipotong karena terlalu panjang untuk mesin AI...]';
                break;
            }
        }
        
        return fullText;
    } catch (error) {
        console.error('Error saat membaca PDF:', error);
        throw new Error('Gagal mengekstrak teks dari PDF. File mungkin rusak atau dilindungi password.');
    }
}

// Fungsi untuk memproses array file
function processFiles(files) {
    // Batas aman untuk LLM: maksimal 100KB per file teks (agar total token tidak jebol)
    const MAX_TEXT_SIZE = 100 * 1024; // 100KB
    
    files.forEach(async file => {
        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');
        
        // Cek ukuran, lewati jika bukan gambar/PDF dan terlalu besar
        if (!isImage && !isPDF && file.size > MAX_TEXT_SIZE) {
            console.warn(`File ${file.name} dilewati karena melebihi batas 100KB.`);
            alert(`File teks ${file.name} terlalu besar (Max 100KB per file).`);
            return;
        }
        
        // Jika file adalah PDF, gunakan pdf.js
        if (isPDF) {
            try {
                // Tampilkan loading (opsional)
                const text = await extractTextFromPDF(file);
                pendingFiles.push({
                    name: file.name,
                    content: text,
                    is_image: false,
                    is_pdf: true,
                    type: file.type || 'application/pdf'
                });
                renderFilePreview();
            } catch (error) {
                alert(error.message);
            }
            return; // Selesai untuk file ini
        }
        
        // Logika aslinya untuk gambar dan teks biasa
        const reader = new FileReader();
        reader.onload = function(event) {
            pendingFiles.push({
                name: file.name,
                content: event.target.result,
                is_image: isImage,
                type: file.type || (isImage ? 'image/jpeg' : 'text/plain')
                is_pdf: false
            });
            renderFilePreview();
        };
        reader.onerror = function() {
            alert(`Gagal membaca file ${file.name}`);
        };
        
        if (isImage) {
            reader.readAsDataURL(file); // Format Base64 untuk gambar
        } else {
            reader.readAsText(file); // Teks mentah
        }
    });
}

// Handle file selection manual via tombol +
document.getElementById('file-upload').addEventListener('change', function(e) {
    processFiles(Array.from(e.target.files));
    e.target.value = ''; // Reset input
});

// ==========================================
// SETUP DRAG AND DROP FILE & FOLDER
// ==========================================
const dropZone = document.querySelector('.main-content');

// Cegah aksi default browser saat men-drag file
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Tampilkan efek visual saat file di-drag ke area chat
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-highlight'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-highlight'), false);
});

// Tangani saat file di-drop
dropZone.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const items = e.dataTransfer.items;
    
    // Jika browser mendukung dataTransfer.items (mendukung deteksi folder)
    if (items) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry) {
                    scanFiles(entry);
                } else {
                    // Fallback jika tidak ada webkitGetAsEntry
                    processFiles([item.getAsFile()]);
                }
            }
        }
    } else {
        // Fallback untuk browser lawas (hanya file, bukan folder)
        processFiles(Array.from(e.dataTransfer.files));
    }
}

// Fungsi rekursif untuk membaca isi folder
function scanFiles(item) {
    if (item.isFile) {
        item.file(file => {
            // Saring file sistem yang tersembunyi seperti .DS_Store
            if (!file.name.startsWith('.')) {
                processFiles([file]);
            }
        });
    } else if (item.isDirectory) {
        // Abaikan folder-folder berat yang tidak relevan untuk AI
        const ignoredFolders = ['node_modules', '.git', 'venv', 'env', '__pycache__', 'dist', 'build', '.next', 'out'];
        if (ignoredFolders.includes(item.name)) {
            console.log("Folder diabaikan: " + item.name);
            return;
        }
        
        const dirReader = item.createReader();
        dirReader.readEntries(entries => {
            entries.forEach(entry => {
                scanFiles(entry);
            });
        });
    }
}

function renderFilePreview() {
    const container = document.getElementById('file-preview-container');
    if (pendingFiles.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = pendingFiles.map((f, index) => {
        let icon = '<i class="fa-regular fa-file-lines"></i>';
        if (f.is_image) icon = '<i class="fa-regular fa-image"></i>';
        else if (f.is_pdf) icon = '<i class="fa-solid fa-file-pdf" style="color: #e25555;"></i>';
        
        let previewContent;
        if (f.is_image) {
            previewContent = `<img src="${f.content}" class="file-preview-image" alt="${f.name}">`;
        } else if (f.is_pdf) {
            previewContent = '<i class="fa-solid fa-file-pdf" style="color: #e25555; font-size: 2rem;"></i>';
        } else {
            previewContent = '<i class="fa-regular fa-file-lines" style="font-size: 2rem;"></i>';
        }

        return `
        <div class="file-item">
            ${icon}
            <div class="file-item-info">
                <span class="file-item-name" title="${f.name}">${f.name}</span>
            </div>
            <button class="remove-file-btn" onclick="removeFile(${index})" title="Hapus lampiran">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>`;
    }).join('');
}

function removeFile(index) {
    pendingFiles.splice(index, 1);
    renderFilePreview();
}

function isMobileView() {
    return window.innerWidth <= 768;
}

function openSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.add('show');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');

    if (isMobileView()) {
        if (sidebar.classList.contains('show')) {
            closeSidebarMobile();
        } else {
            openSidebarMobile();
        }
    } else {
        // Desktop: toggle collapsed
        sidebar.classList.toggle('collapsed');
    }
}

// Swipe gesture untuk HP
(function () {
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
        if (!isMobileView()) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        const sidebar = document.getElementById('sidebar');

        // Swipe horizontal (bukan vertikal)
        if (dy > 50) return;

        // Swipe kiri → tutup sidebar
        if (dx < -60 && sidebar.classList.contains('show')) {
            closeSidebarMobile();
        }
        // Swipe kanan dari pojok kiri layar → buka sidebar
        if (dx > 60 && touchStartX < 40 && !sidebar.classList.contains('show')) {
            openSidebarMobile();
        }
    }, { passive: true });
})();

function toggleAboutAI() {
    const overlay = document.getElementById('about-overlay');
    overlay.classList.toggle('hidden');
}

let hasPastSessions = false;

function loadSessions(autoLoad = false) {
    fetch("/api/sessions")
        .then(response => response.json())
        .then(sessions => {
            const list = document.getElementById("session-list");
            if (sessions.length === 0) {
                hasPastSessions = false;
                list.innerHTML = '<div style="color:var(--text-secondary); text-align:center; margin-top:24px; font-size: 0.85rem; font-family: Poppins, sans-serif;">Belum ada riwayat</div>';
            } else {
                hasPastSessions = true;
                list.innerHTML = sessions.map(s => {
                    const isActive = s.id === currentSessionId ? 'active' : '';
                    return `
                    <div class="session-item ${isActive}" onclick='loadChat(${JSON.stringify(s.id)})'>
                        <i class="fa-regular fa-message session-icon"></i>
                        <span class="session-title" id="stitle-${s.id}">${s.title}</span>
                        <button class="session-menu-btn" onclick='openSessionMenu(event, ${JSON.stringify(s.id)})' title="Opsi">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                    </div>`;
                }).join("");
            }
        })
        .catch(error => console.error("Error loading sessions:", error));
}

function createNewSession() {
    // Jangan hentikan proses AI di latar belakang, cukup putuskan UI dari proses lama.
    // Jangan hentikan proses AI di latar belakang, cukup bersihkan UI.
    document.getElementById("typing-indicator").classList.add("hidden");
    document.querySelectorAll('.streaming-bubble').forEach(el => el.remove());
    const icon = document.getElementById("action-icon");
    if (icon) {
        icon.className = "fa-solid fa-arrow-right";
    }
    currentAbortController = null; // Putuskan koneksi tombol stop dari proses lama.

    savedPrompt = ""; // Hapus prompt lama agar tidak muncul di sesi lain
    currentSessionId = null;
    
    // Kosongkan kolom input pesan secara paksa
    const inputField = document.getElementById("message-input");
    if (inputField) {
        inputField.value = "";
        inputField.style.height = "auto";
    }
    
    // Kosongkan layar chat
    document.getElementById("chat-messages").innerHTML = "";
    
    // Tampilkan sapaan otomatis layaknya pesan dari AI
    let firstName = "User";
    if (typeof CURRENT_USER_NAME !== 'undefined' && CURRENT_USER_NAME) {
        firstName = CURRENT_USER_NAME.split(" ")[0].toLowerCase();
    }
    
    let greetingText = "";
    if (hasPastSessions) {
        greetingText = `Hallo... welcome back ${firstName}...`;
    } else {
        greetingText = `Hallo... welcome di Nexuscore AI`;
    }
    
    // Tampilkan sapaan di tengah layar (Empty State ala Gemini)
    document.getElementById("chat-messages").innerHTML = `
        <div class="empty-state-greeting">
            <h1>${greetingText}</h1>
        </div>
    `;
    
    // Load session list, tapi JANGAN otomatis load obrolan terakhir
    loadSessions(false);
    
    if (window.innerWidth <= 768) {
        toggleSidebar();
    }
}

function deleteSession(sessionId) {
    fetch(`/api/sessions/${sessionId}`, { method: "DELETE" })
        .then(() => {
            if (currentSessionId === sessionId) {
                createNewSession();
            } else {
                loadSessions();
            }
        });
}

// ── Context Menu (titik tiga) ──────────────────────────
let activeContextMenu = null;

function openSessionMenu(event, sessionId) {
    event.stopPropagation();
    closeAllMenus();

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'session-context-menu';
    menu.id = 'session-ctx-' + sessionId;
    menu.innerHTML = `
        <button onclick="startRename(event, '${sessionId}')">
            <i class="fa-solid fa-pencil" style="color:var(--accent-color)"></i> Edit
        </button>
        <button class="danger" onclick="confirmDelete(event, '${sessionId}')">
            <i class="fa-solid fa-trash"></i> Hapus
        </button>`;

    // Posisikan menu di bawah tombol, cegah keluar layar
    menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - 120) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';

    document.body.appendChild(menu);
    activeContextMenu = menu;
}

function closeAllMenus() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}

document.addEventListener('click', closeAllMenus);

function confirmDelete(event, sessionId) {
    event.stopPropagation();
    closeAllMenus();
    deleteSession(sessionId);
}

function startRename(event, sessionId) {
    event.stopPropagation();
    closeAllMenus();

    const titleEl = document.getElementById('stitle-' + sessionId);
    if (!titleEl) return;

    const currentTitle = titleEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'session-rename-input';

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
        const newTitle = input.value.trim() || currentTitle;
        // Ganti balik dengan span
        const span = document.createElement('span');
        span.className = 'session-title';
        span.id = 'stitle-' + sessionId;
        span.textContent = newTitle;
        input.replaceWith(span);

        if (newTitle !== currentTitle) {
            fetch(`/api/sessions/${sessionId}/rename`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
        }
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    });
}

let activeNotifications = {};

function loadChat(sessionId) {
    if (currentSessionId === sessionId) {
        if (isMobileView()) closeSidebarMobile();
        removeNotificationForSession(sessionId); // Tetap hapus notifikasi jika ada
        return;
    }
    document.getElementById("typing-indicator").classList.add("hidden");
    document.querySelectorAll('.streaming-bubble').forEach(el => el.remove());
    const icon = document.getElementById("action-icon");
    if (icon) icon.className = "fa-solid fa-arrow-right";
    currentAbortController = null; // Putuskan koneksi tombol stop dari proses lama.
    removeNotificationForSession(sessionId);

    currentSessionId = sessionId;
    loadSessions();
    
    fetch(`/api/sessions/${sessionId}`)
        .then(response => response.json())
        .then(session => {
            const messagesContainer = document.getElementById("chat-messages");
            messagesContainer.innerHTML = "";
            
            session.messages.forEach((msg, index) => { 
                if (msg.role === 'assistant') {
                    const text = marked.parse(msg.content);
                    displayMessage(text, 'assistant', true, msg.content, null, index);
                } else { // role 'user'
                    const attachments = { images: msg.images || [] };
                    displayMessage(msg.content, 'user', false, msg.content, attachments, index);
                }
            });
            
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
}

let savedPrompt = "";

function handleActionBtn() {
    if (currentAbortController) {
        stopGeneration();
    } else {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById("message-input");
    const sessionIdForThisRequest = currentSessionId; // Simpan ID sesi saat ini untuk referensi nanti
    const rawMessage = input.value.trim();
    
    if (!rawMessage && pendingFiles.length === 0) return;
    
    savedPrompt = rawMessage;
    const inputField = document.getElementById("message-input");
    if (inputField) {
        inputField.value = "";
        inputField.style.height = "auto";
    }
    const greetingEl = document.querySelector('.empty-state-greeting');
    if (greetingEl) {
        greetingEl.remove();
    }
    
    // Gabungkan pesan user dengan konten file jika ada lampiran
    let combinedMessage = rawMessage;
    let uiDisplayMessage = rawMessage;
    let imagesPayload = [];
    
    if (pendingFiles.length > 0) {
        let fileContexts = "";
        
        pendingFiles.forEach(f => {
            if (f.is_image) {
                imagesPayload.push({
                    name: f.name,
                    type: f.type,
                    data: f.content
                });
            } else {
                fileContexts += `\n[SISTEM: Pengguna melampirkan file bernama "${f.name}" (Jenis: ${f.type})]\nIsi File:\n${f.content}\n--- Akhir Isi File ---\n`;
            }
        });
        
        if (fileContexts) {
            if (rawMessage) {
                 combinedMessage = `${rawMessage}\n\nBerikut adalah lampiran file teks terkait:\n${fileContexts}`;
            } else {
                 combinedMessage = `Tolong analisis file teks berikut:\n${fileContexts}`;
            }
        }
        
        // Buat pesan UI
        if (rawMessage) {
             uiDisplayMessage = `${rawMessage}\n\n📄 [Melampirkan ${pendingFiles.length} file]`;
        } else {
             uiDisplayMessage = `📄 [Mengirim ${pendingFiles.length} file]`;
             if (!fileContexts && imagesPayload.length > 0) {
                 combinedMessage = "Tolong analisis gambar ini.";
             }
        }
    }
    
    // Tampilkan pesan pengguna dengan lampiran (jika ada)
    const attachments = { images: imagesPayload };
    displayMessage(uiDisplayMessage, "user", false, rawMessage, attachments);
    
    input.value = "";
    input.style.height = "auto"; // Reset tinggi textarea setelah dikirim
    
    // Kosongkan lampiran setelah dikirim
    pendingFiles = [];
    renderFilePreview();
    
    const typingIndicator = document.getElementById("typing-indicator");
    typingIndicator.classList.remove("hidden");
    
    const messagesContainer = document.getElementById("chat-messages");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    const payload = { 
        message: combinedMessage,
        ui_message: uiDisplayMessage,
        raw_query: rawMessage,
        images: imagesPayload,
        model: currentModel,
        web_search: isWebSearchEnabled,
        persona: currentPersona
    };
    
    if (currentSessionId) {
        payload.session_id = currentSessionId;
    }
    
    // Setup bubble untuk streaming
    const messageDiv = document.createElement("div");
    messageDiv.className = `message assistant`;
    const textDiv = document.createElement("div"); // Bubble sementara untuk streaming
    textDiv.className = "text";
    messageDiv.appendChild(textDiv);
    messagesContainer.appendChild(messageDiv);
    
    const icon = document.getElementById("action-icon");
    if (icon) {
        icon.className = "fa-solid fa-square";
        messageDiv.classList.add("streaming-bubble");
    }
    
    currentAbortController = new AbortController();
    
    let fullContent = "";
    let lastRenderTime = 0;

    fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: currentAbortController.signal
    })
    .then(async response => {
        if (response.status === 403) {
            triggerBanAlarm();
            return;
        }
        if (!response.ok) {
            const text = await response.text();
            console.error("Server Error:", text);
            textDiv.innerHTML = `<span style="color:red">Server Error ${response.status}: ${text}</span>`;
            typingIndicator.classList.add("hidden");
            const icon = document.getElementById("action-icon");
            if (icon) icon.className = "fa-solid fa-arrow-right";
            return;
        }
        
        typingIndicator.classList.add("hidden");
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunkStr = decoder.decode(value, { stream: true });
            const lines = chunkStr.split("\n");
            
            for (let line of lines) {
                if (line.startsWith("data: ")) {
                    const dataStr = line.replace("data: ", "");
                    try {
                        const data = JSON.parse(dataStr);
                        
                        if (data.error) {
                            textDiv.innerHTML = `<span style="color:red">Error: ${data.error}</span>`;
                            return;
                        }
                        
                        if (data.text) {
                            fullContent += data.text;
                            
                            // Hanya render jika pengguna masih di obrolan yang sama
                            if (sessionIdForThisRequest === currentSessionId) {
                                const now = Date.now();
                                if (now - lastRenderTime > 50) { // Throttle render
                                    textDiv.innerHTML = marked.parse(fullContent);
                                    lastRenderTime = now;
                                }
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            }
                        }
                        
                        if (data.done) {
                            // Reset abort controller
                            currentAbortController = null;
                            const icon = document.getElementById("action-icon");
                            if (icon) icon.className = "fa-solid fa-arrow-right";

                            // Jika pengguna masih di obrolan yang sama
                            if (sessionIdForThisRequest === currentSessionId) {
                                if (!currentSessionId && data.session_id) {
                                    currentSessionId = data.session_id;
                                }
                                messageDiv.remove(); // Hapus bubble streaming sementara
                                displayMessage(marked.parse(fullContent), "assistant", true, fullContent);
                                loadSessions();
                                
                                // Tampilkan notifikasi juga jika tab tidak aktif
                                if (document.hidden) {
                                    showCompletionNotification(data.session_id || currentSessionId, data.title || "Obrolan");
                                }
                            } else {
                                // Jika pengguna sudah pindah obrolan, tampilkan notifikasi
                                showCompletionNotification(data.session_id, data.title);
                                messageDiv.remove();
                                loadSessions(); // Tetap update list di background
                            }
                        }
                    } catch (e) {
                        // Ignore parse errors on incomplete chunks
                    }
                }
            }
        }
    })
    .catch(error => {
        if (error.name === 'AbortError') {
            // Hanya update bubble chat jika pengguna masih di obrolan yang sama
            if (sessionIdForThisRequest === currentSessionId) {
                textDiv.innerHTML = marked.parse(fullContent + "\n\n*[Proses dihentikan oleh pengguna]*");
                // Kembalikan prompt yang disimpan
                const input = document.getElementById("message-input");
                if (input && savedPrompt) {
                    input.value = savedPrompt;
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
                }
            }
            // Jangan lakukan apa-apa lagi, `finally` akan membersihkan state.
        } else {
            messageDiv.remove();
            displayMessage("Error: " + error, "assistant");
        }
    })
    .finally(() => {
        // Bersihkan UI global
        typingIndicator.classList.add("hidden");
        const icon = document.getElementById("action-icon");
        if (icon) {
            icon.className = "fa-solid fa-arrow-right";
        }
        currentAbortController = null;
        
        // Hapus class streaming hanya jika masih di bubble yang sama
        if (sessionIdForThisRequest === currentSessionId) {
            messageDiv.classList.remove("streaming-bubble");
        }
    });
}

let currentAbortController = null;

function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
    }
    const input = document.getElementById("message-input");
    if (input && savedPrompt) {
        input.value = savedPrompt;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    }
}

// Auto-resize textarea setiap kali input berubah
document.addEventListener('DOMContentLoaded', function () {
    const textarea = document.getElementById('message-input');
    if (!textarea) return;
    textarea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });
});

function handleKeyDown(event) {
    const textarea = event.target;

    // Ctrl+A: pilih semua teks
    if (event.ctrlKey && event.key === 'a') {
        // Biarkan browser menangani secara native
        return;
    }

    // Shift+Enter: tambah baris baru
    if (event.key === 'Enter' && event.shiftKey) {
        // Biarkan browser insert newline secara native, lalu resize
        setTimeout(() => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        }, 0);
        return;
    }

    // Enter tanpa Shift: kirim pesan
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }

    // Semua shortcut lain (Ctrl+C, Ctrl+V, Ctrl+Z, dll) dibiarkan native
}


function displayMessage(text, sender, isHtml = false, rawText = "", attachments = null, messageIndex = null) {
    const messagesContainer = document.getElementById("chat-messages");
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${sender}`;
    if (messageIndex !== null) {
        messageDiv.dataset.index = messageIndex;
    }
    
    let innerContent = "";
    let attachmentHTML = '';
    if (sender === 'user' && attachments && attachments.images && attachments.images.length > 0) {
        attachmentHTML += '<div class="message-attachments">';
        attachments.images.forEach(imgData => {
            attachmentHTML += `<img src="${imgData}" class="chat-image-thumbnail" alt="lampiran gambar" onclick="openLightbox(this.src)">`;
        });
        attachmentHTML += '</div>';
    }

    let textHTML = '';
    if (isHtml) {
        textHTML = text;
    } else {
        const div = document.createElement('div');
        div.textContent = text;
        // Konversi newline (\n) menjadi <br> agar rapi
        textHTML = div.innerHTML.replace(/\n/g, '<br>');
    }

    // Untuk pesan user, jangan tampilkan div teks jika tidak ada teks (hanya gambar)
    if (sender === 'user' && (!text || !text.trim())) {
        textHTML = '';
    }

    // Gabungkan lampiran dan teks ke dalam satu bubble
    if (sender === 'user' && messageIndex !== null) {
        innerContent = `
        <div class="text">
            ${attachmentHTML}${textHTML}
            <div class="message-tools">
                <button class="message-tool-btn" onclick="startEditPrompt(${messageIndex})" title="Edit Prompt"><i class="fa-solid fa-pen"></i></button>
                <button class="message-tool-btn" onclick="regenerateResponse(${messageIndex})" title="Ulang Respon AI"><i class="fa-solid fa-rotate-right"></i></button>
            </div>
        </div>`;
    } else {
        innerContent = `<div class="text">${attachmentHTML}${textHTML}</div>`;
    }
    
    // Tambahkan tombol copy khusus untuk pesan AI
    if (sender === "assistant") {
    // Ambil raw text (Markdown asli) jika ada, jika tidak gunakan text
        // Tombol copy hanya perlu teks, bukan lampiran, jadi kita buat ulang innerContent
        innerContent = `<div class="text">${textHTML}</div>`;
        const textToCopy = encodeURIComponent(rawText || text);
        
        // Deteksi fitur [GENERATE_WORD]
        let hasWordTag = false;
        if (innerContent.includes('[GENERATE_WORD]')) {
            innerContent = innerContent.replace('[GENERATE_WORD]', '');
            hasWordTag = true;
        }
        
        // Deteksi fitur [GENERATE_EXCEL]
        let hasExcelTag = false;
        if (innerContent.includes('[GENERATE_EXCEL]')) {
            innerContent = innerContent.replace('[GENERATE_EXCEL]', '');
            hasExcelTag = true;
        }

        innerContent += `
        <div class="action-buttons-wrapper">
            <button class="action-btn copy-btn" onclick="copyText(this, '${textToCopy}')" title="Salin penjelasan ini">
                <i class="fa-regular fa-copy"></i> Salin
            </button>`;
            
        if (hasWordTag) {
            // Bersihkan teks asli dari tag sebelum diexport
            const cleanTextToExport = encodeURIComponent((rawText || text).replace('[GENERATE_WORD]', '').trim());
            innerContent += `
            <button class="action-btn download-btn word-btn" onclick="downloadAsWord('${cleanTextToExport}')" title="Download sebagai Microsoft Word">
                <i class="fa-solid fa-file-word"></i> Download Word
            </button>`;
        }
        
        if (hasExcelTag) {
            // Bersihkan teks asli dari tag sebelum diexport
            const cleanTextToExport = encodeURIComponent((rawText || text).replace('[GENERATE_EXCEL]', '').trim());
            innerContent += `
            <button class="action-btn download-btn excel-btn" onclick="downloadAsExcel('${cleanTextToExport}')" title="Download tabel sebagai Excel">
                <i class="fa-solid fa-file-excel"></i> Download Excel
            </button>`;
        }
            
        innerContent += `</div>`;
    }
    
    messageDiv.innerHTML = innerContent;
    
    // Blok kustom kode telah dihapus karena sekarang ditangani langsung oleh renderer marked.js

    messagesContainer.appendChild(messageDiv);
    
    messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: 'smooth'
    });
}

function copyText(buttonElement, encodedText) {
    const decodedText = decodeURIComponent(encodedText);
    navigator.clipboard.writeText(decodedText).then(() => {
        const originalHtml = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="fa-solid fa-check"></i> Tersalin';
        setTimeout(() => {
            buttonElement.innerHTML = originalHtml;
        }, 2000);
    }).catch(err => {
        console.error('Gagal menyalin teks: ', err);
    });
}

// Global Paste Event Listener
document.addEventListener('paste', function(e) {
    const input = document.getElementById("message-input");
    
    // Jika ada file (gambar, teks, dll) yang di-paste
    if (e.clipboardData && e.clipboardData.files.length > 0) {
        e.preventDefault();
        const files = Array.from(e.clipboardData.files);
        const MAX_SIZE = 1024 * 1024; // 1MB
        
        files.forEach(file => {
            if (file.size > MAX_SIZE) {
                alert(`File ${file.name} terlalu besar (Max 1MB).`);
                return;
            }
            const reader = new FileReader();
            reader.onload = function(event) {
                pendingFiles.push({
                    name: file.name || 'Pasted_File',
                    content: event.target.result
                });
                renderFilePreview();
            };
            reader.onerror = function() {
                alert(`Gagal membaca file yang dipaste`);
            };
            
            // Anggap semuanya bisa dibaca sebagai teks untuk saat ini
            reader.readAsText(file);
        });
        return;
    }
    
    // Jika yang di-paste adalah teks, dan kursor TIDAK sedang di kotak input,
    // otomatis masukkan teks tersebut ke kotak input dan fokuskan.
    if (document.activeElement !== input) {
        const text = e.clipboardData.getData('text');
        if (text) {
            e.preventDefault();
            input.value += text;
            input.focus();
        }
    }
});

// Initialization: mulai dengan obrolan baru, muat riwayat di sidebar
createNewSession();
loadSessions();

// ==========================================
// FITUR AI FILE GENERATOR (WORD & EXCEL)
// ==========================================

function downloadAsWord(encodedText) {
    try {
        const text = decodeURIComponent(encodedText);
        // Konversi markdown ke HTML
        const htmlBody = marked.parse(text);
        
        // Struktur file .doc standar dari Microsoft
        const htmlContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>Dokumen AI</title>
                <style>
                    body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid black; padding: 5px; }
                </style>
            </head>
            <body>
                ${htmlBody}
            </body>
            </html>
        `;
        
        const blob = new Blob(['\\ufeff', htmlContent], {
            type: 'application/msword'
        });
        
        const downloadLink = document.createElement("a");
        document.body.appendChild(downloadLink);
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = "Dokumen_Hasil_AI.doc";
        downloadLink.click();
        document.body.removeChild(downloadLink);
    } catch (e) {
        alert("Gagal membuat file Word: " + e);
    }
}

function downloadAsExcel(encodedText) {
    try {
        if (!window.XLSX) {
            alert("Library SheetJS belum termuat. Pastikan koneksi internet stabil.");
            return;
        }
        
        const text = decodeURIComponent(encodedText);
        const htmlContent = marked.parse(text);
        
        // Buat div semu untuk mengekstrak tabel
        const div = document.createElement('div');
        div.innerHTML = htmlContent;
        const table = div.querySelector('table');
        
        if (!table) {
            alert("Maaf, tidak ada tabel yang ditemukan dalam respon AI ini untuk diubah menjadi Excel.");
            return;
        }
        
        const workbook = XLSX.utils.table_to_book(table, {sheet: "Data AI"});
        XLSX.writeFile(workbook, "Data_Tabel_AI.xlsx");
    } catch (e) {
        alert("Gagal membuat file Excel: " + e);
    }
}

// ==========================================
// IMAGE LIGHTBOX
// ==========================================
function openLightbox(src) {
    const lightbox = document.getElementById("image-lightbox");
    const img = document.getElementById("lightbox-img");
    if (lightbox && img) {
        img.src = src;
        lightbox.classList.remove("hidden");
    }
}

function closeLightbox() {
    const lightbox = document.getElementById("image-lightbox");
    if (lightbox) {
        lightbox.classList.add("hidden");
    }
}

// ==========================================
// BAN SYSTEM ALARM
// ==========================================
function triggerBanAlarm() {
    // Tampilkan overlay dengan class .active
    const overlay = document.getElementById("ban-overlay");
    if (overlay) overlay.classList.add("active");
    
    // Kedipkan layar merah-hitam
    document.body.classList.add("banned-alarm");
    
    // Lempar ke logout setelah 4 detik
    setTimeout(() => {
        window.location.href = "/logout";
    }, 4000);
}

// ==========================================
// NOTIFICATION SYSTEM
// ==========================================
function showCompletionNotification(sessionId, sessionTitle) {
    if (activeNotifications[sessionId]) return; // Jangan tampilkan duplikat

    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.setAttribute('data-session-id', sessionId);
    toast.innerHTML = `
        <strong>Respons Selesai</strong>
        <p>Jawaban untuk obrolan "${sessionTitle}" telah siap.</p>
    `;
    toast.onclick = () => {
        loadChat(sessionId);
    };

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10); // Animasikan masuk

    activeNotifications[sessionId] = toast;

    // Hapus otomatis setelah 8 detik
    setTimeout(() => {
        removeNotificationForSession(sessionId);
    }, 8000);
}

function removeNotificationForSession(sessionId) {
    if (activeNotifications[sessionId]) {
        activeNotifications[sessionId].classList.remove('show');
        setTimeout(() => {
            if (activeNotifications[sessionId]) {
                activeNotifications[sessionId].remove();
                delete activeNotifications[sessionId];
            }
        }, 300);
    }
}

// ==========================================
// EDIT PROMPT & REGENERATE SYSTEM
// ==========================================

function startEditPrompt(messageIndex) {
    const bubble = document.querySelector(`.message.user[data-index="${messageIndex}"]`);
    if (!bubble) return;
    
    // Temukan teks asli dari API fetch yang ada di global scope (atau dari innerText jika sederhana)
    // Di sini kita ambil dari session yang saat ini aktif via fetch manual agar akurat
    fetch(`/api/sessions/${currentSessionId}`)
        .then(res => res.json())
        .then(session => {
            const msg = session.messages[messageIndex];
            if (!msg || msg.role !== 'user') return;
            
            const originalText = msg.content;
            
            // Simpan lampiran jika ada
            let attachmentHTML = '';
            if (msg.images && msg.images.length > 0) {
                attachmentHTML += '<div class="message-attachments" style="margin-bottom:10px">';
                msg.images.forEach(imgData => {
                    attachmentHTML += `<img src="${imgData}" class="chat-image-thumbnail">`;
                });
                attachmentHTML += '</div>';
            }
            
            const textContainer = bubble.querySelector('.text');
            textContainer.innerHTML = `
                ${attachmentHTML}
                <div class="edit-prompt-container">
                    <textarea class="edit-prompt-textarea" id="edit-prompt-${messageIndex}">${originalText}</textarea>
                    <div class="edit-prompt-actions">
                        <button class="edit-prompt-cancel" onclick="cancelEditPrompt(${messageIndex})">Batal</button>
                        <button class="edit-prompt-save" onclick="submitEditPrompt(${messageIndex})">Simpan & Kirim</button>
                    </div>
                </div>
            `;
            
            const textarea = document.getElementById(`edit-prompt-${messageIndex}`);
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
            textarea.focus();
            
            textarea.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitEditPrompt(messageIndex);
                }
            });
        });
}

function cancelEditPrompt(messageIndex) {
    // Reload chat untuk mengembalikan UI ke kondisi semula
    const currentId = currentSessionId;
    currentSessionId = null; // force reload
    loadChat(currentId);
}

function submitEditPrompt(messageIndex) {
    const textarea = document.getElementById(`edit-prompt-${messageIndex}`);
    if (!textarea) return;
    
    const newText = textarea.value.trim();
    if (!newText) return;
    
    triggerRegenerate(messageIndex, newText);
}

function regenerateResponse(messageIndex) {
    triggerRegenerate(messageIndex, null);
}

function triggerRegenerate(messageIndex, newText) {
    if (!currentSessionId) return;
    
    // Tampilkan loading state
    const typingIndicator = document.getElementById("typing-indicator");
    typingIndicator.classList.remove("hidden");
    
    // Potong chat UI dari index tersebut ke bawah
    const messagesContainer = document.getElementById("chat-messages");
    const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
    
    let foundStart = false;
    allMessages.forEach(msgDiv => {
        if (msgDiv.dataset.index == messageIndex) {
            foundStart = true;
            // Jika kita edit, biarkan UI update lewat loadChat nanti, atau kita hapus sisanya
        } else if (foundStart) {
            msgDiv.remove();
        }
    });
    
    const payload = {
        session_id: currentSessionId,
        message_index: messageIndex,
        new_message: newText,
        model: currentModel,
        web_search: isWebSearchEnabled,
        persona: currentPersona
    };
    
    const sessionIdForThisRequest = currentSessionId;
    
    // Buat streaming bubble baru
    const messageDiv = document.createElement("div");
    messageDiv.className = `message assistant streaming-bubble`;
    const textDiv = document.createElement("div");
    textDiv.className = "text";
    messageDiv.appendChild(textDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    const icon = document.getElementById("action-icon");
    if (icon) icon.className = "fa-solid fa-square";
    
    currentAbortController = new AbortController();
    let fullContent = "";
    let lastRenderTime = 0;
    
    fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: currentAbortController.signal
    })
    .then(async response => {
        if (response.status === 403) { triggerBanAlarm(); return; }
        if (!response.ok) {
            textDiv.innerHTML = `<span style="color:red">Server Error</span>`;
            return;
        }
        
        typingIndicator.classList.add("hidden");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunkStr = decoder.decode(value, { stream: true });
            const lines = chunkStr.split("\n");
            
            for (let line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.replace("data: ", ""));
                        if (data.error) { textDiv.innerHTML = `<span style="color:red">Error: ${data.error}</span>`; return; }
                        
                        if (data.text) {
                            fullContent += data.text;
                            if (sessionIdForThisRequest === currentSessionId) {
                                const now = Date.now();
                                if (now - lastRenderTime > 50) {
                                    textDiv.innerHTML = marked.parse(fullContent);
                                    lastRenderTime = now;
                                }
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            }
                        }
                        
                        if (data.done) {
                            currentAbortController = null;
                            if (icon) icon.className = "fa-solid fa-arrow-right";
                            
                            if (sessionIdForThisRequest === currentSessionId) {
                                // Reload chat penuh agar sinkron
                                const temp = currentSessionId;
                                currentSessionId = null;
                                loadChat(temp);
                                if (document.hidden) showCompletionNotification(data.session_id, data.title);
                            } else {
                                showCompletionNotification(data.session_id, data.title);
                                loadSessions();
                            }
                        }
                    } catch(e){}
                }
            }
        }
    })
    .catch(error => {
        if (error.name !== 'AbortError') {
            displayMessage("Error: " + error, "assistant");
        }
    })
    .finally(() => {
        typingIndicator.classList.add("hidden");
        if (icon) icon.className = "fa-solid fa-arrow-right";
        currentAbortController = null;
    });
}

// --- FITUR BARU: Web Search, Persona, & Export ---
function toggleWebSearch() {
    isWebSearchEnabled = !isWebSearchEnabled;
    const btn = document.getElementById('web-search-toggle');
    if (isWebSearchEnabled) {
        btn.style.color = '#4CAF50';
        btn.innerHTML = '<i class="fa-solid fa-globe"></i> <span style="font-size:0.7rem; font-family:sans-serif;">ON</span>';
    } else {
        btn.style.color = '#888';
        btn.innerHTML = '<i class=\"fa-solid fa-globe\"></i>';
    }
}

function changePersona(persona) {
    currentPersona = persona;
}

function exportChat() {
    const messages = document.querySelectorAll('.message .text');
    if (messages.length === 0) {
        alert('Tidak ada percakapan untuk di-export.');
        return;
    }

    let exportContent = '# Nexus Core AI Chat Export\\n\\n';
    
    document.querySelectorAll('.message').forEach(msgDiv => {
        const isUser = msgDiv.classList.contains('user');
        const sender = isUser ? 'You' : 'Nexuscore AI';
        // Ambil teks original jika ada di attribut data-original-content, jika tidak ambil innerText
        const textElement = msgDiv.querySelector('.text');
        const rawContent = textElement.getAttribute('data-original-content') || textElement.innerText;
        
        exportContent += `### ${sender}\n${rawContent}\n\n---\n\n`;
    });

    const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NexusCoreAI_Chat_${new Date().getTime()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

