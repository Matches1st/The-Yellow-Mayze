
import * as THREE from 'three';
import { GridCell } from '../types';
import { SETTINGS } from '../constants';

export class CollisionDetector {
  // Checks collision and returns corrected position
  static resolveCollision(
    newPos: THREE.Vector3, 
    grid: GridCell[][], 
    gridSize: number,
    extraColliders: THREE.Box3[] = []
  ): THREE.Vector3 {
    const unit = SETTINGS.UNIT_SIZE;
    const radius = SETTINGS.PLAYER_RADIUS;
    const corrected = newPos.clone();

    // 1. Grid-based Collision (Standard Walls)
    const centerC = Math.round(newPos.x / unit);
    const centerR = Math.round(newPos.z / unit);

    for (let r = centerR - 1; r <= centerR + 1; r++) {
      for (let c = centerC - 1; c <= centerC + 1; c++) {
        // Bounds check
        if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
          if (grid[r][c] === 1) {
            // Wall AABB logic
            const wallMinX = c * unit - unit / 2;
            const wallMaxX = c * unit + unit / 2;
            const wallMinZ = r * unit - unit / 2;
            const wallMaxZ = r * unit + unit / 2;

            CollisionDetector.resolveAABB(corrected, radius, wallMinX, wallMaxX, wallMinZ, wallMaxZ);
          }
        }
      }
    }

    // 2. Extra Colliders (Pit Walls, etc.)
    // Respect Y-bounds: Only collide if player's Y is within the box's vertical range.
    // This allows walking *over* underground walls (max.y=0) without hitting them.
    for (const box of extraColliders) {
        if (corrected.y >= box.min.y && corrected.y <= box.max.y) {
            CollisionDetector.resolveAABB(corrected, radius, box.min.x, box.max.x, box.min.z, box.max.z);
        }
    }
    
    return corrected;
  }

  // Helper to resolve AABB collision for a cylinder/point (2D XZ plane)
  private static resolveAABB(pos: THREE.Vector3, radius: number, minX: number, maxX: number, minZ: number, maxZ: number) {
      // Closest point on AABB to circle center
      const closestX = Math.max(minX, Math.min(pos.x, maxX));
      const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));

      const distanceX = pos.x - closestX;
      const distanceZ = pos.z - closestZ;
      const distanceSq = distanceX * distanceX + distanceZ * distanceZ;

      // If distance < radius, collision!
      if (distanceSq < radius * radius && distanceSq > 0) {
        const distance = Math.sqrt(distanceSq);
        const overlap = radius - distance;
        
        const normX = distanceX / distance;
        const normZ = distanceZ / distance;

        pos.x += normX * overlap;
        pos.z += normZ * overlap;
      } else if (distanceSq === 0) {
        // Fallback if exactly inside (rare)
        pos.x += radius * 0.1;
      }
  }
}
