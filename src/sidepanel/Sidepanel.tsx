import React, { useState, useEffect, useRef } from 'react';
import {
  TrackingMode,
  TrackingStatus,
  SupportedLanguage,
  SUPPORTED_LANGUAGES,
  ConversationMessage,
  TaskRecord,
  BrowserAction,
  ApprovalMode,
  AssistantState,
} from '../shared/types';
import { MockHandTracker } from '../tracking/hand/mockHandTracker';
import { HeadTracker } from '../tracking/head/headTracker';
import { defaultMockAiClient } from '../ai/mockAiClient';
import { defaultMockTaskMemoryStore } from '../memory/mockTaskMemoryStore';
import { defaultMockBrowserActionExecutor } from '../browser/mockBrowserActionExecutor';
import { defaultActionPolicy } from '../shared/safety/action-policy';
import { SharedCursorController } from '../cursor/sharedCursorController';
import { ICursorController } from '../cursor/mockCursorController';

const handTracker = new MockHandTracker();
const headTracker = new HeadTracker();
const dummyCursorUI: ICursorController = {
  moveTo: () => {},
  triggerClickVisual: () => {},
  showDwellProgress: () => {},
  hide: () => {},
  show: () => {}
};
const cursorController = new SharedCursorController(headTracker, handTracker, dummyCursorUI);

export const Sidepanel: React.FC = () => {
  // Tracking controls
  const [mode, setMode] = useState<TrackingMode>('hand');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>({
    mode: 'hand',
    state: 'idle',
    confidence: 0,
    message: 'Standby',
  });

  // Settings: Approval Mode & Language
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask');
  const [language, setLanguage] = useState<SupportedLanguage>('en');

  // Assistant State & Conversation Area
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: 'init_msg',
      role: 'assistant',
      content: 'Welcome to Handsfree. Select tracking mode or issue a voice/text goal below.',
      timestamp: Date.now(),
      language: 'en',
    },
  ]);
  const [inputText, setInputText] = useState('');

  // Live action status & pending human approval
  const [currentActionDescription, setCurrentActionDescription] = useState<string>('Ready for motion or voice inputs');
  const [pendingApproval, setPendingApproval] = useState<BrowserAction | null>(null);
  const [gestureActionsEnabled, setGestureActionsEnabled] = useState<boolean>(false);
  const [mouthClickEnabled, setMouthClickEnabled] = useState<boolean>(true);
  const [tabNavEnabled, setTabNavEnabled] = useState<boolean>(true);
  const [tiltNavEnabled, setTiltNavEnabled] = useState<boolean>(true);
  const [previewOnly, setPreviewOnly] = useState<boolean>(false);

  // Task Memory / History
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  // Camera UI Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load initial tasks & init trackers
  useEffect(() => {
    defaultMockTaskMemoryStore.listTasks().then(setTasks);
    handTracker.initialize().catch(console.error);
    headTracker.initialize().catch(console.error);
  }, []);

  // Sync Camera Preview and Diagnostics Loop
  useEffect(() => {
    if (mode === 'head') {
      headTracker.setPreviewElements(videoRef.current, canvasRef.current);
    } else {
      headTracker.setPreviewElements(null, null);
    }

    let rafId: number;
    const updateDiagnostics = () => {
      if (mode === 'head') {
        const yawEl = document.getElementById('pose-yaw');
        const pitchEl = document.getElementById('pose-pitch');
        const rollEl = document.getElementById('pose-roll');
        const faceEl = document.getElementById('pose-face');

        if (yawEl) yawEl.innerText = headTracker.pose.yaw.toFixed(1) + '°';
        if (pitchEl) pitchEl.innerText = headTracker.pose.pitch.toFixed(1) + '°';
        if (rollEl) rollEl.innerText = headTracker.pose.roll.toFixed(1) + '°';
        if (faceEl) {
          faceEl.innerText = headTracker.pose.hasMatrix ? 'Detected' : 'Not Detected';
          faceEl.className = headTracker.pose.hasMatrix ? 'text-emerald-400 text-[10px]' : 'text-rose-400 text-[10px]';
        }
        
        // Extended Diagnostics
        const dRelYaw = document.getElementById('diag-rel-yaw');
        const dRelPitch = document.getElementById('diag-rel-pitch');
        const dX = document.getElementById('diag-x');
        const dY = document.getElementById('diag-y');
        const dCtrl = document.getElementById('diag-ctrl');
        const dContent = document.getElementById('diag-content');
        const dGesture = document.getElementById('diag-gesture');
        const dJaw = document.getElementById('diag-jaw');
        const dMouthState = document.getElementById('diag-mouth-state');
        const dTabState = document.getElementById('diag-tab-state');
        
        if (dRelYaw) dRelYaw.innerText = (headTracker.pose.relYaw || 0).toFixed(2);
        if (dRelPitch) dRelPitch.innerText = (headTracker.pose.relPitch || 0).toFixed(2);
        if (dX) dX.innerText = (headTracker.pose.targetX || 0).toFixed(2);
        if (dY) dY.innerText = (headTracker.pose.targetY || 0).toFixed(2);
        if (dGesture) dGesture.innerText = headTracker.latestGestureOutput?.gestureLabel || 'None';
        if (dJaw) dJaw.innerText = (headTracker.latestGestureOutput?.jawOpenScore || 0).toFixed(2);
        if (dMouthState) dMouthState.innerText = headTracker.latestGestureOutput?.mouthState || 'IDLE';
        if (dTabState) dTabState.innerText = headTracker.latestGestureOutput?.tabNavState || 'NEUTRAL';
        if (dCtrl) dCtrl.innerText = String(cursorController.diagnostics.receivedUpdates);
        if (dContent) {
          dContent.innerText = `${cursorController.diagnostics.contentDeliverySuccess} OK / ${cursorController.diagnostics.contentDeliveryFail} FAIL`;
          
          const errorsObj = cursorController.diagnostics.errors;
          const topErrors = Object.entries(errorsObj).map(([msg, count]) => `[${count}x] ${msg}`).join(', ');
          
          if (topErrors) {
            dContent.innerText += `\nErrors: ${topErrors}`;
          }
        }
      }
      rafId = requestAnimationFrame(updateDiagnostics);
    };
    rafId = requestAnimationFrame(updateDiagnostics);

    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  // Update hardware & tracker status
  const handleStart = async () => {
    try {
      await cursorController.start(mode);
      const status = cursorController.getStatus();
      setTrackingStatus({
        mode: status.mode as TrackingMode,
        state: status.state,
        confidence: status.confidence,
        message: status.lastError ? status.lastError.message : `Active tracking: ${mode.toUpperCase()} mode running`
      });
      setCurrentActionDescription(`Active tracking: ${mode.toUpperCase()} mode running at 30 FPS`);
    } catch (e) {
      console.error(e);
      const status = cursorController.getStatus();
      setTrackingStatus({
        mode: status.mode as TrackingMode,
        state: status.state,
        confidence: status.confidence,
        message: (e as Error).message
      });
      setCurrentActionDescription(`Failed to start: ${(e as Error).message}`);
    }
  };

  const handlePause = async () => {
    await cursorController.pause();
    const status = cursorController.getStatus();
    setTrackingStatus({
      mode: status.mode as TrackingMode,
      state: status.state,
      confidence: status.confidence,
      message: 'Paused'
    });
    setCurrentActionDescription('Tracking paused by user');
  };

  const handleStop = async () => {
    await cursorController.stop();
    const status = cursorController.getStatus();
    setTrackingStatus({
      mode: mode,
      state: status.state,
      confidence: status.confidence,
      message: 'Stopped'
    });
    setCurrentActionDescription('Tracking stopped');
  };

  const handleModeChange = (newMode: TrackingMode) => {
    setMode(newMode);
    if (trackingStatus.state === 'active') {
      cursorController.start(newMode).then(() => {
        const status = cursorController.getStatus();
        setTrackingStatus({
          mode: status.mode as TrackingMode,
          state: status.state,
          confidence: status.confidence,
          message: status.lastError ? status.lastError.message : `Active tracking: ${newMode.toUpperCase()} mode running`
        });
      });
    }
  };

  const handleToggleGestureActions = () => {
    const newState = !gestureActionsEnabled;
    setGestureActionsEnabled(newState);
    cursorController.gestureActionsEnabled = newState;
  };

  const handleToggleMouthClick = () => {
    const newState = !mouthClickEnabled;
    setMouthClickEnabled(newState);
    headTracker.configureGestures({ mouthClickEnabled: newState });
  };

  const handleToggleTabNav = () => {
    const newState = !tabNavEnabled;
    setTabNavEnabled(newState);
    headTracker.configureGestures({ tabNavEnabled: newState });
  };

  const handleToggleTiltNav = () => {
    const newState = !tiltNavEnabled;
    setTiltNavEnabled(newState);
    headTracker.configureGestures({ tiltNavEnabled: newState });
  };

  const handleTogglePreviewOnly = () => {
    const newState = !previewOnly;
    setPreviewOnly(newState);
    headTracker.configureGestures({ previewOnly: newState });
  };

  // Execute an action safely with policy check
  const executeActionSafely = async (action: BrowserAction, taskId: string) => {
    const decision = defaultActionPolicy.evaluate(action, approvalMode);
    if (decision.requiresApproval) {
      setAssistantState('awaiting_approval');
      setPendingApproval(action);
      setCurrentActionDescription(`Approval needed: ${action.type}`);
      return;
    }

    setAssistantState('executing');
    setCurrentActionDescription(`Executing: [${action.type}]`);
    const result = await defaultMockBrowserActionExecutor.execute(action);
    await defaultMockTaskMemoryStore.recordStepResult(taskId, 1, result);
    const updatedTasks = await defaultMockTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setAssistantState(result.success ? 'success' : 'error');
    setCurrentActionDescription(result.message);
  };

  const handleApproveAction = async () => {
    if (!pendingApproval) return;
    const action = pendingApproval;
    setPendingApproval(null);
    setAssistantState('executing');
    setCurrentActionDescription(`Executing approved: [${action.type}]`);
    const result = await defaultMockBrowserActionExecutor.execute(action);
    setAssistantState(result.success ? 'success' : 'error');
    setCurrentActionDescription(result.message);
  };

  const handleRejectAction = () => {
    if (!pendingApproval) return;
    setPendingApproval(null);
    setAssistantState('idle');
    setCurrentActionDescription('Action cancelled by user');
  };

  // Send conversation message
  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || inputText;
    if (!promptToSend.trim() || assistantState === 'thinking') return;

    const userMsg: ConversationMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
      language,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setAssistantState('thinking');
    setCurrentActionDescription(`Formulating plan in ${language.toUpperCase()}...`);

    try {
      const reply = await defaultMockAiClient.sendMessage(promptToSend, language);
      setMessages((prev) => [...prev, reply]);

      // Generate plan matching BrowserAction contract
      const plannedActions = await defaultMockAiClient.generatePlan(promptToSend, language);
      const newTask = await defaultMockTaskMemoryStore.createTask(promptToSend, language);

      if (plannedActions.length > 0) {
        await executeActionSafely(plannedActions[0], newTask.id);
      } else {
        setAssistantState('success');
      }
    } catch (err) {
      setAssistantState('error');
      setCurrentActionDescription(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 p-4 space-y-4 font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md">
            HF
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-wide text-white">Handsfree</h1>
            <p className="text-xs text-slate-400">Motion & Voice Browser Agent</p>
          </div>
        </div>
        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50">
          MV3 Sidebar
        </span>
      </div>

      {/* Human Approval Required Banner */}
      {pendingApproval && (
        <div className="bg-amber-950/90 border border-amber-600 rounded-xl p-3 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
            <span>⚠️ Action Approval Required</span>
            <span className="uppercase text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-900 border border-amber-700">
              {pendingApproval.type}
            </span>
          </div>
          <p className="text-xs text-amber-200">
            {JSON.stringify(pendingApproval)}
          </p>
          <div className="flex space-x-2 pt-1">
            <button
              onClick={handleApproveAction}
              className="flex-1 py-1 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium"
            >
              Approve
            </button>
            <button
              onClick={handleRejectAction}
              className="flex-1 py-1 px-2 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-medium"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Camera Preview (Head Mode Only) */}
      {mode === 'head' && (
        <div className="bg-slate-800/90 rounded-xl p-2 border border-slate-700 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300 px-1">
            <span>Camera Preview</span>
            <span id="pose-face" className="text-slate-400 text-[10px]">Off</span>
          </div>
          <div className="relative w-full bg-black rounded-lg overflow-hidden border border-slate-700/60 aspect-video flex items-center justify-center">
             {trackingStatus.state !== 'active' && trackingStatus.state !== 'calibrating' && (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-10 p-4 text-center">
                 <span className="text-2xl mb-2">📸</span>
                 <p className="text-[10px]">{trackingStatus.message || 'Click Start to activate camera'}</p>
               </div>
             )}
             <video
               ref={videoRef}
               className="w-full h-full object-cover transform scale-x-[-1]"
               playsInline
               muted
             />
             <canvas
               ref={canvasRef}
               className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1] pointer-events-none"
             />
          </div>
          {/* Matrix Pose Diagnostics */}
          <div className="grid grid-cols-3 gap-1 px-1">
             <div className="bg-slate-900/50 p-1.5 rounded text-center border border-slate-700/50">
                <div className="text-[9px] uppercase text-slate-500 mb-0.5">Yaw</div>
                <div id="pose-yaw" className="text-[11px] font-mono text-slate-300">0.0°</div>
             </div>
             <div className="bg-slate-900/50 p-1.5 rounded text-center border border-slate-700/50">
                <div className="text-[9px] uppercase text-slate-500 mb-0.5">Pitch</div>
                <div id="pose-pitch" className="text-[11px] font-mono text-slate-300">0.0°</div>
             </div>
             <div className="bg-slate-900/50 p-1.5 rounded text-center border border-slate-700/50">
                <div className="text-[9px] uppercase text-slate-500 mb-0.5">Roll</div>
                <div id="pose-roll" className="text-[11px] font-mono text-slate-300">0.0°</div>
             </div>
          </div>
          
          {/* Cursor Diagnostics */}
          <div className="bg-slate-900/80 rounded p-2 border border-slate-700/60 mt-1 text-[10px] font-mono text-slate-400 space-y-1">
             <div className="flex justify-between font-bold text-indigo-300 border-b border-slate-800 pb-1 mb-1">
                <span>Gesture Preview:</span>
                <span id="diag-gesture" className="text-white">None</span>
             </div>
             <div className="flex justify-between">
                <span>Mouth State: <span id="diag-mouth-state" className="text-white">IDLE</span></span>
                <span>Jaw: <span id="diag-jaw" className="text-white">0.00</span></span>
             </div>
             <div className="flex justify-between border-b border-slate-800 pb-1 mb-1">
                <span>Tab State: <span id="diag-tab-state" className="text-white">NEUTRAL</span></span>
             </div>
             <div className="flex justify-between">
                <span>Rel Yaw: <span id="diag-rel-yaw" className="text-white">0.00</span>°</span>
                <span>Rel Pitch: <span id="diag-rel-pitch" className="text-white">0.00</span>°</span>
             </div>
             <div className="flex justify-between">
                <span>Norm X: <span id="diag-x" className="text-white">0.00</span></span>
                <span>Norm Y: <span id="diag-y" className="text-white">0.00</span></span>
             </div>
             <div className="flex justify-between text-[9px] text-slate-500 pt-1 border-t border-slate-800">
                <span>Ctrl Msgs: <span id="diag-ctrl" className="text-slate-300">0</span></span>
                <span>Content Rx: <span id="diag-content" className="text-slate-300">0 OK / 0 FAIL</span></span>
             </div>
          </div>
        </div>
      )}

      {/* Hardware / Tracker Status Indicators */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center space-x-2 bg-slate-800/80 p-2 rounded-lg border border-slate-700/60">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              trackingStatus.state === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span className="text-slate-300 font-medium">Tracking:</span>
          <span className={trackingStatus.state === 'active' ? 'text-emerald-300' : 'text-slate-400'}>
            {trackingStatus.state}
          </span>
        </div>

        <div className="flex items-center space-x-2 bg-slate-800/80 p-2 rounded-lg border border-slate-700/60">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              assistantState === 'executing'
                ? 'bg-amber-400 animate-ping'
                : assistantState === 'success'
                ? 'bg-emerald-400'
                : 'bg-indigo-400'
            }`}
          />
          <span className="text-slate-300 font-medium">AI State:</span>
          <span className="text-indigo-300 font-mono capitalize">
            {assistantState}
          </span>
        </div>
      </div>

      {/* Mode Selectors */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex justify-between items-center">
          <span>Tracking Mode</span>
        </label>
        <div className="grid grid-cols-2 gap-2 bg-slate-800/90 p-1 rounded-xl border border-slate-700">
          <button
            onClick={() => handleModeChange('hand')}
            className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-all ${
              mode === 'hand'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ✋ Hand Mode
          </button>
          <button
            onClick={() => handleModeChange('head')}
            className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-all ${
              mode === 'head'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            👤 Head Mode
          </button>
        </div>
      </div>

      {/* Gesture Controls */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Gesture Actions
        </label>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300">
          <label className="flex items-center space-x-1 cursor-pointer bg-slate-800/80 p-1.5 rounded border border-slate-700/60">
            <input type="checkbox" className="accent-indigo-500" checked={gestureActionsEnabled} onChange={handleToggleGestureActions} />
            <span>Master Actions</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer bg-slate-800/80 p-1.5 rounded border border-slate-700/60">
            <input type="checkbox" className="accent-indigo-500" checked={previewOnly} onChange={handleTogglePreviewOnly} />
            <span>Preview Mode (No click/tab)</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer bg-slate-800/80 p-1.5 rounded border border-slate-700/60">
            <input type="checkbox" className="accent-indigo-500" checked={mouthClickEnabled} onChange={handleToggleMouthClick} />
            <span>Mouth Click</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer bg-slate-800/80 p-1.5 rounded border border-slate-700/60">
            <input type="checkbox" className="accent-indigo-500" checked={tabNavEnabled} onChange={handleToggleTabNav} />
            <span>Head Turn (Tabs)</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer bg-slate-800/80 p-1.5 rounded border border-slate-700/60">
            <input type="checkbox" className="accent-indigo-500" checked={tiltNavEnabled} onChange={handleToggleTiltNav} />
            <span>Head Tilt (Undo/Redo)</span>
          </label>
        </div>
      </div>

      {/* Start, Pause, Stop Controls */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Tracking Controls
        </label>
        <div className="flex space-x-2">
          <button
            onClick={handleStart}
            disabled={trackingStatus.state === 'active'}
            className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center justify-center space-x-1"
          >
            <span>▶</span>
            <span>Start</span>
          </button>

          <button
            onClick={handlePause}
            disabled={trackingStatus.state !== 'active'}
            className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center justify-center space-x-1"
          >
            <span>⏸</span>
            <span>Pause</span>
          </button>

          <button
            onClick={handleStop}
            disabled={trackingStatus.state === 'idle'}
            className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center justify-center space-x-1"
          >
            <span>⏹</span>
            <span>Stop</span>
          </button>
        </div>
      </div>

      {/* Multilingual Selector & Approval Mode */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Language
          </label>
          <div className="grid grid-cols-3 gap-1">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                className={`py-1 text-center text-xs rounded border transition-all ${
                  language === lang.code
                    ? 'border-indigo-500 bg-indigo-950/70 text-indigo-200 font-semibold'
                    : 'border-slate-800 bg-slate-800/50 text-slate-400'
                }`}
              >
                <div>{lang.nativeName}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Approval Mode
          </label>
          <div className="grid grid-cols-2 gap-1 bg-slate-800/90 p-0.5 rounded border border-slate-700">
            <button
              onClick={() => setApprovalMode('ask')}
              className={`py-1 text-xs rounded transition-all ${
                approvalMode === 'ask'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400'
              }`}
            >
              Ask
            </button>
            <button
              onClick={() => setApprovalMode('auto')}
              className={`py-1 text-xs rounded transition-all ${
                approvalMode === 'auto'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400'
              }`}
            >
              Auto
            </button>
          </div>
        </div>
      </div>

      {/* Live Action Status Placeholder */}
      <div className="bg-slate-800/90 rounded-xl p-3 border border-slate-700 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
          <span>Live Action Status</span>
          <span className="font-mono text-[11px] text-indigo-400">
            Conf: {(trackingStatus.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-xs text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 font-mono">
          {currentActionDescription}
        </p>
      </div>

      {/* Mock Assistant Conversation Area */}
      <div className="flex-1 flex flex-col min-h-[160px] bg-slate-800/60 rounded-xl border border-slate-700 p-3 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-300 border-b border-slate-700/60 pb-1.5">
          <span>AI Assistant</span>
          <span className="text-[10px] text-slate-400 uppercase">{language} Mode</span>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto space-y-2 max-h-48 pr-1 text-xs">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2 rounded-lg max-w-[85%] ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white ml-auto'
                  : 'bg-slate-700 text-slate-200 mr-auto'
              }`}
            >
              <div className="text-[10px] text-slate-400 mb-0.5 capitalize">{msg.role}</div>
              <div>{msg.content}</div>
            </div>
          ))}
          {assistantState === 'thinking' && (
            <div className="p-2 rounded-lg bg-slate-700 text-slate-300 mr-auto text-xs animate-pulse">
              Formulating browser actions...
            </div>
          )}
        </div>

        {/* Prompt Suggestions */}
        <div className="flex space-x-1 overflow-x-auto py-1 text-[11px]">
          <button
            onClick={() => handleSendMessage(language === 'hi' ? 'नीचे स्क्रॉल करो' : language === 'mr' ? 'खाली स्क्रोल करा' : 'Scroll down the page')}
            className="px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 whitespace-nowrap text-[11px]"
          >
            {language === 'hi' ? '📜 नीचे स्क्रॉल करो' : language === 'mr' ? '📜 खाली स्क्रोल करा' : '📜 Scroll down'}
          </button>
          <button
            onClick={() => handleSendMessage(language === 'hi' ? 'सर्च बॉक्स पर क्लिक करो' : language === 'mr' ? 'शोध बॉक्सवर क्लिक करा' : 'Click search box')}
            className="px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 whitespace-nowrap text-[11px]"
          >
            {language === 'hi' ? '🔍 सर्च बॉक्स' : language === 'mr' ? '🔍 शोध बॉक्स' : '🔍 Click search'}
          </button>
        </div>

        {/* Input Bar */}
        <div className="flex space-x-1.5 pt-1">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={
              language === 'hi'
                ? 'कमांड टाइप करें (उदा. स्क्रॉल करो)...'
                : language === 'mr'
                ? 'आदेश प्रविष्ट करा...'
                : 'Type command or task goal...'
            }
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || assistantState === 'thinking'}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition"
          >
            Send
          </button>
        </div>
      </div>

      {/* Task History Placeholder */}
      <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-3 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
          <span>Task History</span>
          <span className="text-[10px] text-slate-400">{tasks.length} tasks</span>
        </div>
        <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
          {tasks.length === 0 ? (
            <div className="text-xs text-slate-500 italic">No tasks executed yet</div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between bg-slate-900/70 p-1.5 rounded-lg border border-slate-800 text-xs"
              >
                <div className="truncate flex-1 pr-2">
                  <span className="font-medium text-slate-300">{task.title}</span>
                  <span className="ml-1.5 text-[10px] text-slate-500">[{task.language}]</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded capitalize ${
                    task.status === 'completed'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {task.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
