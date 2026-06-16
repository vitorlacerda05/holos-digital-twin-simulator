import { createPose } from './pose.js';
import { Twin3D } from './twin3d.js';
import { drawSkeleton } from './realview.js';

const $ = (id) => document.getElementById(id);
const video = $('cam');
const overlay = $('overlay');
const twin = new Twin3D($('scene'));

let landmarker = null;
let running = false;     // loop ativo (câmera ligada)
let synced = false;      // gêmeo digital sincronizado
let mirror = true;
let lastVideoTime = -1;
let fps = 0, lastT = performance.now(), frame = 0;
let lostFrames = 0;

// ---------- inicialização ----------
async function boot() {
  $('loadnote').textContent = 'Iniciando…';
  try {
    landmarker = await createPose((msg) => { $('loadnote').textContent = msg; });
  } catch (e) {
    $('loadnote').textContent = 'Erro ao carregar o modelo: ' + e.message;
    return false;
  }
  return true;
}

// PASSO 1 -> 2: liga só a câmera (com detecção de pose, mas sem o gêmeo)
async function startCamera() {
  $('btnCamera').disabled = true;
  if (!landmarker) {
    const ok = await boot();
    if (!ok) { $('btnCamera').disabled = false; return; }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    $('loadnote').textContent = 'Não consegui acessar a câmera: ' + e.message;
    $('btnCamera').disabled = false;
    return;
  }
  $('gate').classList.add('hidden');
  applyMirror();
  running = true;
  requestAnimationFrame(loop);
}

// PASSO 2 -> 3: sincroniza e abre o gêmeo digital ao lado
function sync() {
  if (synced) return;
  $('btnSync').disabled = true;
  $('linkbeam').classList.add('fire');            // feixe de dados câmera -> gêmeo
  const prog = $('linkProgress'), fill = $('lpFill'), msg = $('linkMsg');
  prog.classList.add('show');
  const steps = ['Estabelecendo enlace…', 'Calibrando sensores…', 'Construindo malha 3D…'];
  let p = 0;
  const iv = setInterval(() => {
    p += 4 + Math.random() * 5;
    fill.style.width = Math.min(100, p) + '%';
    msg.textContent = steps[Math.min(steps.length - 1, Math.floor(p / 34))];
    if (p >= 100) {
      clearInterval(iv);
      $('syncCta').classList.add('hidden');
      $('grid').classList.remove('camera-only');  // gêmeo "abre ao lado"
      $('hintCam').classList.add('hidden');
      $('liveControls').classList.remove('hidden');
      setTimeout(() => { twin.resize(); synced = true; }, 820); // após a transição de abertura
    }
  }, 60);
}

// ---------- loop ----------
function loop(now) {
  if (!running) return;

  // FPS
  const dt = now - lastT; lastT = now;
  fps = fps * 0.9 + (1000 / dt) * 0.1;
  if (++frame % 10 === 0) $('fps').textContent = Math.round(fps) + ' FPS';

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const t0 = performance.now();
    const res = landmarker.detectForVideo(video, now);
    const infMs = performance.now() - t0;

    const lmsList = res.landmarks || [];
    const worldList = res.worldLandmarks || [];
    drawSkeleton(overlay, video, lmsList, mirror); // overlay sempre mostra o ao vivo

    if (recording && worldList.length) recordFrame(worldList);

    // alimenta o gêmeo ao vivo (exceto quando o modal de replay está aberto)
    if (synced && !replayOpen) {
      if (worldList.length) {
        lostFrames = 0;
        twin.updatePoses(worldList);
        updateTelemetry(worldList[0], infMs);
      } else if (++lostFrames > 8) {
        twin.hidePose(); setStatus('SINAL PERDIDO', 'crit');
      }
    }
  }

  // gravação: contagem regressiva + parada automática aos 10s -> abre o modal
  if (recording) {
    const rem = Math.max(0, (REC_MS - (now - recStart)) / 1000);
    $('recTxt').textContent = 'REC ' + rem.toFixed(1) + 's';
    if (now - recStart >= REC_MS) stopRecording();
  }

  // replay: o gêmeo roda a partir do estado gravado (digital thread)
  if (synced && replayOpen) {
    let elapsed = pauseTime;
    if (playing) { elapsed = (now - repStart) % repDur; pauseTime = elapsed; }
    renderFrameAt(elapsed);
    const pct = Math.min(100, (elapsed / repDur) * 100);
    $('rmFill').style.width = pct + '%';
    $('rmTime').textContent = (elapsed / 1000).toFixed(1) + 's / ' + (repDur / 1000).toFixed(1) + 's';
    $('recTxt').textContent = (playing ? 'REPLAY ' : 'PAUSA ') + (elapsed / 1000).toFixed(1) + 's';
  }

  if (synced) twin.render();
  requestAnimationFrame(loop);
}

// ---------- gravação / replay (digital thread) ----------
const REC_MS = 10000;
let recording = false, recStart = 0, recFrames = [];
let replayOpen = false, playing = false, repStart = 0, repDur = 1, pauseTime = 0;

const clonePoses = (list) => list.map(p => p.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility })));

function startRecording() {
  if (!synced || recording || replayOpen) return;
  recFrames = []; recStart = performance.now(); recording = true;
  $('recbadge').classList.remove('hidden', 'replay');
  $('btnRec').disabled = true;
}
function recordFrame(worldList) { recFrames.push({ t: performance.now() - recStart, poses: clonePoses(worldList) }); }
function stopRecording() {
  recording = false; $('recbadge').classList.add('hidden');
  if (recFrames.length >= 2) openReplayModal();
  else $('btnRec').disabled = false; // gravação curta/inválida
}

function renderFrameAt(elapsed) {
  let f = recFrames[0];
  for (let k = 0; k < recFrames.length; k++) { if (recFrames[k].t <= elapsed) f = recFrames[k]; else break; }
  twin.updatePoses(f.poses);
  updateTelemetry(f.poses[0], 0);
}

function openReplayModal() {
  replayOpen = true; playing = false; pauseTime = 0;
  repDur = recFrames[recFrames.length - 1].t || 1;
  $('btnRec').disabled = true;
  $('recbadge').classList.remove('hidden'); $('recbadge').classList.add('replay');
  $('rmPlay').textContent = '▶ Reproduzir';
  $('replayModal').classList.remove('hidden');
}
function togglePlay() {
  if (!replayOpen) return;
  playing = !playing;
  if (playing) repStart = performance.now() - pauseTime;  // retoma de onde pausou
  $('rmPlay').textContent = playing ? '⏸ Pausar' : '▶ Reproduzir';
}
function restartReplay() { pauseTime = 0; if (playing) repStart = performance.now(); }

// fechar o modal = descartar a gravação (como se nada tivesse sido gravado)
function discardReplay() {
  replayOpen = false; playing = false; recFrames = []; pauseTime = 0;
  $('replayModal').classList.add('hidden');
  $('recbadge').classList.add('hidden'); $('recbadge').classList.remove('replay');
  $('btnRec').disabled = false;
}

// ---------- telemetria (estado derivado do modelo) ----------
function vec(a, b) { return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }; }
function angleAt(p, a, b) {
  const u = vec(p, a), v = vec(p, b);
  const du = Math.hypot(u.x, u.y, u.z), dv = Math.hypot(v.x, v.y, v.z);
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv || 1);
  return Math.round(Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
}
let calibrated = false;
let anomalyT0 = 0; // instante em que a anomalia começou (p/ alerta preditivo)
function updateTelemetry(w, infMs) {
  const key = [11, 12, 23, 24, 25, 26, 13, 14];
  const conf = key.reduce((s, i) => s + (w[i].visibility ?? 1), 0) / key.length;

  if (!calibrated && conf > 0.6) calibrated = true;

  // ---- sincronia (data assimilation): erro previsão x medição ----
  const sync = Math.max(0, Math.min(100, Math.round(100 * (1 - twin.syncError / 0.18))));
  $('syncv').textContent = sync + '%';
  $('syncfill').style.width = sync + '%';
  $('syncfill').style.background = sync > 70 ? 'linear-gradient(90deg,#34d399,#22d3ee)'
    : sync > 45 ? 'linear-gradient(90deg,#fbbf24,#22d3ee)' : 'linear-gradient(90deg,#f43f5e,#fbbf24)';

  if (calibrated) {
    if (sync < 45) setStatus('RECALIBRANDO', 'warn');
    else setStatus(conf > 0.55 ? 'RASTREANDO' : 'PARCIAL', conf > 0.55 ? 'ok' : 'warn');
  }

  $('conf').textContent = Math.round(conf * 100) + '%';
  $('conf').className = conf > 0.7 ? 'ok' : conf > 0.45 ? 'warn' : 'crit';
  $('lat').textContent = infMs.toFixed(0) + ' ms';

  const eL = angleAt(w[13], w[11], w[15]);
  const eR = angleAt(w[14], w[12], w[16]);
  const kL = angleAt(w[25], w[23], w[27]);
  const kR = angleAt(w[26], w[24], w[28]);
  $('elbow').textContent = `${eL}° / ${eR}°`;
  $('knee').textContent = `${kL}° / ${kR}°`;

  // inclinação do tronco em relação à vertical
  const midSh = { x: (w[11].x + w[12].x) / 2, y: (w[11].y + w[12].y) / 2, z: (w[11].z + w[12].z) / 2 };
  const midHip = { x: (w[23].x + w[24].x) / 2, y: (w[23].y + w[24].y) / 2, z: (w[23].z + w[24].z) / 2 };
  const tv = vec(midHip, midSh);
  const tilt = Math.round(Math.acos(Math.abs(tv.y) / (Math.hypot(tv.x, tv.y, tv.z) || 1)) * 180 / Math.PI);
  $('torso').textContent = tilt + '°';

  // rótulos 3D
  twin.setAnnotations({ elbowL: eL + '°', elbowR: eR + '°', kneeL: kL + '°', kneeR: kR + '°', torso: 'tronco ' + tilt + '°' });

  // ---- anomalia ergonômica (analogia c/ manutenção preditiva) ----
  const shoulderW = Math.hypot(w[11].x - w[12].x, w[11].y - w[12].y, w[11].z - w[12].z) || 0.3;
  const shoulderSkew = Math.abs(w[11].y - w[12].y) / shoulderW; // ombros desnivelados
  let level = 0, msg = 'Ergonomia: postura adequada.';
  if (tilt > 32) { level = Math.max(level, Math.min(1, (tilt - 32) / 30)); msg = `Inclinação de tronco elevada (${tilt}°).`; }
  if (shoulderSkew > 0.22) { level = Math.max(level, Math.min(1, (shoulderSkew - 0.22) / 0.3)); msg = 'Ombros desnivelados — carga assimétrica.'; }

  twin.setAlarm(level);
  const ergo = $('ergo'), et = $('ergoTxt');
  if (level > 0.05) {
    if (!anomalyT0) anomalyT0 = performance.now();
    const held = (performance.now() - anomalyT0) / 1000;
    if (held > 2.5) { ergo.className = 'ergo crit'; et.textContent = `⚠ ${msg} Risco de fadiga/lesão se mantido — recomenda-se correção.`; }
    else { ergo.className = 'ergo warn'; et.textContent = `▲ ${msg}`; }
  } else {
    anomalyT0 = 0; ergo.className = 'ergo ok'; et.textContent = 'Ergonomia: postura adequada.';
  }
}

function setStatus(txt, cls) {
  const el = $('status');
  el.textContent = txt; el.className = cls;
}

// ---------- controles ----------
function applyMirror() { video.classList.toggle('mirror', mirror); twin.setMirror(mirror); }

$('btnCamera').onclick = startCamera;
$('btnSync').onclick = sync;
$('optGhost').onchange = (e) => twin.setGhost(e.target.checked);
$('optLabels').onchange = (e) => twin.setAnnotationsVisible(e.target.checked);
$('optRotate').onchange = (e) => twin.setAutoRotate(e.target.checked);
$('optTrail').onchange = (e) => twin.setTrail(e.target.checked);
$('optMirror').onchange = (e) => { mirror = e.target.checked; applyMirror(); };
$('optSmooth').oninput = (e) => twin.setSmoothing(+e.target.value / 100);
$('btnRec').onclick = startRecording;
$('rmPlay').onclick = togglePlay;
$('rmRestart').onclick = restartReplay;
$('rmDiscard').onclick = discardReplay;
$('rmClose').onclick = discardReplay;
$('replayModal').onclick = (e) => { if (e.target.id === 'replayModal') discardReplay(); }; // clique no fundo descarta
twin.setSmoothing(0.55);

window.addEventListener('resize', () => twin.resize());

// pré-carrega o modelo em segundo plano enquanto a tela inicial está aberta
boot();
