import { POSE_CONNECTIONS } from './pose.js';

// Mapeia coordenadas normalizadas (0..1) para a área visível do vídeo (object-fit: cover).
function coverMap(canvas, video, mirror) {
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  return (xn, yn) => {
    let px = ox + xn * dw;
    const py = oy + yn * dh;
    if (mirror) px = cw - px;
    return [px, py];
  };
}

// cor por pessoa (combina com os avatares 3D)
export const PERSON_COLORS = ['#22d3ee', '#34d399', '#a78bfa'];

// landmarksList: array de poses (cada uma é um array de 33 landmarks normalizados)
export function drawSkeleton(canvas, video, landmarksList, mirror) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarksList || !landmarksList.length) return;

  const map = coverMap(canvas, video, mirror);

  landmarksList.forEach((landmarks, pi) => {
    if (!landmarks) return;
    const col = PERSON_COLORS[pi % PERSON_COLORS.length];

    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    for (const [i, j] of POSE_CONNECTIONS) {
      const a = landmarks[i], b = landmarks[j];
      if (!a || !b) continue;
      const [ax, ay] = map(a.x, a.y);
      const [bx, by] = map(b.x, b.y);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();

    ctx.shadowBlur = 6 * dpr;
    for (let i = 0; i < landmarks.length; i++) {
      const [x, y] = map(landmarks[i].x, landmarks[i].y);
      const r = (i === 0 ? 7 : 4) * dpr;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.shadowBlur = 0;
}
