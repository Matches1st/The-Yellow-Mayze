
import * as THREE from 'three';
import { GridCell } from '../types';
import { SETTINGS, COLORS } from '../constants';
import { createProceduralMaterial } from './threeHelpers';

export const buildScene = (
  scene: THREE.Scene, 
  grid: GridCell[][], 
  size: number
) => {
  // Groups
  const mazeGroup = new THREE.Group();
  const lightGroup = new THREE.Group();
  
  // Materials
  const wallMat = createProceduralMaterial('wall');
  const floorMat = createProceduralMaterial('floor');
  const ceilingMat = createProceduralMaterial('ceiling');
  const emissiveMat = new THREE.MeshBasicMaterial({ color: COLORS.LIGHT_EMISSIVE }); 
  
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

  // Pit Geometries
  // PRECISE DEPTH REDUCTION: 2.5 Units deep
  const pitDepth = 2.5; 
  const pitWallHeight = 2.7; // 2.5 + 0.2 overlap to seal edges
  const thickness = 1;
  const pitWallGeo = new THREE.BoxGeometry(unit, pitWallHeight, thickness);
  const pitBottomGeo = new THREE.PlaneGeometry(unit, unit); // Exact 3x3 size (1 unit x 1 unit scale)

  // Collision Boxes for Pit Walls
  const extraColliders: THREE.Box3[] = [];

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
        // Void cell (2):
        // Needs Ceiling (to cover the hole from top)
        floorCount++;
        // Needs Light (to make exit room bright)
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

  for(let r=0; r<size; r++) {
    for(let c=0; c<size; c++) {
      const x = c * unit;
      const z = r * unit;

      if (grid[r][c] === 1) {
        // --- WALL ---
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
           // The hole in the floor.
           
           // 1. CEILING (Add ceiling over the pit so it looks like a room)
           dummy.position.set(x, h, z);
           dummy.rotation.set(Math.PI/2, 0, 0); // Face Down
           dummy.scale.set(1, 1, 1);
           dummy.updateMatrix();
           ceilingMesh.setMatrixAt(fIdx, dummy.matrix);
           
           // Note: We DO NOT add floorMesh here, leaving the hole open.
           // Since fIdx counts both, we must skip the floor but consume the index for ceiling.
           // We hide the floor mesh by scaling to 0.
           dummy.scale.set(0, 0, 0);
           floorMesh.setMatrixAt(fIdx, dummy.matrix);
           
           fIdx++;

           // 2. LIGHTS (Always add light above the pit for visibility)
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

           // 3. PIT WALLS (Underground)
           const offset = unit/2 + thickness/2; // 2.0
           const wallY = -pitWallHeight / 2; // Center Y = -1.35 (Top at 0, Bottom at -2.7)

           const addCollider = (cx: number, cz: number, width: number, depth: number) => {
               const box = new THREE.Box3();
               // MaxY = 0 ensures player can walk ON floor (y>0) without hitting these walls
               box.min.set(cx - width/2, -pitWallHeight, cz - depth/2);
               box.max.set(cx + width/2, 0, cz + depth/2); 
               extraColliders.push(box);
           };

           // North Wall (Z-)
           const nWall = new THREE.Mesh(pitWallGeo, wallMat);
           nWall.position.set(x, wallY, z - offset);
           mazeGroup.add(nWall);
           addCollider(x, z - offset, unit, thickness);
           
           // South Wall (Z+)
           const sWall = new THREE.Mesh(pitWallGeo, wallMat);
           sWall.position.set(x, wallY, z + offset);
           mazeGroup.add(sWall);
           addCollider(x, z + offset, unit, thickness);

           // East Wall (X+)
           const eWall = new THREE.Mesh(pitWallGeo, wallMat);
           eWall.position.set(x + offset, wallY, z);
           eWall.rotation.y = Math.PI / 2;
           mazeGroup.add(eWall);
           addCollider(x + offset, z, thickness, unit);

           // West Wall (X-)
           const wWall = new THREE.Mesh(pitWallGeo, wallMat);
           wWall.position.set(x - offset, wallY, z);
           wWall.rotation.y = Math.PI / 2;
           mazeGroup.add(wWall);
           addCollider(x - offset, z, thickness, unit);

           // Glowing Bottom Plane
           // Positioned exactly at -2.5
           const bottom = new THREE.Mesh(pitBottomGeo, voidBottomMat);
           bottom.position.set(x, -pitDepth, z); 
           bottom.rotation.x = -Math.PI / 2; 
           bottom.receiveShadow = false; 
           mazeGroup.add(bottom);

           // Upward Bloom Light (Bottom of pit)
           // Positioned slightly above bottom to light the shaft
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

  scene.add(mazeGroup);
  scene.add(lightGroup);

  return { 
      mazeGroup, 
      lightGroup, 
      lights, 
      collisionMeshes: [wallMesh], 
      lightPanelMaterial: emissiveMat,
      extraColliders // Return generated AABBs for collision detector
  };
};
