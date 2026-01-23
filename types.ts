
export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  GENERATING = 'GENERATING',
  REPLAY = 'REPLAY'
}

export enum Difficulty {
  BABY = 'Baby',
  EASY = 'Easy',
  NORMAL = 'Normal',
  HARD = 'Hard',
  HARDCORE = 'Hardcore'
}

export enum GasPhase {
  IDLE = 'IDLE',
  FILLING = 'FILLING',
  FULL = 'FULL',
  FADING = 'FADING'
}

export interface ReplayFrame {
  t: number; // timestamp in ms
  p: { x: number, y: number, z: number }; // position
  r: { x: number, y: number, z: number }; // rotation (Euler)
  q: { x: number, y: number, z: number, w: number }; // rotation (Quaternion)
  s: 0 | 1 | 2; // selected slot
  b: number; // battery
  f: boolean; // flashlight on
  
  // Atmospheric & Map Fields
  ib: boolean; // isBlackout
  if: boolean; // isFlickerActive
  im: boolean; // isMapOpen
  mr: number;  // mapViewRemaining
  cr: number;  // cooldownRemaining
  
  // Gas Fields
  gl?: number; // gasLevel (0-1)
  et?: number; // exposureTime (cumulative damage)
}

export interface ReplayEvent {
  type: 'marker' | 'PHASE_CHANGE' | 'MAP_OPEN' | 'MAP_CLOSE';
  t: number;
  data?: any;
}

export interface SavedEventState {
  // Horror Cycle
  phase: string;
  timer: number;
  blackoutDurationStore: number;
  battery: number;
  flashlightOn: boolean;
  intensityMultiplier: number;
  isBlackout: boolean;
  
  // Gas Cycle
  gasPhase?: GasPhase;
  gasTimer?: number;
  gasDurationStore?: number; 
  gasLevel?: number;
  exposureTime?: number;
}

export interface SavedMaze {
  id: string;
  name: string;
  seed: string | number;
  difficulty: Difficulty;
  timeSpent: number; // in milliseconds
  finalTimerMs?: number; 
  completed: boolean;
  died?: boolean; // New field for gas death
  thumbnail: string; 
  gridSize: number;
  gridData: string; 
  playerPos: { x: number, y: number, z: number };
  playerRot: { x: number, y: number, z: number };
  remainingMarkers: number; 
  markers: Array<{ x: number, y: number, z: number, nx: number, ny: number, nz: number }>;
  visited: string[]; 
  mapCooldownRemaining?: number; 
  mapViewRemaining?: number; 
  isMapOpen?: boolean; 
  eventState?: SavedEventState; 
  recording?: {
    frames: ReplayFrame[];
    events: ReplayEvent[];
    totalTime: number;
  };
}

export interface AppOptions {
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
  shadowQuality: 'Low' | 'Medium' | 'High';
}

export interface GenerationConfig {
  seed: string;
  difficulty: Difficulty;
}

export type GridCell = 0 | 1 | 2; // 0 = Path, 1 = Wall, 2 = Exit Void