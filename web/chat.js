// Ask 00Trench: chat UI for the website agent (POST /api/chat). Keeps the last few turns in memory only.
(function () {
  var log = document.getElementById('chat-log'), form = document.getElementById('chat-form'), input = document.getElementById('chat-input');
  if (!log || !form) return;
  var btn = form.querySelector('button[type=submit]');
  // ---- avatar: idle loop vs talking loop, his voice, and the mic ----
  var idle = document.getElementById('av-idle'), talk = document.getElementById('av-talk'), status = document.getElementById('av-status');
  var voiceBtn = document.getElementById('av-voice'), mic = document.getElementById('chat-mic');
  var voiceOn = true, audio = null;
  try { voiceOn = localStorage.getItem('tf-voice') !== 'off'; } catch (e) {}
  function setVoiceBtn() { if (voiceBtn) { voiceBtn.textContent = voiceOn ? 'VOICE ON' : 'VOICE OFF'; voiceBtn.setAttribute('aria-pressed', String(voiceOn)); } }
  setVoiceBtn();
  if (voiceBtn) voiceBtn.addEventListener('click', function () {
    voiceOn = !voiceOn; setVoiceBtn();
    try { localStorage.setItem('tf-voice', voiceOn ? 'on' : 'off'); } catch (e) {}
    if (!voiceOn && audio) { audio.pause(); mode('idle'); }
  });
  function mode(m, label) {
    if (!idle || !talk) return;
    var t = m === 'talk';
    talk.classList.toggle('on', t); idle.classList.toggle('on', !t);
    var v = t ? talk : idle; var p = v.play(); if (p && p.catch) p.catch(function () {});
    status.textContent = label || (t ? 'TALKING' : 'ON THE LINE'); status.classList.toggle('talking', t);
  }
  function speak(text, sig) {
    if (!voiceOn || !sig) { mode('talk'); setTimeout(function () { mode('idle'); }, Math.min(6000, 600 + text.length * 25)); return; }
    mode('idle', 'THINKING…');
    fetch('/api/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, sig: sig }) })
      .then(function (r) { if (!r.ok) throw new Error('voice'); return r.blob(); })
      .then(function (b) {
        if (audio) audio.pause();
        audio = new Audio(URL.createObjectURL(b));
        audio.onplay = function () { mode('talk'); };
        audio.onended = audio.onpause = function () { mode('idle'); };
        return audio.play();
      })
      .catch(function () { mode('idle'); });
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR && mic) {
    mic.hidden = false;
    var rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    var listening = false;
    rec.onresult = function (e) { var t = e.results[0][0].transcript; input.value = ''; send(t); };
    rec.onend = function () { listening = false; mic.classList.remove('rec'); mic.textContent = 'MIC'; if (!busy) mode('idle'); };
    rec.onerror = rec.onend;
    mic.addEventListener('click', function () {
      if (listening) { rec.stop(); return; }
      if (audio) audio.pause();
      try { rec.start(); listening = true; mic.classList.add('rec'); mic.textContent = 'STOP'; mode('idle', 'LISTENING…'); } catch (e) {}
    });
  }
  var busy = false;

  // Memory lives only in this browser (name, visits, tokens checked, topics, last few messages). "Forget me" wipes it.
  var KEY = 'tf-00trench-memory';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} }
  var mem = load();
  var today = new Date().toISOString().slice(0, 10);
  if (mem.lastVisit !== today) { mem.visits = (mem.visits || 0) + 1; mem.prevVisit = mem.lastVisit || null; mem.lastVisit = today; }
  mem.checked = mem.checked || []; mem.topics = mem.topics || [];
  var history = (mem.history || []).slice(-6);
  save();

  function remember(text, report) {
    var m = text.match(/\b(?:my name is|i am|i'm|im|call me)\s+([A-Za-z][A-Za-z0-9_-]{1,20})/i);
    if (m && !/^(new|not|a|an|the|so|just|here|scared|worried|trying|looking)$/i.test(m[1])) mem.name = m[1];
    if (report) {
      mem.checked = mem.checked.filter(function (c) { return c.mint !== report.mint; });
      mem.checked.push({ mint: report.mint, symbol: (report.token_metadata_untrusted && report.token_metadata_untrusted.symbol) || '?' });
      mem.checked = mem.checked.slice(-10);
    } else if (text.length < 80) {
      mem.topics.push(text.slice(0, 30)); mem.topics = mem.topics.slice(-10);
    }
  }

  function add(cls, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  // Case File: facts with sources, no verdict. Red marks only flag fields worth a second look; they are not a score.
  var LOOK = {
    mint_authority: function (v) { return /^ACTIVE/.test(v); }, freeze_authority: function (v) { return /^ACTIVE/.test(v); },
    creator_holds_pct: function (v) { return v > 5; }, top10_pct: function (v) { return v > 30; },
    insider_wallets: function (v) { return v > 0; }, insider_networks_pct: function (v) { return v > 5; },
    liquidity_usd: function (v) { return !v || v < 5000; }, creator_wallet_age: function (v) { return /minutes|hours/.test(String(v)); },
    creator_recent_launches: function (v) { return v > 1; }, metadata_injection: function (v) { return v === 'YES'; }
  };
  function addReport(r) {
    var d = document.createElement('div');
    d.className = 'report';
    var head = document.createElement('div');
    var hb = document.createElement('b'); hb.textContent = 'CASE FILE: ';
    head.appendChild(hb); head.appendChild(document.createTextNode((r.token_metadata_untrusted && r.token_metadata_untrusted.symbol || '?') + ' · ' + r.mint.slice(0, 4) + '…' + r.mint.slice(-4)));
    d.appendChild(head);
    (r.fields || []).forEach(function (f) {
      if (f.key === 'creator' || f.key === 'token_program' || f.key === 'launchpad') return;
      var line = document.createElement('div');
      var b = document.createElement('b'); b.textContent = f.label.toUpperCase() + ': ';
      var s = document.createElement('span');
      var v = Array.isArray(f.value) ? (f.value.length ? f.value.join(' · ') : 'none') : String(f.value);
      s.textContent = v;
      if (LOOK[f.key]) s.className = LOOK[f.key](f.value) ? 'bad' : 'ok';
      line.title = 'Source: ' + f.source + ' · read ' + f.read_at + (f.note ? ' · ' + f.note : '');
      line.appendChild(b); line.appendChild(s); d.appendChild(line);
    });
    var a = document.createElement('a');
    a.href = '/api/casefile?mint=' + encodeURIComponent(r.mint); a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Raw case file (JSON, with sources) →';
    d.appendChild(a);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true; btn.disabled = true;
    add('user', text);
    history.push({ role: 'user', text: text });
    history = history.slice(-6);
    var typing = add('bot typing', '00Trench is sniffing…');
    var memory = { name: mem.name, visits: mem.visits, lastVisit: mem.prevVisit, checked: mem.checked, topics: mem.topics };
    fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history, memory: memory }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        if (d.report) addReport(d.report);
        var reply = d.reply || 'Static on the line. Try again.';
        add(d.blocked ? 'bot warn' : 'bot', reply);
        speak(reply, d.sig);
        if (d.blocked) history.pop(); else { history.push({ role: 'model', text: reply }); remember(text, d.report); }
        mem.history = history.slice(-6); save();
      })
      .catch(function () { typing.remove(); add('bot', 'Static on the line. The Agency is unreachable right now.'); })
      .then(function () { busy = false; btn.disabled = false; input.focus(); });
  }

  // show the last conversation when someone comes back
  history.forEach(function (m) { add(m.role === 'user' ? 'user' : 'bot', m.text); });
  if (mem.visits > 1 && mem.name) add('bot', 'Agent ' + mem.name + '. You came back. Smart. What are we sniffing today?');

  var forget = document.getElementById('chat-forget');
  if (forget) forget.addEventListener('click', function (e) {
    e.preventDefault();
    try { localStorage.removeItem(KEY); } catch (err) {}
    mem = { visits: 1, lastVisit: today, checked: [], topics: [] }; history = [];
    log.querySelectorAll('.msg.user, .report, .msg.bot:not(:first-child)').forEach(function (n) { n.remove(); });
    add('bot', 'Memory wiped. We never met. Smooth.');
  });

  // share links (thetrenchforce.com/check/<mint>) land here with ?mint=: run the check automatically
  try {
    var qm = new URLSearchParams(location.search).get('mint');
    if (qm && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(qm)) setTimeout(function () { send(qm); }, 600);
  } catch (e) {}

  form.addEventListener('submit', function (e) { e.preventDefault(); var t = input.value; input.value = ''; send(t); });
  document.querySelectorAll('#chips button').forEach(function (b) { b.addEventListener('click', function () { send(b.getAttribute('data-q')); }); });
})();
