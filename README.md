# Digital Twin · Avatar 3D ao Vivo

Demo de **gêmeo digital** em tempo real: a câmera do notebook é o **sensor**, a visão
computacional (MediaPipe Pose) extrai 33 articulações do corpo em 3D, e um **avatar
holográfico** (Three.js + bloom) reconstrói você em tempo real — orbitável com o mouse.
Tudo roda **localmente no navegador**, nada é enviado para a internet.

## Por que isso "é" um gêmeo digital (e não só um espelho)

| Pilar | Como aparece na demo |
|------|----------------------|
| **Modelo, não reflexo** | O twin reconstrói um esqueleto 3D real (articulações + ossos), não copia pixels. Você orbita a câmera em volta dele. |
| **Estado derivado** | A telemetria (ângulos de cotovelo/joelho, inclinação do tronco) é *calculada* do modelo — informação que a imagem não dá pronta. |
| **Sincronização** | Confiança de rastreamento e latência exibidas; o twin segue o sensor em tempo real e se recupera quando o sinal volta. |

## Como rodar

```bash
npm install          # dependências (Three.js + MediaPipe)
npm run fetch-model  # baixa o modelo de pose + runtime WASM para /public (uma vez, precisa de internet)
npm run dev          # abre em http://localhost:5173
```

Depois do `fetch-model`, a demo roda **offline**. Clique em **"Ativar câmera"** e permita o acesso.

> A câmera só funciona em `localhost` ou HTTPS (requisito do navegador). O `npm run dev` já serve em `localhost`.

## Dicas de captura
- Fique a ~2 m da câmera, **corpo inteiro visível** e boa iluminação.
- `npm run build` gera a versão de produção em `dist/` (pode hospedar em qualquer HTTPS).

## Roteiro de apresentação (~90s)
1. **"Esquerda é o real, direita é o gêmeo digital."** Mexa os braços → o avatar 3D segue.
2. **Arraste o mouse** no painel direito para orbitar em volta do avatar enquanto se move
   → prova que é um modelo 3D de verdade, não vídeo. Ligue **Auto-orbitar** para deixar girando.
3. Aponte para a **telemetria** (ângulos, confiança, latência): *"o twin não só te copia,
   ele entende seu estado."*
4. Ligue o **Rastro** e faça um movimento amplo → efeito visual forte.
5. Saia de quadro → **SINAL PERDIDO**; volte → ele re-sincroniza sozinho.

## Stack
- **MediaPipe Tasks Vision** — Pose Landmarker (33 pontos, world landmarks 3D)
- **Three.js** — render 3D, `UnrealBloomPass` para o glow holográfico, `OrbitControls`
- **Vite** — dev server e build

## Estrutura
```
src/
  main.js       orquestra loop, telemetria e controles
  pose.js       carrega o MediaPipe Pose Landmarker
  twin3d.js     cena Three.js + avatar holográfico + bloom
  realview.js   overlay 2D do esqueleto sobre a webcam
scripts/
  fetch-model.mjs   baixa modelo + copia WASM para /public
```
