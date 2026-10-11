import React, { useState, useEffect, useRef } from 'react';
import { t } from '../shared/i18n';
import {
  TrackingMode,
  TrackingStatus,
  SupportedLanguage,
  SUPPORTED_LANGUAGES,
  TaskRecord,
  BrowserAction,
  ApprovalMode,
  AssistantState,
  PointerPosition,
} from '../shared/types';
import { HandTracker } from '../tracking/hand/HandTracker';
import { HAND_CONNECTIONS } from '../tracking/hand/landmarkConnections';
import { actionForHandGesture } from '../tracking/hand/gestureActions';
import type { CalibrationState } from '../tracking/hand/calibration/calibrationEngine';
import { MockHeadTracker } from '../tracking/head/mockHeadTracker';
import { defaultMockAiClient } from '../ai/mockAiClient';
import { defaultMockTaskMemoryStore } from '../memory/mockTaskMemoryStore';
import { defaultChromeActionExecutor } from '../browser/chromeActionExecutor';
import { defaultActionPolicy } from '../shared/safety/action-policy';
import { WebSpeechRecognizer } from '../voice/webSpeechRecognizer';

// The real tracker owns the camera in hand mode. MockHandTracker remains
// available as an exported fallback, but is not used for the live session.
const handTracker = new HandTracker();
const headTracker = new MockHeadTracker();
const voiceRecognizer = new WebSpeechRecognizer();

const INITIAL_CALIBRATION_STATE: CalibrationState = {
  phase: 'idle', progress: 0, instruction: 'Calibration not started.', elapsedMs: 0, remainingMs: 0,
};

function drawHandSkeleton(canvas: HTMLCanvasElement, hands: Array<Array<{ x: number; y: number }>>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, bounds.width, bounds.height);

  for (const hand of hands) {
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.lineWidth = 2;
    for (const [start, end] of HAND_CONNECTIONS) {
      const a = hand[start];
      const b = hand[end];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * bounds.width, a.y * bounds.height);
      ctx.lineTo(b.x * bounds.width, b.y * bounds.height);
      ctx.stroke();
    }
    for (const landmark of hand) {
      ctx.beginPath();
      ctx.arc(landmark.x * bounds.width, landmark.y * bounds.height, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#10B981';
      ctx.fill();
    }
  }
}

export const Sidepanel: React.FC = () => {
  // Theme & App State
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [currentView, setCurrentView] = useState<'main' | 'settings' | 'history' | 'task_details'>('main');
  const [viewedTaskId, setViewedTaskId] = useState<string | null>(null);

  // Tracking
  const [mode, setMode] = useState<TrackingMode>('hand');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>({
    mode: 'hand', state: 'idle', confidence: 0, message: 'Standby',
  });

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraState, setCameraState] = useState<'off' | 'requesting' | 'live' | 'error'>('off');
  const [showSkeleton] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);
  const [handFeedback, setHandFeedback] = useState({ hands: 0, pointing: false, pointerActive: false, cursorDelivered: false, frames: 0, inferenceMs: 0 });
  const [lastGesture, setLastGesture] = useState<string>('none');
  const [calibrationState, setCalibrationState] = useState<CalibrationState>(INITIAL_CALIBRATION_STATE);
  const calibrationInFlightRef = useRef(false);
  const calibrationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showGestureGuide, setShowGestureGuide] = useState(false);

  // Settings
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask');
  const [interfaceLanguage, setInterfaceLanguage] = useState<SupportedLanguage>('en');
  const [voiceLanguage, setVoiceLanguage] = useState<SupportedLanguage>('en');
  const [sensitivity, setSensitivity] = useState<number>(1.0);

  // Voice State
  const [voiceState, setVoiceState] = useState<'idle' | 'requesting' | 'listening' | 'processing' | 'recognized' | 'denied' | 'unsupported' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Assistant & Chat
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [inputText, setInputText] = useState('');
  const [conversation, setConversation] = useState<{role: 'user'|'assistant', text: string}[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Actions & Approval
  const [currentActionDescription, setCurrentActionDescription] = useState<string>(t('tracking', interfaceLanguage) + '...');
  const [pendingApproval, setPendingApproval] = useState<BrowserAction | null>(null);
  
  // Tasks & History
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTask = tasks.find(t => t.id === activeTaskId) || null;

  // Theme Sync
  useEffect(() => {
    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    };
    applyTheme();
    const listener = () => { if (theme === 'system') applyTheme(); };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);

  // Init Tasks & Voice Binding
  useEffect(() => {
    defaultMockTaskMemoryStore.listTasks().then(setTasks);

    const unbindResult = voiceRecognizer.onResult((res) => {
      setInputText(res.transcript);
      if (res.isFinal) {
        setVoiceState('recognized');
      }
    });
    const unbindError = voiceRecognizer.onError((err) => {
      if (err === 'not-allowed') setVoiceState('denied');
      else {
        setVoiceState('error');
        setVoiceError(err);
      }
    });
    const unbindEnd = voiceRecognizer.onEnd(() => {
      setVoiceState(prev => (prev === 'listening' ? 'idle' : prev));
    });

    return () => { unbindResult(); unbindError(); unbindEnd(); };
  }, []);

  // Raw MediaPipe results drive the existing preview canvas. The preview and
  // canvas are both mirrored by CSS, so raw normalized landmarks use the same
  // coordinate orientation as Member 1's original implementation.
  useEffect(() => {
    let lastFeedbackUpdate = 0;
    const unbindRaw = handTracker.onRawResult((result) => {
      if (showSkeleton && canvasRef.current) {
        drawHandSkeleton(canvasRef.current, result.landmarks);
      }
      if (Date.now() - lastFeedbackUpdate >= 200) {
        lastFeedbackUpdate = Date.now();
        const diagnostics = handTracker.getDiagnostics();
        setHandFeedback((previous) => ({
          ...previous,
          hands: result.landmarks.filter((hand) => hand.length === 21).length,
          pointing: diagnostics.pointing,
          pointerActive: diagnostics.pointerActive,
          frames: diagnostics.processedFrames,
          inferenceMs: diagnostics.inferenceMs,
        }));
        setTrackingStatus(handTracker.getStatus());
      }
    });
    return unbindRaw;
  }, [showSkeleton]);

  // Tracking visualization binding
  useEffect(() => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    let lastPipelineDiagnosticAt = 0;
    const injectionInFlight = new Map<number, Promise<void>>();
    const lastInjectionFailureAt = new Map<number, number>();
    const logPipeline = (message: string, data?: Record<string, unknown>) => {
      if (Date.now() - lastPipelineDiagnosticAt < 1_000) return;
      lastPipelineDiagnosticAt = Date.now();
      console.info(`[Handsfree][PointerPipeline] ${message}`, data ?? '');
    };

    const deliverPointer = async (tabId: number, pos: PointerPosition) => {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'POINTER_POSITION_UPDATE', payload: pos });
        if (mode === 'hand') setHandFeedback((previous) => ({ ...previous, cursorDelivered: response?.ok === true }));
        logPipeline('Pointer delivered to content script.', { tabId, cursorVisible: response?.ok === true });
      } catch (initialError) {
        // Tabs open before an extension reload do not receive static content
        // scripts again. Inject once on demand, then retry this same pointer.
        try {
          if (Date.now() - (lastInjectionFailureAt.get(tabId) ?? 0) < 1_000) {
            throw initialError;
          }
          let injection = injectionInFlight.get(tabId);
          if (!injection) {
            injection = chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['content.js'],
            }).then(() => undefined).finally(() => injectionInFlight.delete(tabId));
            injectionInFlight.set(tabId, injection);
          }
          await injection;
          const response = await chrome.tabs.sendMessage(tabId, { type: 'POINTER_POSITION_UPDATE', payload: pos });
          if (mode === 'hand') setHandFeedback((previous) => ({ ...previous, cursorDelivered: response?.ok === true }));
          logPipeline('Content script injected and pointer delivered.', { tabId, cursorVisible: response?.ok === true });
        } catch (retryError) {
          if (mode === 'hand') setHandFeedback((previous) => ({ ...previous, cursorDelivered: false }));
          lastInjectionFailureAt.set(tabId, Date.now());
          logPipeline('Pointer delivery failed; target cannot host the cursor.', {
            tabId,
            error: String(retryError || initialError),
          });
        }
      }
    };

    const unbindPointer = activeTracker.onPointerMove((pos: PointerPosition) => {
      // Send pointer updates to the active webpage
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          void deliverPointer(tabs[0].id, pos);
        } else {
          logPipeline('No active web tab was available for the pointer update.');
        }
      });
      
    });
    return () => { unbindPointer(); };
  }, [mode, showSkeleton, cameraState]);

  // Adjust canvas size to match video
  useEffect(() => {
    if (cameraState === 'live' && videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const updateSize = () => {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      };
      const timer = setTimeout(updateSize, 100);
      window.addEventListener('resize', updateSize);
      return () => { clearTimeout(timer); window.removeEventListener('resize', updateSize); };
    }
  }, [cameraState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCalibrationPolling();
      stopCamera();
      handTracker.stop();
      headTracker.stop();
    };
  }, []);

  // Camera lifecycle is now purely driven by Session Start/Stop

  const startCamera = async () => {
    console.log('[Camera Flow] startCamera called. Current state:', cameraState, 'Stream exists:', !!streamRef.current);
    if (streamRef.current) {
      console.log('[Camera Flow] Stream already exists. Returning early.');
      return;
    }
    
    try {
      console.log('[Camera Flow] Setting state to requesting...');
      setCameraState('requesting');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Camera Flow] navigator.mediaDevices.getUserMedia is not supported or not in a secure context.');
        throw new Error('getUserMedia not supported in this context.');
      }
      
      // Request audio first
      try {
        console.log('[Camera Flow] Requesting audio...');
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[Camera Flow] Audio granted, stopping audio tracks immediately.');
        audioStream.getTracks().forEach(track => track.stop());
      } catch (e: any) {
        console.warn('[Camera Flow] Audio request denied or failed:', e.name, e.message);
      }

      console.log('[Camera Flow] Requesting video...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      console.log('[Camera Flow] Video granted. Stream ID:', stream.id);
      
      streamRef.current = stream;
      if (videoRef.current) {
        console.log('[Camera Flow] Attaching stream to video element.');
        videoRef.current.srcObject = stream;
      } else {
        console.warn('[Camera Flow] videoRef is null, cannot attach stream!');
      }
      
      console.log('[Camera Flow] Setting state to live.');
      setCameraState('live');
    } catch (err: any) {
      console.error('[Camera Flow] Video request failed!', err.name, err.message, err);
      setCameraState('error');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setCameraState('off');
  };

  const attachHandTrackerPreview = () => {
    const trackerVideo = handTracker.getVideoElement();
    if (!trackerVideo?.srcObject) {
      throw new Error('Hand camera started without a video stream.');
    }
    if (videoRef.current) {
      // This reuses the stream opened by HandTracker; do not request another
      // camera stream for the side-panel preview.
      videoRef.current.srcObject = trackerVideo.srcObject;
    }
    setCameraState('live');
  };

  const clearCalibrationPolling = () => {
    if (calibrationPollRef.current) {
      clearInterval(calibrationPollRef.current);
      calibrationPollRef.current = null;
    }
  };

  const handleCalibrate = async () => {
    if (mode !== 'hand' || calibrationInFlightRef.current || trackingStatus.state !== 'active') return;
    calibrationInFlightRef.current = true;
    setCalibrationState(handTracker.getCalibrationState());
    setCurrentActionDescription('Calibration started. Follow the instruction below.');
    clearCalibrationPolling();
    calibrationPollRef.current = setInterval(() => {
      setCalibrationState(handTracker.getCalibrationState());
    }, 200);

    try {
      await handTracker.calibrate();
      setCalibrationState(handTracker.getCalibrationState());
      setTrackingStatus(handTracker.getStatus());
      setCurrentActionDescription('Hand calibration complete.');
    } catch (err) {
      setCalibrationState(handTracker.getCalibrationState());
      setTrackingStatus(handTracker.getStatus());
      setCurrentActionDescription(`Calibration error: ${(err as Error).message}`);
    } finally {
      calibrationInFlightRef.current = false;
      clearCalibrationPolling();
    }
  };

  // Tracking Handlers
  const handleStart = async () => {
    try {
      if (mode === 'hand') {
        setCameraState('requesting');
        await handTracker.start('hand');
        attachHandTrackerPreview();
        setTrackingStatus(handTracker.getStatus());
        return;
      }

      await startCamera();
      await headTracker.start('head');
      setTrackingStatus(headTracker.getStatus());
    } catch (err) {
      console.error('[Tracking] Failed to start tracker:', err);
      setCameraState('error');
      const activeTracker = mode === 'hand' ? handTracker : headTracker;
      setTrackingStatus(activeTracker.getStatus());
    }
  };

  // @ts-ignore: preserved for underlying lifecycle logic
  const handlePause = async () => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.pause();
    setTrackingStatus(activeTracker.getStatus());
  };

  // @ts-ignore: preserved for underlying lifecycle logic
  const handleResume = async () => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.resume();
    setTrackingStatus(activeTracker.getStatus());
  };

  const handleStop = async () => {
    clearCalibrationPolling();
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.stop();
    calibrationInFlightRef.current = false;
    setCalibrationState(handTracker.getCalibrationState());
    setHandFeedback({ hands: 0, pointing: false, pointerActive: false, cursorDelivered: false, frames: 0, inferenceMs: 0 });
    setTrackingStatus(activeTracker.getStatus());
    stopCamera();
  };

  const handleModeChange = async (newMode: TrackingMode) => {
    if (newMode === mode) return;

    const wasActive = trackingStatus.state === 'active' || trackingStatus.state === 'paused';
    clearCalibrationPolling();
    const previousTracker = mode === 'hand' ? handTracker : headTracker;
    await previousTracker.stop();
    calibrationInFlightRef.current = false;
    setCalibrationState(handTracker.getCalibrationState());
    setHandFeedback({ hands: 0, pointing: false, pointerActive: false, cursorDelivered: false, frames: 0, inferenceMs: 0 });
    // Stops the head-mode stream and clears the preview. In hand mode the
    // tracker has already released its own stream above.
    stopCamera();
    setMode(newMode);

    if (!wasActive) {
      setTrackingStatus((newMode === 'hand' ? handTracker : headTracker).getStatus());
      return;
    }

    try {
      if (newMode === 'hand') {
        setCameraState('requesting');
        await handTracker.start('hand');
        attachHandTrackerPreview();
        setTrackingStatus(handTracker.getStatus());
      } else {
        await startCamera();
        await headTracker.start('head');
        setTrackingStatus(headTracker.getStatus());
      }
    } catch (err) {
      console.error('[Tracking] Failed to switch tracker mode:', err);
      setCameraState('error');
      const activeTracker = newMode === 'hand' ? handTracker : headTracker;
      setTrackingStatus(activeTracker.getStatus());
    }
  };

  // Actions & AI
  const executeActionSafely = async (action: BrowserAction, taskId: string) => {
    const decision = defaultActionPolicy.evaluate(action, approvalMode);
    if (decision.requiresApproval) {
      setAssistantState('awaiting_approval');
      setPendingApproval(action);
      setCurrentActionDescription(`${t('actionRequired', interfaceLanguage)}: ${action.type}`);
      return;
    }

    setAssistantState('executing');
    setCurrentActionDescription(`${t('tracking', interfaceLanguage)}: ${action.type}`);
    const stepNumber = await defaultMockTaskMemoryStore.addStep(taskId, action);
    const result = await defaultChromeActionExecutor.execute(action);
    await defaultMockTaskMemoryStore.recordStepResult(taskId, stepNumber, result);
    await defaultMockTaskMemoryStore.updateTaskStatus(taskId, result.success ? 'completed' : 'failed');
    const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setAssistantState(result.success ? 'success' : 'error');
    setCurrentActionDescription(result.message);
  };

  const handleHandGesture = async (gesture: Parameters<typeof actionForHandGesture>[0]) => {
    setLastGesture(gesture);

    if (gesture === 'shaka') {
      toggleListen();
      setCurrentActionDescription(`Gesture recognized: shaka (toggled voice)`);
      return;
    }

    const action = actionForHandGesture(gesture);
    if (!action) {
      setCurrentActionDescription(`Gesture recognized: ${gesture} (no approval-safe action mapped)`);
      return;
    }

    const task = await defaultMockTaskMemoryStore.createTask(`Hand gesture: ${gesture}`, voiceLanguage);
    await defaultMockTaskMemoryStore.updateTaskStatus(task.id, 'in_progress');
    setActiveTaskId(task.id);
    setTasks(await defaultMockTaskMemoryStore.listTasks());
    await executeActionSafely(action, task.id);
  };

  useEffect(() => {
    const unbindGesture = handTracker.onTrackingEvent((event) => {
      void handleHandGesture(event.gesture);
    });
    return unbindGesture;
  }, [voiceLanguage, approvalMode]);

  const handleApproveAction = async () => {
    if (!pendingApproval || !activeTaskId) return;
    const action = pendingApproval;
    setPendingApproval(null);
    setAssistantState('executing');
    
    // Notify background script so it trusts the incoming execution request
    await chrome.runtime.sendMessage({ type: 'APPROVE_ACTION', payload: { action } });
    
    const stepNumber = await defaultMockTaskMemoryStore.addStep(activeTaskId, action);
    const result = await defaultChromeActionExecutor.execute(action);
    await defaultMockTaskMemoryStore.recordStepResult(activeTaskId, stepNumber, result);
    await defaultMockTaskMemoryStore.updateTaskStatus(activeTaskId, result.success ? 'completed' : 'failed');
    const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setAssistantState(result.success ? 'success' : 'error');
    setCurrentActionDescription(result.message);
  };

  const handleRejectAction = async () => {
    if (!pendingApproval || !activeTaskId) return;
    const action = pendingApproval;
    setPendingApproval(null);
    setAssistantState('idle');
    setCurrentActionDescription(t('cancel', interfaceLanguage));
    
    // Notify background
    await chrome.runtime.sendMessage({ type: 'REJECT_ACTION', payload: { action } });
    
    const stepNumber = await defaultMockTaskMemoryStore.addStep(activeTaskId, action);
    await defaultMockTaskMemoryStore.recordStepResult(activeTaskId, stepNumber, { success: false, message: 'Action rejected by user' });
    await defaultMockTaskMemoryStore.updateTaskStatus(activeTaskId, 'cancelled');
    const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setActiveTaskId(null);
  };

  
  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    // Attempt to match the selected language
    utterance.lang = voiceLanguage;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleReadPage = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) throw new Error('No active tab found');
      const response = await chrome.tabs.sendMessage(tabs[0].id, { 
        type: 'EXECUTE_BROWSER_ACTION', 
        action: { type: 'read_page' } 
      });
      if (response && response.success && response.data?.content) {
        setConversation(prev => [...prev, { role: 'user', text: 'Read this page' }]);
        const reply = "I am reading the page: " + response.data.content.substring(0, 500) + "...";
        setConversation(prev => [...prev, { role: 'assistant', text: reply }]);
        speakText(response.data.content);
      } else {
        throw new Error('Failed to read page content');
      }
    } catch (err: any) {
       setConversation(prev => [...prev, { role: 'assistant', text: `Error reading page: ${err.message}` }]);
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToProcess = overrideText || inputText;
    if (!textToProcess.trim() || assistantState === 'thinking') return;
    
    if (voiceState === 'listening') {
      await voiceRecognizer.stopListening();
    }
    setVoiceState('processing');
    setAssistantState('thinking');
    setCurrentActionDescription('...');
    setConversation(prev => [...prev, {role: 'user', text: textToProcess}]);
    if (!overrideText) {
      setInputText('');
    }

    try {
      await defaultMockAiClient.sendMessage(textToProcess, voiceLanguage);
      const assistantReply = await defaultMockAiClient.sendMessage(textToProcess, voiceLanguage);
      setConversation(prev => [...prev, {role: 'assistant', text: assistantReply.content}]);
      speakText(assistantReply.content);
      const plannedActions = await defaultMockAiClient.generatePlan(textToProcess, voiceLanguage);
      const newTask = await defaultMockTaskMemoryStore.createTask(textToProcess, voiceLanguage);
      setActiveTaskId(newTask.id);
      
      const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
      setTasks(updatedTasks);

      if (plannedActions.length > 0) {
        await executeActionSafely(plannedActions[0], newTask.id);
      } else {
        setAssistantState('success');
        setCurrentActionDescription('...');
        setActiveTaskId(null);
      }
      setVoiceState('idle');
    } catch (err) {
      setAssistantState('error');
      setCurrentActionDescription(`Error: ${(err as Error).message}`);
      setVoiceState('error');
    }
  };

  const handleCancelTask = async () => {
    if (activeTaskId) {
      await defaultMockTaskMemoryStore.updateTaskStatus(activeTaskId, 'cancelled');
      const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
      setTasks(updatedTasks);
      setActiveTaskId(null);
      setAssistantState('idle');
      setPendingApproval(null);
    }
  };

  const handleResumeTask = async (taskId: string) => {
    setActiveTaskId(taskId);
    await defaultMockTaskMemoryStore.updateTaskStatus(taskId, 'in_progress');
    const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setAssistantState('idle');
    setCurrentView('main');
  };

  const handleClearHistory = async () => {
    await defaultMockTaskMemoryStore.clearHistory();
    setTasks([]);
    setActiveTaskId(null);
  };

  const toggleListen = async () => {
    if (voiceState === 'listening') {
      await voiceRecognizer.stopListening();
      return;
    }
    try {
      setVoiceState('requesting');
      setVoiceError(null);
      setInputText('');
      await voiceRecognizer.startListening(voiceLanguage);
      setVoiceState('listening');
    } catch (err: any) {
      if (err.message.includes('not supported')) {
        setVoiceState('unsupported');
      } else {
        setVoiceState('error');
        setVoiceError(err.message);
      }
    }
  };

  return (
    // Background matching the warm cream reference #f6f4ee
    <div className="flex flex-col min-h-screen overflow-y-auto px-4 py-5 space-y-4 font-sans text-hf-text-primary dark:text-hf-dark-text-primary transition-colors duration-200 bg-hf-ivory dark:bg-hf-dark-bg selection:bg-teal-500/20">
      
      {/* 1. Header with Official Logo */}
      <div className="flex flex-col bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-4 dark:border-white/5 space-y-3 shrink-0">
        <div className="flex justify-between items-start w-full">
          <div className="flex space-x-3 items-center">
            <div className="w-[52px] h-[52px] flex items-center justify-center shrink-0">
              <img src="/icons/icon-128.png" alt="Handsfree Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[20px] font-bold tracking-tight text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white leading-tight">Handsfree</h1>
              <p className="text-[12px] text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-400 font-medium tracking-tight">{t('subtitle', interfaceLanguage)}</p>
            </div>
          </div>
          <div className="flex space-x-1">
            <button 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="w-[36px] h-[36px] rounded-full bg-gradient-to-tr from-white/80 to-white/40 dark:from-white/10 dark:to-white/5 backdrop-blur-md border border-white/80 dark:border-white/20 shadow-[inset_0_2px_4px_rgba(255,255,255,0.8),0_2px_8px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.2)] hover:scale-105 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(255,255,255,0.05)] transition-all flex items-center justify-center text-hf-text-secondary dark:text-hf-dark-text-secondary" 
            >
              {theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Switch to light mode</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              ) : (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Switch to dark mode</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
              )}
            </button>
            <button 
              onClick={() => setCurrentView(currentView === 'settings' ? 'main' : 'settings')}
              className="w-[36px] h-[36px] rounded-full bg-gradient-to-tr from-white/80 to-white/40 dark:from-white/10 dark:to-white/5 backdrop-blur-md border border-white/80 dark:border-white/20 shadow-[inset_0_2px_4px_rgba(255,255,255,0.8),0_2px_8px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.2)] hover:scale-105 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(255,255,255,0.05)] transition-all flex items-center justify-center text-hf-text-secondary dark:text-hf-dark-text-secondary" 
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
          </div>
        </div>
      </div>
      
      {currentView === 'settings' && (
        <div className="flex flex-col space-y-4 animate-in fade-in h-full pb-4">
          <div className="bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-5">
             <h2 className="text-[14px] font-bold mb-4">{t('settings', interfaceLanguage)}</h2>
             
             <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-sm font-medium">{t('interfaceLanguage', interfaceLanguage)}</span>
                  <select 
                    value={interfaceLanguage} 
                    onChange={(e) => setInterfaceLanguage(e.target.value as SupportedLanguage)}
                    className="text-[13px] font-semibold bg-gray-50 dark:bg-white/10 rounded-lg px-2 py-1 text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200 outline-none border border-hf-border dark:border-hf-dark-border"
                  >
                    {SUPPORTED_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.nativeName}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex justify-between items-center px-1">
                  <span className="text-sm font-medium">{t('voiceLanguage', interfaceLanguage)}</span>
                  <select 
                    value={voiceLanguage} 
                    onChange={(e) => setVoiceLanguage(e.target.value as SupportedLanguage)}
                    className="text-[13px] font-semibold bg-gray-50 dark:bg-white/10 rounded-lg px-2 py-1 text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200 outline-none border border-hf-border dark:border-hf-dark-border"
                  >
                    {SUPPORTED_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.nativeName}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-between items-center px-1">
                  <span className="text-sm font-medium">{t('actionApproval', interfaceLanguage)}</span>
                  <select 
                    value={approvalMode} 
                    onChange={(e) => {
                      const newMode = e.target.value as ApprovalMode;
                      setApprovalMode(newMode);
                      chrome.runtime.sendMessage({ type: 'SET_APPROVAL_MODE', payload: { mode: newMode } });
                    }}
                    className="text-[13px] font-semibold bg-gray-50 dark:bg-white/10 rounded-lg px-2 py-1 text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200 outline-none border border-hf-border dark:border-hf-dark-border"
                  >
                    <option value="ask">{t('ask', interfaceLanguage)}</option>
                    <option value="auto">{t('auto', interfaceLanguage)}</option>
                  </select>
                </div>

                <div className="flex justify-between items-center px-1">
                  <span className="text-sm font-medium">{t('sensitivity', interfaceLanguage)}</span>
                  <input 
                    type="range" min="0.1" max="2.0" step="0.1" 
                    value={sensitivity} 
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="w-1/2"
                  />
                </div>

                {mode === 'hand' && (
                  <div className="rounded-xl border border-hf-border dark:border-hf-dark-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">Hand calibration</div>
                        <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary">{calibrationState.instruction}</p>
                      </div>
                      <button
                        onClick={handleCalibrate}
                        disabled={trackingStatus.state !== 'active' || calibrationInFlightRef.current}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-hf-teal text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {calibrationState.phase === 'sweeping' ? 'Calibrating…' : calibrationState.phase === 'complete' ? 'Calibrated' : 'Calibrate'}
                      </button>
                    </div>
                    {calibrationState.phase === 'sweeping' && (
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                          <div className="h-full bg-hf-teal transition-all" style={{ width: `${Math.round(calibrationState.progress * 100)}%` }} />
                        </div>
                        <div className="text-[10px] text-hf-text-secondary dark:text-hf-dark-text-secondary">Move your index fingertip across your comfortable working area.</div>
                      </div>
                    )}
                    {calibrationState.phase === 'complete' && <div className="text-[11px] text-hf-teal font-semibold">Calibration complete — cursor bounds updated.</div>}
                    {calibrationState.phase === 'failed' && <div className="text-[11px] text-red-500">Calibration stopped; default cursor bounds are active.</div>}
                  </div>
                )}
                
                <button onClick={handleClearHistory} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-hf-red/10 rounded-lg">{t('clearHistory', interfaceLanguage)}</button>
                {tasks.length > 0 && tasks.map(task => (
                  <div key={task.id} className="text-[12px] p-2 border-t border-gray-100 flex justify-between">
                     <span>{task.goal}</span>
                     <button onClick={() => handleResumeTask(task.id)} className="text-blue-500 font-medium">{t('resume', interfaceLanguage) || 'Resume'}</button>
                  </div>
                ))}
             </div>

             <button onClick={() => setCurrentView('main')} className="mt-4 px-4 py-2 bg-gray-100 dark:bg-white/10 rounded-lg text-sm font-medium w-full text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white">{t('back', interfaceLanguage)}</button>
          </div>
        </div>
      )}

      {currentView === 'history' && (
        <div className="flex flex-col space-y-4 animate-in fade-in h-full pb-4">
          <div className="bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-5">
             <div className="flex justify-between items-center mb-4">
               <h2 className="text-[14px] font-bold">Task History</h2>
               <button onClick={() => setCurrentView('main')} className="text-gray-400 hover:text-hf-text-secondary dark:text-hf-dark-text-secondary font-medium text-sm">Close</button>
             </div>
             
             <div className="space-y-3">
               {tasks.length === 0 && <p className="text-sm text-hf-text-secondary dark:text-hf-dark-text-secondary text-center py-4">No tasks yet.</p>}
               {tasks.map(task => (
                 <div key={task.id} className="p-3 bg-hf-ivory dark:bg-white/5 rounded-xl border border-hf-border dark:border-hf-dark-border flex justify-between items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 transition" onClick={() => { setViewedTaskId(task.id); setCurrentView('task_details'); }}>
                   <div className="flex flex-col flex-1 min-w-0 pr-2">
                     <span className="font-bold text-[13px] truncate text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white">{task.goal}</span>
                     <span className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary capitalize">{task.status} • {new Date(task.createdAt).toLocaleTimeString()}</span>
                   </div>
                   <div className="flex items-center space-x-2 shrink-0">
                     <span className={`w-2 h-2 rounded-full ${task.status === 'completed' ? 'bg-hf-green' : task.status === 'failed' ? 'bg-hf-red' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
                     <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg>
                   </div>
                 </div>
               ))}
             </div>
             <button onClick={() => setCurrentView('main')} className="mt-4 px-4 py-2 bg-gray-100 dark:bg-white/10 rounded-lg text-sm font-medium w-full text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white">{t('back', interfaceLanguage)}</button>
          </div>
        </div>
      )}

      {currentView === 'task_details' && viewedTaskId && (
        <div className="flex flex-col space-y-4 animate-in fade-in h-full pb-4">
          <div className="bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-5">
             <div className="flex items-center mb-4 space-x-3">
               <button onClick={() => setCurrentView(activeTask?.id === viewedTaskId ? 'main' : 'history')} className="w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 flex items-center justify-center transition shrink-0">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg>
               </button>
               <h2 className="text-[14px] font-bold">Task Details</h2>
             </div>
             
             {(() => {
                const task = tasks.find(t => t.id === viewedTaskId);
                if (!task) return <div className="text-sm text-hf-text-secondary dark:text-hf-dark-text-secondary">Task not found</div>;
                return (
                  <div className="space-y-4">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary uppercase tracking-wider mb-1">Goal</span>
                      <span className="text-[14px] font-bold text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white break-words">{task.goal}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary uppercase tracking-wider mb-1">Status</span>
                        <div className="flex items-center space-x-1.5">
                          <span className={`w-2 h-2 rounded-full ${task.status === 'completed' ? 'bg-hf-green' : task.status === 'failed' ? 'bg-hf-red' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-400'}`}></span>
                          <span className="text-[13px] font-semibold capitalize text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200">{task.status}</span>
                        </div>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[11px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary uppercase tracking-wider mb-1">Created</span>
                        <span className="text-[13px] font-medium text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200">{new Date(task.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    
                    {task.status === 'failed' && currentActionDescription.startsWith('Failed:') && task.id === activeTaskId && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl text-[12px] font-medium break-words mt-3">
                        {currentActionDescription}
                      </div>
                    )}
                    
                    <div className="pt-2">
                      <span className="text-[11px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary uppercase tracking-wider mb-2 block">Steps History</span>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {task.steps && task.steps.length > 0 ? task.steps.map((step, idx) => (
                          <div key={idx} className="bg-hf-ivory dark:bg-white/5 rounded-xl p-3 text-[12px]">
                            <div className="font-semibold text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white mb-1 uppercase tracking-wider text-[10px]">Action {idx + 1}</div>
                            <div className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary dark:text-gray-200 mb-1">{step.action.type}</div>
                            {step.result && (
                              <div className={`mt-1 font-medium break-words ${step.result.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {step.result.message}
                              </div>
                            )}
                          </div>
                        )) : (
                          <div className="text-[12px] text-hf-text-secondary dark:text-hf-dark-text-secondary italic">No steps recorded yet.</div>
                        )}
                      </div>
                    </div>

                    {task.status === 'in_progress' && task.id === activeTask?.id && (
                      <button onClick={handleCancelTask} className="mt-4 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-bold w-full transition shadow-sm">Stop Task</button>
                    )}
                  </div>
                );
             })()}
          </div>
        </div>
      )}

      {currentView === 'main' && (
        <>
          {/* 2. Tracking Mode & Dictionary */}
          <div className="flex flex-col bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-2xl p-2 space-y-2 shrink-0">
            <div className="flex items-center justify-between px-1">
              <div className="relative flex bg-gradient-to-b from-gray-200/50 to-gray-100/50 dark:from-white/5 dark:to-white/10 rounded-full p-[3px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] border border-black/5 dark:border-white/5" >
                <div 
                  className="absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] bg-gradient-to-br from-white/90 to-white/70 dark:from-[#3A3C42]/80 dark:to-[#2A2B30]/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.05)] border border-white dark:border-white/20 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                  style={{ transform: mode === 'hand' ? 'translateX(0)' : 'translateX(100%)' }}
                />
                <button onClick={() => handleModeChange('hand')} className={`relative z-10 flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-colors duration-300 ${mode === 'hand' ? 'text-hf-teal' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary hover:text-hf-text-primary dark:hover:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M21.2 9.5c-.3-.3-.7-.5-1.1-.6-.4-.1-.8-.1-1.2 0-.2 0-.5.1-.7.2l-.7-3.2c-.1-.5-.4-.9-.9-1.2-.5-.2-1-.3-1.5-.1-.5.1-.9.5-1.2 1-.2.4-.2.8-.2 1.3V9c-.1-.2-.3-.5-.5-.6-.3-.2-.6-.3-1-.3-.4 0-.8.1-1.1.4-.4.3-.6.7-.6 1.1v3.2L9.3 12c-.3-.2-.7-.3-1-.3-.4 0-.8.1-1.1.4-.5.4-.7 1-.5 1.5l1.6 5.8c.4 1.5 1.8 2.5 3.3 2.5h2.1c2 0 3.8-1.2 4.6-3L21 12.3c.4-1 .3-2-.2-2.8z"/></svg>
                  <span>{t('hand', interfaceLanguage)}</span>
                </button>
                <button onClick={() => handleModeChange('head')} className={`relative z-10 flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-colors duration-300 ${mode === 'head' ? 'text-hf-teal' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary hover:text-hf-text-primary dark:hover:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .6.4 1 1 1h6c.6 0 1-.4 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7zm0 2c2.8 0 5 2.2 5 5 0 2-.1 4-2 5v2H9v-2c-1.9-1-2-3-2-5 0-2.8 2.2-5 5-5z"/></svg>
                  <span>{t('head', interfaceLanguage)}</span>
                </button>
              </div>
              
              <div className="flex items-center space-x-1.5">
                 <span className={`w-2 h-2 rounded-full ${trackingStatus.state === 'active' ? 'bg-hf-teal' : trackingStatus.state === 'error' ? 'bg-hf-red' : 'bg-gray-300'}`}></span>
                 <span className="text-[12px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200">{t('tracking', interfaceLanguage)}</span>
              </div>
            </div>
            
            <div className="flex flex-col pt-2 pb-1 border-t border-hf-border dark:border-white/10 space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hf-text-secondary/80 dark:text-hf-dark-text-secondary/80">
                  {mode === 'hand' ? 'Quick Gestures' : 'Head Controls'}
                </span>
                <button
                  onClick={() => setShowGestureGuide(true)}
                  className="flex items-center space-x-1 text-[11px] font-bold text-hf-teal hover:text-hf-teal/80 transition px-1.5 py-0.5 rounded-md hover:bg-hf-teal/10"
                  title="View complete gesture dictionary"
                >
                  <span>All Gestures</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>

              {mode === 'hand' ? (
                <div className="flex flex-wrap justify-between items-center w-full px-1 text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary gap-x-1.5 gap-y-1">
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Point:</span><span>Move</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">2 fingers:</span><span>Tab/Scroll</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">3 fingers:</span><span>Scroll</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Air click:</span><span>Feedback</span></div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-between items-center w-full px-1 text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary gap-x-1.5 gap-y-1">
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Look:</span><span>Move</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Nod:</span><span>Click</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Shake:</span><span>Cancel</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Dwell:</span><span>Hover/Click</span></div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Live Camera Preview */}

          <div className="flex flex-col space-y-3 shrink-0">
            <div className="relative w-full aspect-[4/3] bg-black/5 dark:bg-black/20 rounded-2xl overflow-hidden flex items-center justify-center shadow-sm border border-hf-border dark:border-white/10">
              {cameraState === 'error' ? (
                <div className="flex flex-col items-center p-6 text-center space-y-3">
                  <div className="w-10 h-10 bg-red-100 text-red-500 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <h3 className="text-[14px] font-semibold text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white tracking-tight">{t('cameraDenied', interfaceLanguage)}</h3>
                  <p className="text-[12px] text-hf-text-secondary dark:text-hf-dark-text-secondary">{t('cameraDeniedDesc', interfaceLanguage)}</p>
                  <button onClick={startCamera} className="mt-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-[13px] font-bold rounded-lg transition">{t('retryCamera', interfaceLanguage)}</button>
                </div>
              ) : cameraState === 'off' ? (
                <div className="flex flex-col items-center text-center space-y-2 opacity-60">
                   <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                   <span className="text-[13px] font-semibold tracking-tight">{t('cameraOff', interfaceLanguage)}</span>
                </div>
              ) : (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className={`w-full h-full object-cover transform -scale-x-100 ${cameraState === 'live' ? 'opacity-100' : 'opacity-0'}`} 
                  />
                  <canvas 
                    ref={canvasRef} 
                    className={`absolute top-0 left-0 w-full h-full pointer-events-none transform -scale-x-100`}
                  />
                  {cameraState === 'requesting' && (
                     <div className="absolute text-white/70 text-[13px] font-semibold animate-pulse tracking-tight">...</div>
                  )}
                  {cameraState === 'live' && (
                    <>
                      <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
                        <span>{t('cameraLive', interfaceLanguage)}</span>
                      </div>
                      <button className="absolute top-3 right-3 w-[26px] h-[26px] rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/80 transition">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                      </button>
                      {mode === 'hand' && (
                        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                          <div className="max-w-[calc(100%-85px)] bg-black/60 backdrop-blur-md text-white px-2.5 py-1.5 rounded-lg text-[10px] leading-relaxed shadow-sm">
                            <div className="font-semibold">{handFeedback.hands > 0 ? `✋ ${handFeedback.hands} hand${handFeedback.hands === 1 ? '' : 's'} detected` : 'Show your hand to the camera'}</div>
                            <div className="text-white/80">{handFeedback.pointing ? 'Pointing pose accepted' : 'Pointing pose waiting'} · {handFeedback.pointerActive ? 'Cursor streaming' : 'No pointer output'} · {handFeedback.cursorDelivered ? 'Overlay updated' : 'Overlay waiting'}</div>
                            <div className="text-white/60">Frames {handFeedback.frames} · inference {handFeedback.inferenceMs.toFixed(0)}ms · gesture {lastGesture}</div>
                          </div>
                          <button
                            onClick={handleCalibrate}
                            disabled={trackingStatus.state !== 'active' || calibrationInFlightRef.current}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-br from-[#238F83] to-[#1A6B62] text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition active:scale-95"
                          >
                            {calibrationState.phase === 'sweeping' ? 'Calibrating…' : calibrationState.phase === 'complete' ? 'Calibrated' : 'Calibrate'}
                          </button>
                        </div>
                      )}
                      {calibrationState.phase !== 'idle' && calibrationState.phase !== 'complete' && (
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white z-20 space-y-3">
                           <div className="w-12 h-12 bg-[#238F83] rounded-full flex items-center justify-center animate-pulse">
                             <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                           </div>
                           <div className="text-[14px] font-bold text-center px-4">{calibrationState.instruction}</div>
                           <div className="w-2/3 bg-white/20 h-2 rounded-full overflow-hidden">
                             <div className="bg-[#10b981] h-full transition-all duration-200" style={{ width: `${calibrationState.progress * 100}%` }} />
                           </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 4. Session Controls */}
          <div className="flex flex-col space-y-3 px-1 pt-2 shrink-0">
             <div className="flex space-x-2">
               <button onClick={handleStart} className="flex-1 h-[48px] bg-gradient-to-br from-white/90 to-white/60 dark:from-[#2A2B30]/80 dark:to-[#1A1B20]/80 backdrop-blur-md hover:from-white hover:to-white/80 dark:hover:from-[#3A3C42]/80 border border-[#10b981]/40 dark:border-[#10b981]/30 text-hf-text-primary dark:text-white rounded-xl font-bold tracking-wide transition-all duration-300 ease-out active:scale-[0.98] flex items-center justify-center space-x-1.5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_8px_rgba(16,185,129,0.1)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(16,185,129,0.05)]" >
                 <svg className="w-4 h-4 text-[#10b981] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                 <span className="text-[14px] truncate">{t('startSession', interfaceLanguage)}</span>
               </button>

               <button onClick={handleStop} className="flex-1 h-[48px] bg-gradient-to-br from-white/60 to-white/30 dark:from-[#2A2B30]/50 dark:to-[#1A1B20]/50 backdrop-blur-md hover:from-red-50/80 hover:to-red-50/50 dark:hover:from-red-900/20 dark:hover:to-red-900/10 border border-red-500/30 text-hf-text-primary dark:text-white rounded-xl font-bold flex items-center justify-center space-x-1.5 transition-all duration-300 ease-out active:scale-[0.98] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_2px_8px_rgba(0,0,0,0.02)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" >
                 <svg className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                 <span className="text-[14px] truncate">Stop</span>
               </button>
             </div>
             
             {/* Show Test Approval and Test Cursor only in unpacked extensions (development mode) */}
             {(typeof chrome !== 'undefined' && chrome.runtime?.getManifest && !('update_url' in chrome.runtime.getManifest())) && (
               <div className="flex space-x-2 pt-2 border-t border-gray-200 dark:border-white/10 mt-2">
                 <button 
                   onClick={async () => {
                     const task = await defaultMockTaskMemoryStore.createTask('Test Approval', 'en');
                     await defaultMockTaskMemoryStore.updateTaskStatus(task.id, 'in_progress');
                     const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
                     setTasks(updatedTasks);
                     setActiveTaskId(task.id);
                     executeActionSafely({ type: 'click_element', targetId: 'h1' }, task.id);
                   }} 
                   className="flex-1 h-[36px] bg-gradient-to-br from-white/40 to-white/10 dark:from-white/5 dark:to-white/5 backdrop-blur-sm hover:from-white/60 hover:to-white/30 dark:hover:from-white/10 dark:hover:to-white/5 text-gray-600 dark:text-gray-400 border border-white/50 dark:border-white/10 rounded-lg font-bold tracking-wide transition-all duration-300 ease-out flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]" 
                 >
                   <span className="text-[13px]">Test Approval</span>
                 </button>
                 <button 
                   onClick={async () => {
                     let localTaskId: string | null = null;
                     try {
                       const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                       if (!tabs[0]?.id) throw new Error('No active tab found');
                       const tabId = tabs[0].id;
                       
                       // Ensure content script is ready
                       try {
                         await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_PING' });
                       } catch (e) {
                         // Receiving end does not exist, try to inject
                         await chrome.scripting.executeScript({
                           target: { tabId },
                           files: ['content.js']
                         });
                         // Give it a moment to initialize
                         await new Promise(r => setTimeout(r, 200));
                       }
                       
                       const task = await defaultMockTaskMemoryStore.createTask('Test Cursor Sequence', 'en');
                       localTaskId = task.id;
                       await defaultMockTaskMemoryStore.updateTaskStatus(task.id, 'in_progress');
                       setCurrentActionDescription('Testing cursor coordinates...');
                       setActiveTaskId(task.id);
                       setTasks(await defaultMockTaskMemoryStore.listTasks());

                       const points = [
                         { x: 0.5, y: 0.5 }, // center
                         { x: 0.1, y: 0.1 }, // top-left
                         { x: 0.9, y: 0.9 }, // bottom-right
                       ];
                       
                       for (const pt of points) {
                         const action: any = { type: 'pointer_update', targetId: `x:${pt.x}, y:${pt.y}` };
                         const step = await defaultMockTaskMemoryStore.addStep(task.id, action);
                         
                         const response = await chrome.tabs.sendMessage(tabId, {
                           type: 'POINTER_POSITION_UPDATE',
                           payload: { x: pt.x, y: pt.y, confidence: 1, timestamp: Date.now() }
                         });
                         
                         const debugStr = response?.debug ? JSON.stringify(response.debug) : 'No debug info';
                         if (!response || !response.ok) {
                           await defaultMockTaskMemoryStore.recordStepResult(task.id, step, { success: false, message: 'Message delivery failed or cursor hidden. Debug: ' + debugStr });
                           throw new Error('Message delivery failed or cursor hidden. Debug: ' + debugStr);
                         }
                         
                         await defaultMockTaskMemoryStore.recordStepResult(task.id, step, { success: true, message: `Moved to ${pt.x}, ${pt.y}. Diagnostics: ${debugStr}` });
                         await new Promise(r => setTimeout(r, 600));
                       }
                       
                       await defaultMockTaskMemoryStore.updateTaskStatus(task.id, 'completed');
                       setCurrentActionDescription('Test completed successfully');
                       setTasks(await defaultMockTaskMemoryStore.listTasks());
                     } catch (err: any) {
                       let tid = localTaskId || activeTaskId;
                       if (!tid) {
                         const t = await defaultMockTaskMemoryStore.createTask('Test Cursor Failed', 'en');
                         tid = t.id;
                         setActiveTaskId(tid);
                       }
                       const action: any = { type: 'system_error', targetId: 'Test Cursor' };
                       const step = await defaultMockTaskMemoryStore.addStep(tid, action);
                       await defaultMockTaskMemoryStore.recordStepResult(tid, step, { success: false, message: err.message });
                       await defaultMockTaskMemoryStore.updateTaskStatus(tid, 'failed');
                       setCurrentActionDescription(`Failed: ${err.message}`);
                       setTasks(await defaultMockTaskMemoryStore.listTasks());
                     }
                   }} 
                   className="flex-1 h-[36px] bg-gradient-to-br from-white/40 to-white/10 dark:from-white/5 dark:to-white/5 backdrop-blur-sm hover:from-white/60 hover:to-white/30 dark:hover:from-white/10 dark:hover:to-white/5 text-gray-600 dark:text-gray-400 border border-white/50 dark:border-white/10 rounded-lg font-bold tracking-wide transition-all duration-300 ease-out flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]" 
                 >
                   <span className="text-[13px]">Test Cursor</span>
                 </button>
               </div>
             )}
             
             <p className="text-[13px] text-hf-text-secondary dark:text-hf-dark-text-secondary font-medium px-1 leading-snug pt-2">{t('startSessionDesc', interfaceLanguage)}</p>
          </div>

          {/* 5. Active Task */}
          <div className="bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-4 flex flex-col shrink-0">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 bg-yellow-100 text-yellow-600 rounded flex items-center justify-center">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <h3 className="font-bold text-[15px] tracking-tight text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white">{t('activeTask', interfaceLanguage)}</h3>
              </div>
              <button onClick={() => setCurrentView('history')} className="text-[13px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary hover:text-hf-text-primary dark:text-hf-dark-text-primary transition">{t('viewAll', interfaceLanguage)}</button>
            </div>
            
            {activeTask ? (
              <div className="flex flex-col space-y-3">
                <div className="flex items-center bg-hf-ivory dark:bg-white/5 rounded-2xl p-3 border border-hf-border dark:border-hf-dark-border">
                  {(assistantState === 'thinking' || assistantState === 'executing') ? (
                    <div className="w-[42px] h-[42px] rounded-full border-[3px] border-gray-200 dark:border-white/10 border-t-[#10b981] animate-spin shrink-0"></div>
                  ) : (assistantState === 'error' || activeTask.status === 'failed') ? (
                    <div className="w-[42px] h-[42px] rounded-full bg-red-100 text-red-500 shrink-0 flex items-center justify-center font-bold">!</div>
                  ) : (activeTask.status === 'completed' || assistantState === 'success') ? (
                    <div className="w-[42px] h-[42px] rounded-full bg-green-100 text-green-500 shrink-0 flex items-center justify-center font-bold">✓</div>
                  ) : (
                    <div className="w-[42px] h-[42px] rounded-full bg-gray-200 dark:bg-white/10 shrink-0 flex items-center justify-center text-gray-400 font-bold">-</div>
                  )}
                  <div className="flex flex-col ml-3 flex-1 min-w-0">
                    <span className="font-bold text-[14px] text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white truncate">{activeTask.goal}</span>
                    <span className="text-[12px] font-medium text-hf-text-secondary dark:text-hf-dark-text-secondary truncate mt-0.5">• {currentActionDescription}</span>
                  </div>
                  <button onClick={() => { setViewedTaskId(activeTask.id); setCurrentView('task_details'); }} className="w-7 h-7 flex items-center justify-center text-gray-400 mx-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-full transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg>
                  </button>
                  <button onClick={handleCancelTask} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-hf-red/10 text-red-500 text-[13px] font-bold rounded-lg transition shrink-0">{t('cancel', interfaceLanguage)}</button>
                </div>
                
                {pendingApproval && (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200/50 dark:border-yellow-900/30 rounded-xl space-y-2 mt-2 shadow-sm animate-in slide-in-from-bottom-2">
                    <h4 className="font-semibold text-[11px] uppercase tracking-wider text-yellow-800 dark:text-yellow-500">{t('actionRequired', interfaceLanguage)}</h4>
                    <p className="text-[12px] opacity-90 text-yellow-900 dark:text-yellow-200 break-words">
                      {pendingApproval.type}
                    </p>
                    <div className="flex space-x-2 pt-1">
                      <button onClick={handleApproveAction} className="flex-1 py-1.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg text-[13px] shadow-sm transition">{t('confirm', interfaceLanguage)}</button>
                      <button onClick={handleRejectAction} className="flex-1 py-1.5 bg-white dark:bg-[#2c2c2e] hover:bg-gray-50 dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white font-medium rounded-lg text-[13px] border border-black/10 dark:border-white/10 transition">{t('cancel', interfaceLanguage)}</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[13px] font-medium text-gray-400 text-center py-2">{t('noActiveTask', interfaceLanguage)}</div>
            )}
          </div>

          {/* 6. Voice Command Composer */}
          <div className="bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)] rounded-3xl p-4 shrink-0 space-y-4">
             <div className="flex justify-between items-center">
               <div className="flex items-center space-x-2">
                 <div className="w-5 h-5 bg-gray-100 dark:bg-white/10 text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-white rounded flex items-center justify-center">
                   <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                 </div>
                 <h3 className="font-bold text-[15px] tracking-tight text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white">{t('voiceCommand', interfaceLanguage)}</h3>
               </div>
               <div className="flex items-center space-x-1">
                 <select 
                    value={voiceLanguage} 
                    onChange={(e) => setVoiceLanguage(e.target.value as SupportedLanguage)}
                    className="text-[12px] font-semibold bg-gray-50 dark:bg-white/10 px-2 py-1 rounded text-hf-text-secondary dark:text-hf-dark-text-secondary uppercase outline-none"
                  >
                    {SUPPORTED_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.nativeName}</option>
                    ))}
                 </select>
               </div>
             </div>

             <div className="flex flex-col w-full h-[160px] bg-black/5 dark:bg-black/20 shadow-inner rounded-2xl p-3 overflow-y-auto space-y-2">
                {conversation.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-2 opacity-50">
                    <span className="text-gray-400 text-[14px] font-medium tracking-tight">{t('sayCommand', interfaceLanguage)}</span>
                  </div>
                ) : (
                  conversation.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-[13px] ${msg.role === 'user' ? 'bg-gradient-to-br from-blue-500/15 to-blue-500/5 backdrop-blur-md border border-blue-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_2px_4px_rgba(59,130,246,0.05)] text-blue-800 dark:text-blue-200 rounded-tr-sm' : 'bg-gradient-to-br from-white/80 to-white/40 dark:from-white/10 dark:to-white/5 backdrop-blur-sm border border-white/50 dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] text-hf-text-primary dark:text-white rounded-tl-sm'}`}>
                         {msg.text}
                      </div>
                    </div>
                  ))
                )}
             </div>

             <div className="flex items-center space-x-2">
               {isSpeaking && (
                 <button onClick={stopSpeaking} className="p-2 bg-yellow-100 text-yellow-600 rounded-full hover:bg-yellow-200">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                 </button>
               )}
               <button onClick={toggleListen} className={`w-[40px] h-[40px] shrink-0 rounded-full flex items-center justify-center transition shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_5px_rgba(0,0,0,0.1)] ${voiceState === 'listening' ? 'bg-gradient-to-br from-red-400 to-red-600 text-white animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5),inset_0_2px_4px_rgba(255,255,255,0.4)] border border-red-300/50' : 'bg-gradient-to-br from-[#238F83] to-[#1A6B62] text-white hover:scale-105 shadow-[0_2px_8px_rgba(35,143,131,0.3),inset_0_2px_4px_rgba(255,255,255,0.3)] border border-[#238F83]/50'}`}>
                 <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
               </button>
               <input 
                 type="text" 
                 value={inputText}
                 onChange={(e) => setInputText(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                 placeholder={t('typeRequest', interfaceLanguage)} 
                 className="flex-1 min-w-0 bg-hf-ivory dark:bg-white/5 text-[13px] px-3 py-2.5 rounded-xl border border-hf-border dark:border-white/10 outline-none placeholder:text-gray-400 font-medium dark:text-white"
               />
               <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || assistantState === 'thinking'} className="w-[40px] h-[40px] shrink-0 flex items-center justify-center text-gray-400 hover:text-hf-text-primary dark:text-hf-dark-text-primary transition disabled:opacity-30 bg-hf-ivory dark:bg-white/5 rounded-xl border border-hf-border dark:border-white/10">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
               </button>
             </div>
             
             <div className="pt-1 flex justify-center">
                <button onClick={handleReadPage} className="flex items-center space-x-1.5 text-[12px] font-semibold text-hf-teal hover:text-hf-teal/80 transition bg-hf-teal/10 px-3 py-1.5 rounded-lg">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
                  <span>Read Page Aloud</span>
                </button>
             </div>

             {voiceState === 'error' && voiceError && (
               <p className="text-[11px] text-red-500 font-medium">{voiceError}</p>
             )}
           </div>

        </>
      )}

      {/* Complete Gesture & Features Dictionary Drawer/Modal */}
      {showGestureGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div 
            className="w-full max-w-lg max-h-[85vh] bg-hf-ivory dark:bg-[#1E2025] rounded-t-3xl sm:rounded-3xl border border-white/60 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-4 border-b border-hf-border dark:border-white/10 shrink-0 bg-gradient-to-r from-transparent via-white/40 dark:via-white/5 to-transparent">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-hf-teal/10 dark:bg-hf-teal/20 text-hf-teal flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-hf-text-primary dark:text-hf-dark-text-primary dark:text-white leading-tight">Controls &amp; Gesture Dictionary</h3>
                  <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary">Complete reference of supported handsfree interactions</p>
                </div>
              </div>
              <button 
                onClick={() => setShowGestureGuide(false)}
                className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-gray-500 dark:text-gray-300 flex items-center justify-center transition"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Dictionary Content Sections */}
            <div className="p-4 overflow-y-auto space-y-4 text-[12px]">
              {/* Hand Gestures Section */}
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-[12px] font-bold text-hf-teal uppercase tracking-wider">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M21.2 9.5c-.3-.3-.7-.5-1.1-.6-.4-.1-.8-.1-1.2 0-.2 0-.5.1-.7.2l-.7-3.2c-.1-.5-.4-.9-.9-1.2-.5-.2-1-.3-1.5-.1-.5.1-.9.5-1.2 1-.2.4-.2.8-.2 1.3V9c-.1-.2-.3-.5-.5-.6-.3-.2-.6-.3-1-.3-.4 0-.8.1-1.1.4-.4.3-.6.7-.6 1.1v3.2L9.3 12c-.3-.2-.7-.3-1-.3-.4 0-.8.1-1.1.4-.5.4-.7 1-.5 1.5l1.6 5.8c.4 1.5 1.8 2.5 3.3 2.5h2.1c2 0 3.8-1.2 4.6-3L21 12.3c.4-1 .3-2-.2-2.8z"/></svg>
                  <span>Hand Gestures</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">Point (Index finger)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold">Pointer</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Moves mouse cursor across webpage</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">Air Click (Index + Pinky)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 font-semibold">Click</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Performs click action at cursor position</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">2 Fingers Swipe</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-semibold">Tabs / Scroll</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Swipe horizontal to switch tabs, vertical to scroll</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">3 Fingers Swipe</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-semibold">Fast Scroll</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Dedicated smooth scroll up / down</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">Thumbs Up / Down</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">Zoom</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Thumbs Up: Zoom In · Thumbs Down: Zoom Out</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">4 Fingers Horizontal Swipe</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">History</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Swipe left to Undo, swipe right to Redo</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">Shaka 🤙 (Thumb + Pinky)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">Voice Toggle</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Instantly starts or stops voice listening</p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-hf-text-primary dark:text-white">Fist ✊ / Open Palm ✋</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-semibold">Quick Actions</span>
                    </div>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-1">Fist: Undo · Palm Open: Redo / Reset</p>
                  </div>
                </div>
              </div>

              {/* Head Tracking Section */}
              <div className="space-y-2 pt-2 border-t border-hf-border dark:border-white/10">
                <div className="flex items-center space-x-2 text-[12px] font-bold text-hf-teal uppercase tracking-wider">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .6.4 1 1 1h6c.6 0 1-.4 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7zm0 2c2.8 0 5 2.2 5 5 0 2-.1 4-2 5v2H9v-2c-1.9-1-2-3-2-5 0-2.8 2.2-5 5-5z"/></svg>
                  <span>Head Tracking Controls</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10">
                    <span className="font-bold text-hf-text-primary dark:text-white">Look Around:</span>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-0.5">Smooth head tilt moves cursor anywhere on screen</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10">
                    <span className="font-bold text-hf-text-primary dark:text-white">Nod:</span>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-0.5">Quick nod down triggers primary click</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10">
                    <span className="font-bold text-hf-text-primary dark:text-white">Shake:</span>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-0.5">Quick head shake cancels task or dismisses modal</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10">
                    <span className="font-bold text-hf-text-primary dark:text-white">Dwell:</span>
                    <p className="text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary mt-0.5">Hovering pointer over any button activates click</p>
                  </div>
                </div>
              </div>

              {/* Voice Commands Section */}
              <div className="space-y-2 pt-2 border-t border-hf-border dark:border-white/10">
                <div className="flex items-center space-x-2 text-[12px] font-bold text-hf-teal uppercase tracking-wider">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  <span>Voice Shortcuts &amp; AI Control</span>
                </div>

                <div className="p-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-hf-border dark:border-white/10 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between"><span className="font-semibold text-hf-text-primary dark:text-white">&quot;Scroll down / Scroll up&quot;</span><span className="text-hf-text-secondary dark:text-hf-dark-text-secondary">Scrolls the page</span></div>
                  <div className="flex items-center justify-between"><span className="font-semibold text-hf-text-primary dark:text-white">&quot;Click [button name or element]&quot;</span><span className="text-hf-text-secondary dark:text-hf-dark-text-secondary">AI clicks targeted item</span></div>
                  <div className="flex items-center justify-between"><span className="font-semibold text-hf-text-primary dark:text-white">&quot;Read this page&quot;</span><span className="text-hf-text-secondary dark:text-hf-dark-text-secondary">Reads web page text aloud</span></div>
                  <div className="flex items-center justify-between"><span className="font-semibold text-hf-text-primary dark:text-white">&quot;Next tab / Previous tab&quot;</span><span className="text-hf-text-secondary dark:text-hf-dark-text-secondary">Switches browser tab</span></div>
                  <div className="flex items-center justify-between"><span className="font-semibold text-hf-text-primary dark:text-white">&quot;Zoom in / Zoom out&quot;</span><span className="text-hf-text-secondary dark:text-hf-dark-text-secondary">Scales page magnification</span></div>
                </div>
              </div>
            </div>

            {/* Footer close button */}
            <div className="p-3 border-t border-hf-border dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex justify-end">
              <button
                onClick={() => setShowGestureGuide(false)}
                className="px-4 py-2 bg-hf-teal text-white rounded-xl text-[12px] font-bold hover:bg-hf-teal/90 transition shadow-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
