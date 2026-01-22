
import * as THREE from 'three';
import { GridCell } from '../types';
import { SETTINGS, COLORS } from '../constants';
import { createProceduralMaterial, createVentMaterial } from './threeHelpers';

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
  
  // Vent Material Array (Multi-material for BoxGeometry)
  const ventMaterials = createVentMaterial(wallMat);

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

  // Composite Wall Parts (for Vent Cells)
  // Wall is 3x3x3.
  // Vent is 1x1x1 at bottom center face.
  // We need to fill the rest.
  // Top Part: 3 wide, 2 high, 3 deep.
  const topPartGeo = new THREE.BoxGeometry(unit, 2, unit); 
  // Side Columns: 1 wide, 1 high, 3 deep.
  const sidePartGeo = new THREE.BoxGeometry(1, 1, unit);
  // Rear Fill: 1 wide, 1 high, 2 deep (behind vent).
  const rearPartGeo = new THREE.BoxGeometry(1, 1, 2);
  // Vent Mesh: 1x1x1
  const ventGeo = new THREE.BoxGeometry(1, 1, 1);

  // Pit Geometries
  const pitDepth = 2.5; 
  const pitWallHeight = 2.7; 
  const thickness = 1;
  const pitWallGeo = new THREE.BoxGeometry(unit, pitWallHeight, thickness);
  const pitBottomGeo = new THREE.PlaneGeometry(unit, unit); 

  // Collision Boxes for Pit Walls
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

  let verticalWallSegmentsCount = 0;

  for(let r=0; r<size; r++) {
    for(let c=0; c<size; c++) {
      const x = c * unit;
      const z = r * unit;

      if (grid[r][c] === 1) {
        // --- WALL ---
        
        // VENT CHECK
        // Must border a floor to be visible/usable.
        let isCandidate = false;
        let rotationY = 0; // Default

        // Check neighbors for path (0). Face vent towards path.
        // Priority: North, South, West, East (arbitrary, picking first valid)
        if (r > 0 && grid[r-1][c] === 0) { isCandidate = true; rotationY = Math.PI; } // Face North (backwards Z) -> Rot 180?
        // Wait, default BoxGeometry Front is +Z.
        // If (r-1, c) is path, that is -Z direction.
        // So we want Front (+Z) to rotate 180 to face -Z. Yes.
        else if (r < size-1 && grid[r+1][c] === 0) { isCandidate = true; rotationY = 0; } // Face South (+Z). No rot.
        else if (c > 0 && grid[r][c-1] === 0) { isCandidate = true; rotationY = -Math.PI/2; } // Face West (-X). Rot -90.
        else if (c < size-1 && grid[r][c+1] === 0) { isCandidate = true; rotationY = Math.PI/2; } // Face East (+X). Rot 90.
        
        let isVent = false;
        if (isCandidate) {
            verticalWallSegmentsCount++;
            if (verticalWallSegmentsCount % 50 === 0) {
                isVent = true;
            }
        }

        if (!isVent) {
            // Standard Wall
            dummy.position.set(x, h/2, z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            wallMesh.setMatrixAt(wIdx++, dummy.matrix);
        } else {
            // SPECIAL VENT WALL
            // Hide the instance by scaling to 0 (keeps index sync logic simple)
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            wallMesh.setMatrixAt(wIdx++, dummy.matrix);

            // Create Composite Geometry
            // We use a group centered at the cell center (x, 0, z)
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            
            // Apply rotation so +Z aligns with the open corridor
            group.rotation.y = rotationY;

            // 1. Top Part (3w x 2h x 3d). Position: y=2 (1 unit gap below)
            const topPart = new THREE.Mesh(topPartGeo, wallMat);
            topPart.position.set(0, 2, 0); 
            topPart.castShadow = true; topPart.receiveShadow = true;
            group.add(topPart);

            // 2. Side Parts (1w x 1h x 3d).
            // Left (-1) and Right (+1). Y=0.5 (bottom unit)
            const leftPart = new THREE.Mesh(sidePartGeo, wallMat);
            leftPart.position.set(-1, 0.5, 0);
            leftPart.castShadow = true; leftPart.receiveShadow = true;
            group.add(leftPart);

            const rightPart = new THREE.Mesh(sidePartGeo, wallMat);
            rightPart.position.set(1, 0.5, 0);
            rightPart.castShadow = true; rightPart.receiveShadow = true;
            group.add(rightPart);

            // 3. Vent Mesh (1w x 1h x 1d). At Center Front (+1 z-offset? No, +1 unit from center? No)
            // Wall is 3 deep. Z goes -1.5 to +1.5.
            // Front face is roughly +1.5. 
            // Vent is 1 deep. Center at +1.0. Range +0.5 to +1.5.
            const vent = new THREE.Mesh(ventGeo, ventMaterials);
            vent.position.set(0, 0.5, 1.0); 
            vent.castShadow = true;
            group.add(vent);
            ventMeshes.push(vent);

            // 4. Rear Fill (1w x 1h x 2d). Fills space behind vent (-0.5 to -1.5? range -1.5 to +0.5)
            // Center at -0.5.
            const rearPart = new THREE.Mesh(rearPartGeo, wallMat);
            rearPart.position.set(0, 0.5, -0.5);
            rearPart.castShadow = true; rearPart.receiveShadow = true;
            group.add(rearPart);

            mazeGroup.add(group);
        }

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

  scene.add(mazeGroup);
  scene.add(lightGroup);

  return { 
      mazeGroup, 
      lightGroup, 
      lights, 
      collisionMeshes: [wallMesh], 
      ventMeshes,
      lightPanelMaterial: emissiveMat,
      extraColliders // Return generated AABBs for collision detector
  };
};