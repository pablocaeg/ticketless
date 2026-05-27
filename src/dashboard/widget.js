/**
 * Ticketless Chat Widget
 *
 * Embed a support chat in any website with one script tag.
 * Connects to a running Ticketless server and provides a polished
 * chat experience with live investigation steps and typing animations.
 *
 * Usage:
 *   <script src="http://localhost:3100/widget.js"
 *     data-server="http://localhost:3100"
 *     data-title="Support"
 *     data-subtitle="We usually reply instantly"
 *     data-accent="#4f46e5"
 *     data-placeholder="Ask a question..."
 *     data-greeting="Hi! How can we help?"
 *     data-position="right"
 *     data-user-id="usr_001"
 *     data-user-name="Alice"
 *     data-user-email="alice@example.com"
 *   ></script>
 */
(function () {
  'use strict';

  // --- Config from script tag ---
  const script = document.currentScript;
  const cfg = {
    server: attr('data-server', 'http://localhost:3100'),
    title: attr('data-title', 'Support'),
    subtitle: attr('data-subtitle', 'We usually reply instantly'),
    accent: attr('data-accent', '#4f46e5'),
    placeholder: attr('data-placeholder', 'Ask a question...'),
    greeting: attr('data-greeting', 'Hi! How can we help?'),
    greetingSub: attr('data-greeting-sub', ''),
    position: attr('data-position', 'right'),
    userId: attr('data-user-id', ''),
    userName: attr('data-user-name', ''),
    userEmail: attr('data-user-email', ''),
    logo: attr('data-logo', ''),
    presets: attr('data-presets', ''),
  };

  function attr(name, fallback) {
    return script && script.getAttribute(name) || fallback;
  }

  function hex2rgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  const accentRgb = hex2rgb(cfg.accent);
  const presets = cfg.presets ? cfg.presets.split('|').map(s => s.trim()).filter(Boolean) : [];

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    .tl-widget *,.tl-widget *::before,.tl-widget *::after{margin:0;padding:0;box-sizing:border-box}
    .tl-widget{--accent:${cfg.accent};--accent-rgb:${accentRgb};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;position:fixed;bottom:20px;${cfg.position}:20px;z-index:99999}

    /* FAB */
    .tl-fab{width:52px;height:52px;border-radius:50%;background:var(--accent);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(var(--accent-rgb),0.35);transition:transform .2s,box-shadow .2s}
    .tl-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(var(--accent-rgb),0.45)}
    .tl-fab:active{transform:scale(.95)}
    .tl-fab svg{width:22px;height:22px}
    .tl-fab.tl-hidden{display:none}

    /* Panel */
    .tl-panel{width:380px;height:540px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.04);display:none;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(10px) scale(.98);transition:opacity .2s,transform .2s}
    .tl-panel.tl-open{display:flex;opacity:1;transform:translateY(0) scale(1)}

    /* Header */
    .tl-header{padding:14px 16px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 85%,#000));color:#fff;display:flex;align-items:center;gap:10px;flex-shrink:0}
    .tl-header-logo{width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden}
    .tl-header-logo img{width:100%;height:100%;object-fit:cover;border-radius:8px}
    .tl-header-logo svg{width:16px;height:16px}
    .tl-header-text{flex:1;min-width:0}
    .tl-header-title{font-size:14px;font-weight:600;letter-spacing:-.3px}
    .tl-header-sub{font-size:10px;opacity:.7;margin-top:1px}
    .tl-status{display:flex;align-items:center;gap:5px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.1);font-size:9px;font-weight:500;letter-spacing:.3px}
    .tl-status-dot{width:5px;height:5px;border-radius:50%;background:#34d399;animation:tl-pulse 2s infinite}
    @keyframes tl-pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .tl-close{width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;margin-left:4px}
    .tl-close:hover{background:rgba(255,255,255,.2)}
    .tl-close svg{width:14px;height:14px}

    /* Messages */
    .tl-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
    .tl-messages::-webkit-scrollbar{width:4px}
    .tl-messages::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:4px}

    /* Welcome */
    .tl-welcome{text-align:center;padding:32px 16px}
    .tl-welcome-text{font-size:14px;font-weight:500;color:#111}
    .tl-welcome-sub{font-size:12px;color:#9ca3af;margin-top:4px}
    .tl-presets{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:16px}
    .tl-preset{padding:6px 12px;border-radius:20px;border:1px solid #e5e7eb;background:#fff;font-size:11px;color:#6b7280;cursor:pointer;transition:all .15s;font-family:inherit}
    .tl-preset:hover{border-color:var(--accent);color:var(--accent);background:rgba(var(--accent-rgb),.04)}

    /* Bubbles */
    .tl-row{display:flex}
    .tl-row-user{justify-content:flex-end}
    .tl-row-agent{justify-content:flex-start}
    .tl-bubble{max-width:84%;padding:10px 14px;font-size:13px;line-height:1.55;word-wrap:break-word}
    .tl-bubble-user{background:var(--accent);color:#fff;border-radius:16px 16px 4px 16px}
    .tl-bubble-agent{background:#f3f4f6;color:#374151;border-radius:16px 16px 16px 4px;border:1px solid #e5e7eb}
    .tl-bubble-agent strong{font-weight:600;color:#111}

    /* Investigation */
    .tl-steps{padding:4px 8px}
    .tl-step{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;color:#9ca3af}
    .tl-step svg{width:12px;height:12px;flex-shrink:0}
    .tl-step-done svg{color:#34d399}
    .tl-step-active svg{color:var(--accent);animation:tl-spin .8s linear infinite}
    @keyframes tl-spin{to{transform:rotate(360deg)}}

    /* Escalation */
    .tl-escalation{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;font-size:11px;color:#92400e}
    .tl-escalation svg{width:14px;height:14px;color:#d97706;flex-shrink:0}

    /* Typing dots */
    .tl-dots{display:flex;align-items:center;gap:3px;padding:10px 14px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:16px 16px 16px 4px;width:fit-content}
    .tl-dot{width:5px;height:5px;border-radius:50%;background:#d1d5db;animation:tl-bounce 1.4s ease-in-out infinite}
    .tl-dot:nth-child(2){animation-delay:.15s}
    .tl-dot:nth-child(3){animation-delay:.3s}
    @keyframes tl-bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}

    /* Input */
    .tl-input-area{border-top:1px solid #f3f4f6;padding:10px 12px;flex-shrink:0}
    .tl-input-row{display:flex;gap:8px;align-items:flex-end}
    .tl-input{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:12px;padding:8px 12px;font-size:13px;font-family:inherit;line-height:1.4;outline:none;transition:border-color .15s;min-height:38px;max-height:100px}
    .tl-input:focus{border-color:var(--accent)}
    .tl-input::placeholder{color:#d1d5db}
    .tl-send{width:34px;height:34px;border-radius:10px;border:none;background:var(--accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s;flex-shrink:0}
    .tl-send:hover{opacity:.9}
    .tl-send:disabled{opacity:.2;cursor:default}
    .tl-send svg{width:14px;height:14px}

    @media(max-width:420px){
      .tl-panel{width:calc(100vw - 24px);height:calc(100vh - 80px);bottom:12px;${cfg.position}:12px;border-radius:12px}
    }
  `;
  document.head.appendChild(style);

  // --- Icons ---
  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>',
    close: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>',
    spin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.49-8.49l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>',
    warn: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
  };

  // --- DOM ---
  const root = document.createElement('div');
  root.className = 'tl-widget';

  const fab = document.createElement('button');
  fab.className = 'tl-fab';
  fab.innerHTML = ICONS.chat;
  fab.setAttribute('aria-label', 'Open support chat');

  const panel = document.createElement('div');
  panel.className = 'tl-panel';
  panel.innerHTML = `
    <div class="tl-header">
      <div class="tl-header-logo">${cfg.logo ? `<img src="${cfg.logo}" alt="">` : ICONS.chat}</div>
      <div class="tl-header-text">
        <div class="tl-header-title">${esc(cfg.title)}</div>
        <div class="tl-header-sub">${esc(cfg.subtitle)}</div>
      </div>
      <div class="tl-status"><span class="tl-status-dot"></span>online</div>
      <button class="tl-close">${ICONS.close}</button>
    </div>
    <div class="tl-messages"></div>
    <div class="tl-input-area">
      <div class="tl-input-row">
        <textarea class="tl-input" placeholder="${esc(cfg.placeholder)}" rows="1"></textarea>
        <button class="tl-send" disabled>${ICONS.send}</button>
      </div>
    </div>
  `;

  root.appendChild(fab);
  root.appendChild(panel);
  document.body.appendChild(root);

  const messagesEl = panel.querySelector('.tl-messages');
  const inputEl = panel.querySelector('.tl-input');
  const sendBtn = panel.querySelector('.tl-send');
  const closeBtn = panel.querySelector('.tl-close');

  // --- State ---
  let isOpen = false;
  let isBusy = false;
  let ticketN = 0;
  const chatHistory = [];

  function showWelcome() {
    let html = `<div class="tl-welcome">
      <div class="tl-welcome-text">${esc(cfg.greeting)}</div>`;
    if (cfg.greetingSub) html += `<div class="tl-welcome-sub">${esc(cfg.greetingSub)}</div>`;
    if (presets.length) {
      html += '<div class="tl-presets">';
      presets.forEach(p => { html += `<button class="tl-preset">${esc(p)}</button>`; });
      html += '</div>';
    }
    html += '</div>';
    messagesEl.innerHTML = html;
    messagesEl.querySelectorAll('.tl-preset').forEach(btn => {
      btn.addEventListener('click', () => sendMessage(btn.textContent));
    });
  }

  showWelcome();

  // --- Events ---
  fab.addEventListener('click', () => { isOpen = true; update(); inputEl.focus(); });
  closeBtn.addEventListener('click', () => { isOpen = false; update(); });
  inputEl.addEventListener('input', () => {
    sendBtn.disabled = isBusy || !inputEl.value.trim();
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener('click', () => sendMessage());

  function update() {
    panel.classList.toggle('tl-open', isOpen);
    fab.classList.toggle('tl-hidden', isOpen);
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- Markdown ---
  function md(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code style="background:#e5e7eb;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/  \n/g, '<br/>').replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');
  }

  function esc(s) {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // --- Render helpers ---
  function addUserBubble(text) {
    const welcome = messagesEl.querySelector('.tl-welcome');
    if (welcome) welcome.remove();
    const row = document.createElement('div');
    row.className = 'tl-row tl-row-user';
    row.innerHTML = `<div class="tl-bubble tl-bubble-user">${esc(text)}</div>`;
    messagesEl.appendChild(row);
    scrollDown();
  }

  function addAgentBubble() {
    const row = document.createElement('div');
    row.className = 'tl-row tl-row-agent';
    const bubble = document.createElement('div');
    bubble.className = 'tl-bubble tl-bubble-agent';
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollDown();
    return bubble;
  }

  function addDots() {
    const el = document.createElement('div');
    el.className = 'tl-dots';
    el.innerHTML = '<span class="tl-dot"></span><span class="tl-dot"></span><span class="tl-dot"></span>';
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function addStepsContainer() {
    const el = document.createElement('div');
    el.className = 'tl-steps';
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function addStep(container, text, done) {
    const step = document.createElement('div');
    step.className = `tl-step ${done ? 'tl-step-done' : 'tl-step-active'}`;
    step.innerHTML = `${done ? ICONS.check : ICONS.spin}<span>${esc(text)}</span>`;
    container.appendChild(step);
    scrollDown();
    return step;
  }

  function markAllStepsDone(container) {
    container.querySelectorAll('.tl-step-active').forEach(s => {
      s.className = 'tl-step tl-step-done';
      s.querySelector('svg').outerHTML = ICONS.check;
    });
  }

  function addEscalation(reason) {
    const el = document.createElement('div');
    el.className = 'tl-escalation';
    el.innerHTML = `${ICONS.warn}<span>${esc(reason)}</span>`;
    messagesEl.appendChild(el);
    scrollDown();
  }

  // --- Type animation ---
  async function typeIntoBubble(bubble, fullText) {
    const len = fullText.length;
    const chunk = Math.max(1, Math.floor(len / 120));
    for (let i = 0; i < len; i += chunk) {
      bubble.innerHTML = md(fullText.slice(0, i + chunk));
      scrollDown();
      await sleep(20);
    }
    bubble.innerHTML = md(fullText);
    scrollDown();
  }

  // --- Humanize tool calls ---
  function humanize(detail) {
    const m = detail.match(/^(\w+)\((.+?)\) completed in \d+ms$/);
    if (!m) return null;
    try {
      const args = JSON.parse(m[2]);
      const action = args.action || '';
      let params = {};
      try { params = JSON.parse(args.params || '{}'); } catch {}
      const map = {
        shift_exchange: { list_users: 'Looking up staff members', get_schedule: `Checking ${/^\d+$/.test(params.id || '') ? 'user #' + params.id : params.id + "'s"} schedule`, list_exchanges: 'Checking open exchanges' },
        shift_comply: { health: 'Connecting to compliance engine', get_rules: `Loading ${params.jurisdiction || ''} regulations`, validate_swap: 'Validating against regulations' },
      };
      return map[m[1]]?.[action] || `${m[1]}: ${action}`;
    } catch { return null; }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // --- Send ---
  async function sendMessage(text) {
    const msg = (text || inputEl.value).trim();
    if (!msg || isBusy) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    isBusy = true;
    sendBtn.disabled = true;

    addUserBubble(msg);
    chatHistory.push({ role: 'user', text: msg });

    const ticketId = `w-${++ticketN}-${Date.now()}`;
    const shown = new Set();
    let stepsEl = null;
    let stopped = false;

    // Poll audit trail for live steps
    const poll = async () => {
      while (!stopped) {
        await sleep(600);
        if (stopped) break;
        try {
          const res = await fetch(`${cfg.server}/api/audit?ticketId=${ticketId}`);
          const data = await res.json();
          const calls = (data.entries || [])
            .filter(e => e.step === 'tool_call' && !shown.has(e.detail) && !e.detail.includes('failed'))
            .map(e => { shown.add(e.detail); return humanize(e.detail) || e.detail; });
          if (calls.length) {
            if (!stepsEl) { stepsEl = addStepsContainer(); dots.remove(); }
            const prev = stepsEl.querySelector('.tl-step-active');
            if (prev) { prev.className = 'tl-step tl-step-done'; prev.querySelector('svg').outerHTML = ICONS.check; }
            calls.forEach(c => addStep(stepsEl, c, false));
          }
        } catch {}
      }
    };

    const polling = poll();
    const dots = addDots();

    try {
      const res = await fetch(`${cfg.server}/api/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ticketId,
          source: 'chat',
          subject: msg.slice(0, 80),
          body: (chatHistory.length > 1 ? 'Conversation so far:\n' + chatHistory.slice(0, -1).map(m => (m.role === 'user' ? 'User' : 'Agent') + ': ' + m.text.slice(0, 300)).join('\n') + '\n\nNew message: ' + msg : msg) + (cfg.userName ? '\n\nContext: I am ' + cfg.userName + '. When looking up my schedule, use my name not a numeric id. Sign off as "Support Team" (never use placeholders like [Your Name]).' : ''),
          customerEmail: cfg.userEmail || 'chat@user',
          customerId: cfg.userId || undefined,
          metadata: {},
        }),
      });

      stopped = true;
      await polling;
      dots.remove();

      if (stepsEl) markAllStepsDone(stepsEl);

      const resolution = await res.json();

      if (resolution.action === 'escalate') {
        addEscalation(resolution.escalationReason || 'Escalated to a human agent');
        if (resolution.investigationSummary) {
          chatHistory.push({ role: 'agent', text: resolution.investigationSummary });
          const bubble = addAgentBubble();
          await typeIntoBubble(bubble, resolution.investigationSummary);
        }
      } else if (resolution.reply) {
        chatHistory.push({ role: 'agent', text: resolution.reply });
        const bubble = addAgentBubble();
        await typeIntoBubble(bubble, resolution.reply);
      } else {
        const bubble = addAgentBubble();
        bubble.textContent = 'Something went wrong. Please try again.';
      }
    } catch {
      stopped = true;
      dots.remove();
      const bubble = addAgentBubble();
      bubble.textContent = 'Support is unavailable right now. Please try again later.';
    }

    isBusy = false;
    sendBtn.disabled = !inputEl.value.trim();
    inputEl.focus();
  }
})();
