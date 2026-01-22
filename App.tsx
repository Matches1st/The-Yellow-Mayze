import React, { useEffect, useRef, useState, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { GameState, Difficulty, SavedMaze, AppOptions, GridCell, ReplayFrame, ReplayEvent } from './types';
import { SETTINGS, COLORS, DEFAULT_OPTIONS } from './constants';
import { generateMaze } from './services/mazeGenerator';
import { audioManager } from './services/audioManager';
import { Persistence } from './services/persistence';
import { GameOverlay } from './components/GameOverlay';
import { buildScene } from './services/sceneBuilder';
import { CollisionDetector } from './services/collisionDetector';
import { EventSystem, EventPhase } from './services/eventSystem';

// --- Error Boundary Component ---
interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("CRITICAL APP FAILURE:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black text-[#C9B458] font-mono flex flex-col items-center justify-center p-8 z-[9999]">
          <h1 className="text-6xl font-bold mb-8 text-red-600 animate-pulse">SYSTEM FAILURE</h1>
          <div className="border-4 border-red-900 bg-[#111] p-6 max-w-3xl w-full mb-8 rounded shadow-2xl">
            <p className="text-xl mb-4 text-white">The simulation encountered a fatal error.</p>
            <pre className="text-xs text-red-400 overflow-auto max-h-48 whitespace-pre-wrap font-sans bg-black p-4 border border-red-900">
              {this.state.error?.toString() || "Unknown Error"}
            </pre>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-4 bg-[#C9B458] text-black font-bold text-2xl hover:bg-white hover:scale-105 transition-all"
          >
            REBOOT SYSTEM
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Global Three.js objects
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let raycaster = new THREE.Raycaster();

// Game logic Globals
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let isGrounded = false;
let prevTime = performance.now();

// Feature Managers
const eventSystem = new EventSystem();
let pointLights: THREE.PointLight[] = [];
let markers: THREE.Mesh[] = [];
let flashlight: THREE.SpotLight;
let interactableObjects: THREE.Object3D[] = [];

// Light Culling Configuration
const CULL_DISTANCE = 25; 
const CULL_DIST_SQ = CULL_DISTANCE * CULL_DISTANCE;
const RECORD_INTERVAL = 50; // Record every 50ms
const FALL_TRIGGER_Y = -1.5; // Early trigger for shallow 2.5 unit pit

const GameContent: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  
  // React State for UI
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [options, setOptions] = useState<AppOptions>(Persistence.getOptions());
  const [currentMaze, setCurrentMaze] = useState<SavedMaze | null>(null);
  
  // TIMER STATE
  const [timeSpent, setTimeSpent] = useState(0); 
  const timeSpentRef = useRef(0); 

  // EXIT SEQUENCE STATE
  const [exitOpacity, setExitOpacity] = useState(0);
  // NONE -> PAUSED (Suspend mid-air) -> FADING (White screen) -> FINISHED
  const exitStateRef = useRef<'NONE' | 'PAUSED' | 'FADING' | 'FINISHED'>('NONE');
  const exitStartTimeRef = useRef(0);
  const finalTimeRef = useRef(0);

  const [battery, setBattery] = useState(100);
  // Selected Slot only tracks Hand (0) or Markers (2). Map (1) is a separate ability.
  const [selectedSlot, setSelectedSlot] = useState<0 | 2>(0); 
  const [markerCount, setMarkerCount] = useState(20);
  const [isBlackout, setIsBlackout] = useState(false);

  // MAP MECHANICS
  const [mapVisible, setMapVisible] = useState(false);
  const [mapCooldown, setMapCooldown] = useState(0); // For UI countdown
  const [mapViewTime, setMapViewTime] = useState(0); // For UI countdown (active view)
  const mapCooldownRef = useRef(0); // Logic authoritative
  const mapViewTimerRef = useRef(0); // Tracks the view time

  // Replay State
  const [replayTime, setReplayTime] = useState(0);
  const [replayDuration, setReplayDuration] = useState(0);
  const [replayPaused, setReplayPaused] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);

  // Mutable Refs for Game Loop
  const mazeDataRef = useRef<{grid: GridCell[][], size: number} | null>(null);
  const extraCollidersRef = useRef<THREE.Box3[]>([]); // Store pit wall colliders
  const playerExploredRef = useRef(new Set<string>()); // Stores "x,z" keys of visited cells
  const requestIdRef = useRef<number>(0);
  const footstepDistRef = useRef(0); // Accumulator for rhythmic footsteps
  
  // Map Rendering Optimization Refs
  const mapNeedsUpdateRef = useRef(true);
  const lastMapPosRef = useRef({ x: 0, z: 0 });

  // Persistence Refs
  const markersDataRef = useRef<Array<{ x: number, y: number, z: number, nx: number, ny: number, nz: number }>>([]);
  const markerMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const markerGeometryRef = useRef<THREE.PlaneGeometry | null>(null);
  const lightPanelMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  
  // Recording Refs
  const recordingFramesRef = useRef<ReplayFrame[]>([]);
  const recordingEventsRef = useRef<ReplayEvent[]>([]);
  const lastRecordTimeRef = useRef<number>(0);
  const lastPhaseRef = useRef<EventPhase>(EventPhase.IDLE_DELAY); // Track phase changes

  // Replay Data Ref (Loaded)
  const loadedReplayRef = useRef<{ frames: ReplayFrame[], events: ReplayEvent[] } | null>(null);

  // Helper to safely lock controls
  const lockControls = useCallback(() => {
      const c = controlsRef.current;
      if (c && !c.isLocked) {
          try {
              c.lock();
          } catch (e) {
              console.warn("PointerLock failed:", e);
          }
      }
  }, []);

  const activateMap = useCallback(() => {
      // STRICT: Cannot open if cooldown > 0 or already open
      if (mapCooldownRef.current > 0 || mapVisible || isBlackout || !currentMaze) return;

      setMapVisible(true);
      
      // Difficulty-based View Duration:
      // Baby/Easy: 3s
      // Normal: 20s
      // Hard/Hardcore: 30s
      const diff = currentMaze.difficulty;
      let duration = 20.0;
      if (diff === Difficulty.BABY || diff === Difficulty.EASY) duration = 3.0;
      else if (diff === Difficulty.HARD || diff === Difficulty.HARDCORE) duration = 30.0;
      
      mapViewTimerRef.current = duration;
      setMapViewTime(duration);
      
      audioManager.playMapOpen();
      mapNeedsUpdateRef.current = true; // Force render

      // Log Event for Replay
      recordingEventsRef.current.push({
          type: 'MAP_OPEN',
          t: timeSpentRef.current
      });
  }, [mapVisible, isBlackout, currentMaze]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); 
    scene.fog = new THREE.FogExp2(COLORS.FOG, 0.015);

    // CRITICAL FIX: Unconditional Ambient Light
    // Prevents black screen if dynamic lights fail to generate or load
    const ambientFallback = new THREE.AmbientLight(0xFFFFFF, 0.1);
    scene.add(ambientFallback);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(options.fov, window.innerWidth / window.innerHeight, 0.1, 100);
    
    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // 4. Controls
    const controls = new PointerLockControls(camera, mountRef.current);
    controlsRef.current = controls;

    controls.addEventListener('lock', () => {
      setGameState(prev => (prev === GameState.REPLAY ? GameState.REPLAY : GameState.PLAYING));
    });
    
    controls.addEventListener('unlock', () => {
      setGameState(prev => {
        if (prev === GameState.PLAYING) return GameState.PAUSED;
        return prev;
      });
    });

    // 5. Lighting & Flashlight
    flashlight = new THREE.SpotLight(0xFFFFD0, 0, 35, 0.55, 0.5, 2);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    flashlight.castShadow = true; 
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);

    // 7. Marker Assets Init
    const cvs = document.createElement('canvas'); cvs.width=64; cvs.height=64;
    const ctx = cvs.getContext('2d')!;
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 10;
    ctx.moveTo(10,10); ctx.lineTo(54,54); ctx.stroke();
    ctx.moveTo(54,10); ctx.lineTo(10,54); ctx.stroke();
    const tex = new THREE.CanvasTexture(cvs);
    
    markerMaterialRef.current = new THREE.MeshBasicMaterial({ 
        map: tex, 
        transparent: true, 
        polygonOffset: true, 
        polygonOffsetFactor: -2,
        color: 0x000000 // Start Black
    });
    markerGeometryRef.current = new THREE.PlaneGeometry(0.6, 0.6);

    // 8. Event Listeners
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current) mountRef.current.innerHTML = '';
      cancelAnimationFrame(requestIdRef.current!);
      controls.dispose();
      controlsRef.current = null;
      if (markerMaterialRef.current) markerMaterialRef.current.dispose();
      if (markerGeometryRef.current) markerGeometryRef.current.dispose();
      audioManager.stopAmbience();
    };
  }, []);

  // Sync Options (FOV, Volume, Sensitivity)
  useEffect(() => {
    if (camera) {
        camera.fov = options.fov;
        camera.updateProjectionMatrix();
    }
    
    // APPLY MOUSE SENSITIVITY
    if (controlsRef.current) {
        // PointerLockControls has a .pointerSpeed property (default 1.0)
        // We map the 0.1 - 5.0 slider directly to this multiplier.
        controlsRef.current.pointerSpeed = options.mouseSensitivity;
    }

    audioManager.setMasterVolume(options.masterVolume);
  }, [options]);

  // Force map redraw on Slot or State change
  useEffect(() => {
    mapNeedsUpdateRef.current = true;
  }, [selectedSlot, gameState, mapVisible]);

  // Handle Ambience Pausing
  useEffect(() => {
    if (gameState === GameState.PAUSED) {
        audioManager.pauseAmbience();
    } else if (gameState === GameState.PLAYING) {
        audioManager.resumeAmbience();
    }
  }, [gameState]);

  // --- INPUT HANDLING ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Replay Hotkeys
      if (gameState === GameState.REPLAY) {
        switch(e.code) {
          case 'Space': setReplayPaused(p => !p); break;
          case 'ArrowLeft': setReplayTime(t => Math.max(0, t - 5000)); break;
          case 'ArrowRight': setReplayTime(t => Math.min(replayDuration, t + 5000)); break;
          case 'Comma': setReplayTime(t => Math.max(0, t - 500)); break; 
          case 'Period': setReplayTime(t => Math.min(replayDuration, t + 500)); break;
        }
        return;
      }

      if (gameState !== GameState.PLAYING) return;
      switch(e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        
        // --- SELECTION LOGIC ---
        // '1' activates Map Ability (if allowed)
        case 'Digit1': 
            activateMap(); 
            break;
        // '2' toggles Markers (Slot 2 or 0)
        case 'Digit2': 
            setSelectedSlot(prev => prev === 2 ? 0 : 2); 
            break;
            
        case 'KeyF': 
          eventSystem.toggleFlashlight(); 
          break;
        case 'KeyP':
          if (controlsRef.current?.isLocked) {
              eventSystem.forceEventSequence();
          }
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (gameState !== GameState.PLAYING) return;
      switch(e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
      }
    };
    
    const onMouseDown = (e: MouseEvent) => {
      if (gameState === GameState.REPLAY) return;

      const controls = controlsRef.current;
      if (!controls) return;

      if (gameState !== GameState.PLAYING) return;
      
      if (e.button === 0 && !controls.isLocked) {
        lockControls();
      }
      
      if (e.button === 2 && selectedSlot === 2 && markerCount > 0) {
        placeMarker();
      }
    };

    // NOTE: Wheel listener completely removed to prevent accidental scrolling

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousedown', onMouseDown);
    }
  }, [gameState, selectedSlot, markerCount, replayDuration, lockControls, activateMap]);

  // --- GAME LOOP ---
  const animate = useCallback(() => {
    requestIdRef.current = requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);
    prevTime = time;

    // --- REPLAY LOGIC ---
    if (gameState === GameState.REPLAY && loadedReplayRef.current) {
        const frames = loadedReplayRef.current.frames;
        
        if (frames.length > 0) {
            // Update Time
            if (!replayPaused) {
                setReplayTime(prev => {
                    const next = prev + delta * 1000 * replaySpeed;
                    return Math.min(next, frames[frames.length-1].t);
                });
            }

            // Find Interpolation Frames
            let lower = 0; let upper = frames.length - 1; let idx = 0;
            while (lower <= upper) {
                const mid = Math.floor((lower + upper) / 2);
                if (frames[mid].t <= replayTime) { idx = mid; lower = mid + 1; } else { upper = mid - 1; }
            }
            const frameA = frames[idx]; const frameB = frames[idx + 1];
            
            // Apply State from Frame (Nearest neighbor for flags, Interpolation for pos)
            if (frameA && frameB) {
                const range = frameB.t - frameA.t;
                const progress = range > 0 ? (replayTime - frameA.t) / range : 0;
                const alpha = Math.max(0, Math.min(1, progress));
                
                // Position & Rotation
                camera.position.set(
                   frameA.p.x + (frameB.p.x - frameA.p.x) * alpha,
                   frameA.p.y + (frameB.p.y - frameA.p.y) * alpha,
                   frameA.p.z + (frameB.p.z - frameA.p.z) * alpha
                );
                if (frameA.q && frameB.q) {
                    const qA = new THREE.Quaternion(frameA.q.x, frameA.q.y, frameA.q.z, frameA.q.w);
                    const qB = new THREE.Quaternion(frameB.q.x, frameB.q.y, frameB.q.z, frameB.q.w);
                    qA.slerp(qB, alpha);
                    camera.quaternion.copy(qA);
                } else {
                    camera.rotation.set(
                        frameA.r.x + (frameB.r.x - frameA.r.x) * alpha,
                        frameA.r.y + (frameB.r.y - frameA.r.y) * alpha,
                        frameA.r.z + (frameB.r.z - frameA.r.z) * alpha
                    );
                }

                // UI & Event State (Use frameA/nearest)
                const f = alpha > 0.5 ? frameB : frameA;
                
                setBattery(f.b);
                setIsBlackout(f.ib);
                setMapVisible(f.im);
                setMapCooldown(f.cr);

                flashlight.intensity = f.f ? 6 : 0;

                // --- REPLAY VISUALS (Events) ---
                // Re-implement visual logic based on frame state
                
                // 1. Calculate Intensity Multiplier
                let intensityMult = 1.0;
                if (f.ib) {
                    intensityMult = 0.0;
                } else if (f.if) {
                    // Re-generate flicker if active
                    const strobe = Math.sin(Date.now() * 0.047) > 0;
                    intensityMult = strobe ? 1.0 : 0.1;
                }

                // 2. Apply Fog & Emissive
                if (scene.fog && scene.fog instanceof THREE.FogExp2) {
                  if (f.ib) {
                      // Blackout
                      if (scene.fog.color.getHex() !== 0x000000) scene.fog.color.setHex(0x000000);
                      if (scene.fog.density !== 0.08) scene.fog.density = 0.08;
                      if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.setHex(0x050505);
                      if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0xFFFFFF); // Glow
                  } else {
                      // Normal
                      if (scene.fog.color.getHexString() !== COLORS.FOG.replace('#','').toLowerCase()) scene.fog.color.set(COLORS.FOG);
                      if (scene.fog.density !== 0.015) scene.fog.density = 0.015;
                      if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
                      if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0x000000); // Ink
                  }
                }

                // 3. Apply Light Intensity (Culling)
                const pPos = camera.position;
                const targetIntensity = 5.0 * intensityMult;
                for (let i = 0; i < pointLights.length; i++) {
                    const light = pointLights[i];
                    const distSq = light.position.distanceToSquared(pPos);
                    if (distSq > CULL_DIST_SQ) {
                        light.visible = false;
                    } else {
                        light.visible = true;
                        light.intensity = targetIntensity;
                    }
                }

            } else if (frameA) {
                camera.position.set(frameA.p.x, frameA.p.y, frameA.p.z);
            }

            // Restore Markers & Explored Map for Replay
            markers.forEach(m => scene.remove(m)); markers = [];
            const activeEvents = loadedReplayRef.current.events.filter(e => e.t <= replayTime && e.type === 'marker');
            activeEvents.forEach(e => {
                createMarkerMesh(new THREE.Vector3(e.data.x, e.data.y, e.data.z), new THREE.Vector3(e.data.nx, e.data.ny, e.data.nz));
            });
            setMarkerCount(20 - activeEvents.length);
            
            playerExploredRef.current.clear();
            for(let i=0; i <= idx; i+=5) { 
               const f = frames[i];
               const cx = Math.round(f.p.x / SETTINGS.UNIT_SIZE);
               const cz = Math.round(f.p.z / SETTINGS.UNIT_SIZE);
               playerExploredRef.current.add(`${cx},${cz}`);
            }
            mapNeedsUpdateRef.current = true;
        }
        
        // Render map if replay frame says it's visible
        updateMiniMap();
        renderer.render(scene, camera);
        return; 
    }

    // --- PLAYING LOGIC ---
    const controls = controlsRef.current;

    if (gameState === GameState.PLAYING && controls && controls.isLocked) {
      
      // 0. EXIT SEQUENCE HANDLER
      // State Machine: NONE -> PAUSED -> FADING -> FINISHED
      if (exitStateRef.current === 'PAUSED' || exitStateRef.current === 'FADING') {
          // Freeze position/physics during exit sequence
          velocity.set(0, 0, 0); 
          
          const elapsed = performance.now() - exitStartTimeRef.current;
          
          if (exitStateRef.current === 'PAUSED') {
              // Hover mid-air for 1 second
              if (elapsed > 1000) {
                  exitStateRef.current = 'FADING';
                  exitStartTimeRef.current = performance.now(); // Reset timer for fade
              }
          } else if (exitStateRef.current === 'FADING') {
              // Fade to white over 2.5 seconds
              const fadeDuration = 2500;
              const opacity = Math.min(1.0, elapsed / fadeDuration);
              setExitOpacity(opacity);

              if (opacity >= 1.0) {
                  exitStateRef.current = 'FINISHED';
                  completeMaze(finalTimeRef.current);
                  // CRITICAL FIX: DO NOT return to menu here. 
                  // completeMaze() will switch state to REPLAY and loop will handle it next frame.
              }
          }
      } else {
          // Normal Time Update
          timeSpentRef.current += delta * 1000;
          setTimeSpent(timeSpentRef.current);

          // --- MAP TIMERS (New Logic) ---
          if (mapVisible) {
              mapViewTimerRef.current -= delta;
              setMapViewTime(mapViewTimerRef.current);
              
              if (mapViewTimerRef.current <= 0) {
                  setMapVisible(false);
                  audioManager.playMapCooldownStart();
                  
                  // Difficulty-based Cooldown Duration:
                  // Baby/Easy: 20s
                  // Normal: 60s
                  // Hard/Hardcore: 80s
                  const diff = currentMaze?.difficulty || Difficulty.NORMAL;
                  let cooldown = 60.0;
                  if (diff === Difficulty.BABY || diff === Difficulty.EASY) cooldown = 20.0;
                  else if (diff === Difficulty.HARD || diff === Difficulty.HARDCORE) cooldown = 80.0;
                  
                  mapCooldownRef.current = cooldown;
                  setMapCooldown(cooldown);
                  
                  // Log Close Event
                  recordingEventsRef.current.push({ type: 'MAP_CLOSE', t: timeSpentRef.current });
              }
          } else if (mapCooldownRef.current > 0) {
              mapCooldownRef.current -= delta;
              if (mapCooldownRef.current <= 0) {
                  mapCooldownRef.current = 0;
                  setMapCooldown(0);
                  audioManager.playMapReady();
              } else {
                  setMapCooldown(mapCooldownRef.current);
              }
          }
          
          // 3. Physics & Collision (Only if not exiting)
          velocity.x -= velocity.x * 10.0 * delta;
          velocity.z -= velocity.z * 10.0 * delta;
          velocity.y -= SETTINGS.GRAVITY * delta; 
          direction.z = Number(moveForward) - Number(moveBackward);
          direction.x = Number(moveRight) - Number(moveLeft);
          direction.normalize();
          const isMovingLongitudinally = moveForward || moveBackward;
          const speed = isMovingLongitudinally ? SETTINGS.SPEED_WALK : 3.5;
          if (moveForward || moveBackward) velocity.z -= direction.z * speed * 10.0 * delta;
          if (moveLeft || moveRight) velocity.x -= direction.x * speed * 10.0 * delta;
          controls.moveRight(-velocity.x * delta);
          controls.moveForward(-velocity.z * delta);
          
          if (mazeDataRef.current) {
            const pos = camera.position.clone();
            const corrected = CollisionDetector.resolveCollision(
                pos, 
                mazeDataRef.current.grid, 
                mazeDataRef.current.size,
                extraCollidersRef.current // Pass Pit Walls
            );
            camera.position.x = corrected.x;
            camera.position.z = corrected.z;
            
            const gx = Math.round(corrected.x / SETTINGS.UNIT_SIZE);
            const gz = Math.round(corrected.z / SETTINGS.UNIT_SIZE);
            const cell = mazeDataRef.current.grid[gz]?.[gx];
            if (cell === 2) {
                // VOID LOGIC:
                // Check for mid-fall trigger
                // SHALLOW TRIGGER: y < -1.5 
                // With pit depth 2.5, this triggers ~1m before bottom
                if (camera.position.y < FALL_TRIGGER_Y && exitStateRef.current === 'NONE') {
                    // Trigger Exit Sequence: Abrupt Freeze
                    exitStateRef.current = 'PAUSED';
                    exitStartTimeRef.current = performance.now();
                    finalTimeRef.current = timeSpentRef.current; // FREEZE TIMER
                    
                    // Abruptly stop player to create "hanging" illusion
                    velocity.set(0, 0, 0); 
                    
                    audioManager.playWin(); // WHOOSH
                }

                // Standard "Void" fall death check (fallback if glitch)
                if (camera.position.y < -10) {
                    if (exitStateRef.current === 'NONE') completeMaze();
                }
                isGrounded = false;
            } else {
                if (camera.position.y < SETTINGS.PLAYER_HEIGHT) {
                velocity.y = 0;
                camera.position.y = SETTINGS.PLAYER_HEIGHT;
                isGrounded = true;
                } else {
                isGrounded = false;
                }
            }
          }
          camera.position.y += velocity.y * delta;
      }

      // 1. EXPLORATION TRACKING
      const cx = Math.round(camera.position.x / SETTINGS.UNIT_SIZE);
      const cz = Math.round(camera.position.z / SETTINGS.UNIT_SIZE);
      
      if (cx !== lastMapPosRef.current.x || cz !== lastMapPosRef.current.z) {
          lastMapPosRef.current = { x: cx, z: cz };
          mapNeedsUpdateRef.current = true;
          playerExploredRef.current.add(`${cx},${cz}`);
      }

      // 2. RECORDING (Stop recording if exiting to prevent weird replay tail)
      if (exitStateRef.current === 'NONE') {
          // Track event phase changes
          const evState = eventSystem.update(delta);
          if (evState.phase !== lastPhaseRef.current) {
              recordingEventsRef.current.push({
                  type: 'PHASE_CHANGE',
                  t: timeSpentRef.current,
                  data: { from: lastPhaseRef.current, to: evState.phase }
              });
              lastPhaseRef.current = evState.phase;
          }

          if (time - lastRecordTimeRef.current >= RECORD_INTERVAL) {
            lastRecordTimeRef.current = time;
            const quat = camera.quaternion;
            
            recordingFramesRef.current.push({
              t: timeSpentRef.current,
              p: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
              r: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
              q: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
              s: selectedSlot, 
              b: battery,
              f: evState.flashlightOn,
              // New Fields
              ib: evState.isBlackout,
              if: evState.phase === EventPhase.FLICKERING || evState.phase === EventPhase.RESTORING,
              im: mapVisible,
              mr: mapViewTimerRef.current,
              cr: mapCooldownRef.current
            });
          }

          // Events & Lighting Update
          setIsBlackout(evState.isBlackout);
          setBattery(evState.battery);
          
          if (evState.flashlightOn) {
              const batteryPct = evState.battery / 100;
              flashlight.intensity = 6 * batteryPct; 
              flashlight.angle = 0.55 * (0.5 + 0.5 * batteryPct); 
          } else {
              flashlight.intensity = 0;
          }

          // Update Fog/Visuals
          if (scene.fog && scene.fog instanceof THREE.FogExp2) {
              if (evState.isBlackout) {
                  if (scene.fog.color.getHex() !== 0x000000) scene.fog.color.setHex(0x000000);
                  if (scene.fog.density !== 0.08) scene.fog.density = 0.08;
                  if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.setHex(0x050505); 
                  if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0xFFFFFF);
              } else {
                  if (scene.fog.color.getHexString() !== COLORS.FOG.replace('#','').toLowerCase()) scene.fog.color.set(COLORS.FOG);
                  if (scene.fog.density !== 0.015) scene.fog.density = 0.015;
                  if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
                  if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0x000000);
              }
          }
          
          // Culling
          const pPos = camera.position;
          const targetIntensity = 5.0 * evState.intensityMultiplier;
          for (let i = 0; i < pointLights.length; i++) {
            const light = pointLights[i];
            const distSq = light.position.distanceToSquared(pPos);
            if (distSq > CULL_DIST_SQ) {
              if (light.visible) light.visible = false;
            } else {
              if (!light.visible) light.visible = true;
              if (light.intensity !== targetIntensity) light.intensity = targetIntensity;
            }
          }
      }

      // FOOTSTEP LOGIC
      // Accumulate distance moved and trigger sound every ~2.4 meters (cadence)
      const speedMag = Math.sqrt(velocity.x*velocity.x + velocity.z*velocity.z);
      if (isGrounded && speedMag > 0.5) {
         footstepDistRef.current += speedMag * delta;
         // Stride length ~ 2.4 units for the current speed feels right for audio
         if (footstepDistRef.current > 2.4) {
            audioManager.playFootstep();
            footstepDistRef.current = 0;
         }
      } else {
         // Reset accumulator if stopped so next step doesn't play immediately upon moving
         if (!isGrounded) footstepDistRef.current = 0;
      }

      updateMiniMap();
      renderer.render(scene, camera);
    }
    
    if (gameState === GameState.MENU) {
       camera.rotation.y += 0.001;
       renderer.render(scene, camera);
    }

  }, [gameState, replayTime, replayPaused, replaySpeed, selectedSlot, battery, markerCount, mapVisible, currentMaze]); 

  useEffect(() => {
    requestIdRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestIdRef.current!);
  }, [animate]);


  // --- GAME LOGIC HELPERS ---

  const startNewGame = (seed: string, difficulty: Difficulty, savedState?: SavedMaze, customName?: string) => {
    try {
        // Reset Exit State
        setExitOpacity(0);
        exitStateRef.current = 'NONE';
        exitStartTimeRef.current = 0;
        finalTimeRef.current = 0;
        footstepDistRef.current = 0; // Reset footstep cadence

        // Reset or Restore Event System
        if (savedState && savedState.eventState) {
            eventSystem.restoreState(savedState.eventState);
            lastPhaseRef.current = savedState.eventState.phase as EventPhase;
        } else {
            eventSystem.reset();
            lastPhaseRef.current = EventPhase.IDLE_DELAY;
        }
        
        // Scene Cleanup
        const disposeHierarchy = (node: THREE.Object3D) => {
          if (!node) return;
          for (let i = node.children.length - 1; i >= 0; i--) {
            const child = node.children[i];
            disposeHierarchy(child);
          }
          if ((node as THREE.Mesh).geometry) (node as THREE.Mesh).geometry.dispose();
          if ((node as THREE.Mesh).material) {
            const mat = (node as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat.dispose();
          }
        };
        scene.traverse((obj) => {
          if (obj !== camera && obj !== flashlight && obj !== flashlight.target) {
            disposeHierarchy(obj);
          }
        });
        scene.clear();
        scene.add(camera); 
        
        const data = generateMaze(seed, difficulty);
        mazeDataRef.current = data;
        playerExploredRef.current.clear();
        
        const built = buildScene(scene, data.grid, data.size);
        pointLights = built.lights; 
        interactableObjects = built.collisionMeshes;
        lightPanelMaterialRef.current = built.lightPanelMaterial;
        extraCollidersRef.current = built.extraColliders; // STORE PIT WALLS
        
        markers = [];
        markersDataRef.current = [];

        // FORCE LIGHTING RESET (Fix for black screen bug)
        // Explicitly set normal visual state immediately after build
        if (scene.fog instanceof THREE.FogExp2) {
            scene.fog.color.set(COLORS.FOG);
            scene.fog.density = 0.015;
        }
        if (lightPanelMaterialRef.current) {
            lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
        }
        // Force all lights visible and full intensity
        pointLights.forEach(l => {
            l.visible = true;
            l.intensity = 5;
        });
        setIsBlackout(false); // Sync React state

        // --- REPLAY MODE CHECK ---
        if (savedState && savedState.completed && savedState.recording) {
            // ... (Replay setup unchanged) ...
            setGameState(GameState.REPLAY);
            setCurrentMaze(savedState);
            loadedReplayRef.current = savedState.recording;
            setReplayDuration(savedState.recording.totalTime);
            setReplayTime(0);
            setReplayPaused(false);
            setReplaySpeed(1);
            if (savedState.recording.frames.length > 0) {
                const f = savedState.recording.frames[0];
                camera.position.set(f.p.x, f.p.y, f.p.z);
                if (f.q) camera.quaternion.set(f.q.x, f.q.y, f.q.z, f.q.w);
                else camera.rotation.set(f.r.x, f.r.y, f.r.z);
            }

            // LOAD MARKERS FOR REPLAY MAP
            // Populate markersDataRef with ALL saved markers for map visibility
            if (savedState.markers) {
                markersDataRef.current = savedState.markers;
            }

            if (controlsRef.current) controlsRef.current.unlock();
            return;
        }

        // --- NORMAL PLAY MODE ---
        recordingFramesRef.current = [];
        recordingEventsRef.current = [];
        setGameState(GameState.GENERATING);
        
        mapNeedsUpdateRef.current = true;

        if (savedState) {
          camera.position.set(savedState.playerPos.x, savedState.playerPos.y, savedState.playerPos.z);
          if (savedState.playerRot && typeof savedState.playerRot === 'object') {
            camera.rotation.set(savedState.playerRot.x, savedState.playerRot.y, savedState.playerRot.z);
          } else {
            camera.rotation.set(0, 0, 0); 
          }
          
          if (savedState.markers) {
            savedState.markers.forEach(m => {
              createMarkerMesh(new THREE.Vector3(m.x, m.y, m.z), new THREE.Vector3(m.nx, m.ny, m.nz));
              markersDataRef.current.push(m);
            });
          }
          setMarkerCount(savedState.remainingMarkers !== undefined ? savedState.remainingMarkers : 20);
          setCurrentMaze(savedState);
          setTimeSpent(savedState.timeSpent);
          timeSpentRef.current = savedState.timeSpent;

          if (savedState.visited) playerExploredRef.current = new Set(savedState.visited);

          // RESTORE COOLDOWN & MAP STATE
          mapCooldownRef.current = savedState.mapCooldownRemaining || 0;
          setMapCooldown(mapCooldownRef.current);
          
          if (savedState.isMapOpen && (savedState.mapViewRemaining || 0) > 0) {
              setMapVisible(true);
              mapViewTimerRef.current = savedState.mapViewRemaining!;
              setMapViewTime(savedState.mapViewRemaining!);
              mapNeedsUpdateRef.current = true;
          } else {
              setMapVisible(false);
              setMapViewTime(0);
          }

        } else {
          const sx = data.start.x * SETTINGS.UNIT_SIZE;
          const sz = data.start.y * SETTINGS.UNIT_SIZE;
          camera.position.set(sx, SETTINGS.PLAYER_HEIGHT, sz);
          camera.lookAt(sx, SETTINGS.PLAYER_HEIGHT, sz + 5);
          
          const existing = Persistence.getMazes();
          const nextNum = existing.length + 1;
          // Auto-name logic
          const mazeName = customName && customName.trim().length > 0 ? customName.trim() : `Maze #${nextNum}`;

          const newMaze: SavedMaze = {
            id: crypto.randomUUID(),
            name: mazeName,
            seed,
            difficulty,
            timeSpent: 0,
            completed: false,
            thumbnail: '',
            gridSize: data.size,
            gridData: '',
            playerPos: {x: sx, y: SETTINGS.PLAYER_HEIGHT, z: sz},
            playerRot: {x: 0, y: 0, z: 0},
            remainingMarkers: 20,
            markers: [],
            visited: [],
            mapCooldownRemaining: 0,
            mapViewRemaining: 0,
            isMapOpen: false
          };

          // ADDED: Immediate save so the record exists even if game crashes/exits improperly
          Persistence.saveMaze(newMaze);
          setCurrentMaze(newMaze);
          
          setTimeSpent(0);
          timeSpentRef.current = 0;
          setMarkerCount(20);
          
          // Reset Cooldown
          mapCooldownRef.current = 0;
          setMapCooldown(0);
          setMapVisible(false);

          const quat = camera.quaternion;
          recordingFramesRef.current.push({
              t: 0, 
              p: { x: sx, y: SETTINGS.PLAYER_HEIGHT, z: sz },
              r: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
              q: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
              s: 0,
              b: 100,
              f: false,
              ib: false,
              if: false,
              im: false,
              mr: 0,
              cr: 0
          });
        }

        // Sync Battery and Event UI State immediately
        const initialEv = eventSystem.getState();
        setBattery(initialEv.battery);
        setIsBlackout(initialEv.isBlackout);

        setGameState(GameState.PLAYING);
        lockControls();
        audioManager.startAmbience();
    } catch (error) {
        console.error("Failed to start game:", error);
        alert("A critical error occurred while starting the maze. Please check the console or try regenerating.");
        setGameState(GameState.MENU);
    }
  };

  const handleRegenerate = (oldMaze: SavedMaze) => {
    // ... (unchanged)
    const data = generateMaze(oldMaze.seed, oldMaze.difficulty);
    const sx = data.start.x * SETTINGS.UNIT_SIZE;
    const sz = data.start.y * SETTINGS.UNIT_SIZE;
    const resetMaze: SavedMaze = {
        ...oldMaze,
        timeSpent: 0,
        completed: false,
        thumbnail: '',
        playerPos: { x: sx, y: SETTINGS.PLAYER_HEIGHT, z: sz },
        playerRot: { x: 0, y: 0, z: 0 },
        remainingMarkers: 20,
        markers: [],
        visited: [],
        recording: undefined,
        finalTimerMs: undefined,
        mapCooldownRemaining: 0, // Reset cooldown
        mapViewRemaining: 0,
        isMapOpen: false,
        eventState: undefined // Reset events
    };
    Persistence.saveMaze(resetMaze);
    startNewGame(resetMaze.seed.toString(), resetMaze.difficulty, resetMaze);
  };

  const createMarkerMesh = (pos: THREE.Vector3, normal: THREE.Vector3) => {
      // ... (unchanged)
      if (!markerGeometryRef.current || !markerMaterialRef.current) return;
      const mesh = new THREE.Mesh(markerGeometryRef.current, markerMaterialRef.current);
      mesh.position.copy(pos);
      mesh.lookAt(pos.clone().add(normal));
      scene.add(mesh);
      markers.push(mesh);
  };

  const placeMarker = () => {
     // ... (unchanged)
     if (markerCount <= 0) return;
     raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
     const intersects = raycaster.intersectObjects(interactableObjects);
     if (intersects.length > 0 && intersects[0].distance < 4) {
        const hit = intersects[0];
        const normal = hit.face!.normal.clone();
        const placedPos = hit.point.clone().add(normal.clone().multiplyScalar(0.015));
        createMarkerMesh(placedPos, normal);
        const mData = {
           x: placedPos.x, y: placedPos.y, z: placedPos.z,
           nx: normal.x, ny: normal.y, nz: normal.z
        };
        markersDataRef.current.push(mData);
        mapNeedsUpdateRef.current = true;
        recordingEventsRef.current.push({
            type: 'marker',
            t: timeSpentRef.current,
            data: mData
        });
        setMarkerCount(c => c-1);
        audioManager.playClick();
     }
  };

  const updateMiniMap = () => {
     // ONLY render if mapVisible is true and not blacked out
     // Also force render if it was just opened (mapNeedsUpdateRef)
     if (!mapVisible || isBlackout) return;
     if (!mapCanvasRef.current || !mazeDataRef.current) return;
     if (!mapNeedsUpdateRef.current && gameState !== GameState.REPLAY) return;

     const ctx = mapCanvasRef.current.getContext('2d');
     if (!ctx) return;

     const size = mazeDataRef.current.size;
     // ... (Render logic mostly unchanged, just ensured it runs for visible state) ...
     const cx = Math.round(camera.position.x / SETTINGS.UNIT_SIZE);
     const cz = Math.round(camera.position.z / SETTINGS.UNIT_SIZE);
     
     ctx.fillStyle = '#111';
     ctx.fillRect(0,0, 280, 280);
     const cellSize = 280 / size; 
     
     ctx.fillStyle = '#555'; 
     playerExploredRef.current.forEach(key => {
        const [x, z] = key.split(',').map(Number);
        ctx.fillRect(x * cellSize, z * cellSize, cellSize, cellSize);
     });

     ctx.font = `bold ${Math.max(10, cellSize)}px monospace`;
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     markersDataRef.current.forEach(m => {
        const mx = Math.round(m.x / SETTINGS.UNIT_SIZE);
        const mz = Math.round(m.z / SETTINGS.UNIT_SIZE);
        // RED MARKER COLOR for distinct visibility
        ctx.fillStyle = '#FF0000'; 
        if (cellSize < 4) {
            ctx.fillRect(mx * cellSize, mz * cellSize, cellSize, cellSize);
        } else {
            ctx.fillText('X', mx * cellSize + cellSize/2, mz * cellSize + cellSize/2);
        }
     });
     
     ctx.fillStyle = COLORS.WALL_BASE; 
     ctx.beginPath();
     ctx.arc(cx * cellSize + cellSize/2, cz * cellSize + cellSize/2, Math.max(2, cellSize/1.5), 0, Math.PI*2);
     ctx.fill();
     
     mapNeedsUpdateRef.current = false;
  };

  // Updated completion handler to accept override time
  const completeMaze = (finalTimeOverride?: number) => {
    const finalTime = finalTimeOverride ?? timeSpentRef.current;
    const quat = camera.quaternion;
    const evState = eventSystem.getState();

    // Force one last frame to capture the final position (mid-fall)
    const finalFrames = [...recordingFramesRef.current];
    finalFrames.push({
        t: finalTime, 
        p: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        r: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
        q: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        s: selectedSlot,
        b: battery,
        f: false,
        ib: evState.isBlackout,
        if: evState.phase === EventPhase.FLICKERING || evState.phase === EventPhase.RESTORING,
        im: mapVisible,
        mr: mapViewTimerRef.current,
        cr: mapCooldownRef.current
    });
    
    let thumb = '';
    if (renderer) {
      // OPTIMIZATION: Use JPEG 0.5 instead of PNG for completion thumbnail too
      try {
        renderer.render(scene, camera);
        thumb = renderer.domElement.toDataURL('image/jpeg', 0.5); 
      } catch(e) { console.warn("Completion thumbnail failed", e); }
    }
    
    if (currentMaze) {
       // EXPLICIT SYNC for completion save
       const finished: SavedMaze = { 
         ...currentMaze, 
         completed: true, 
         timeSpent: finalTime, 
         finalTimerMs: finalTime,
         thumbnail: thumb,
         // Sync latest state
         playerPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
         playerRot: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
         remainingMarkers: markerCount,
         markers: markersDataRef.current,
         visited: Array.from(playerExploredRef.current),
         mapCooldownRemaining: 0, // Reset cooldown on completion
         mapViewRemaining: 0,
         isMapOpen: false,
         eventState: eventSystem.getPersistenceState(), // Capture state even on completion
         recording: {
             frames: finalFrames,
             events: recordingEventsRef.current,
             totalTime: finalTime 
         }
       };
       Persistence.saveMaze(finished);
       setCurrentMaze(finished);

       // DIRECT REPLAY TRANSITION
       loadedReplayRef.current = finished.recording!;
       setReplayDuration(finalTime);
       setReplayTime(0);
       setReplayPaused(false);
       setReplaySpeed(1);

       // Reset Visuals
       setExitOpacity(0);
       exitStateRef.current = 'NONE';
       
       setGameState(GameState.REPLAY);
       controlsRef.current?.unlock();

       // Init Replay Cam
       if (finalFrames.length > 0) {
           const f = finalFrames[0];
           camera.position.set(f.p.x, f.p.y, f.p.z);
           if (f.q) camera.quaternion.set(f.q.x, f.q.y, f.q.z, f.q.w);
           else camera.rotation.set(f.r.x, f.r.y, f.r.z);
       }
    }
  };

  const handleLeaveWorld = () => {
     // 1. Unconditional Save Attempt (if data exists and playing)
     if (currentMaze) {
        // Only save progress if we are in a state where progress is being made
        if (gameState === GameState.PLAYING || gameState === GameState.PAUSED || gameState === GameState.GENERATING) {
            let thumb = currentMaze.thumbnail;
            if (renderer) {
                try {
                    renderer.render(scene, camera); 
                    // OPTIMIZATION: Use JPEG 0.5 instead of PNG (approx 10x smaller)
                    thumb = renderer.domElement.toDataURL('image/jpeg', 0.5); 
                } catch(e) { console.warn("Thumbnail capture failed", e); }
            }
            
            // EXPLICIT RUNTIME SYNC:
            const saveState: SavedMaze = { 
                ...currentMaze, 
                // Sync Time
                timeSpent: timeSpentRef.current,
                
                // Sync Visuals
                thumbnail: thumb,
                
                // Sync Position & Rotation
                playerPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                playerRot: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
                
                // Sync Gameplay Items
                remainingMarkers: markerCount,
                markers: markersDataRef.current, 
                visited: Array.from(playerExploredRef.current),
                mapCooldownRemaining: mapCooldownRef.current,
                mapViewRemaining: mapViewTimerRef.current,
                isMapOpen: mapVisible,
                
                // Sync Event State 
                eventState: eventSystem.getPersistenceState(),

                // Add Recording State
                recording: {
                    frames: recordingFramesRef.current,
                    events: recordingEventsRef.current,
                    totalTime: timeSpentRef.current
                }
            };
            
            // TIERED SAVE STRATEGY
            // 1. Try Full Save
            try {
                Persistence.saveMaze(saveState);
                setCurrentMaze(saveState);
            } catch (err1) {
                console.warn("Primary save failed (Quota). Retrying without Recording...", err1);
                
                // 2. Try Save without Recording (Heavy data)
                const fallbackState1: SavedMaze = { 
                    ...saveState, 
                    recording: { frames: [], events: [], totalTime: saveState.timeSpent } 
                };

                try {
                    Persistence.saveMaze(fallbackState1);
                    setCurrentMaze(fallbackState1);
                } catch (err2) {
                     console.warn("Fallback save failed (Quota). Retrying without Thumbnail...", err2);
                     
                     // 3. Try Save without Thumbnail (Image data)
                     const fallbackState2: SavedMaze = {
                         ...fallbackState1,
                         thumbnail: '' // Drop image
                     };

                     try {
                         Persistence.saveMaze(fallbackState2);
                         setCurrentMaze(fallbackState2);
                     } catch (err3) {
                         console.error("Critical Storage Error. Cannot save progress.", err3);
                         alert("STORAGE FULL: Progress could not be saved. Please delete old mazes.");
                     }
                }
            }
        }
     }

     // 2. Unconditional Navigation
     if (controlsRef.current) {
         try { controlsRef.current.unlock(); } catch(e) {}
     }
     
     setGameState(GameState.MENU);
     audioManager.stopAmbience();
  };

  return (
    <div ref={mountRef} className="w-full h-full relative bg-black">
      <GameOverlay 
        gameState={gameState}
        options={options}
        currentMaze={currentMaze}
        timeSpent={gameState === GameState.REPLAY ? replayTime : timeSpent}
        battery={battery}
        selectedSlot={selectedSlot}
        markerCount={markerCount}
        onResume={() => lockControls()}
        onGenerate={(seed, diff, name) => startNewGame(seed, diff, undefined, name)}
        onLoadMaze={(m) => startNewGame(m.seed.toString(), m.difficulty, m)}
        onRegenerate={handleRegenerate}
        onUpdateOptions={(o) => { setOptions(o); Persistence.saveOptions(o); }}
        onLeaveWorld={handleLeaveWorld}
        isBlackout={isBlackout}
        mapRef={mapCanvasRef}
        
        // Pass Map State
        mapVisible={mapVisible}
        mapCooldown={mapCooldown}
        mapViewTime={mapViewTime}
        onActivateMap={activateMap}

        // Replay Props
        replayTime={replayTime}
        replayDuration={replayDuration}
        replayPaused={replayPaused}
        replaySpeed={replaySpeed}
        onReplayToggle={() => setReplayPaused(p => !p)}
        onReplaySeek={(t) => setReplayTime(t)}
        onReplaySpeed={(s) => setReplaySpeed(s)}

        // Exit Props
        exitOpacity={exitOpacity}
      />
    </div>
  );
};

// Export Wrapped App
const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <GameContent />
        </ErrorBoundary>
    );
};

export default App;