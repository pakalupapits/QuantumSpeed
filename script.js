/* ===================== LAUNCHSPEED ======================
   Rocket-launch internet speed test.
   Real measurements are taken against Cloudflare's public,
   CORS-enabled edge test endpoints (the same infrastructure
   that powers speed.cloudflare.com) — no backend required,
   so this runs fine on GitHub Pages or any static host.
=========================================================== */

const CF_DOWN = 'https://speed.cloudflare.com/__down';
const CF_UP   = 'https://speed.cloudflare.com/__up';
const CF_META = 'https://speed.cloudflare.com/meta';

/* ---------------------------------------------------------
   1. STARFIELD BACKGROUND
--------------------------------------------------------- */
(function starfield(){
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w, h;

  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.floor((w * h) / 9000);
    stars = Array.from({length: count}, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.2,
      speed: Math.random() * 0.15 + 0.02,
      twinkle: Math.random() * Math.PI * 2
    }));
  }

  function tick(){
    ctx.clearRect(0, 0, w, h);
    for (const s of stars){
      s.twinkle += 0.02;
      const alpha = 0.45 + Math.sin(s.twinkle) * 0.4;
      ctx.beginPath();
      ctx.fillStyle = `rgba(232,240,255,${Math.max(0.05, alpha)})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      s.y += s.speed;
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
    }
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  resize();
  tick();
})();

/* ---------------------------------------------------------
   2. ALTITUDE SCALE + ROCKET TRACK
--------------------------------------------------------- */
const ALT_TIERS = [
  { mbps: 0,    label: 'LAUNCH PAD' },
  { mbps: 1,    label: 'DIAL-UP · 1' },
  { mbps: 10,   label: 'DSL · 10' },
  { mbps: 25,   label: 'HD STREAM · 25' },
  { mbps: 100,  label: 'BROADBAND · 100' },
  { mbps: 300,  label: '4K STREAM · 300' },
  { mbps: 600,  label: 'FIBER · 600' },
  { mbps: 1000, label: 'GIGABIT · 1G' },
  { mbps: 1300, label: 'ESCAPE VELOCITY' }
];
const ALT_MAX = 1300;

function speedToPercent(mbps, max = ALT_MAX){
  const clamped = Math.max(0, Math.min(mbps, max));
  return (Math.log10(clamped + 1) / Math.log10(max + 1)) * 100;
}

function renderAltitudeLabels(){
  const wrap = document.getElementById('altitude-labels');
  wrap.style.position = 'relative';
  wrap.style.height = '100%';
  wrap.innerHTML = '';
  ALT_TIERS.forEach(t => {
    const el = document.createElement('span');
    el.style.position = 'absolute';
    el.style.right = '0';
    el.style.bottom = speedToPercent(t.mbps) + '%';
    el.style.transform = 'translateY(50%)';
    el.textContent = t.label;
    wrap.appendChild(el);
  });
}
renderAltitudeLabels();

const rocketEl = document.getElementById('rocket');
const trackEl = document.getElementById('track');
let currentMax = ALT_MAX;

function setRocketAltitude(mbps, max = ALT_MAX){
  currentMax = max;
  const pct = speedToPercent(mbps, max);
  // keep a small margin so the rocket nose never clips the top
  const bottom = 10 + pct * 0.85;
  rocketEl.style.bottom = `calc(${bottom}% )`;
}

function setPhase(text, mode){
  const label = document.getElementById('phase-label');
  label.textContent = text;
  label.className = 'track-status' + (mode ? ' ' + mode : '');
}

/* ---------------------------------------------------------
   3. GROUND STATION (ISP / colo info)
--------------------------------------------------------- */
(async function groundStation(){
  const el = document.getElementById('ground-station');
  try {
    const res = await fetch(CF_META, { cache: 'no-store' });
    const data = await res.json();
    const org = data.asOrganization || 'UNKNOWN NETWORK';
    const country = data.country || '';
    const colo = data.colo || '';
    el.textContent = `GROUND STATION: ${org.toUpperCase()} · ${country}${colo ? ' · RELAY ' + colo : ''}`;
  } catch (e) {
    el.textContent = 'GROUND STATION: SIGNAL UNAVAILABLE';
  }
})();

/* ---------------------------------------------------------
   4. SPEED TEST ENGINE
--------------------------------------------------------- */

// --- Ping + jitter ---
async function measurePing(samples = 8){
  const times = [];
  for (let i = 0; i < samples; i++){
    const start = performance.now();
    try {
      await fetch(`${CF_DOWN}?bytes=0&cx=${Date.now()}_${i}`, { cache: 'no-store' });
      times.push(performance.now() - start);
    } catch (e) { /* skip failed sample */ }
  }
  // drop the first (connection warm-up) sample if we have enough
  const usable = times.length > 3 ? times.slice(1) : times;
  const ping = usable.reduce((a, b) => a + b, 0) / usable.length;
  let jitterSum = 0;
  for (let i = 1; i < usable.length; i++) jitterSum += Math.abs(usable[i] - usable[i - 1]);
  const jitter = usable.length > 1 ? jitterSum / (usable.length - 1) : 0;
  return { ping, jitter };
}

// --- Download: multiple parallel streamed connections, time-boxed ---
async function measureDownload({ durationMs = 5500, concurrency = 4, rampMs = 700, onTick, onDone }){
  let totalBytes = 0;
  let measuredBytes = 0;
  const testStart = performance.now();
  const measureStart = testStart + rampMs;
  const controllers = [];
  let stop = false;

  function tickLoop(){
    if (stop) return;
    const now = performance.now();
    const elapsed = (now - testStart) / 1000;
    const mbps = elapsed > 0 ? (totalBytes * 8) / elapsed / 1e6 : 0;
    onTick && onTick(mbps);
    if (now - testStart < durationMs) requestAnimationFrame(tickLoop);
  }
  requestAnimationFrame(tickLoop);

  const REQUEST_BYTES = 25 * 1000 * 1000; // 25MB per request — large enough to
  // saturate a fast line, small enough that the endpoint reliably serves it.

  async function lane(){
    while (!stop){
      const controller = new AbortController();
      controllers.push(controller);
      try {
        const res = await fetch(`${CF_DOWN}?bytes=${REQUEST_BYTES}&cx=${Math.random()}`, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!res.ok || !res.body){
          console.warn('LAUNCHSPEED download: bad response', res.status);
          await new Promise(r => setTimeout(r, 300)); // back off, don't hammer
          continue;
        }
        const reader = res.body.getReader();
        while (!stop){
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (performance.now() >= measureStart) measuredBytes += value.length;
        }
      } catch (e) {
        if (!stop) console.warn('LAUNCHSPEED download lane error:', e.message);
        await new Promise(r => setTimeout(r, 300)); // avoid a tight failure loop
      }
    }
  }

  const lanes = Array.from({ length: concurrency }, () => lane());
  await new Promise(r => setTimeout(r, durationMs));
  stop = true;
  controllers.forEach(c => { try { c.abort(); } catch (e) {} });
  await Promise.allSettled(lanes);

  const measuredElapsed = (Math.min(performance.now(), testStart + durationMs) - measureStart) / 1000;
  const mbps = measuredElapsed > 0 ? (measuredBytes * 8) / measuredElapsed / 1e6 : 0;
  onDone && onDone(mbps);
  return mbps;
}

// --- Upload: multiple parallel XHR lanes with real progress events, time-boxed ---
function buildRandomBlob(sizeBytes){
  const buf = new Uint8Array(sizeBytes);
  const chunk = 65536;
  for (let i = 0; i < sizeBytes; i += chunk){
    crypto.getRandomValues(buf.subarray(i, Math.min(i + chunk, sizeBytes)));
  }
  return new Blob([buf]);
}

async function measureUpload({ durationMs = 4500, concurrency = 3, rampMs = 500, onTick, onDone }){
  const payload = buildRandomBlob(6 * 1024 * 1024); // 6MB reused across requests
  const laneLoaded = new Array(concurrency).fill(0);
  let completedBytes = 0;
  const testStart = performance.now();
  const measureStart = testStart + rampMs;
  let stop = false;
  const xhrs = [];

  function totalLoaded(){
    return completedBytes + laneLoaded.reduce((a, b) => a + b, 0);
  }

  function tickLoop(){
    if (stop) return;
    const now = performance.now();
    const elapsed = (now - testStart) / 1000;
    const mbps = elapsed > 0 ? (totalLoaded() * 8) / elapsed / 1e6 : 0;
    onTick && onTick(mbps);
    if (now - testStart < durationMs) requestAnimationFrame(tickLoop);
  }
  requestAnimationFrame(tickLoop);

  function runLane(idx){
    return new Promise(resolve => {
      function send(){
        if (stop) return resolve();
        const xhr = new XMLHttpRequest();
        xhrs.push(xhr);
        xhr.open('POST', `${CF_UP}?cx=${Math.random()}`, true);
        xhr.upload.onprogress = (e) => { laneLoaded[idx] = e.loaded; };
        xhr.onloadend = () => {
          completedBytes += laneLoaded[idx];
          laneLoaded[idx] = 0;
          if (!stop) send(); else resolve();
        };
        xhr.onerror = () => { if (!stop) send(); else resolve(); };
        xhr.send(payload);
      }
      send();
    });
  }

  let baselineBytes = 0;
  let baselineTime = testStart;
  setTimeout(() => {
    baselineBytes = totalLoaded();
    baselineTime = performance.now();
  }, rampMs);

  const lanes = Array.from({ length: concurrency }, (_, i) => runLane(i));
  await new Promise(r => setTimeout(r, durationMs));
  const finalBytes = totalLoaded();
  const finalTime = performance.now();
  stop = true;
  xhrs.forEach(x => { try { x.abort(); } catch (e) {} });
  await Promise.allSettled(lanes);

  const measuredElapsed = Math.max(0.001, (finalTime - baselineTime) / 1000);
  const mbps = ((finalBytes - baselineBytes) * 8) / measuredElapsed / 1e6;
  onDone && onDone(mbps);
  return mbps;
}

/* ---------------------------------------------------------
   5. COMPARISONS, RANKS, RESULTS
--------------------------------------------------------- */
function fmtTime(seconds){
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function buildComparisons(dl, ul){
  const items = [];
  items.push({ label: '4K movie (7 GB)', value: fmtTime((7 * 8000) / dl), tag: 'download' });
  items.push({ label: 'AAA game (70 GB)', value: fmtTime((70 * 8000) / dl), tag: 'download' });
  items.push({ label: 'Simultaneous 4K streams', value: `${Math.max(0, Math.floor(dl / 25))}`, tag: 'download' });
  items.push({ label: 'Upload a 5 MB photo', value: fmtTime((5 * 8) / Math.max(ul, 0.1)), tag: 'upload' });
  const callTier = ul >= 4 ? 'Multi-guest 4K calls' : ul >= 1.5 ? 'Group HD video calls' : ul >= 0.5 ? 'Solo HD video calls' : 'Voice calls only';
  items.push({ label: 'Video call ceiling', value: callTier, tag: 'upload' });
  return items;
}

function renderComparisons(dl, ul){
  const list = document.getElementById('comparisons-list');
  list.innerHTML = '';
  buildComparisons(dl, ul).forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.label}</span><span>${item.value} <span class="tag">${item.tag}</span></span>`;
    list.appendChild(li);
  });
}

const RANKS = [
  { min: 0,    name: 'Cadet' },
  { min: 1,    name: 'Pilot' },
  { min: 25,   name: 'Astronaut' },
  { min: 100,  name: 'Voyager' },
  { min: 300,  name: 'Commander' },
  { min: 700,  name: 'Ludicrous' },
  { min: 1300, name: 'Lightspeed' }
];
function rankFor(dl){
  let r = RANKS[0];
  for (const t of RANKS) if (dl >= t.min) r = t;
  return r.name;
}

/* ---------------------------------------------------------
   6. MISSION LOG (localStorage)
--------------------------------------------------------- */
const LOG_KEY = 'launchspeed_missions';

function loadMissions(){
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
  catch (e) { return []; }
}
function saveMission(m){
  const missions = loadMissions();
  missions.unshift(m);
  while (missions.length > 10) missions.pop();
  localStorage.setItem(LOG_KEY, JSON.stringify(missions));
  renderMissionLog();
}
function clearMissions(){
  localStorage.removeItem(LOG_KEY);
  renderMissionLog();
}

function renderMissionLog(){
  const missions = loadMissions();
  const list = document.getElementById('log-list');
  const spark = document.getElementById('sparkline');

  if (missions.length === 0){
    list.innerHTML = '<li class="log-empty">No missions logged yet — launch your first test above.</li>';
    spark.innerHTML = '';
    return;
  }

  list.innerHTML = missions.map(m => `
    <li>
      <span class="log-date">${new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="log-metric">↓ <b>${m.download.toFixed(1)}</b></span>
      <span class="log-metric">↑ <b>${m.upload.toFixed(1)}</b></span>
      <span class="log-metric">⏱ <b>${m.ping.toFixed(0)}ms</b></span>
    </li>
  `).join('');

  const chrono = [...missions].reverse();
  const maxDl = Math.max(...chrono.map(m => m.download), 1);
  const w = 300, h = 60, pad = 4;
  const pts = chrono.map((m, i) => {
    const x = chrono.length > 1 ? (i / (chrono.length - 1)) * (w - pad * 2) + pad : w / 2;
    const y = h - pad - (m.download / maxDl) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  spark.innerHTML = `
    <polyline points="${pts}" fill="none" stroke="#4fd8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${chrono.map((m, i) => {
      const x = chrono.length > 1 ? (i / (chrono.length - 1)) * (w - pad * 2) + pad : w / 2;
      const y = h - pad - (m.download / maxDl) * (h - pad * 2);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ff7a3d"/>`;
    }).join('')}
  `;
}
renderMissionLog();
document.getElementById('clear-log').addEventListener('click', clearMissions);

/* ---------------------------------------------------------
   7. MISSION PATCH (shareable canvas badge)
--------------------------------------------------------- */
function drawPatch({ dl, ul, ping, rank }){
  const canvas = document.getElementById('patch-canvas');
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.clearRect(0, 0, S, S);

  // outer ring
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#0a0e18');
  grad.addColorStop(1, '#16233a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ff7a3d';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(79,216,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2);
  ctx.stroke();

  // stars
  ctx.fillStyle = 'rgba(232,240,255,0.6)';
  for (let i = 0; i < 40; i++){
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (S / 2 - 30);
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // rocket glyph
  ctx.font = `${S * 0.16}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🚀', S / 2, S * 0.42);

  // rank
  ctx.fillStyle = '#ffc857';
  ctx.font = `800 ${S * 0.075}px Sora, sans-serif`;
  ctx.fillText(rank.toUpperCase(), S / 2, S * 0.56);

  // stats
  ctx.fillStyle = '#e8f0ff';
  ctx.font = `600 ${S * 0.045}px "JetBrains Mono", monospace`;
  ctx.fillText(`↓ ${dl.toFixed(1)} Mbps   ↑ ${ul.toFixed(1)} Mbps`, S / 2, S * 0.66);
  ctx.fillStyle = '#7c8aa5';
  ctx.font = `${S * 0.032}px "JetBrains Mono", monospace`;
  ctx.fillText(`PING ${ping.toFixed(0)}ms · ${new Date().toLocaleDateString()}`, S / 2, S * 0.715);

  ctx.fillStyle = '#4fd8ff';
  ctx.font = `700 ${S * 0.035}px Sora, sans-serif`;
  ctx.fillText('LAUNCHSPEED', S / 2, S * 0.86);

  document.getElementById('download-patch').disabled = false;
}

document.getElementById('download-patch').addEventListener('click', () => {
  const canvas = document.getElementById('patch-canvas');
  const link = document.createElement('a');
  link.download = 'launchspeed-mission-patch.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

/* ---------------------------------------------------------
   8. LAUNCH SEQUENCE (wires everything together)
--------------------------------------------------------- */
const btn = document.getElementById('launch-btn');
const btnLabel = document.getElementById('launch-btn-label');
let running = false;

btn.addEventListener('click', async () => {
  if (running) return;
  running = true;
  btn.disabled = true;
  btn.classList.add('active');
  rocketEl.classList.add('launching');
  document.getElementById('rank-line').textContent = '';

  ['ping', 'jitter', 'download', 'upload'].forEach(id => {
    document.getElementById('val-' + id).textContent = '—';
  });
  setRocketAltitude(0);

  // Phase 1: ignition (ping/jitter)
  setPhase('IGNITION SEQUENCE', 'active');
  btnLabel.textContent = 'MEASURING PING…';
  const { ping, jitter } = await measurePing();
  document.getElementById('val-ping').textContent = ping.toFixed(0);
  document.getElementById('val-jitter').textContent = jitter.toFixed(1);

  // Phase 2: ascent (download)
  setPhase('ASCENT · DOWNLINK', 'active');
  btnLabel.textContent = 'MEASURING DOWNLOAD…';
  const dl = await measureDownload({
    onTick: (mbps) => {
      setRocketAltitude(mbps, ALT_MAX);
      document.getElementById('val-download').textContent = mbps.toFixed(1);
    }
  });
  document.getElementById('val-download').textContent = dl.toFixed(1);

  // Phase 3: return burn (upload)
  setPhase('RETURN BURN · UPLINK', 'active');
  btnLabel.textContent = 'MEASURING UPLOAD…';
  const ul = await measureUpload({
    onTick: (mbps) => {
      setRocketAltitude(mbps, 400);
      document.getElementById('val-upload').textContent = mbps.toFixed(1);
    }
  });
  document.getElementById('val-upload').textContent = ul.toFixed(1);

  // Done
  setRocketAltitude(dl, ALT_MAX);
  setPhase('MISSION COMPLETE', 'done');
  rocketEl.classList.remove('launching');
  btnLabel.textContent = 'LAUNCH AGAIN';
  btn.disabled = false;
  btn.classList.remove('active');
  running = false;

  const rank = rankFor(dl);
  document.getElementById('rank-line').textContent = `Pilot rank earned: ${rank.toUpperCase()}`;
  renderComparisons(dl, ul);
  drawPatch({ dl, ul, ping, rank });
  saveMission({ date: Date.now(), ping, jitter, download: dl, upload: ul, rank });
});
