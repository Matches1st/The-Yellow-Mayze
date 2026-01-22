
import { Difficulty, GridCell } from '../types';
import { SETTINGS } from '../constants';

// Mulberry32 PRNG
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// DJB2 Hash
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

export const generateMaze = (seedInput: string | number, difficulty: Difficulty) => {
  const size = SETTINGS.GRID_SIZE[difficulty];
  const seed = typeof seedInput === 'string' ? djb2(seedInput) : seedInput;
  const random = mulberry32(seed);

  // Initialize grid with Walls (1)
  const grid: GridCell[][] = Array(size).fill(0).map(() => Array(size).fill(1));
  
  // Starting position (always odd coordinates to ensure walls between cells)
  // Standard recursive backtracker usually works on odd indices for cells and even for walls.
  // We'll stick to a standard implementation: Cells are at odd coordinates (1, 3, 5).
  
  // Start near top-left
  const startRow = 1;
  const startCol = 1; 

  const stack: [number, number][] = [[startRow, startCol]];
  grid[startRow][startCol] = 0; // Clear start

  const directions = [
    [0, -2], // North
    [0, 2],  // South
    [2, 0],  // East
    [-2, 0]  // West
  ];

  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    
    // Shuffle directions
    for (let i = directions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [directions[i], directions[j]] = [directions[j], directions[i]];
    }

    let carved = false;
    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;

      if (nr > 0 && nr < size - 1 && nc > 0 && nc < size - 1 && grid[nr][nc] === 1) {
        grid[nr][nc] = 0; // Carve room
        grid[r + dr / 2][c + dc / 2] = 0; // Carve wall between
        stack.push([nr, nc]);
        carved = true;
        break;
      }
    }

    if (!carved) {
      stack.pop();
    }
  }

  // --- LOOPINESS / IMPERFECT MAZE LOGIC ---
  // After generating a perfect maze, we selectively remove random internal walls
  // to create loops, alternative paths, and detached "floating" wall islands.
  // This makes the maze feel less linear and more chaotic (Backrooms style).
  
  let loopiness = 0;
  if (difficulty === Difficulty.NORMAL) {
      loopiness = 0.02; // 2% extra connectivity (Subtle loops)
  } else if (difficulty === Difficulty.HARD || difficulty === Difficulty.HARDCORE) {
      loopiness = 0.12; // 12% extra connectivity (Chaotic, many islands)
  }

  if (loopiness > 0) {
      // Iterate through all potential internal walls
      // Cells are at odd indices [r, c]. Walls are at even indices between them.
      for (let r = 1; r < size - 1; r += 2) {
          for (let c = 1; c < size - 1; c += 2) {
              
              // 1. Try removing Right Wall (at [r][c+1])
              // Check if right neighbor exists within bounds
              if (c + 2 < size - 1) {
                  if (grid[r][c+1] === 1) {
                      // It is currently a wall. Roll to remove it.
                      if (random() < loopiness) {
                          grid[r][c+1] = 0;
                      }
                  }
              }

              // 2. Try removing Bottom Wall (at [r+1][c])
              // Check if bottom neighbor exists within bounds
              if (r + 2 < size - 1) {
                   if (grid[r+1][c] === 1) {
                       // It is currently a wall. Roll to remove it.
                       if (random() < loopiness) {
                           grid[r+1][c] = 0;
                       }
                   }
              }
          }
      }
  }

  // Create Exit Room
  // Attached 3x3 logical room (approx 9x9 meters) to the bottom of the maze.
  // CRITICAL FIX: Ensure the room center is placed such that its 3x3 area 
  // NEVER touches the outer boundary walls (index 0 or size-1).
  
  const exitRow = size - 3; // Bottom safe row (size-1 is wall, size-2 is bottom of room)
  
  // Calculate valid range for column (must be odd to align with grid cells)
  // Min: 3 (since 1-1=0 wall, 3-1=2 safe)
  // Max: size-3 (since size-2 even, size-1 wall).
  const minExitCol = 3; 
  const maxExitCol = size - 3;
  const colRange = (maxExitCol - minExitCol) / 2;
  
  // Generate safe odd column
  const exitCol = minExitCol + Math.floor(random() * (colRange + 1)) * 2;
  
  // Ensure connection to maze body
  // Scan upwards from top of room (exitRow-1) -> (exitRow-2)
  let connectorR = exitRow - 2;
  // Connect to the nearest open cell (0) above
  while(connectorR > 0 && grid[connectorR][exitCol] === 1) {
      grid[connectorR][exitCol] = 0;
      connectorR--;
  }

  // Clear exit room area (3x3 logic grid)
  // STRICT BOUNDS CHECK: Do not touch r=0, r=size-1, c=0, c=size-1
  // This guarantees a sealed room with no outer wall holes.
  for(let r = -1; r <= 1; r++) {
      for(let c = -1; c <= 1; c++) {
          const nr = exitRow + r;
          const nc = exitCol + c;
          if (nr > 0 && nr < size - 1 && nc > 0 && nc < size - 1) {
            grid[nr][nc] = 0; 
          }
      }
  }
  
  // Mark the specific center for the void hole
  grid[exitRow][exitCol] = 2; // VOID

  return {
    grid,
    size,
    start: { x: startCol, y: startRow }, // Logic coordinates
    exit: { x: exitCol, y: exitRow }
  };
};
