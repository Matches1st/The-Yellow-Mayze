import React, { useEffect, useRef, useState, useCallback, ErrorInfo, ReactNode } from 'react';
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

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

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
let ventObjects: THREE.Mesh[] = [];

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

  // VENT STATE
  const [inVent, setInVent] = useState(false);
  const [interactionPrompt, setInteractionPrompt] = useState<string | null>(null);
  const preVentPositionRef = useRef<THREE.Vector3 | null>(null);
  const preVentRotationRef = useRef<THREE.Euler | null>(null);
  const ventLockDirectionRef = useRef<THREE.Vector3 | null>(null);

  // GAS STATE
  const [exposureTime, setExposureTime] = useState(0);
  const [isDead, setIsDead] = useState(false);

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

  const handleEnterVent = (targetVent: THREE.Mesh) => {
      if (inVent) return;
      
      preVentPositionRef.current = camera.position.clone();
      preVentRotationRef.current = camera.rotation.clone();

      const worldPos = new THREE.Vector3();
      targetVent.getWorldPosition(worldPos);
      
      const parent = targetVent.parent;
      if (parent) {
          const cellCenter = parent.position.clone();
          cellCenter.y = 0.5; // Lower camera to crawl height
          camera.position.copy(cellCenter);
          camera.lookAt(worldPos);
          
          const lookDir = new THREE.Vector3();
          camera.getWorldDirection(lookDir);
          ventLockDirectionRef.current = lookDir;
      }

      setInVent(true);
      setInteractionPrompt(null);
      velocity.set(0,0,0); // Kill momentum
      audioManager.playClick();
  };

  const handleExitVent = () => {
      if (!inVent || !preVentPositionRef.current) return;
      
      camera.position.copy(preVentPositionRef.current);
      if (preVentRotationRef.current) camera.rotation.copy(preVentRotationRef.current);
      
      preVentPositionRef.current = null;
      preVentRotationRef.current = null;
      ventLockDirectionRef.current = null;
      
      setInVent(false);
      audioManager.playClick();
  };

  // --- HELPER FUNCTIONS ---

  const createMarkerMesh = useCallback((pos: THREE.Vector3, normal: THREE.Vector3) => {
    if (!markerMaterialRef.current || !markerGeometryRef.current) return;
    const mesh = new THREE.Mesh(markerGeometryRef.current, markerMaterialRef.current);
    const offsetPos = pos.clone().add(normal.clone().multiplyScalar(0.02));
    mesh.position.copy(offsetPos);
    mesh.lookAt(offsetPos.clone().add(normal));
    scene.add(mesh);
    markers.push(mesh);
  }, []);

  const placeMarker = useCallback(() => {
    if (markerCount <= 0) return;
    
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    // Filter to avoid hitting markers or player items
    const hit = intersects.find(i => i.distance < 4.0 && i.object.visible && !markers.includes(i.object as THREE.Mesh));

    if (hit && hit.face) {
        const pos = hit.point;
        const n = hit.face.normal.clone();
        
        // Transform normal to world space
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        n.applyMatrix3(normalMatrix).normalize();

        createMarkerMesh(pos, n);
        
        markersDataRef.current.push({
           x: pos.x, y: pos.y, z: pos.z,
           nx: n.x, ny: n.y, nz: n.z
        });
        
        setMarkerCount(c => c - 1);
        audioManager.playClick();
        
        recordingEventsRef.current.push({
           type: 'marker',
           t: timeSpentRef.current,
           data: { x: pos.x, y: pos.y, z: pos.z, nx: n.x, ny: n.y, nz: n.z }
        });
    }
  }, [markerCount, createMarkerMesh]);

  const updateMiniMap = useCallback(() => {
    if (!mapVisible || !mazeDataRef.current || !mapCanvasRef.current) return;
    const ctx = mapCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const size = mazeDataRef.current.size;
    const w = mapCanvasRef.current.width;
    const h = mapCanvasRef.current.height;
    const scale = w / size;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    
    // Draw Explored
    ctx.fillStyle = '#555555';
    playerExploredRef.current.forEach(key => {
        const [cx, cz] = key.split(',').map(Number);
        ctx.fillRect(cx * scale, cz * scale, scale, scale);
    });
    
    // Draw Player Arrow
    const px = camera.position.x / SETTINGS.UNIT_SIZE;
    const pz = camera.position.z / SETTINGS.UNIT_SIZE;
    
    ctx.save();
    ctx.translate(px * scale, pz * scale);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const angle = Math.atan2(dir.x, dir.z);
    ctx.rotate(-angle);
    
    ctx.fillStyle = '#00FF00';
    ctx.beginPath();
    ctx.moveTo(0, -scale * 0.7);
    ctx.lineTo(scale * 0.5, scale * 0.7);
    ctx.lineTo(-scale * 0.5, scale * 0.7);
    ctx.fill();
    ctx.restore();
  }, [mapVisible]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!mountRef.current) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); 
    scene.fog = new THREE.FogExp2(COLORS.FOG, 0.015);

    const ambientFallback = new THREE.AmbientLight(0xFFFFFF, 0.1);
    scene.add(ambientFallback);

    camera = new THREE.PerspectiveCamera(options.fov, window.innerWidth / window.innerHeight, 0.1, 100);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

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

    flashlight = new THREE.SpotLight(0xFFFFD0, 0, 35, 0.55, 0.5, 2);
    flashlight.position.set(0, 0, 0);
    flashlight.target.position.set(0, 0, -1);
    flashlight.castShadow = true; 
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);

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
    if (controlsRef.current) {
        controlsRef.current.pointerSpeed = options.mouseSensitivity;
    }
    audioManager.setMasterVolume(options.masterVolume);
  }, [options]);

  useEffect(() => {
    mapNeedsUpdateRef.current = true;
  }, [selectedSlot, gameState, mapVisible]);

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
      
      if (e.code === 'KeyE') {
          if (inVent) {
              handleExitVent();
          } else if (interactionPrompt) {
              raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
              const intersects = raycaster.intersectObjects(ventObjects, false); 
              if (intersects.length > 0 && intersects[0].distance < 3.0) {
                  handleEnterVent(intersects[0].object as THREE.Mesh);
              }
          }
      }

      if (inVent) return; 

      switch(e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Digit1': activateMap(); break;
        case 'Digit2': setSelectedSlot(prev => prev === 2 ? 0 : 2); break;
        case 'KeyF': eventSystem.toggleFlashlight(); break;
        case 'KeyP': if (controlsRef.current?.isLocked) { eventSystem.forceEventSequence(); } break;
        case 'KeyN': if (controlsRef.current?.isLocked) { eventSystem.triggerGasSequence(); } break; // Manual Gas Trigger
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
      if (e.button === 2 && selectedSlot === 2 && markerCount > 0 && !inVent) {
        placeMarker();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousedown', onMouseDown);
    }
  }, [gameState, selectedSlot, markerCount, replayDuration, lockControls, activateMap, inVent, interactionPrompt, placeMarker]);

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
            if (!replayPaused) {
                setReplayTime(prev => {
                    const next = prev + delta * 1000 * replaySpeed;
                    return Math.min(next, frames[frames.length-1].t);
                });
            }
            let lower = 0; let upper = frames.length - 1; let idx = 0;
            while (lower <= upper) {
                const mid = Math.floor((lower + upper) / 2);
                if (frames[mid].t <= replayTime) { idx = mid; lower = mid + 1; } else { upper = mid - 1; }
            }
            const frameA = frames[idx]; const frameB = frames[idx + 1];
            if (frameA && frameB) {
                const range = frameB.t - frameA.t;
                const progress = range > 0 ? (replayTime - frameA.t) / range : 0;
                const alpha = Math.max(0, Math.min(1, progress));
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
                const f = alpha > 0.5 ? frameB : frameA;
                setBattery(f.b);
                setIsBlackout(f.ib);
                setMapVisible(f.im);
                setMapCooldown(f.cr);
                setExposureTime(f.et || 0);
                setIsDead(!!currentMaze?.died); // In replay, status is static based on maze data

                flashlight.intensity = f.f ? 6 : 0;

                let intensityMult = 1.0;
                if (f.ib) {
                    intensityMult = 0.0;
                } else if (f.if) {
                    const strobe = Math.sin(Date.now() * 0.047) > 0;
                    intensityMult = strobe ? 1.0 : 0.1;
                }

                if (scene.fog && scene.fog instanceof THREE.FogExp2) {
                  if (f.ib) {
                      if (scene.fog.color.getHex() !== 0x000000) scene.fog.color.setHex(0x000000);
                      if (scene.fog.density !== 0.08) scene.fog.density = 0.08;
                      if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.setHex(0x050505);
                      if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0xFFFFFF); 
                  } else {
                      // Apply Gas Fog Logic for Replay
                      const gasLevel = f.gl || 0;
                      const targetColor = new THREE.Color(COLORS.FOG).lerp(new THREE.Color(0x660099), gasLevel);
                      const targetDensity = 0.015 + (gasLevel * (0.05 - 0.015));
                      
                      scene.fog.color.copy(targetColor);
                      scene.fog.density = targetDensity;

                      if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
                      if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0x000000); 
                  }
                }

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
        updateMiniMap();
        renderer.render(scene, camera);
        return; 
    }

    // --- PLAYING LOGIC ---
    const controls = controlsRef.current;

    if (gameState === GameState.PLAYING && controls && controls.isLocked) {

      // VENT LOGIC
      if (!inVent) {
          raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
          const intersects = raycaster.intersectObjects(ventObjects, false);
          if (intersects.length > 0 && intersects[0].distance < 3.0) {
              setInteractionPrompt("Press E to enter");
          } else {
              setInteractionPrompt(null);
          }
      } else {
          if (ventLockDirectionRef.current) {
              const target = camera.position.clone().add(ventLockDirectionRef.current);
              camera.lookAt(target);
          }
      }
      
      // 0. EXIT SEQUENCE HANDLER
      if (exitStateRef.current === 'PAUSED' || exitStateRef.current === 'FADING') {
          velocity.set(0, 0, 0); 
          const elapsed = performance.now() - exitStartTimeRef.current;
          
          if (exitStateRef.current === 'PAUSED') {
              if (elapsed > 1000) {
                  exitStateRef.current = 'FADING';
                  exitStartTimeRef.current = performance.now(); 
              }
          } else if (exitStateRef.current === 'FADING') {
              const fadeDuration = 2500;
              const opacity = Math.min(1.0, elapsed / fadeDuration);
              setExitOpacity(opacity);

              if (opacity >= 1.0) {
                  exitStateRef.current = 'FINISHED';
                  completeMaze(finalTimeRef.current, isDead); // Pass isDead state
              }
          }
      } else {
          timeSpentRef.current += delta * 1000;
          setTimeSpent(timeSpentRef.current);

          if (mapVisible) {
              mapViewTimerRef.current -= delta;
              setMapViewTime(mapViewTimerRef.current);
              if (mapViewTimerRef.current <= 0) {
                  setMapVisible(false);
                  audioManager.playMapCooldownStart();
                  const diff = currentMaze?.difficulty || Difficulty.NORMAL;
                  let cooldown = 60.0;
                  if (diff === Difficulty.BABY || diff === Difficulty.EASY) cooldown = 20.0;
                  else if (diff === Difficulty.HARD || diff === Difficulty.HARDCORE) cooldown = 80.0;
                  mapCooldownRef.current = cooldown;
                  setMapCooldown(cooldown);
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
          
          if (!inVent) {
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
                    extraCollidersRef.current 
                );
                camera.position.x = corrected.x;
                camera.position.z = corrected.z;
                
                const gx = Math.round(corrected.x / SETTINGS.UNIT_SIZE);
                const gz = Math.round(corrected.z / SETTINGS.UNIT_SIZE);
                const cell = mazeDataRef.current.grid[gz]?.[gx];
                if (cell === 2) {
                    if (camera.position.y < FALL_TRIGGER_Y && exitStateRef.current === 'NONE') {
                        exitStateRef.current = 'PAUSED';
                        exitStartTimeRef.current = performance.now();
                        finalTimeRef.current = timeSpentRef.current; 
                        velocity.set(0, 0, 0); 
                        audioManager.playWin(); 
                    }
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
      }

      const cx = Math.round(camera.position.x / SETTINGS.UNIT_SIZE);
      const cz = Math.round(camera.position.z / SETTINGS.UNIT_SIZE);
      
      if (cx !== lastMapPosRef.current.x || cz !== lastMapPosRef.current.z) {
          lastMapPosRef.current = { x: cx, z: cz };
          mapNeedsUpdateRef.current = true;
          playerExploredRef.current.add(`${cx},${cz}`);
      }

      // 2. RECORDING & EVENTS
      if (exitStateRef.current === 'NONE') {
          // Pass inVent status to update logic (handles Gas Damage)
          const evState = eventSystem.update(delta, inVent);
          
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
              ib: evState.isBlackout,
              if: evState.phase === EventPhase.FLICKERING || evState.phase === EventPhase.RESTORING,
              im: mapVisible,
              mr: mapViewTimerRef.current,
              cr: mapCooldownRef.current,
              gl: evState.gasLevel,
              et: evState.exposureTime
            });
          }

          setIsBlackout(evState.isBlackout);
          setBattery(evState.battery);
          setExposureTime(evState.exposureTime); // Update HUD state
          
          // DEATH CHECK
          if (evState.exposureTime >= 10 && !isDead) {
              setIsDead(true);
              exitStateRef.current = 'FADING'; // Skip hover, straight to fade
              exitStartTimeRef.current = performance.now();
              finalTimeRef.current = timeSpentRef.current;
              // Don't play win sound
          }

          if (evState.flashlightOn) {
              const batteryPct = evState.battery / 100;
              flashlight.intensity = 6 * batteryPct; 
              flashlight.angle = 0.55 * (0.5 + 0.5 * batteryPct); 
          } else {
              flashlight.intensity = 0;
          }

          if (scene.fog && scene.fog instanceof THREE.FogExp2) {
              if (evState.isBlackout) {
                  // Blackout Override
                  if (scene.fog.color.getHex() !== 0x000000) scene.fog.color.setHex(0x000000);
                  if (scene.fog.density !== 0.08) scene.fog.density = 0.08;
                  if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.setHex(0x050505); 
                  if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0xFFFFFF);
              } else {
                  // Normal + Gas Blending
                  const targetColor = new THREE.Color(COLORS.FOG).lerp(new THREE.Color(0x660099), evState.gasLevel);
                  const targetDensity = 0.015 + (evState.gasLevel * (0.05 - 0.015));
                  
                  scene.fog.color.copy(targetColor);
                  scene.fog.density = targetDensity;

                  if (lightPanelMaterialRef.current) lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
                  if (markerMaterialRef.current) markerMaterialRef.current.color.setHex(0x000000);
              }
          }
          
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
      if (!inVent) {
          const speedMag = Math.sqrt(velocity.x*velocity.x + velocity.z*velocity.z);
          if (isGrounded && speedMag > 0.5) {
             footstepDistRef.current += speedMag * delta;
             if (footstepDistRef.current > 2.4) {
                audioManager.playFootstep();
                footstepDistRef.current = 0;
             }
          } else {
             if (!isGrounded) footstepDistRef.current = 0;
          }
      }

      updateMiniMap();
      renderer.render(scene, camera);
    }
    
    if (gameState === GameState.MENU) {
       camera.rotation.y += 0.001;
       renderer.render(scene, camera);
    }

  }, [gameState, replayTime, replayPaused, replaySpeed, selectedSlot, battery, markerCount, mapVisible, currentMaze, inVent, isDead, updateMiniMap]); 

  useEffect(() => {
    requestIdRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestIdRef.current!);
  }, [animate]);

  const startNewGame = (seed: string, difficulty: Difficulty, savedState?: SavedMaze, customName?: string) => {
    try {
        setExitOpacity(0);
        exitStateRef.current = 'NONE';
        exitStartTimeRef.current = 0;
        finalTimeRef.current = 0;
        footstepDistRef.current = 0;
        
        // Reset Logic
        setInVent(false);
        setIsDead(false);
        setExposureTime(0);
        preVentPositionRef.current = null;
        preVentRotationRef.current = null;
        ventLockDirectionRef.current = null;
        setInteractionPrompt(null);

        if (savedState && savedState.eventState) {
            eventSystem.restoreState(savedState.eventState);
            lastPhaseRef.current = savedState.eventState.phase as EventPhase;
            setExposureTime(savedState.eventState.exposureTime || 0); // Restore accumulated damage
        } else {
            eventSystem.reset();
            lastPhaseRef.current = EventPhase.IDLE_DELAY;
        }
        
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
        extraCollidersRef.current = built.extraColliders; 
        ventObjects = built.ventMeshes; 
        
        markers = [];
        markersDataRef.current = [];

        if (scene.fog instanceof THREE.FogExp2) {
            scene.fog.color.set(COLORS.FOG);
            scene.fog.density = 0.015;
        }
        if (lightPanelMaterialRef.current) {
            lightPanelMaterialRef.current.color.set(COLORS.LIGHT_EMISSIVE);
        }
        pointLights.forEach(l => {
            l.visible = true;
            l.intensity = 5;
        });
        setIsBlackout(false); 

        // --- REPLAY MODE CHECK ---
        if (savedState && (savedState.completed || savedState.died) && savedState.recording) {
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
          const mazeName = customName && customName.trim().length > 0 ? customName.trim() : `Maze #${nextNum}`;

          const newMaze: SavedMaze = {
            id: crypto.randomUUID(),
            name: mazeName,
            seed,
            difficulty,
            timeSpent: 0,
            completed: false,
            died: false,
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

          Persistence.saveMaze(newMaze);
          setCurrentMaze(newMaze);
          
          setTimeSpent(0);
          timeSpentRef.current = 0;
          setMarkerCount(20);
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
              cr: 0,
              gl: 0,
              et: 0
          });
        }

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

  const completeMaze = (finalTimeOverride?: number, died?: boolean) => {
    const finalTime = finalTimeOverride ?? timeSpentRef.current;
    const quat = camera.quaternion;
    const evState = eventSystem.getState();

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
        cr: mapCooldownRef.current,
        gl: evState.gasLevel,
        et: evState.exposureTime
    });
    
    let thumb = '';
    if (renderer) {
      try {
        renderer.render(scene, camera);
        thumb = renderer.domElement.toDataURL('image/jpeg', 0.5); 
      } catch(e) { console.warn("Completion thumbnail failed", e); }
    }
    
    if (currentMaze) {
       const finished: SavedMaze = { 
         ...currentMaze, 
         completed: !died, // Only completed if not died
         died: !!died,
         timeSpent: finalTime, 
         finalTimerMs: finalTime,
         thumbnail: thumb,
         playerPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
         playerRot: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
         remainingMarkers: markerCount,
         markers: markersDataRef.current,
         visited: Array.from(playerExploredRef.current),
         mapCooldownRemaining: 0,
         mapViewRemaining: 0,
         isMapOpen: false,
         eventState: eventSystem.getPersistenceState(),
         recording: {
             frames: finalFrames,
             events: recordingEventsRef.current,
             totalTime: finalTime 
         }
       };
       Persistence.saveMaze(finished);
       setCurrentMaze(finished);

       loadedReplayRef.current = finished.recording!;
       setReplayDuration(finalTime);
       setReplayTime(0);
       setReplayPaused(false);
       setReplaySpeed(1);

       setExitOpacity(0);
       exitStateRef.current = 'NONE';
       
       setGameState(GameState.REPLAY);
       controlsRef.current?.unlock();

       if (finalFrames.length > 0) {
           const f = finalFrames[0];
           camera.position.set(f.p.x, f.p.y, f.p.z);
           if (f.q) camera.quaternion.set(f.q.x, f.q.y, f.q.z, f.q.w);
           else camera.rotation.set(f.r.x, f.r.y, f.r.z);
       }
    }
  };

  const handleLeaveWorld = () => {
     if (currentMaze) {
        if (gameState === GameState.PLAYING || gameState === GameState.PAUSED || gameState === GameState.GENERATING) {
            let thumb = currentMaze.thumbnail;
            if (renderer) {
                try {
                    renderer.render(scene, camera); 
                    thumb = renderer.domElement.toDataURL('image/jpeg', 0.5); 
                } catch(e) { console.warn("Thumbnail capture failed", e); }
            }
            
            const saveState: SavedMaze = { 
                ...currentMaze, 
                timeSpent: timeSpentRef.current,
                thumbnail: thumb,
                playerPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                playerRot: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
                remainingMarkers: markerCount,
                markers: markersDataRef.current, 
                visited: Array.from(playerExploredRef.current),
                mapCooldownRemaining: mapCooldownRef.current,
                mapViewRemaining: mapViewTimerRef.current,
                isMapOpen: mapVisible,
                eventState: eventSystem.getPersistenceState(),
                recording: {
                    frames: recordingFramesRef.current,
                    events: recordingEventsRef.current,
                    totalTime: timeSpentRef.current
                }
            };
            
            try {
                Persistence.saveMaze(saveState);
                setCurrentMaze(saveState);
            } catch (err1) {
                console.warn("Primary save failed (Quota). Retrying without Recording...", err1);
                const fallbackState1: SavedMaze = { 
                    ...saveState, 
                    recording: { frames: [], events: [], totalTime: saveState.timeSpent } 
                };
                try {
                    Persistence.saveMaze(fallbackState1);
                    setCurrentMaze(fallbackState1);
                } catch (err2) {
                     console.warn("Fallback save failed (Quota). Retrying without Thumbnail...", err2);
                     const fallbackState2: SavedMaze = {
                         ...fallbackState1,
                         thumbnail: '' 
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

     if (controlsRef.current) {
         try { controlsRef.current.unlock(); } catch(e) {}
     }
     
     setGameState(GameState.MENU);
     audioManager.stopAmbience();
  };

  const handleRegenerate = useCallback((maze: SavedMaze) => {
    startNewGame(maze.seed.toString(), maze.difficulty, undefined, maze.name);
  }, []);

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
        mapVisible={mapVisible}
        mapCooldown={mapCooldown}
        mapViewTime={mapViewTime}
        onActivateMap={activateMap}
        replayTime={replayTime}
        replayDuration={replayDuration}
        replayPaused={replayPaused}
        replaySpeed={replaySpeed}
        onReplayToggle={() => setReplayPaused(p => !p)}
        onReplaySeek={(t) => setReplayTime(t)}
        onReplaySpeed={(s) => setReplaySpeed(s)}
        exitOpacity={exitOpacity}
        interactionPrompt={interactionPrompt}
        inVent={inVent}
        exposureTime={exposureTime}
        isDead={isDead}
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