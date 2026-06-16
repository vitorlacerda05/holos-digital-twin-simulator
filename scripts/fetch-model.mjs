// Baixa o modelo de pose e copia o runtime WASM do MediaPipe para /public,
// para que a demo rode 100% offline depois do setup.
import { createWriteStream } from 'node:fs';
import { mkdir, cp, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const modelDir = join(root, 'public', 'models');
const modelPath = join(modelDir, 'pose_landmarker_full.task');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'wasm');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const total = +res.headers['content-length'] || 0;
      let got = 0;
      const file = createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (total) process.stdout.write(`\r  baixando modelo… ${(got / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('\n'); resolve(); }));
    }).on('error', reject);
    get(url);
  });
}

const exists = (p) => access(p).then(() => true).catch(() => false);

async function main() {
  await mkdir(modelDir, { recursive: true });
  if (await exists(modelPath)) console.log('✓ modelo já presente');
  else { console.log('→ baixando modelo de pose…'); await download(MODEL_URL, modelPath); console.log('✓ modelo salvo em public/models/'); }

  if (!(await exists(wasmSrc))) {
    console.warn('! WASM do MediaPipe não encontrado em node_modules — rode "npm install" primeiro.');
    process.exit(1);
  }
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('✓ runtime WASM copiado para public/wasm/');
  console.log('\nPronto. Rode:  npm run dev');
}
main().catch((e) => { console.error('Falha no setup:', e.message); process.exit(1); });
