import {
  ITracker,
  PointerPosition,
  TrackingEvent,
  TrackingMode,
  TrackingStatus,
} from '../../shared/types/tracking';
import { logger } from '../../shared/utils';
import { FaceLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { GestureStateMachine, GestureInput, GestureOutput } from '../../cursor/gestureStateMachine';

// A curated, deliberately sparse semantic mesh following natural facial contours
const SPARSE_MESH_CONNECTIONS = [{"start":71,"end":68},{"start":68,"end":104},{"start":104,"end":69},{"start":69,"end":108},{"start":108,"end":151},{"start":151,"end":337},{"start":337,"end":299},{"start":299,"end":333},{"start":333,"end":298},{"start":298,"end":301},{"start":162,"end":21},{"start":21,"end":54},{"start":54,"end":103},{"start":103,"end":67},{"start":67,"end":109},{"start":109,"end":10},{"start":10,"end":338},{"start":338,"end":297},{"start":297,"end":332},{"start":332,"end":284},{"start":284,"end":251},{"start":251,"end":389},{"start":116,"end":143},{"start":143,"end":227},{"start":227,"end":234},{"start":234,"end":127},{"start":127,"end":162},{"start":50,"end":117},{"start":117,"end":118},{"start":118,"end":119},{"start":119,"end":120},{"start":120,"end":100},{"start":345,"end":372},{"start":372,"end":447},{"start":447,"end":454},{"start":454,"end":356},{"start":356,"end":389},{"start":280,"end":346},{"start":346,"end":347},{"start":347,"end":348},{"start":348,"end":349},{"start":349,"end":329}];

export class HeadTracker implements ITracker {
  private status: TrackingStatus = {
    mode: 'head',
    state: 'idle',
    confidence: 0,
    message: 'Ready to start head tracking',
  };

  private pointerListeners: ((pos: PointerPosition) => void)[] = [];
  private eventListeners: ((event: TrackingEvent) => void)[] = [];
  
  private faceLandmarker: FaceLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  
  // UI Elements
  private previewVideo: HTMLVideoElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private drawingUtils: DrawingUtils | null = null;
  
  // Pose diagnostics
  public pose: { yaw: number, pitch: number, roll: number, hasMatrix: boolean, relYaw: number, relPitch: number, targetX: number, targetY: number } = { yaw: 0, pitch: 0, roll: 0, hasMatrix: false, relYaw: 0, relPitch: 0, targetX: 0, targetY: 0 };
  
  private requestAnimationFrameId: number | null = null;
  
  // Settings
  private sensitivity = 1.0; // Reduced sensitivity
  private smoothing = 0.8;
  private deadzone = 0.02;
  
  // State
  private lastX = 0.5;
  private lastY = 0.5;
  private lastTime = 0;
  
  // Calibration
  private isCalibrated = false;
  private neutralPitch = 0;
  private neutralYaw = 0;
  
  private gestureMachine = new GestureStateMachine();
  
  // Current jaw open score from most recent frame
  private currentJawOpenScore = 0;

  public latestGesture: string = 'None';
  public latestGestureOutput: GestureOutput | null = null;
  
  public configureGestures(config: Partial<Parameters<typeof this.gestureMachine.configure>[0]>) {
     this.gestureMachine.configure(config);
  }

  public setPreviewElements(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null) {
    this.previewVideo = video;
    this.previewCanvas = canvas;
    if (this.previewVideo && this.stream) {
      this.previewVideo.srcObject = this.stream;
    }
    if (this.previewCanvas) {
      const ctx = this.previewCanvas.getContext('2d');
      if (ctx) {
        this.drawingUtils = new DrawingUtils(ctx);
      }
    } else {
      this.drawingUtils = null;
    }
  }

  public async initialize(): Promise<void> {
    logger.info('HeadTracker', 'Initializing FaceLandmarker model');
    try {
      const vision = await FilesetResolver.forVisionTasks(
        chrome.runtime.getURL('wasm')
      );
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'),
          delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO",
        numFaces: 1
      });
      this.status.message = 'Initialized';
    } catch (e) {
      logger.error('HeadTracker', 'Failed to initialize FaceLandmarker', e);
      this.status.state = 'error';
      this.status.message = 'Model loading failed';
      throw e;
    }
  }

  public async start(mode: TrackingMode = 'head'): Promise<void> {
    if (this.status.state === 'active') return;
    
    logger.info('HeadTracker', `Starting head tracking...`);
    this.status.mode = mode;
    this.status.state = 'starting';
    
    try {
      // 1. Request webcam access only after starting
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 }, 
          facingMode: 'user' 
        } 
      });
      
      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.stream;
      this.videoElement.playsInline = true;
      this.videoElement.muted = true;
      await this.videoElement.play();
      
      if (this.previewVideo) {
        this.previewVideo.srcObject = this.stream;
        this.previewVideo.play().catch(e => logger.warn('HeadTracker', 'Preview play failed', e));
      }

      if (!this.isCalibrated) {
        await this.calibrate();
      } else {
        this.status.state = 'active';
        this.status.message = 'Tracking active';
      }
      
      this.lastTime = performance.now();
      this.detectLoop();
    } catch (e: any) {
      logger.error('HeadTracker', `Camera access failed: ${e.name} - ${e.message}`, e);
      this.status.state = 'error';
      if (e.name === 'NotAllowedError') {
        this.status.message = 'Camera permission denied. Please grant access and try again.';
      } else if (e.name === 'NotFoundError') {
        this.status.message = 'No webcam found. Please connect a camera.';
      } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        this.status.message = 'Webcam is currently in use by another application.';
      } else {
        this.status.message = `Camera error: ${e.message || 'Unknown error'}`;
      }
      throw e;
    }
  }

  private detectLoop = () => {
    if (this.status.state !== 'active' && this.status.state !== 'calibrating') {
      return;
    }

    if (this.faceLandmarker && this.videoElement && this.videoElement.readyState >= 2) {
      const startTimeMs = performance.now();
      if (this.lastTime !== this.videoElement.currentTime) {
        this.lastTime = this.videoElement.currentTime;
        const results = this.faceLandmarker.detectForVideo(this.videoElement, startTimeMs);
        
        let trackingValid = false;
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
          trackingValid = true;
          const landmarks = results.faceLandmarks[0];
          
          this.drawOverlay(landmarks);
          this.extractPose(results.facialTransformationMatrixes?.[0]);

          const rawPos = this.processPose();
          
          if (results.faceBlendshapes && results.faceBlendshapes.length > 0 && rawPos) {
             this.currentJawOpenScore = this.extractJawOpenScore(results.faceBlendshapes[0].categories);
          }
          
          this.status.confidence = 1;
        } else {
          this.clearOverlay();
          this.pose.hasMatrix = false;
          // Face lost
          if (this.status.state === 'active') {
             this.status.confidence = 0;
          }
        }
        
        // Pass everything to the Gesture State Machine
        const input: GestureInput = {
          jawOpenScore: this.currentJawOpenScore,
          relativeYawDeg: this.pose.relYaw,
          relativeRollDeg: this.pose.roll,
          trackingValid,
          nowMs: Date.now()
        };
        
        const output = this.gestureMachine.update(input);
        this.latestGestureOutput = output;
        
        // Use frozen or live position
        const emitPos: PointerPosition = {
          x: this.lastX,
          y: this.lastY,
          confidence: this.status.confidence,
          timestamp: input.nowMs
        };
        
        if (trackingValid && !output.freezeCursor) {
           this.emitPointer(emitPos);
        }
        
        // Handle Action
        if (output.action === 'MOUTH_CLICK') {
           this.setLiveGesture('Mouth Click');
           this.emitEvent({ timestamp: input.nowMs, mode: 'head', position: emitPos, gesture: 'mouth_open', confidence: 1 });
        } else if (output.action === 'TAB_LEFT') {
           this.setLiveGesture('Tab Left');
           this.emitEvent({ timestamp: input.nowMs, mode: 'head', position: emitPos, gesture: 'tab_left', confidence: 1 });
        } else if (output.action === 'TAB_RIGHT') {
           this.setLiveGesture('Tab Right');
           this.emitEvent({ timestamp: input.nowMs, mode: 'head', position: emitPos, gesture: 'tab_right', confidence: 1 });
        } else if (output.action === 'UNDO') {
           this.setLiveGesture('Undo');
           this.emitEvent({ timestamp: input.nowMs, mode: 'head', position: emitPos, gesture: 'undo', confidence: 1 });
        } else if (output.action === 'REDO') {
           this.setLiveGesture('Redo');
           this.emitEvent({ timestamp: input.nowMs, mode: 'head', position: emitPos, gesture: 'redo', confidence: 1 });
        }
        
        // Diagnostic label update
        if (output.gestureLabel !== 'None' && output.gestureLabel !== 'Frozen') {
           this.setLiveGesture(output.gestureLabel);
        }
      }
    }
    this.requestAnimationFrameId = requestAnimationFrame(this.detectLoop);
  }

  private extractPose(matrixItem?: { data: number[] | Float32Array }) {
    if (!matrixItem || !matrixItem.data || matrixItem.data.length < 16) {
       this.pose.hasMatrix = false;
       return;
    }
    
    // 4x4 matrix (column-major)
    const m = matrixItem.data;
    const r00 = m[0];
    const r10 = m[1];
    const r20 = m[2], r21 = m[6], r22 = m[10];
    
    let pitch = Math.atan2(r21, r22) * 180 / Math.PI;
    let yaw = Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22)) * 180 / Math.PI;
    let roll = Math.atan2(r10, r00) * 180 / Math.PI;
    
    // Mild smoothing for display
    const alpha = 0.5;
    this.pose.pitch = this.pose.pitch * alpha + pitch * (1 - alpha);
    this.pose.yaw = this.pose.yaw * alpha + yaw * (1 - alpha);
    this.pose.roll = this.pose.roll * alpha + roll * (1 - alpha);
    this.pose.hasMatrix = true;
  }

  private drawOverlay(landmarks: any[]) {
    if (!this.previewCanvas || !this.previewVideo || !this.drawingUtils) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;
    
    // Ensure canvas matches video's intrinsic dimensions for accurate coordinate mapping.
    // CSS object-fit will crop and scale the video and canvas synchronously.
    const vw = this.previewVideo.videoWidth || 640;
    const vh = this.previewVideo.videoHeight || 480;
    if (this.previewCanvas.width !== vw || this.previewCanvas.height !== vh) {
      this.previewCanvas.width = vw;
      this.previewCanvas.height = vh;
    }
    
    ctx.clearRect(0, 0, vw, vh);
    
    const drawCustomLines = (points: any[], edges: any[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const edge of edges) {
        const p1 = points[edge.start];
        const p2 = points[edge.end];
        if (p1 && p2) {
          ctx.moveTo(p1.x * vw, p1.y * vh);
          ctx.lineTo(p2.x * vw, p2.y * vh);
        }
      }
      ctx.stroke();
    };

    // Draw sparse secondary facial mesh with subtle style
    drawCustomLines(landmarks, SPARSE_MESH_CONNECTIONS, 'rgba(255, 255, 255, 0.25)', 0.55);

    // Draw primary contours with refined bright lines
    const contourColor = 'rgba(255, 255, 255, 0.90)';
    const contourWidth = 1.0;
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, contourColor, contourWidth);
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, contourColor, contourWidth);
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, contourColor, contourWidth);
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, contourColor, contourWidth);
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, contourColor, contourWidth);
    drawCustomLines(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, contourColor, contourWidth);
    
    // Draw an explicit nose bridge contour 
    const noseContour = [{"start":168,"end":6},{"start":6,"end":197},{"start":197,"end":195},{"start":195,"end":5},{"start":5,"end":4}];
    drawCustomLines(landmarks, noseContour, contourColor, contourWidth);
  }

  private clearOverlay() {
    if (!this.previewCanvas) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  private processPose() {
    if (this.status.state === 'calibrating' || !this.pose.hasMatrix) return;
    
    const currentYaw = this.pose.yaw;
    const currentPitch = this.pose.pitch;

    // Relative movement from neutral position (mirrored horizontally)
    // Scale the degrees to normalized [0, 1] screen space coordinates
    // We assume roughly +/- 30 degrees for full horizontal motion, +/- 20 degrees for vertical
    let deltaX = -(currentYaw - this.neutralYaw) / 30 * this.sensitivity;
    let deltaY = (currentPitch - this.neutralPitch) / 20 * this.sensitivity;

    // Apply Deadzone
    if (Math.abs(deltaX) < this.deadzone) deltaX = 0;
    if (Math.abs(deltaY) < this.deadzone) deltaY = 0;

    let targetX = 0.5 + deltaX;
    let targetY = 0.5 + deltaY;

    // Clamp
    targetX = Math.max(0, Math.min(1, targetX));
    targetY = Math.max(0, Math.min(1, targetY));
    
    // Save diagnostics
    this.pose.relYaw = currentYaw - this.neutralYaw;
    this.pose.relPitch = currentPitch - this.neutralPitch;
    this.pose.targetX = targetX;
    this.pose.targetY = targetY;

    // Smoothing (exponential moving average)
    const x = this.lastX * this.smoothing + targetX * (1 - this.smoothing);
    const y = this.lastY * this.smoothing + targetY * (1 - this.smoothing);

    this.lastX = x;
    this.lastY = y;

    const pos: PointerPosition = {
      x,
      y,
      confidence: 1,
      timestamp: Date.now()
    };
    
    return pos;
  }

  private extractJawOpenScore(categories: any[]): number {
    for (const cat of categories) {
      if (cat.categoryName === 'jawOpen') {
        return cat.score;
      }
    }
    return 0;
  }

  // End of old gestures

  private setLiveGesture(gesture: string) {
    this.latestGesture = gesture;
    setTimeout(() => {
      if (this.latestGesture === gesture) this.latestGesture = 'None';
    }, 1500);
  }

  public async pause(): Promise<void> {
    logger.info('HeadTracker', 'Pausing head tracker');
    this.status.state = 'paused';
    this.status.message = 'Tracking paused';
    this.gestureMachine.pause();
  }

  public async resume(): Promise<void> {
    logger.info('HeadTracker', 'Resuming head tracker');
    this.status.state = 'active';
    this.status.message = 'Tracking active';
    this.gestureMachine.resume();
    if (!this.requestAnimationFrameId) {
        this.detectLoop();
    }
  }

  public async stop(): Promise<void> {
    logger.info('HeadTracker', 'Stopping head tracker');
    if (this.requestAnimationFrameId) {
      cancelAnimationFrame(this.requestAnimationFrameId);
      this.requestAnimationFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    if (this.previewVideo) {
      this.previewVideo.srcObject = null;
    }
    this.clearOverlay();
    this.status.state = 'idle';
    this.status.message = 'Tracking stopped';
    this.gestureMachine.stop();
  }

  public async calibrate(): Promise<void> {
    logger.info('HeadTracker', 'Calibrating head position...');
    this.status.state = 'calibrating';
    this.status.message = 'Please look straight at the camera and keep your head still...';
    
    return new Promise((resolve) => {
       setTimeout(() => {
         if (this.pose.hasMatrix) {
            this.neutralYaw = this.pose.yaw;
            this.neutralPitch = this.pose.pitch;
            this.isCalibrated = true;
            this.status.state = 'active';
            this.status.message = 'Calibration complete';
         } else {
            this.neutralYaw = 0;
            this.neutralPitch = 0;
            this.isCalibrated = true;
            this.status.state = 'active';
            this.status.message = 'Calibration complete (fallback)';
         }
         resolve();
       }, 2000); 
    });
  }

  public getStatus(): TrackingStatus {
    return { ...this.status };
  }

  public onPointerMove(listener: (pos: PointerPosition) => void): () => void {
    this.pointerListeners.push(listener);
    return () => {
      this.pointerListeners = this.pointerListeners.filter((l) => l !== listener);
    };
  }

  public onTrackingEvent(listener: (event: TrackingEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  public async destroy(): Promise<void> {
    await this.stop();
    if (this.faceLandmarker) {
       this.faceLandmarker.close();
       this.faceLandmarker = null;
    }
    this.pointerListeners = [];
    this.eventListeners = [];
  }

  private emitPointer(pos: PointerPosition): void {
    for (const listener of this.pointerListeners) {
      listener(pos);
    }
  }

  private emitEvent(event: TrackingEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
