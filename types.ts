
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

export interface ReplayFrame {
  t: number; // timestamp in ms
  p: { x: number, y: number, z: number }; // position
  r: { x: number, y: number, z: number }; // rotation (Euler) - kept for fallback
  q: { x: number, y: number, z: number, w: number }; // rotation (Quaternion) - for smooth Slerp
  s: 0 | 1 | 2; // selected slot
  b: number; // battery
  f: boolean; // flashlight on
  
  // New Atmospheric & Map Fields
  ib: boolean; // isBlackout
  if: boolean; // isFlickerActive
  im: boolean; // isMapOpen
  mr: number;  // mapViewRemaining (seconds)
  cr: number;  // cooldownRemaining (seconds)
}

export interface ReplayEvent {
  type: 'marker' | 'PHASE_CHANGE' | 'MAP_OPEN' | 'MAP_CLOSE';
  t: number;
  data?: any;
}

export interface SavedEventState {
  phase: string;
  timer: number;
  blackoutDurationStore: number;
  battery: number;
  flashlightOn: boolean;
  intensityMultiplier: number;
  isBlackout: boolean;
}

export interface SavedMaze {
  id: string;
  name: string;
  seed: string | number;
  difficulty: Difficulty;
  timeSpent: number; // in milliseconds
  finalTimerMs?: number; // Snapshot of time upon completion
  completed: boolean;
  thumbnail: string; // Data URL
  gridSize: number;
  gridData: string; // Base64 or JSON string of the layout
  playerPos: { x: number, y: number, z: number };
  playerRot: { x: number, y: number, z: number };
  remainingMarkers: number; // Hotbar slot 2 count
  markers: Array<{ x: number, y: number, z: number, nx: number, ny: number, nz: number }>;
  visited: string[]; // Array of "x,y" coordinates for explored map cells
  mapCooldownRemaining?: number; // Persisted cooldown state
  mapViewRemaining?: number; // Persisted active view timer
  isMapOpen?: boolean; // Persisted open state
  eventState?: SavedEventState; // Persisted horror event state
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
