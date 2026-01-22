
import { Howl, Howler } from 'howler';
import { ASSETS } from '../constants';

class AudioManager {
  private hum: Howl;
  private footstep: Howl;
  private click: Howl;
  private flicker: Howl;
  private win: Howl;
  private mapOpen: Howl;
  private mapClose: Howl;
  private mapReady: Howl;

  constructor() {
    this.hum = new Howl({
      src: [ASSETS.sounds.hum],
      loop: true,
      volume: 0.15, // Slightly lower for the constant drone
      rate: 1.0
    });

    this.footstep = new Howl({
      src: [ASSETS.sounds.footstep],
      volume: 0.25, 
      rate: 1.0 
    });

    this.click = new Howl({
      src: [ASSETS.sounds.click],
      volume: 0.5
    });

    this.flicker = new Howl({
      src: [ASSETS.sounds.flicker],
      volume: 0.3
    });

    this.win = new Howl({
      src: [ASSETS.sounds.win],
      volume: 0.6
    });

    // Map Sounds - Using pitched clicks/ui sounds as placeholders
    this.mapOpen = new Howl({
      src: [ASSETS.sounds.click],
      volume: 0.6,
      rate: 0.5 // Lower pitch "woosh" feel
    });

    this.mapClose = new Howl({
      src: [ASSETS.sounds.click],
      volume: 0.4,
      rate: 2.0 // High pitch "lock" feel
    });

    this.mapReady = new Howl({
      src: [ASSETS.sounds.win], // Use start of win sound as chime
      volume: 0.3,
      rate: 2.0,
      sprite: {
        chime: [0, 500] // Take just the first 500ms
      }
    });
  }

  setMasterVolume(vol: number) {
    Howler.volume(vol / 100);
  }

  startAmbience() {
    if (!this.hum.playing()) {
      this.hum.play();
    }
  }

  pauseAmbience() {
    if (this.hum.playing()) {
      this.hum.pause();
    }
  }

  resumeAmbience() {
    // If it was paused or stopped, play it
    if (!this.hum.playing()) {
      this.hum.play();
    }
  }

  stopAmbience() {
    this.hum.stop();
  }

  playFootstep() {
    // Slight random pitch variation (0.8 to 1.0) to mimic natural step variation
    // Lower rate makes it sound like a heavier boot
    this.footstep.rate(0.8 + Math.random() * 0.2); 
    this.footstep.play();
  }

  playClick() {
    this.click.rate(1.0);
    this.click.play();
  }

  playFlicker() {
    this.flicker.play();
  }
  
  playWin() {
    this.win.rate(1.0);
    this.win.play();
  }

  playMapOpen() {
    this.mapOpen.play();
  }

  playMapCooldownStart() {
    this.mapClose.play();
  }

  playMapReady() {
    this.mapReady.play('chime');
  }
}

export const audioManager = new AudioManager();
