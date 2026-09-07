const $ = (selector) => document.querySelector(selector);
const chat = $('#chat');
const input = $('#messageInput');
const sendButton = $('#sendButton');
const toggle = $('#cameraToggle');
const cameraLabel = $('#cameraLabel');
const cameraView = $('#cameraView');
const cameraFallback = $('#cameraFallback');
const video = $('#cameraVideo');
const photoInput = $('#photoInput');
const countdown = $('#countdown');
const typingIndicator = $('#typingIndicator');

const conversation = [];
let stream = null;
let cameraTimer = null;
let secondsLeft = 60;
let visualController = null;
let chatController = null;

function now() {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
}

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

function addMessage(text, who = 'companion') {
  const article = document.createElement('article');
  article.className = `message ${who === 'user' ? 'user-message' : 'companion-message'}`;
  if (who === 'user') {
    article.innerHTML = `<div class="bubble-wrap"><div class="message-meta">You <span>· ${now()}</span></div><p class="bubble">${escapeHtml(text)}</p></div>`;
  } else {
    article.innerHTML = `<img class="avatar" src="./assets/lumi-portrait.png" alt=""><div class="bubble-wrap"><div class="message-meta">Lumi <span>· ${now()}</span></div><p class="bubble">${escapeHtml(text)}</p></div>`;
  }
  chat.appendChild(article);
  chat.scrollTop = chat.scrollHeight;
  return article;
}

function setTyping(visible) {
  typingIndicator.hidden = !visible;
  sendButton.disabled = visible;
  if (visible) chat.scrollTop = chat.scrollHeight;
}

function setCountdown() {
  countdown.textContent = `Next check-in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
}

async function askCompanion(messages, image = null, kind = 'chat') {
  const controller = new AbortController();
  if (kind === 'chat') chatController = controller;
  else visualController = controller;
  try {
    const response = await fetch('/api/companion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, ...(image ? { image } : {}) }),
      signal: controller.signal
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) throw new Error(payload.error || 'Lumi could not reply right now.');
    if (!payload.reply || typeof payload.reply !== 'string') throw new Error('Lumi returned an empty reply.');
    return payload.reply.trim();
  } finally {
    if (kind === 'chat' && chatController === controller) chatController = null;
    if (kind !== 'chat' && visualController === controller) visualController = null;
  }
}

$('#composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || sendButton.disabled) return;
  input.value = '';
  input.style.height = 'auto';
  addMessage(text, 'user');
  const messages = [...conversation, { role: 'user', content: text }].slice(-20);
  setTyping(true);
  try {
    const reply = await askCompanion(messages);
    conversation.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    while (conversation.length > 20) conversation.shift();
    addMessage(reply);
  } catch (error) {
    if (error.name !== 'AbortError') addMessage('I couldn’t reach Lumi just now. Please try sending that again in a moment.');
  } finally {
    setTyping(false);
    input.focus();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('#composer').requestSubmit();
  }
});

function stopTracks() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

function stopCamera({ announce = true } = {}) {
  if (cameraTimer) window.clearInterval(cameraTimer);
  cameraTimer = null;
  if (visualController) visualController.abort();
  stopTracks();
  cameraView.hidden = true;
  cameraFallback.hidden = true;
  cameraLabel.textContent = 'Camera off';
  secondsLeft = 60;
  setCountdown();
  if (announce) addMessage('Camera is off now. No frames were saved, and I’m still right here with you in the chat.');
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toggle.checked = false;
    cameraLabel.textContent = 'Camera needs HTTPS';
    cameraFallback.hidden = false;
    addMessage('Live camera access requires a secure HTTPS connection in this browser. You can still choose one photo for a private check-in.');
    return;
  }
  cameraFallback.hidden = true;
  cameraLabel.textContent = 'Connecting…';
  try {
    const requestedStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 640 } },
      audio: false
    });
    if (!toggle.checked) {
      requestedStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = requestedStream;
    video.srcObject = stream;
    cameraView.hidden = false;
    cameraLabel.textContent = 'Camera on';
    secondsLeft = 60;
    setCountdown();
    addMessage('Camera is on. I’ll take one small, private visual check-in every 60 seconds. You can switch it off at any time.');
    cameraTimer = window.setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        secondsLeft = 60;
        captureVisualFrame();
      }
      setCountdown();
    }, 1000);
  } catch (error) {
    toggle.checked = false;
    stopTracks();
    cameraView.hidden = true;
    cameraLabel.textContent = 'Camera unavailable';
    cameraFallback.hidden = false;
    addMessage('I couldn’t access the live camera, so I left it off. You can choose a single photo instead; nothing was recorded.');
  }
}

toggle.addEventListener('change', () => {
  if (toggle.checked) startCamera();
  else stopCamera();
});

function canvasJpeg(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) throw new Error('The image is not ready yet.');
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: false });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function dataUrlToImage(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return { mimeType: dataUrl.slice(5, comma).split(';')[0] || 'image/jpeg', data: dataUrl.slice(comma + 1) };
}

async function requestVisualObservation(dataUrl) {
  if (visualController) return;
  const image = dataUrlToImage(dataUrl);
  const messages = [...conversation, { role: 'user', content: 'Offer one concise, supportive visual check-in based only on what is visibly apparent in this image.' }].slice(-20);
  try {
    const reply = await askCompanion(messages, image, 'visual');
    addMessage(reply);
  } catch (error) {
    if (error.name !== 'AbortError') addMessage('I couldn’t complete that visual check-in. Your camera is still private, and we can keep talking here.');
  }
}

function captureVisualFrame() {
  if (!stream || video.readyState < 2 || visualController) return;
  try {
    const dataUrl = canvasJpeg(video);
    requestVisualObservation(dataUrl);
  } catch (_) {
    // A frame that is not ready is simply skipped; no image is retained.
  }
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = async () => {
    try {
      const dataUrl = canvasJpeg(image);
      await requestVisualObservation(dataUrl);
    } catch (_) {
      addMessage('I couldn’t read that photo. Please try choosing another image.');
    } finally {
      URL.revokeObjectURL(objectUrl);
      photoInput.value = '';
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    photoInput.value = '';
    addMessage('I couldn’t read that photo. Please try choosing another image.');
  };
  image.src = objectUrl;
});

$('#privacyButton').addEventListener('click', () => $('#privacyDialog').showModal());
$('#closePrivacy').addEventListener('click', () => $('#privacyDialog').close());
$('#privacyDialog').addEventListener('click', (event) => {
  if (event.target === $('#privacyDialog')) $('#privacyDialog').close();
});
window.addEventListener('pagehide', () => stopCamera({ announce: false }));
