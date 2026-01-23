
import { audioManager } from './audioManager';
import { SavedEventState } from '../types';

// Phases of the atmospheric horror cycle
export enum EventPhase {
  IDLE_DELAY = 'IDLE_DELAY',         // Waiting for next event (3:30 - 5:00 min)
  FLICKERING = 'FLICKERING',         // Lights flickering (3s, 5s, or 7s)
  BLACKOUT = 'BLACKOUT',             // Lights out (Duration 3:00 - 4:30 min)
  RESTORING = 'RESTORING'            // Brief flicker before return to normal (2s)
}

export interface EventState {
  phase: EventPhase;
  isBlackout: boolean;
  battery: number; // 0-100 percentage
  flashlightOn: boolean;
  intensityMultiplier: number; // 0.0 to 1.0 (for lights)
  gasLevel: number; // 0.0 to 1.0
  exposureTime: number; // Accumulated time in gas
  debugTimer?: number; // Exposed for debugging if needed
}

export class EventSystem {
  private state: EventState = {
    phase: EventPhase.IDLE_DELAY,
    isBlackout: false,
    battery: 100,
    flashlightOn: false,
    intensityMultiplier: 1.0,
    gasLevel: 0,
    exposureTime: 0
  };

  private timer = 0;
  private blackoutDurationStore = 0; // Stores the duration of the upcoming blackout
  
  // Configuration (Seconds)
  private readonly MIN_IDLE = 210;       // 3:30
  private readonly MAX_IDLE = 300;       // 5:00
  
  private readonly MIN_BLACKOUT_DURATION = 180; // 3:00
  private readonly MAX_BLACKOUT_DURATION = 270; // 4:30
  
  private readonly RESTORE_DURATION = 2.0;

  // Battery Calculation: 100% over 150s (2.5 minutes)
  // This ensures the battery drains at ~0.66% per second.
  private readonly BATTERY_DRAIN_RATE = 100 / 150; 

  constructor() {
    this.reset();
  }

  public reset() {
    this.state = {
      phase: EventPhase.IDLE_DELAY,
      isBlackout: false,
      battery: 100,
      flashlightOn: false, // Flashlight resets to off
      intensityMultiplier: 1.0,
      gasLevel: 0,
      exposureTime: 0
    };
    // Initial delay on world enter
    this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
    this.blackoutDurationStore = 0;
  }

  public update(delta: number, inVent: boolean = false): EventState {
    // 1. Timer Tick
    this.timer -= delta;

    // 2. Battery Logic (Only drains during blackout phase when light is on)
    if (this.state.phase === EventPhase.BLACKOUT && this.state.flashlightOn) {
       this.state.battery -= (this.BATTERY_DRAIN_RATE * delta);
       if (this.state.battery <= 0) {
           this.state.battery = 0;
           this.state.flashlightOn = false;
           audioManager.playClick();
       }
    }

    // 3. Flicker Effect (Applied during FLICKERING and RESTORING)
    // 450 BPM = 7.5 Hz. Sine wave > 0 for on/off.
    if (this.state.phase === EventPhase.FLICKERING || this.state.phase === EventPhase.RESTORING) {
        const strobe = Math.sin(Date.now() * 0.047) > 0; 
        this.state.intensityMultiplier = strobe ? 1.0 : 0.1;
    } else if (this.state.phase === EventPhase.BLACKOUT) {
        this.state.intensityMultiplier = 0.0;
    } else {
        this.state.intensityMultiplier = 1.0;
    }

    // 4. Gas Logic (Simple Implementation: Vent = Gas)
    if (inVent) {
        this.state.gasLevel = Math.min(1.0, this.state.gasLevel + delta * 0.5); // Fade in gas
        this.state.exposureTime += delta;
    } else {
        this.state.gasLevel = Math.max(0.0, this.state.gasLevel - delta * 0.5); // Fade out gas
    }

    // 5. Phase Transition Logic
    if (this.timer <= 0) {
        this.advancePhase();
    }

    // 6. Sync Public State
    this.state.isBlackout = (this.state.phase === EventPhase.BLACKOUT);
    this.state.debugTimer = this.timer;

    return { ...this.state };
  }

  private advancePhase() {
      switch (this.state.phase) {
          case EventPhase.IDLE_DELAY:
              // Idle time over, time to flip the coin
              this.triggerCoinFlipSequence();
              break;

          case EventPhase.FLICKERING:
              // Flicker finished. Did we succeed (Blackout) or fail (Idle)?
              if (this.blackoutDurationStore > 0) {
                  // Success! Go directly to blackout.
                  this.startBlackout();
              } else {
                  // Failed flips (all tails), return to Idle
                  this.state.phase = EventPhase.IDLE_DELAY;
                  this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
              }
              break;

          case EventPhase.BLACKOUT:
              // Blackout finished, brief flicker before restoring
              this.state.phase = EventPhase.RESTORING;
              this.setTimer(this.RESTORE_DURATION);
              audioManager.playFlicker(); // Restore sound
              break;

          case EventPhase.RESTORING:
              // Restoration done, restart cycle
              this.state.phase = EventPhase.IDLE_DELAY;
              this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
              this.state.flashlightOn = false; // Auto-hide flashlight on restore
              break;
      }
  }

  private triggerCoinFlipSequence() {
      let success = false;
      let flickerTime = 7.0; // Default duration (used if all tails)
      let firstHeadFound = false;

      // 3 Independent flips, 50% chance heads (0.50)
      // Probability of at least one head (Blackout): 1 - (0.50)^3 = 0.875 (87.5%)
      // Probability of all tails (Flicker only): 0.50^3 = 0.125 (12.5%)
      // This creates very frequent blackouts for high tension, with rare relief.
      for (let i = 0; i < 3; i++) {
          const isHead = Math.random() < 0.50; 
          
          if (isHead) {
              success = true;
              
              // Flicker duration based on FIRST successful head:
              // 1st flip = 3s, 2nd flip = 5s, 3rd flip = 7s
              if (!firstHeadFound) {
                  if (i === 0) flickerTime = 3.0;
                  else if (i === 1) flickerTime = 5.0;
                  else if (i === 2) flickerTime = 7.0;
                  firstHeadFound = true;
              }
          }
      }

      // Transition to Flicker Phase immediately
      this.state.phase = EventPhase.FLICKERING;
      this.setTimer(flickerTime);
      audioManager.playFlicker();

      // Store result for AFTER flicker
      if (success) {
          // Success (≥1 heads): Set Blackout Duration (3:00 - 4:30)
          this.blackoutDurationStore = this.randomRange(this.MIN_BLACKOUT_DURATION, this.MAX_BLACKOUT_DURATION);
      } else {
          // Failure (all tails): No blackout
          this.blackoutDurationStore = 0;
      }
      
      console.log(`[Event] Flips Done. Success: ${success}. Flicker: ${flickerTime}s. Blackout Duration: ${this.blackoutDurationStore}s`);
  }

  private startBlackout() {
      this.state.phase = EventPhase.BLACKOUT;
      // Trigger for "That exact duration" calculated earlier
      this.setTimer(this.blackoutDurationStore);
      
      // Reset Gameplay State for Blackout
      // Full Battery Reset (100% = 150s runtime)
      this.state.battery = 100;
      this.state.flashlightOn = true; // Auto-on for survival
      audioManager.playClick(); // Sound effect for flashlight on
  }

  private setTimer(seconds: number) {
      this.timer = seconds;
  }

  private randomRange(min: number, max: number) {
      return min + Math.random() * (max - min);
  }

  // --- Persistence Methods ---

  public getPersistenceState(): SavedEventState {
    return {
      phase: this.state.phase,
      timer: this.timer,
      blackoutDurationStore: this.blackoutDurationStore,
      battery: this.state.battery,
      flashlightOn: this.state.flashlightOn,
      intensityMultiplier: this.state.intensityMultiplier,
      isBlackout: this.state.isBlackout,
      exposureTime: this.state.exposureTime
    };
  }

  public restoreState(saved: SavedEventState) {
    this.state = {
      phase: saved.phase as EventPhase,
      isBlackout: saved.isBlackout,
      battery: saved.battery,
      flashlightOn: saved.flashlightOn,
      intensityMultiplier: saved.intensityMultiplier,
      gasLevel: 0, // Reset dynamic visuals
      exposureTime: saved.exposureTime || 0
    };
    this.timer = saved.timer;
    this.blackoutDurationStore = saved.blackoutDurationStore;
  }

  // --- Public Interaction ---

  public toggleFlashlight(): boolean {
    if (this.state.phase === EventPhase.BLACKOUT) {
        if (this.state.battery > 0) {
            this.state.flashlightOn = !this.state.flashlightOn;
            audioManager.playClick();
            return true;
        } else {
            // Click but no light
            audioManager.playClick();
            return false;
        }
    }
    // Normal mode flashlight toggle (optional/cosmetic)
    audioManager.playClick();
    return false;
  }

  // Debug: Force a fresh event sequence immediately
  public forceEventSequence() {
      // Guard: Don't interrupt if we are already in an active horror event
      // This prevents phase skips or weird state resets during the action
      if (this.state.phase === EventPhase.FLICKERING || 
          this.state.phase === EventPhase.BLACKOUT || 
          this.state.phase === EventPhase.RESTORING) {
          console.log("Forced event ignored: Horror event already active.");
          return;
      }
      
      console.log("Debug: Forcing fresh coin flip sequence (P).");
      // Directly call the trigger to bypass IDLE delay and generate fresh random values
      this.triggerCoinFlipSequence();
  }
  
  public getState() { return this.state; }
}
