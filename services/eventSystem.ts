
import { audioManager } from './audioManager';
import { SavedEventState, GasPhase } from '../types';

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
  
  // Gas State
  gasPhase: GasPhase;
  gasTimer: number;
  gasLevel: number; // 0.0 to 1.0 (visual fog density factor)
  exposureTime: number; // Cumulative seconds of damage
}

export class EventSystem {
  private state: EventState = {
    phase: EventPhase.IDLE_DELAY,
    isBlackout: false,
    battery: 100,
    flashlightOn: false,
    intensityMultiplier: 1.0,
    
    gasPhase: GasPhase.IDLE,
    gasTimer: 0,
    gasLevel: 0,
    exposureTime: 0
  };

  // Horror Cycle Timers
  private timer = 0;
  private blackoutDurationStore = 0; 
  
  // Gas Cycle Timers
  private gasDurationStore = 0; // Duration of FULL phase

  // Configuration (Seconds)
  private readonly MIN_IDLE = 210;       
  private readonly MAX_IDLE = 300;       
  private readonly MIN_BLACKOUT_DURATION = 180; 
  private readonly MAX_BLACKOUT_DURATION = 270; 
  private readonly RESTORE_DURATION = 2.0;
  private readonly BATTERY_DRAIN_RATE = 100 / 150; 

  // Gas Config
  private readonly MIN_GAS_IDLE = 300; // 5 mins
  private readonly MAX_GAS_IDLE = 420; // 7 mins
  private readonly GAS_FILL_DURATION = 10.0;
  private readonly GAS_FADE_DURATION = 10.0;
  private readonly MIN_GAS_FULL = 40.0;
  private readonly MAX_GAS_FULL = 50.0;

  constructor() {
    this.reset();
  }

  public reset() {
    this.state = {
      phase: EventPhase.IDLE_DELAY,
      isBlackout: false,
      battery: 100,
      flashlightOn: false, 
      intensityMultiplier: 1.0,
      
      gasPhase: GasPhase.IDLE,
      gasTimer: this.randomRange(this.MIN_GAS_IDLE, this.MAX_GAS_IDLE),
      gasLevel: 0,
      exposureTime: 0
    };
    
    // Initial horror delay
    this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
    this.blackoutDurationStore = 0;
    this.gasDurationStore = 0;
  }

  public update(delta: number, inVent: boolean = false): EventState {
    // --- HORROR EVENT CYCLE ---
    this.timer -= delta;

    if (this.state.phase === EventPhase.BLACKOUT && this.state.flashlightOn) {
       this.state.battery -= (this.BATTERY_DRAIN_RATE * delta);
       if (this.state.battery <= 0) {
           this.state.battery = 0;
           this.state.flashlightOn = false;
           audioManager.playClick();
       }
    }

    if (this.state.phase === EventPhase.FLICKERING || this.state.phase === EventPhase.RESTORING) {
        const strobe = Math.sin(Date.now() * 0.047) > 0; 
        this.state.intensityMultiplier = strobe ? 1.0 : 0.1;
    } else if (this.state.phase === EventPhase.BLACKOUT) {
        this.state.intensityMultiplier = 0.0;
    } else {
        this.state.intensityMultiplier = 1.0;
    }

    if (this.timer <= 0) {
        this.advancePhase();
    }

    this.state.isBlackout = (this.state.phase === EventPhase.BLACKOUT);

    // --- GAS CYCLE ---
    this.state.gasTimer -= delta;

    if (this.state.gasTimer <= 0) {
        this.advanceGasPhase();
    }

    // Gas Level Calculation & Damage
    switch (this.state.gasPhase) {
        case GasPhase.IDLE:
            this.state.gasLevel = 0;
            break;
        case GasPhase.FILLING:
            // gasTimer counts down from 10. Progress 0 -> 1.
            // Progress = 1 - (timer / duration)
            this.state.gasLevel = Math.max(0, Math.min(1, 1 - (this.state.gasTimer / this.GAS_FILL_DURATION)));
            break;
        case GasPhase.FULL:
            this.state.gasLevel = 1;
            // DAMAGE LOGIC: Only at FULL gas and NOT in vent
            if (!inVent) {
                this.state.exposureTime += delta;
            }
            break;
        case GasPhase.FADING:
            // gasTimer counts down from 10. Progress 1 -> 0.
            // Level = timer / duration
            this.state.gasLevel = Math.max(0, Math.min(1, this.state.gasTimer / this.GAS_FADE_DURATION));
            break;
    }

    return { ...this.state };
  }

  private advancePhase() {
      switch (this.state.phase) {
          case EventPhase.IDLE_DELAY:
              this.triggerCoinFlipSequence();
              break;
          case EventPhase.FLICKERING:
              if (this.blackoutDurationStore > 0) {
                  this.startBlackout();
              } else {
                  this.state.phase = EventPhase.IDLE_DELAY;
                  this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
              }
              break;
          case EventPhase.BLACKOUT:
              this.state.phase = EventPhase.RESTORING;
              this.setTimer(this.RESTORE_DURATION);
              audioManager.playFlicker();
              break;
          case EventPhase.RESTORING:
              this.state.phase = EventPhase.IDLE_DELAY;
              this.setTimer(this.randomRange(this.MIN_IDLE, this.MAX_IDLE));
              this.state.flashlightOn = false; 
              break;
      }
  }

  private advanceGasPhase() {
      switch (this.state.gasPhase) {
          case GasPhase.IDLE:
              // Start Filling
              this.state.gasPhase = GasPhase.FILLING;
              this.state.gasTimer = this.GAS_FILL_DURATION;
              // Determine next Full duration
              this.gasDurationStore = this.randomRange(this.MIN_GAS_FULL, this.MAX_GAS_FULL);
              break;
          case GasPhase.FILLING:
              // Start Full
              this.state.gasPhase = GasPhase.FULL;
              this.state.gasTimer = this.gasDurationStore;
              break;
          case GasPhase.FULL:
              // Start Fading
              this.state.gasPhase = GasPhase.FADING;
              this.state.gasTimer = this.GAS_FADE_DURATION;
              break;
          case GasPhase.FADING:
              // Return to Idle
              this.state.gasPhase = GasPhase.IDLE;
              this.state.gasTimer = this.randomRange(this.MIN_GAS_IDLE, this.MAX_GAS_IDLE);
              break;
      }
  }

  private triggerCoinFlipSequence() {
      let success = false;
      let flickerTime = 7.0; 
      let firstHeadFound = false;

      for (let i = 0; i < 3; i++) {
          const isHead = Math.random() < 0.50; 
          if (isHead) {
              success = true;
              if (!firstHeadFound) {
                  if (i === 0) flickerTime = 3.0;
                  else if (i === 1) flickerTime = 5.0;
                  else if (i === 2) flickerTime = 7.0;
                  firstHeadFound = true;
              }
          }
      }

      this.state.phase = EventPhase.FLICKERING;
      this.setTimer(flickerTime);
      audioManager.playFlicker();

      if (success) {
          this.blackoutDurationStore = this.randomRange(this.MIN_BLACKOUT_DURATION, this.MAX_BLACKOUT_DURATION);
      } else {
          this.blackoutDurationStore = 0;
      }
  }

  private startBlackout() {
      this.state.phase = EventPhase.BLACKOUT;
      this.setTimer(this.blackoutDurationStore);
      this.state.battery = 100;
      this.state.flashlightOn = true; 
      audioManager.playClick(); 
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
      
      gasPhase: this.state.gasPhase,
      gasTimer: this.state.gasTimer,
      gasDurationStore: this.gasDurationStore,
      gasLevel: this.state.gasLevel,
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
      gasPhase: saved.gasPhase || GasPhase.IDLE,
      gasTimer: saved.gasTimer || this.randomRange(this.MIN_GAS_IDLE, this.MAX_GAS_IDLE),
      gasLevel: saved.gasLevel || 0,
      exposureTime: saved.exposureTime || 0
    };
    this.timer = saved.timer;
    this.blackoutDurationStore = saved.blackoutDurationStore;
    this.gasDurationStore = saved.gasDurationStore || 0;
  }

  public toggleFlashlight(): boolean {
    if (this.state.phase === EventPhase.BLACKOUT) {
        if (this.state.battery > 0) {
            this.state.flashlightOn = !this.state.flashlightOn;
            audioManager.playClick();
            return true;
        } else {
            audioManager.playClick();
            return false;
        }
    }
    audioManager.playClick();
    return false;
  }

  public forceEventSequence() {
      if (this.state.phase === EventPhase.FLICKERING || 
          this.state.phase === EventPhase.BLACKOUT || 
          this.state.phase === EventPhase.RESTORING) {
          console.log("Forced event ignored: Horror event already active.");
          return;
      }
      this.triggerCoinFlipSequence();
  }
  
  public getState() { return this.state; }
}