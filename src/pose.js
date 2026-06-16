import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Conexões do esqueleto (índices do BlazePose / MediaPipe Pose — 33 pontos).
export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],      // tronco + braços
  [11, 23], [12, 24], [23, 24],                          // tronco -> quadril
  [23, 25], [25, 27], [24, 26], [26, 28],                // pernas
  [27, 31], [28, 32], [27, 29], [28, 30],                // pés
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22], // mãos
  [0, 11], [0, 12],                                      // cabeça -> ombros
];

export async function createPose(onLoad) {
  onLoad?.('Carregando runtime de visão (WASM)…');
  // wasm e modelo servidos localmente a partir de /public para funcionar offline.
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  onLoad?.('Carregando modelo de pose…');
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/models/pose_landmarker_full.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  onLoad?.('');
  return landmarker;
}
