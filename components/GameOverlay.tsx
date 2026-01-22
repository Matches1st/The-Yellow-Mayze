import React, { useEffect, useRef, useState } from 'react';
import { GameState, SavedMaze, Difficulty, AppOptions } from '../types';
import { Persistence } from '../services/persistence';

// --- Helper Functions & Sub-components ---

const getDifficultyColor = (diff: Difficulty) => {
  switch (diff) {
    case Difficulty.BABY: return 'bg-cyan-200 text-cyan-900';
    case Difficulty.EASY: return 'bg-green-200 text-green-900';
    case Difficulty.NORMAL: return 'bg-yellow-200 text-yellow-900';
    case Difficulty.HARD: return 'bg-orange-200 text-orange-900';
    case Difficulty.HARDCORE: return 'bg-red-200 text-red-900';
    default: return 'bg-gray-200 text-gray-900';
  }
};

const getDifficultyColorText = (diff: Difficulty) => {
  switch (diff) {
    case Difficulty.BABY: return 'text-cyan-400';
    case Difficulty.EASY: return 'text-green-400';
    case Difficulty.NORMAL: return 'text-yellow-400';
    case Difficulty.HARD: return 'text-orange-400';
    case Difficulty.HARDCORE: return 'text-red-400';
    default: return 'text-gray-400';
  }
};

interface OptionsMenuProps {
  options: AppOptions;
  onClose: () => void;
  onUpdate: (opts: AppOptions) => void;
}

const OptionsMenu: React.FC<OptionsMenuProps> = ({ options, onClose, onUpdate }) => {
  return (
    <div className="bg-[#111] border-4 border-[#C9B458] p-8 w-[600px] max-w-full flex flex-col gap-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
      <h2 className="text-4xl text-[#C9B458] font-minecraft text-center mb-4 border-b-2 border-[#C9B458] pb-4">OPTIONS</h2>
      
      <div className="space-y-6">
        <div>
          <label className="flex justify-between text-white font-minecraft mb-2 text-xl">
            <span>Mouse Sensitivity</span>
            <span>{options.mouseSensitivity.toFixed(1)}x</span>
          </label>
          <input 
            type="range" min="0.1" max="5.0" step="0.1" 
            value={options.mouseSensitivity}
            onChange={(e) => onUpdate({...options, mouseSensitivity: parseFloat(e.target.value)})}
            className="w-full accent-[#C9B458] h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div>
          <label className="flex justify-between text-white font-minecraft mb-2 text-xl">
            <span>Field of View</span>
            <span>{options.fov}</span>
          </label>
          <input 
            type="range" min="60" max="110" step="1" 
            value={options.fov}
            onChange={(e) => onUpdate({...options, fov: parseInt(e.target.value)})}
            className="w-full accent-[#C9B458] h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div>
          <label className="flex justify-between text-white font-minecraft mb-2 text-xl">
            <span>Master Volume</span>
            <span>{options.masterVolume}%</span>
          </label>
          <input 
            type="range" min="0" max="100" step="1" 
            value={options.masterVolume}
            onChange={(e) => onUpdate({...options, masterVolume: parseInt(e.target.value)})}
            className="w-full accent-[#C9B458] h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        
        <div>
           <label className="block text-white font-minecraft mb-2 text-xl">Shadow Quality</label>
           <div className="flex gap-2">
             {['Low', 'Medium', 'High'].map((q) => (
               <button
                 key={q}
                 onClick={() => onUpdate({...options, shadowQuality: q as any})}
                 className={`flex-1 py-3 border-2 font-minecraft transition-colors text-lg
                   ${options.shadowQuality === q 
                     ? 'border-[#C9B458] bg-[#C9B458] text-black font-bold' 
                     : 'border-[#333] bg-[#222] text-gray-400 hover:border-gray-500'}
                 `}
               >
                 {q}
               </button>
             ))}
           </div>
        </div>
      </div>

      <button 
        onClick={onClose}
        className="mt-4 py-4 bg-[#333] border-4 border-[#555] text-white font-minecraft text-2xl hover:bg-[#444]"
      >
        BACK
      </button>
    </div>
  );
};

// --- End Helpers ---

interface Props {
  gameState: GameState;
  options: AppOptions;
  currentMaze: SavedMaze | null;
  timeSpent: number;
  battery: number;
  selectedSlot: 0 | 2; // Slot 1 is now handled via Status Props
  markerCount: number;
  onResume: () => void;
  onGenerate: (seed: string, diff: Difficulty, name?: string) => void;
  onLoadMaze: (maze: SavedMaze) => void;
  onRegenerate: (maze: SavedMaze) => void;
  onUpdateOptions: (opts: AppOptions) => void;
  onLeaveWorld: () => void;
  isBlackout: boolean;
  mapRef: React.RefObject<HTMLCanvasElement>;
  
  // Map Status Props
  mapVisible: boolean;
  mapCooldown: number;
  mapViewTime?: number;
  onActivateMap: () => void;

  // Replay Props
  replayTime?: number;
  replayDuration?: number;
  replayPaused?: boolean;
  replaySpeed?: number;
  onReplayToggle?: () => void;
  onReplaySeek?: (t: number) => void;
  onReplaySpeed?: (s: number) => void;

  // Exit Props
  exitOpacity: number;
}

export const GameOverlay: React.FC<Props> = ({
  gameState,
  options,
  currentMaze,
  timeSpent,
  battery,
  selectedSlot,
  markerCount,
  onResume,
  onGenerate,
  onLoadMaze,
  onRegenerate,
  onUpdateOptions,
  onLeaveWorld,
  isBlackout,
  mapRef,
  mapVisible,
  mapCooldown,
  mapViewTime = 0,
  onActivateMap,
  replayTime = 0,
  replayDuration = 0,
  replayPaused = false,
  replaySpeed = 1,
  onReplayToggle,
  onReplaySeek,
  onReplaySpeed,
  exitOpacity
}) => {
  const [activeMenu, setActiveMenu] = useState<'main' | 'mazes' | 'options' | 'generate'>('main');
  const [seedInput, setSeedInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>(Difficulty.NORMAL);
  
  const [mazes, setMazes] = useState<SavedMaze[]>([]);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Selection & Edit State
  const [selectedMazeId, setSelectedMazeId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMaze, setEditingMaze] = useState<SavedMaze | null>(null);
  const [editName, setEditName] = useState('');
  
  // Confirmation Dialogs
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Refresh mazes list whenever menu is accessed or tab changes
  useEffect(() => {
    if (activeMenu === 'mazes') {
      const loaded = Persistence.getMazes();
      setMazes(loaded);
      if (selectedMazeId && !loaded.find(m => m.id === selectedMazeId)) {
        setSelectedMazeId(null);
      }
    }
  }, [activeMenu, gameState, selectedMazeId]); 

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    const msPart = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    return `${m}:${s}.${msPart}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onReplaySeek || !replayDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onReplaySeek(pct * replayDuration);
  };

  // --- Handlers for Mazes Menu ---
  const handleMazeClick = (mazeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedMazeId(prev => prev === mazeId ? null : mazeId);
  };

  const handlePlay = () => {
      const maze = mazes.find(m => m.id === selectedMazeId);
      if (maze) onLoadMaze(maze);
  };

  const handleEditOpen = () => {
      const maze = mazes.find(m => m.id === selectedMazeId);
      if (maze) {
          setEditingMaze(maze);
          setEditName(maze.name);
          setShowEditModal(true);
          setConfirmDelete(false);
          setConfirmRegen(false);
      }
  };

  const handleSaveName = () => {
      if (!editingMaze) return;
      const updated = { ...editingMaze, name: editName || `Maze #${mazes.length}` };
      Persistence.saveMaze(updated);
      setEditingMaze(updated);
      setMazes(Persistence.getMazes());
  };

  const handleDelete = () => {
      if (!editingMaze) return;
      Persistence.deleteMaze(editingMaze.id);
      setMazes(Persistence.getMazes());
      setShowEditModal(false);
      setSelectedMazeId(null);
  };

  const handleRegenerateClick = () => {
      if (!editingMaze) return;
      setShowEditModal(false);
      onRegenerate(editingMaze);
  };

  // --- HUD (Playing & Replay) ---
  if (gameState === GameState.PLAYING || gameState === GameState.PAUSED || gameState === GameState.REPLAY) {
    return (
      <>
        {/* WHITE EXIT FADE OVERLAY */}
        {exitOpacity > 0 && (
            <div 
                className="fixed inset-0 bg-white z-[100] pointer-events-none transition-none"
                style={{ opacity: exitOpacity }}
            />
        )}

        {/* REPLAY UI OVERLAY */}
        {gameState === GameState.REPLAY && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[800px] bg-black/80 border-2 border-[#C9B458] p-4 flex flex-col gap-2 rounded pointer-events-auto">
                <div className="flex justify-between text-[#C9B458] font-minecraft text-xl mb-1">
                    <span className={currentMaze?.completed ? "text-green-500 font-bold" : ""}>
                        {currentMaze?.completed ? "MAZE COMPLETED" : "REPLAY MODE"}
                    </span>
                    <span>{formatTime(replayTime)} / {formatTime(replayDuration)}</span>
                </div>
                
                <div 
                    className="w-full h-6 bg-[#333] cursor-pointer relative border border-gray-600 group"
                    onClick={handleSeek}
                >
                    <div 
                        className="h-full bg-[#C9B458] transition-all duration-75"
                        style={{ width: `${(replayTime / replayDuration) * 100}%` }}
                    />
                    <div className="absolute top-0 w-[2px] h-full bg-white opacity-0 group-hover:opacity-50 pointer-events-none" />
                </div>

                <div className="flex justify-between items-center mt-2">
                    <div className="flex gap-4">
                        <button 
                           onClick={onReplayToggle}
                           className="px-4 py-2 bg-[#C9B458] text-black font-bold font-minecraft hover:bg-[#E0C968]"
                        >
                            {replayPaused ? "PLAY ▶" : "PAUSE ❚❚"}
                        </button>
                        <button onClick={onLeaveWorld} className="px-4 py-2 bg-[#992222] text-white font-minecraft border border-[#AA3333]">
                           EXIT REPLAY
                        </button>
                    </div>
                    
                    <div className="relative">
                        <button 
                           onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                           className="px-4 py-2 bg-[#333] text-white border border-gray-500 font-minecraft w-24 text-center"
                        >
                           {replaySpeed}x
                        </button>
                        {showSpeedMenu && (
                            <div className="absolute bottom-full mb-1 left-0 bg-[#222] border border-gray-500 flex flex-col w-24 shadow-xl">
                                {[1, 2, 5, 10, 30, 50, 100].map(s => (
                                    <button 
                                        key={s} 
                                        onClick={() => { onReplaySpeed?.(s); setShowSpeedMenu(false); }}
                                        className="py-1 hover:bg-[#444] text-white font-minecraft text-center"
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="text-gray-500 text-xs text-center font-mono mt-1">
                    [SPACE] Pause • [ARROWS] Seek • [ , . ] Step
                </div>
            </div>
        )}

        {/* HUD ELEMENTS */}
        <div className="absolute top-4 left-4 bg-black/60 p-4 rounded text-white font-minecraft text-2xl border-2 border-white/20 pointer-events-none">
          Time: {formatTime(timeSpent)}
        </div>

        {(isBlackout || (gameState === GameState.REPLAY && battery < 100)) && (
          <div className="absolute top-4 right-4 flex flex-col items-center pointer-events-none">
             <div className="w-10 h-48 bg-gray-900 border-2 border-gray-600 relative rounded">
                <div 
                  className="absolute bottom-0 w-full"
                  style={{ 
                    height: `${battery}%`, 
                    background: `linear-gradient(to top, #FF0000, #00FF00)` 
                  }}
                />
             </div>
             <span className="text-white font-minecraft mt-2 text-xl">BATTERY</span>
             {gameState !== GameState.REPLAY && <div className="text-yellow-400 font-bold animate-pulse text-xl mt-4">PRESS 'F'</div>}
          </div>
        )}

        {/* Hotbar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 p-2 rounded-lg border-2 border-[#4A4A4A] flex gap-4 pointer-events-auto transition-opacity duration-500"
             style={{ opacity: gameState === GameState.REPLAY ? 0.8 : 1 }}
        >
          {/* SLOT 1: MAP ABILITY STATUS */}
          <div 
             className={`w-16 h-16 border-4 relative transition-all duration-300
               ${mapVisible ? 'border-green-400 bg-[#3A3A3A] scale-105' : 'border-[#4A4A4A] bg-[#2A2A2A]'}
               ${mapCooldown > 0 ? 'opacity-80' : 'hover:bg-[#333] cursor-pointer'}
             `}
             onClick={() => {
                // Click to activate if not cooldown
                if (mapCooldown <= 0) onActivateMap();
             }}
          >
            <span className="text-xs absolute top-1 left-1 text-gray-400">1</span>
            
            {/* Map Icon */}
            <div className="w-10 h-10 border border-gray-500 bg-gray-800 grid grid-cols-3 grid-rows-3 gap-[1px] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70">
               {[...Array(9)].map((_, i) => <div key={i} className="bg-gray-600"></div>)}
            </div>

            {/* View Timer Overlay */}
            {mapVisible && mapViewTime > 0 && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center font-bold text-green-400 text-xl font-minecraft z-10 select-none">
                    {Math.ceil(mapViewTime)}
                </div>
            )}

            {/* Cooldown Overlay */}
            {mapCooldown > 0 && (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center font-bold text-white text-lg font-minecraft z-10 cursor-not-allowed">
                    {Math.ceil(mapCooldown)}
                </div>
            )}
          </div>

          {/* SLOT 2: MARKERS (Selectable) */}
          <div 
             className={`w-16 h-16 border-4 cursor-pointer relative bg-[#2A2A2A] hover:bg-[#333]
                ${selectedSlot === 2 ? 'border-white' : 'border-[#4A4A4A]'}
             `}
          >
             <span className="text-xs absolute top-1 left-1 text-gray-400">2</span>
             <div className="text-4xl text-black font-bold absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none" style={{textShadow: '0 0 2px white'}}>X</div>
             <span className={`absolute bottom-1 right-1 text-lg font-minecraft ${markerCount < 5 ? 'text-red-500' : 'text-white'}`}>
               {markerCount}
             </span>
          </div>
        </div>

        {/* MiniMap Overlay */}
        {/* Visibility controlled strictly by mapVisible prop, independent of selection */}
        <div className={`absolute bottom-28 left-4 border-2 border-white bg-black/90 p-1 pointer-events-none ${mapVisible && !isBlackout ? 'block' : 'hidden'}`}>
           <canvas ref={mapRef} width={280} height={280} className="w-[280px] h-[280px]" />
        </div>
        
        {/* Pause Menu */}
        {gameState === GameState.PAUSED && (
          <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center font-minecraft text-white">
            <h1 className="text-7xl text-[#C9B458] mb-12 text-glow">PAUSED</h1>
            <div className="flex flex-col gap-6 w-[400px]">
              <button 
                onClick={(e) => { e.stopPropagation(); onResume(); }} 
                className="bg-[#2A2A2A] hover:bg-[#3F3F3F] border-4 border-[#4A4A4A] py-4 text-2xl"
              >
                RESUME
              </button>
              <button onClick={() => setActiveMenu('options')} className="bg-[#2A2A2A] hover:bg-[#3F3F3F] border-4 border-[#4A4A4A] py-4 text-2xl">
                OPTIONS
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onLeaveWorld(); }} 
                className="bg-[#992222] hover:bg-[#AA3333] border-4 border-[#661111] py-4 text-2xl"
              >
                LEAVE WORLD
              </button>
            </div>
            
            {activeMenu === 'options' && (
              <OptionsMenu options={options} onClose={() => setActiveMenu('main')} onUpdate={onUpdateOptions} />
            )}
          </div>
        )}
      </>
    );
  }

  // Main Menus (Unchanged logic, just wrapper)
  return (
    <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 font-minecraft text-white"
        onClick={() => setSelectedMazeId(null)} 
    >
      {activeMenu === 'main' && (
        <div className="flex flex-col items-center animate-in fade-in duration-1000" onClick={e => e.stopPropagation()}>
          <h1 className="text-[108px] font-bold text-[#C9B458] text-glow mb-24 animate-pulse">MAYZE</h1>
          <div className="flex flex-col gap-8 w-[550px]">
            <button onClick={() => setActiveMenu('mazes')} className="h-[90px] bg-[#2A2A2A] hover:bg-[#3F3F3F] border-4 border-[#4A4A4A] text-4xl shadow-lg transition-transform hover:scale-105">
              MAZES
            </button>
            <button onClick={() => setActiveMenu('options')} className="h-[90px] bg-[#2A2A2A] hover:bg-[#3F3F3F] border-4 border-[#4A4A4A] text-4xl shadow-lg transition-transform hover:scale-105">
              OPTIONS
            </button>
          </div>
          <div className="absolute bottom-4 left-4 text-[#888] text-lg">v1.2 – Enter the Mayze</div>
        </div>
      )}

      {activeMenu === 'mazes' && (
        <div className="flex flex-col items-center w-full max-w-4xl h-[90vh] relative" onClick={e => e.stopPropagation()}>
          <h2 className="text-6xl text-[#C9B458] mb-8">SAVED MAZES</h2>
          <button 
            onClick={() => setActiveMenu('generate')}
            className="w-full bg-[#C9B458] text-black font-bold h-16 text-3xl mb-6 hover:brightness-110 border-4 border-[#8A7A30]"
          >
            GENERATE NEW MAZE
          </button>
          
          <div className="flex-1 w-full overflow-y-auto pr-4 space-y-4 mb-20 custom-scrollbar">
             {mazes.length === 0 && (
                <div className="text-center text-gray-500 text-3xl mt-20">No mazes yet – generate one!</div>
             )}
             {mazes.map(maze => (
               <div 
                   key={maze.id} 
                   onClick={(e) => handleMazeClick(maze.id, e)} 
                   className={`flex bg-[#1E1E1E] hover:bg-[#2A2A2A] border-4 cursor-pointer h-40 p-2 gap-4 transition-all relative
                               ${selectedMazeId === maze.id ? 'border-[#C9B458] bg-[#252520]' : 'border-[#333]'}`}
               >
                  <div className="w-36 h-36 bg-black border border-gray-600 shrink-0 relative overflow-hidden">
                    {maze.thumbnail ? 
                      <img src={maze.thumbnail} className="w-full h-full object-cover" alt="Maze Thumbnail" /> : 
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-600 bg-yellow-900/20">NO IMG</div>
                    }
                  </div>
                  <div className="flex flex-col justify-center gap-2">
                     <div className="text-3xl font-bold">{maze.name || `Maze ${maze.seed.toString().slice(0,5)}`}</div>
                     <div className="flex gap-4 text-xl">
                        <span className={`px-2 py-1 rounded text-black font-bold text-sm ${getDifficultyColor(maze.difficulty)}`}>
                          {maze.difficulty}
                        </span>
                        <span className="text-gray-400">
                           {maze.completed ? formatTime(maze.finalTimerMs ?? maze.timeSpent) : formatTime(maze.timeSpent)}
                        </span>
                        {maze.completed && <span className="text-green-500 font-bold flex items-center gap-2">COMPLETED</span>}
                     </div>
                  </div>
               </div>
             ))}
          </div>
          
          {selectedMazeId && (
            <div className="absolute bottom-24 left-0 w-full flex justify-center gap-[60px] animate-in slide-in-from-bottom-5 duration-300">
                <button 
                    onClick={handlePlay}
                    className="w-48 h-16 bg-[#00FF88] hover:bg-[#22FF99] text-black font-bold text-2xl border-4 border-[#00CC66] shadow-lg hover:scale-105 transition-transform"
                >
                    PLAY
                </button>
                <button 
                    onClick={handleEditOpen}
                    className="w-48 h-16 bg-[#AAAAFF] hover:bg-[#CCCCFF] text-black font-bold text-2xl border-4 border-[#7777CC] shadow-lg hover:scale-105 transition-transform"
                >
                    EDIT
                </button>
            </div>
          )}

          <button onClick={() => setActiveMenu('main')} className="absolute bottom-0 px-12 py-4 bg-[#333] border-4 border-[#555] text-2xl hover:bg-[#444]">BACK</button>
        </div>
      )}

      {showEditModal && editingMaze && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
              <div className="w-[700px] h-[550px] bg-[#000000DD] border-[6px] border-[#C9B458] flex flex-col p-8 gap-8 shadow-2xl animate-in zoom-in-95 duration-200">
                  <h2 className="text-[#C9B458] text-5xl font-bold text-center border-b-2 border-[#C9B458] pb-4">Edit Maze</h2>
                  
                  <div className="flex flex-col gap-6 flex-1">
                      <div className="flex flex-col gap-2">
                          <label className="text-2xl text-gray-300">World Name:</label>
                          <input 
                             type="text" 
                             value={editName}
                             onChange={(e) => setEditName(e.target.value)}
                             onBlur={handleSaveName}
                             onKeyDown={(e) => { if(e.key === 'Enter') { handleSaveName(); (e.target as HTMLInputElement).blur(); } }}
                             className="bg-[#111] border-2 border-[#555] p-3 text-2xl text-white font-mono focus:border-[#C9B458] outline-none"
                          />
                      </div>
                      
                      <div className="flex flex-col gap-2">
                          <label className="text-2xl text-gray-300">Seed:</label>
                          <div className="bg-[#111] border border-[#333] p-3 text-xl text-gray-500 font-mono select-text">
                              {editingMaze.seed}
                          </div>
                      </div>

                      {!confirmDelete && !confirmRegen && (
                          <div className="flex gap-8 mt-4 justify-center">
                              <button 
                                  onClick={() => setConfirmRegen(true)}
                                  className="flex-1 py-4 bg-[#FF8844] hover:bg-[#FF9955] text-black font-bold text-2xl border-4 border-[#CC6622]"
                              >
                                  REGENERATE WORLD
                              </button>
                              <button 
                                  onClick={() => setConfirmDelete(true)}
                                  className="flex-1 py-4 bg-[#FF4444] hover:bg-[#FF6666] text-black font-bold text-2xl border-4 border-[#CC2222]"
                              >
                                  DELETE MAZE
                              </button>
                          </div>
                      )}

                      {confirmDelete && (
                          <div className="bg-[#220000] border-2 border-red-500 p-4 text-center animate-pulse">
                              <p className="text-red-300 text-xl mb-4">Delete this maze permanently? Cannot undo.</p>
                              <div className="flex justify-center gap-4">
                                  <button onClick={handleDelete} className="px-6 py-2 bg-red-600 text-white font-bold border border-red-400 hover:bg-red-500">YES, DELETE</button>
                                  <button onClick={() => setConfirmDelete(false)} className="px-6 py-2 bg-[#333] text-white border border-gray-500 hover:bg-[#444]">CANCEL</button>
                              </div>
                          </div>
                      )}
                      
                      {confirmRegen && (
                          <div className="bg-[#221100] border-2 border-orange-500 p-4 text-center">
                              <p className="text-orange-300 text-lg mb-4">
                                  Regenerate will reset timer, map, markers, and events.<br/>
                                  You will respawn at the start. Keep seed & difficulty?
                              </p>
                              <div className="flex justify-center gap-4">
                                  <button onClick={handleRegenerateClick} className="px-6 py-2 bg-orange-600 text-white font-bold border border-orange-400 hover:bg-orange-500">YES, REGENERATE</button>
                                  <button onClick={() => setConfirmRegen(false)} className="px-6 py-2 bg-[#333] text-white border border-gray-500 hover:bg-[#444]">CANCEL</button>
                              </div>
                          </div>
                      )}
                  </div>

                  <div className="flex justify-center border-t border-[#333] pt-4">
                      <button 
                          onClick={() => { setShowEditModal(false); setEditingMaze(null); }}
                          className="px-12 py-3 bg-[#333] border-4 border-[#555] text-xl hover:bg-[#444]"
                      >
                          CLOSE
                      </button>
                  </div>
              </div>
          </div>
      )}

      {activeMenu === 'generate' && (
        <div className="bg-black/95 border-4 border-[#C9B458] p-12 w-[800px] flex flex-col items-center max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
           <h2 className="text-5xl text-[#C9B458] mb-8">NEW MAZE</h2>
           
           <div className="flex w-full mb-4 border-b-2 border-[#333]">
              <div className="flex-1 text-center py-4 text-2xl border-b-4 border-[#C9B458] text-[#C9B458]">Config</div>
           </div>

           <div className="grid grid-cols-1 gap-2 w-full mb-6">
              <label className="text-2xl text-[#C9B458] mb-2">DIFFICULTY:</label>
              <div className="grid grid-cols-1 gap-2">
                  {Object.values(Difficulty).map(diff => (
                     <button 
                       key={diff} 
                       onClick={() => setGenDifficulty(diff)}
                       className={`p-4 border-2 transition-all text-left flex justify-between items-center group
                         ${genDifficulty === diff ? 'border-[#C9B458] bg-[#333]' : 'border-[#333] hover:border-gray-500'}
                       `}
                     >
                       <span className={`text-2xl font-bold ${getDifficultyColorText(diff)}`}>{diff}</span>
                       <span className="text-gray-500 text-lg group-hover:text-gray-300">
                         {diff === Difficulty.BABY && "12x12"}
                         {diff === Difficulty.EASY && "24x24"}
                         {diff === Difficulty.NORMAL && "48x48"}
                         {diff === Difficulty.HARD && "96x96"}
                         {diff === Difficulty.HARDCORE && "192x192"}
                       </span>
                     </button>
                  ))}
              </div>
           </div>
           
           <div className="flex flex-col w-full gap-2 mb-6">
              <span className="text-xl text-[#C9B458]">SEED:</span>
              <div className="flex gap-4">
                  <input 
                    type="text" 
                    value={seedInput} 
                    onChange={(e) => setSeedInput(e.target.value)} 
                    placeholder="Random"
                    className="flex-1 bg-[#111] border border-[#444] p-3 text-xl font-mono text-[#C9B458] focus:border-[#C9B458] outline-none"
                  />
                  <button 
                     onClick={() => setSeedInput(Math.random().toString(36).substring(7))}
                     className="px-4 bg-[#333] border border-[#555] hover:bg-[#444]"
                  >
                     🎲
                  </button>
              </div>
           </div>

           <div className="flex flex-col w-full gap-2 mb-8">
              <span className="text-xl text-[#C9B458]">WORLD NAME:</span>
              <input 
                type="text" 
                value={nameInput} 
                onChange={(e) => setNameInput(e.target.value)} 
                placeholder="Leave empty for auto-name"
                className="w-full bg-[#111] border border-[#444] p-3 text-xl font-mono text-[#C9B458] focus:border-[#C9B458] outline-none"
              />
           </div>

           <div className="flex gap-4 w-full">
               <button 
                 onClick={() => onGenerate(seedInput || Math.random().toString(), genDifficulty, nameInput)} 
                 className="flex-1 py-4 bg-[#C9B458] text-black font-bold text-2xl border-4 border-[#8A7A30] hover:brightness-110"
               >
                 GENERATE & PLAY
               </button>
               <button onClick={() => setActiveMenu('mazes')} className="px-8 py-4 bg-[#333] border-4 border-[#555] text-2xl hover:bg-[#444]">
                 CANCEL
               </button>
           </div>
        </div>
      )}

      {activeMenu === 'options' && (
        <OptionsMenu options={options} onClose={() => setActiveMenu('main')} onUpdate={onUpdateOptions} />
      )}
    </div>
  );
};