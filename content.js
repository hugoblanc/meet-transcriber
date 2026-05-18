// content.js — Floating recording indicator on Meet pages (Shadow DOM isolated)

let host = null;
let timerInterval = null;
let startTime = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECORDING_STARTED') showIndicator();
  if (msg.type === 'RECORDING_STOPPED') hideIndicator();
});

chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((res) => {
  if (res?.session?.status === 'recording') {
    startTime = res.session.startTime;
    showIndicator();
  }
});

function showIndicator() {
  if (host) return;

  host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      .indicator {
        position: fixed;
        bottom: 24px;
        left: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: rgba(229, 57, 53, 0.94);
        color: #fff;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        z-index: 2147483647;
        box-shadow: 0 2px 12px rgba(0,0,0,0.25);
        user-select: none;
        line-height: 1;
      }
      .dot {
        width: 8px;
        height: 8px;
        background: #fff;
        border-radius: 50%;
        animation: pulse 1.4s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .timer {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        min-width: 40px;
      }
      .stop-btn {
        margin-left: 4px;
        padding: 3px 10px;
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.35);
        border-radius: 12px;
        color: #fff;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s;
      }
      .stop-btn:hover {
        background: rgba(255,255,255,0.35);
      }
    </style>
    <div class="indicator">
      <div class="dot"></div>
      <span>REC</span>
      <span class="timer">00:00</span>
      <button class="stop-btn">Arrêter</button>
    </div>
  `;

  const timerEl = shadow.querySelector('.timer');

  if (!startTime) startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);

  shadow.querySelector('.stop-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    hideIndicator();
  });

  document.body.appendChild(host);
}

function hideIndicator() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  startTime = 0;
}
