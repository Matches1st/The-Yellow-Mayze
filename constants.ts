
import { Difficulty } from './types';

// Asset URLs (Public Domain / CC0 Placeholders)
// In a real deployment, these would be local files.
// We use a helper to generate procedural textures if these fail or to avoid CORS in pure client-side generation.
export const ASSETS = {
  textures: {
    wall: 'procedural_wall', // Handled by procedural generator
    floor: 'procedural_floor',
    particle: 'https://assets.codepen.io/127738/dot_texture.png'
  },
  sounds: {
    hum: 'https://assets.mixkit.co/active_storage/sfx/2658/2658-preview.mp3', // Steady Fluorescent Hum
    footstep: 'https://assets.mixkit.co/active_storage/sfx/2510/2510-preview.mp3', // Heavy boot on concrete
    click: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', // Switch click
    flicker: 'https://assets.mixkit.co/active_storage/sfx/2241/2241-preview.mp3', // Electric crackle
    win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3', // Wind swell
  }
};

export const COLORS = {
  WALL_BASE: '#C9B458',
  WALL_STAIN: '#A08F3A',
  FLOOR_BASE: '#A08F3A',
  FLOOR_SCUFF: '#6E5C28',
  LIGHT_EMISSIVE: '#FFFFF0',
  LIGHT_COLOR: '#FFFFFF',
  FOG: '#C9B458',
  MARKER_X: '#000000',
  VOID_GLOW: '#FFFFFF'
};

export const SETTINGS = {
  UNIT_SIZE: 3, // meters (width of corridor)
  WALL_HEIGHT: 3,
  PLAYER_HEIGHT: 1.62,
  PLAYER_RADIUS: 0.4,
  SPEED_WALK: 4.317,
  SPEED_SPRINT_MULT: 1.5,
  GRAVITY: 20.0,
  JUMP_FORCE: 8.5,
  GRID_SIZE: {
    [Difficulty.BABY]: 12,
    [Difficulty.EASY]: 24,
    [Difficulty.NORMAL]: 48,
    [Difficulty.HARD]: 96,
    [Difficulty.HARDCORE]: 192
  }
};

export const DEFAULT_OPTIONS = {
  mouseSensitivity: 1.0,
  fov: 90,
  masterVolume: 80,
  shadowQuality: 'Medium' as const
};
