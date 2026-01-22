import { SavedMaze, AppOptions } from '../types';
import { DEFAULT_OPTIONS } from '../constants';

const MAZE_KEY = 'maze_data_v1';
const OPTIONS_KEY = 'maze_options_v1';

export const Persistence = {
  getMazes: (): SavedMaze[] => {
    try {
      const data = localStorage.getItem(MAZE_KEY);
      return data ? JSON.parse(data).mazes || [] : [];
    } catch (e) {
      console.error("Failed to load mazes", e);
      return [];
    }
  },

  saveMaze: (maze: SavedMaze) => {
    const mazes = Persistence.getMazes();
    const existingIndex = mazes.findIndex(m => m.id === maze.id);
    
    if (existingIndex >= 0) {
      mazes[existingIndex] = maze;
    } else {
      mazes.push(maze);
    }
    
    localStorage.setItem(MAZE_KEY, JSON.stringify({ mazes }));
  },

  deleteMaze: (id: string) => {
    const mazes = Persistence.getMazes().filter(m => m.id !== id);
    localStorage.setItem(MAZE_KEY, JSON.stringify({ mazes }));
  },

  getOptions: (): AppOptions => {
    try {
      const data = localStorage.getItem(OPTIONS_KEY);
      return data ? { ...DEFAULT_OPTIONS, ...JSON.parse(data) } : DEFAULT_OPTIONS;
    } catch {
      return DEFAULT_OPTIONS;
    }
  },

  saveOptions: (options: AppOptions) => {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  }
};