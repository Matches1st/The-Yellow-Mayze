
import * as THREE from 'three';
import { GridCell } from '../types';
import { SETTINGS, COLORS } from '../constants';
import { createProceduralMaterial, createGrateTexture } from './threeHelpers';

export const buildScene = (
  scene: THREE.Scene, 
  grid: GridCell[][], 
  size: number
) => {
  // Groups
  const mazeGroup = new THREE.Group();
  const lightGroup = new THREE.Group();
  const ventGroup = new THREE.Group(); // New Group for vents
  
  // Materials
  const wallMat = createProceduralMaterial('wall');
  const floorMat = createProceduralMaterial('floor');
  const ceilingMat = createProceduralMaterial('ceiling');
  const emissiveMat = new THREE.MeshBasicMaterial({ color: COLORS.LIGHT_EMISSIVE }); 
  
  // Vent Material
  const ventTex = createGrateTexture();
  const ventMat = new THREE.MeshBasicMaterial({ 
      map: ventTex, 
      transparent: true, 
      opacity: 0.98, 
      side: THREE.DoubleSide,
      depthWrite: false, // Avoid z-fighting issues
      color: 0x888888 
  });

  // Void Pit Materials (Illusory Infinite Pit)
  const voidBottomMat = new THREE.MeshStandardMaterial({ 
    color: 0xFFFFFF, 
    emissive: 0xFFFFFF, 
    emissiveIntensity: 5.0, // Intense white glow
    roughness: 0.1,
    depthWrite: false
  });

  // Geometries
  const unit = SETTINGS.UNIT_SIZE;
  const h = SETTINGS.WALL_HEIGHT;
  
  const boxGeo = new THREE.BoxGeometry(unit, h, unit); // Walls
  const floorGeo = new THREE.PlaneGeometry(unit, unit); // Floor
  const ceilGeo = new THREE.PlaneGeometry(unit, unit); // Ceiling
  const lightPanelGeo = new THREE.PlaneGeometry(1, 1); 
  const ventGeo = new THREE.PlaneGeometry(unit * 0.9, unit * 0.9); // Vent Grate 

  // Pit Geometries
  const pitDepth = 2.5; 
  const pitWallHeight = 2.7; 
  const thickness = 1;
  const pitWallGeo = new THREE.BoxGeometry(unit, pitWallHeight, thickness);
  const pitBottomGeo = new THREE.PlaneGeometry(unit, unit); 

  // Collision Boxes & Special Meshes
  const extraColliders: THREE.Box3[] = [];
  const ventMeshes: THREE.Mesh[] = [];

  // Count instances
  let wallCount = 0;
  let floorCount = 0; 
  let lightCount = 0; 

  for(let r=0; r<size; r++) {
    for(let c=0; c<size; c++) {
      if (grid[r][c] === 1) {
        wallCount++;
      } else if (grid[r][c] !== 2) {
        // Normal floor/ceiling count
        floorCount++;
        if (r % 4 === 1 && c % 4 === 1) lightCount++;
      } else {
        // Void cell (2)
        floorCount++;
        lightCount++;
      }
    }
  }

  // --- Instanced Meshes ---
  const wallMesh = new THREE.InstancedMesh(boxGeo, wallMat, wallCount);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;

  const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floorCount);
  floorMesh.receiveShadow = true;

  const ceilingMesh = new THREE.InstancedMesh(ceilGeo, ceilingMat, floorCount);
  ceilingMesh.receiveShadow = true; 
  
  const lightPanelMesh = new THREE.InstancedMesh(lightPanelGeo, emissiveMat, lightCount);

  let wIdx = 0;
  let fIdx = 0;
  let lIdx = 0;
  
  const dummy = new THREE.Object3D();
  const lights: THREE.PointLight[] = [];

  // Vent Logic: Count vertical wall segments (1-unit high blocks).
  // Current walls are 'h' high (usually 3 units).
  // So each wall column adds 'h' segments to the count.
  let ventCounter = 0;

  for(let r=0; r<size; r++) {
    for(let c=0; c<size; c++) {
      const x = c * unit;
      const z = r * unit;

      if (grid[r][c] === 1) {
        // --- WALL ---
        
        // Vent Logic:
        // We simulate stacking blocks. The bottom block is the one we care about.
        // Increment counter for the bottom block
        ventCounter++;
        
        const isVent = (ventCounter % 50 === 0);
        
        // We must also account for the other blocks in the stack if h > 1
        // Assuming h=3, we add 2 more to the counter for the upper blocks
        ventCounter += (h - 1);

        if (isVent) {
            // Determine exposed face (facing a 0 path)
            // Directions: N (r-1), S (r+1), W (c-1), E (c+1)
            const neighbors = [
                { r: r-1, c: c, rot: Math.PI, zOff: -unit/2 - 0.01, xOff: 0 }, // North (face -Z)
                { r: r+1, c: c, rot: 0, zOff: unit/2 + 0.01, xOff: 0 },       // South (face +Z)
                { r: r, c: c-1, rot: -Math.PI/2, zOff: 0, xOff: -unit/2 - 0.01 }, // West (face -X)
                { r: r, c: c+1, rot: Math.PI/2, zOff: 0, xOff: unit/2 + 0.01 }    // East (face +X)
            ];
            
            // Filter for valid path neighbors
            const valid = neighbors.filter(n => 
                n.r >= 0 && n.r < size && n.c >= 0 && n.c < size && grid[n.r][n.c] === 0
            );

            if (valid.length > 0) {
                // Pick one (e.g., first one, or random)
                const choice = valid[Math.floor(Math.random() * valid.length)];
                
                const vent = new THREE.Mesh(ventGeo, ventMat);
                // Position: Center X/Z + Offset. Y is bottom block center (unit/2).
                vent.position.set(x + choice.xOff, unit / 2, z + choice.zOff);
                vent.rotation.y = choice.rot;
                ventMeshes.push(vent);
                ventGroup.add(vent);
                console.log(`Vent placed at ${x}, ${z}`);
            }
        }

        dummy.position.set(x, h/2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        wallMesh.setMatrixAt(wIdx++, dummy.matrix);

      } else {
        // --- PATH (Floor + Ceiling or Void) ---
        
        // 1. FLOOR (Skip if Void)
        if (grid[r][c] !== 2) { 
           dummy.position.set(x, 0, z);
           dummy.rotation.set(-Math.PI/2, 0, 0); // Face Up
           dummy.scale.set(1, 1, 1);
           dummy.updateMatrix();
           floorMesh.setMatrixAt(fIdx, dummy.matrix);
           
           // 2. CEILING (Normal)
           dummy.position.set(x, h, z);
           dummy.rotation.set(Math.PI/2, 0, 0); // Face Down
           dummy.scale.set(1, 1, 1);
           dummy.updateMatrix();
           ceilingMesh.setMatrixAt(fIdx, dummy.matrix);
           
           fIdx++; // Increment shared index

           // 3. LIGHTS (Normal Corridors Only)
           if (r % 4 === 1 && c % 4 === 1) {
                dummy.position.set(x, h - 0.05, z);
                dummy.rotation.set(Math.PI/2, 0, 0); 
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                lightPanelMesh.setMatrixAt(lIdx++, dummy.matrix);

                const pl = new THREE.PointLight(COLORS.LIGHT_COLOR, 5, 10, 2);
                pl.position.set(x, h - 0.5, z);
                pl.castShadow = false; 
                pl.visible = false; 
                lightGroup.add(pl);
                lights.push(pl);
           }

        } else {
           // --- VOID PIT GENERATION ---
           dummy.position.set(x, h, z);
           dummy.rotation.set(Math.PI/2, 0, 0); 
           dummy.scale.set(1, 1, 1);
           dummy.updateMatrix();
           ceilingMesh.setMatrixAt(fIdx, dummy.matrix);
           
           // Hide Floor
           dummy.scale.set(0, 0, 0);
           floorMesh.setMatrixAt(fIdx, dummy.matrix);
           fIdx++;

           // Light
           dummy.position.set(x, h - 0.05, z);
           dummy.rotation.set(Math.PI/2, 0, 0); 
           dummy.scale.set(1, 1, 1);
           dummy.updateMatrix();
           lightPanelMesh.setMatrixAt(lIdx++, dummy.matrix);

           const pl = new THREE.PointLight(COLORS.LIGHT_COLOR, 5, 10, 2);
           pl.position.set(x, h - 0.5, z);
           pl.castShadow = false; 
           pl.visible = false; 
           lightGroup.add(pl);
           lights.push(pl);

           // Pit Walls
           const offset = unit/2 + thickness/2; 
           const wallY = -pitWallHeight / 2; 

           const addCollider = (cx: number, cz: number, width: number, depth: number) => {
               const box = new THREE.Box3();
               box.min.set(cx - width/2, -pitWallHeight, cz - depth/2);
               box.max.set(cx + width/2, 0, cz + depth/2); 
               extraColliders.push(box);
           };

           const nWall = new THREE.Mesh(pitWallGeo, wallMat);
           nWall.position.set(x, wallY, z - offset);
           mazeGroup.add(nWall);
           addCollider(x, z - offset, unit, thickness);
           
           const sWall = new THREE.Mesh(pitWallGeo, wallMat);
           sWall.position.set(x, wallY, z + offset);
           mazeGroup.add(sWall);
           addCollider(x, z + offset, unit, thickness);

           const eWall = new THREE.Mesh(pitWallGeo, wallMat);
           eWall.position.set(x + offset, wallY, z);
           eWall.rotation.y = Math.PI / 2;
           mazeGroup.add(eWall);
           addCollider(x + offset, z, thickness, unit);

           const wWall = new THREE.Mesh(pitWallGeo, wallMat);
           wWall.position.set(x - offset, wallY, z);
           wWall.rotation.y = Math.PI / 2;
           mazeGroup.add(wWall);
           addCollider(x - offset, z, thickness, unit);

           const bottom = new THREE.Mesh(pitBottomGeo, voidBottomMat);
           bottom.position.set(x, -pitDepth, z); 
           bottom.rotation.x = -Math.PI / 2; 
           bottom.receiveShadow = false; 
           mazeGroup.add(bottom);

           const pitLight = new THREE.PointLight(0xFFFFFF, 3, 15, 2);
           pitLight.position.set(x, -2.0, z); 
           lightGroup.add(pitLight);
           lights.push(pitLight);
        }
      }
    }
  }

  mazeGroup.add(wallMesh);
  mazeGroup.add(floorMesh);
  mazeGroup.add(ceilingMesh);
  mazeGroup.add(lightPanelMesh); 
  mazeGroup.add(ventGroup); // Add vents to maze

  scene.add(mazeGroup);
  scene.add(lightGroup);

  return { 
      mazeGroup, 
      lightGroup, 
      lights, 
      collisionMeshes: [wallMesh], 
      ventMeshes: ventMeshes, 
      lightPanelMaterial: emissiveMat,
      extraColliders // Return generated AABBs for collision detector
  };
};
