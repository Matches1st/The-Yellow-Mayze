import * as THREE from 'three';
import { COLORS } from '../constants';

// Helper to create noise texture
const createNoiseTexture = (width: number, height: number, opacity: number = 0.2) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0,0,width,height);
  
  const imgData = ctx.getImageData(0,0,width,height);
  const data = imgData.data;
  
  for(let i=0; i < data.length; i+=4) {
    const val = Math.floor(Math.random() * 255);
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
    data[i+3] = Math.floor(255 * opacity);
  }
  
  ctx.putImageData(imgData, 0, 0);
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const createProceduralMaterial = (type: 'wall' | 'floor' | 'ceiling') => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // 1. Base Color
  const baseColor = type === 'floor' ? COLORS.FLOOR_BASE : COLORS.WALL_BASE;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  // 2. Noise / Grime Overlay
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 10000; i++) {
    ctx.fillStyle = `rgba(150, 140, 50, ${Math.random() * 0.15})`; // Yellowish grime
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const s = Math.random() * 3;
    ctx.fillRect(x, y, s, s);
  }

  // 3. Stains (Moisture)
  ctx.globalCompositeOperation = 'source-over';
  const stainColor = type === 'floor' ? COLORS.FLOOR_SCUFF : COLORS.WALL_STAIN;
  
  // Big faint stains
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 50 + Math.random() * 100;
    
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, stainColor); // Darker
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    
    ctx.globalAlpha = 0.15; // Faint
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Pattern Details
  ctx.globalAlpha = 1.0;
  if (type === 'wall' || type === 'ceiling') {
     // Faint floral / damask hints (simplified as diamond pattern)
     ctx.globalCompositeOperation = 'multiply';
     ctx.fillStyle = '#888';
     ctx.globalAlpha = 0.03;
     
     const size = 64;
     for(let x=0; x<512; x+=size) {
         for(let y=0; y<512; y+=size) {
             if ((x/size + y/size) % 2 === 0) {
                 ctx.fillRect(x+10, y+10, size-20, size-20);
             }
         }
     }
  } else if (type === 'floor') {
     // Carpet fibers/lines
     ctx.globalCompositeOperation = 'multiply';
     ctx.strokeStyle = '#555';
     ctx.globalAlpha = 0.1;
     for(let y=0; y<512; y+=2) {
         ctx.beginPath();
         ctx.moveTo(0, y);
         ctx.lineTo(512, y + (Math.random() * 4 - 2));
         ctx.stroke();
     }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  
  // Normal Map approximation (using noise)
  const normalMap = createNoiseTexture(512, 512, 0.5);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: type === 'floor' ? 0.95 : 0.85,
    metalness: 0.02,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.1, 0.1)
  });

  return material;
}
