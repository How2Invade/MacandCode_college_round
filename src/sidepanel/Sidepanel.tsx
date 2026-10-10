import React, { useState, useEffect } from 'react';
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
import { MockHeadTracker } from '../tracking/head/mockHeadTracker';
import { defaultBackendAiClient } from '../ai/providers/backendAiClient';
import { defaultChromeStorageTaskMemoryStore } from '../memory/chromeStorageMemoryStore';
import { defaultChromeBrowserActionExecutor } from '../browser/chromeBrowserActionExecutor';
import { ResumableTaskManager } from '../memory/resumableTaskManager';
import { defaultActionPolicy } from '../shared/safety/action-policy';
import { VoicePipeline, VoiceState, LiveKitVoiceClient, LiveKitVoiceState, LiveKitTranscriptEvent } from '../voice';
import { PageContext } from '../ai/types';

const handTracker = new MockHandTracker();
const headTracker = new MockHeadTracker();
const voicePipeline = new VoicePipeline();
const livekitVoiceClient = new LiveKitVoiceClient();

async function getActivePageContext(): Promise<PageContext | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return undefined;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return undefined;

    let domSummary = '';
    if (typeof tab.id === 'number' && chrome.scripting?.executeScript) {
      try {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const visible = (element: HTMLElement) => {
              const style = getComputedStyle(element);
              return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            };
            const label = (element: HTMLElement) => (element.innerText || element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ');
            return JSON.stringify({
              title: document.title,
              url: location.href,
              headings: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3')).filter(visible).map(label).filter(Boolean).slice(0, 8).map((item) => item.slice(0, 100)),
              links: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(visible).map((element) => ({ text: label(element).slice(0, 100), url: element.href.slice(0, 250) })).filter((item) => item.text).slice(0, 6),
              buttons: Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).filter(visible).map(label).filter(Boolean).slice(0, 8).map((item) => item.slice(0, 100)),
              searchFields: Array.from(document.querySelectorAll<HTMLInputElement>('input[type="search"],input[role="combobox"],input[name*="search" i],input[placeholder*="search" i],form[role="search"] input'))
                .filter(visible).map((element) => ({ id: element.id.slice(0, 80), name: element.name.slice(0, 80), placeholder: element.placeholder.slice(0, 100), value: element.value.slice(0, 100), ariaLabel: (element.getAttribute('aria-label') || '').slice(0, 100) })).slice(0, 8),
              text: (document.body?.innerText || document.body?.textContent || '').slice(0, 2500),
            });
          },
        });
        domSummary = typeof injected?.result === 'string' ? injected.result.slice(0, 8000) : '';
      } catch {
        // Restricted pages may block script access; URL and title still provide context.
      }
    }

    // Fallback to the installed content script if direct scripting is unavailable
    // for this tab (for example, a page with tighter injection restrictions).
    if (!domSummary && typeof tab.id === 'number' && chrome.tabs?.sendMessage) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_BROWSER_ACTION',
          payload: { action: { type: 'read_page' } },
        });
        const pageData = result?.data;
        if (result?.success && pageData && typeof pageData === 'object') {
          domSummary = JSON.stringify(pageData).slice(0, 8000);
        }
      } catch {
        // Keep an empty summary; read requests will explain that page access failed.
      }
    }

    return { url: tab.url, title: tab.title, domSummary };
  } catch {
    return undefined;
  }
}

function isCancellationPrompt(text: string): boolean {
  return /^(stop|cancel|abort|please stop|stop please|cancel that|रुको|रोक दो|बस|काम रोक दो|बंद करो)(\s+please)?[.!\s]*$/i.test(text.trim());
}

export const Sidepanel: React.FC = () => {
  // One-time Chrome Extension Microphone Permission Grant Tab Handler
  const isMicRequestTab = typeof window !== 'undefined' && window.location.search.includes('mic=request');
  const [micGranted, setMicGranted] = useState(false);

  useEffect(() => {
    if (isMicRequestTab && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
          setMicGranted(true);
        })
        .catch(() => {});
    }
  }, [isMicRequestTab]);

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
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;
  // Execution details stay in the live conversation context only. Task storage
  // keeps a compact result summary and never stores full page text.
  const executionNotesRef = React.useRef<ConversationMessage[]>([]);
  const lastLiveKitUserRef = React.useRef({ text: '', timestamp: 0 });
  const isSendingMessageRef = React.useRef(false);
  const pendingReplacementPromptRef = React.useRef<string | null>(null);
  const chatRequestEpochRef = React.useRef(0);
  const lastVoicePromptRef = React.useRef({ text: '', timestamp: 0 });
  const cancelExecutionRef = React.useRef(false);
  const executionEpochRef = React.useRef(0);
  const activeTaskIdRef = React.useRef<string | null>(null);

  // LiveKit real-time voice state
  const [livekitState, setLivekitState] = useState<LiveKitVoiceState>('idle');
  const [livekitTranscript, setLivekitTranscript] = useState<{ userText: string; aiText: string }>({
    userText: '',
    aiText: '',
  });
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [livekitManualInput, setLivekitManualInput] = useState('');

  // Live action status & pending human approval
  const [currentActionDescription, setCurrentActionDescription] = useState<string>('Ready for motion or voice inputs');
  const [pendingApproval, setPendingApproval] = useState<BrowserAction | null>(null);
  // Keep the remainder of an approved multi-step plan while the approval banner is open.
  const pendingPlanRef = React.useRef<{ actions: BrowserAction[]; nextIndex: number; taskId: string } | null>(null);

  // Task Memory / History
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  // Load initial tasks
  useEffect(() => {
    defaultChromeStorageTaskMemoryStore.listTasks().then(setTasks);
  }, []);

  // Sync language with VoicePipeline
  useEffect(() => {
    voicePipeline.setLanguage(language);
  }, [language]);

  // Wire Voice STT events
  useEffect(() => {
    const unsubTranscript = voicePipeline.onTranscript((result) => {
      setInputText(result.transcript);
      if (result.isFinal && result.transcript.trim()) {
        const prompt = result.transcript.trim();
        const normalized = prompt.toLocaleLowerCase().replace(/\s+/g, ' ');
        const now = Date.now();
        if (lastVoicePromptRef.current.text === normalized && now - lastVoicePromptRef.current.timestamp < 2500) return;
        lastVoicePromptRef.current = { text: normalized, timestamp: now };
        void handleSendMessage(prompt);
      }
    });

    const unsubState = voicePipeline.onStateChange((st) => {
      setVoiceState(st);
    });

    const unsubVoiceError = voicePipeline.onError((err) => {
      setCurrentActionDescription(`Voice output failed: ${err}`);
    });

    return () => {
      unsubTranscript();
      unsubState();
      unsubVoiceError();
    };
  }, [language]);

  // Wire LiveKit WebRTC Real-Time Voice Events
  useEffect(() => {
    livekitVoiceClient.setLanguage(language);
  }, [language]);

  useEffect(() => {
    livekitVoiceClient.setConversationContextProvider(async () => ({
      history: [...messagesRef.current.filter((message) => message.id !== 'init_msg'), ...executionNotesRef.current].slice(-12),
      pageContext: await getActivePageContext(),
    }));
  }, []);

  useEffect(() => {
    const unsubState = livekitVoiceClient.onStateChange((st) => {
      setLivekitState(st);
      if (st !== 'error') setLivekitError(null);
    });

    const unsubTranscript = livekitVoiceClient.onTranscript((evt: LiveKitTranscriptEvent) => {
      if (evt.isUser && evt.isFinal) {
        const normalized = evt.text.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
        if (lastLiveKitUserRef.current.text === normalized && evt.timestamp - lastLiveKitUserRef.current.timestamp < 2500) return;
        lastLiveKitUserRef.current = { text: normalized, timestamp: evt.timestamp };
        if (isCancellationPrompt(evt.text)) {
          void cancelCurrentWork();
          return;
        }
        if (activeTaskIdRef.current || pendingPlanRef.current) void supersedeActiveTask();
        else cancelExecutionRef.current = false;
      }
      setLivekitTranscript((prev) => ({
        userText: evt.isUser ? evt.text : prev.userText,
        aiText: !evt.isUser ? evt.text : prev.aiText,
      }));

      if (evt.isFinal && evt.text.trim()) {
        const msg: ConversationMessage = {
          id: `msg_lk_${Date.now()}_${evt.isUser ? 'user' : 'ai'}`,
          role: evt.isUser ? 'user' : 'assistant',
          content: evt.text,
          timestamp: Date.now(),
          language,
        };
        messagesRef.current = [...messagesRef.current, msg];
        setMessages(messagesRef.current);
      }
    });

    const unsubActions = livekitVoiceClient.onActions(async (actions, reply, requestedPrompt) => {
      // Handle disconnect_voice action emitted by fallback handler
      const disconnectAction = actions.find((a: any) => a.type === 'disconnect_voice');
      if (disconnectAction) {
        // Speak the farewell message first, then disconnect
        if (reply) {
          await voicePipeline.speak(reply, language);
        }
        await livekitVoiceClient.disconnect();
        return;
      }
      const realActions = actions.filter((a: any) => a.type !== 'disconnect_voice');
      if (realActions.length > 0) {
        if (cancelExecutionRef.current) return;
        const actionEpoch = executionEpochRef.current;
        const latestUserGoal = [...messagesRef.current].reverse().find((message) => message.role === 'user')?.content;
        if (requestedPrompt && latestUserGoal?.trim() !== requestedPrompt.trim()) return;
        const newTask = await defaultChromeStorageTaskMemoryStore.createTask(
          latestUserGoal || livekitTranscript.userText || 'LiveKit Voice Command',
          language,
          realActions,
        );
        const currentUserGoal = [...messagesRef.current].reverse().find((message) => message.role === 'user')?.content;
        if (cancelExecutionRef.current || actionEpoch !== executionEpochRef.current || (requestedPrompt && currentUserGoal?.trim() !== requestedPrompt.trim())) {
          await defaultChromeStorageTaskMemoryStore.updateTaskStatus(newTask.id, 'cancelled');
          return;
        }
        activeTaskIdRef.current = newTask.id;
        setCurrentActionDescription(`LiveKit plan: ${realActions.length} action(s) generated`);
        await executeActionSafely(realActions, newTask.id);
        const task = await defaultChromeStorageTaskMemoryStore.getTask(newTask.id);
        if (task) {
          const outcome = task.status === 'completed'
            ? `Task completed. ${task.steps.map((step) => step.result?.message).filter(Boolean).join(' ')}`
            : `Task ${task.status}. ${task.steps.filter((step) => step.result).map((step) => step.result?.message).join(' ')}`;
          executionNotesRef.current = [...executionNotesRef.current, {
            id: `execution_task_${Date.now()}`, role: 'assistant' as const, content: `Confirmed task outcome: ${outcome}`,
            timestamp: Date.now(), language,
          }].slice(-6);
        }
      }
    });

    const unsubError = livekitVoiceClient.onError((err) => {
      setLivekitError(err);
      setCurrentActionDescription(`LiveKit Error: ${err}`);
    });

    return () => {
      unsubState();
      unsubTranscript();
      unsubActions();
      unsubError();
    };
  }, [language, approvalMode]);

  // Update hardware & tracker status
  const handleStart = async () => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.start(mode);
    setTrackingStatus(activeTracker.getStatus());
    setCurrentActionDescription(`Active tracking: ${mode.toUpperCase()} mode running at 30 FPS`);
  };

  const handlePause = async () => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.pause();
    setTrackingStatus(activeTracker.getStatus());
    setCurrentActionDescription('Tracking paused by user');
  };

  const handleStop = async () => {
    const activeTracker = mode === 'hand' ? handTracker : headTracker;
    await activeTracker.stop();
    setTrackingStatus(activeTracker.getStatus());
    setCurrentActionDescription('Tracking stopped');
  };

  const handleModeChange = (newMode: TrackingMode) => {
    setMode(newMode);
    if (trackingStatus.state === 'active') {
      const activeTracker = newMode === 'hand' ? handTracker : headTracker;
      activeTracker.start(newMode);
      setTrackingStatus(activeTracker.getStatus());
    }
  };

  const cancelCurrentWork = async () => {
    cancelExecutionRef.current = true;
    executionEpochRef.current += 1;
    chatRequestEpochRef.current += 1;
    pendingPlanRef.current = null;
    setPendingApproval(null);
    await Promise.allSettled([voicePipeline.stopSpeaking()]);
    if (['connected', 'listening', 'speaking', 'thinking'].includes(livekitState)) livekitVoiceClient.interrupt();
    const taskId = activeTaskIdRef.current;
    if (taskId) await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'cancelled');
    activeTaskIdRef.current = null;
    setAssistantState('idle');
    setCurrentActionDescription('Cancelled. No further actions will run.');
    setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
  };

  const supersedeActiveTask = async () => {
    if (!activeTaskIdRef.current && !pendingPlanRef.current) return;
    cancelExecutionRef.current = true;
    executionEpochRef.current += 1;
    pendingPlanRef.current = null;
    setPendingApproval(null);
    const taskId = activeTaskIdRef.current;
    activeTaskIdRef.current = null;
    cancelExecutionRef.current = false;
    if (taskId) await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'cancelled');
    setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
    setCurrentActionDescription('Stopped the previous task to follow your new instruction.');
  };

  // Execute validated actions through the Chrome shared executor, with policy and checkpoints.
  const executeActionSafely = async (actions: BrowserAction[], taskId: string, startIndex = 0) => {
    const executionEpoch = executionEpochRef.current;
    await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'in_progress');
    for (let index = startIndex; index < actions.length; index += 1) {
      if (cancelExecutionRef.current || executionEpoch !== executionEpochRef.current) {
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'cancelled');
        setCurrentActionDescription('Cancelled. No further actions will run.');
        setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
        return;
      }
      const action = actions[index];
      const decision = defaultActionPolicy.evaluate(action, approvalMode);
      if (decision.requiresApproval) {
        setAssistantState('awaiting_approval');
        setPendingApproval(action);
        pendingPlanRef.current = { actions, nextIndex: index + 1, taskId };
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'paused');
        setCurrentActionDescription(`Approval needed: ${action.type}`);
        return;
      }

      setAssistantState('executing');
      setCurrentActionDescription(`Executing: [${action.type}]`);
      const result = await defaultChromeBrowserActionExecutor.execute(action);
      const persistedResult = action.type === 'read_page' && result.data && typeof result.data === 'object'
        ? { ...result, data: { url: (result.data as any).url, title: (result.data as any).title, textLength: String((result.data as any).text || '').length } }
        : result;
      await defaultChromeStorageTaskMemoryStore.recordStepResult(taskId, index + 1, persistedResult);
      if (executionEpoch !== executionEpochRef.current) {
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'cancelled');
        setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
        return;
      }
      if (!result.success) {
        setAssistantState('error');
        setCurrentActionDescription(result.message);
        pendingPlanRef.current = null;
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'failed');
        setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
        return;
      }
      if (cancelExecutionRef.current) {
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'cancelled');
        setAssistantState('idle');
        setCurrentActionDescription('Cancelled. The current action finished; no further actions will run.');
        setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
        return;
      }
      const actionSummary = action.type === 'read_page' && result.data && typeof result.data === 'object'
        ? `Read page “${(result.data as any).title || ''}” at ${(result.data as any).url || 'the active tab'}. Page content: ${String((result.data as any).text || '').slice(0, 3000)}`
        : `${result.message}${result.data ? ` Confirmed result data: ${JSON.stringify(result.data).slice(0, 1200)}` : ''}`;
      executionNotesRef.current = [...executionNotesRef.current, {
        id: `execution_${Date.now()}_${index}`, role: 'assistant' as const, content: `Confirmed browser action result: ${actionSummary}`,
        timestamp: Date.now(), language,
      }].slice(-6);
    }
    pendingPlanRef.current = null;
    await defaultChromeStorageTaskMemoryStore.updateTaskStatus(taskId, 'completed');
    activeTaskIdRef.current = null;
    const updatedTasks = await defaultChromeStorageTaskMemoryStore.listTasks();
    setTasks(updatedTasks);
    setAssistantState('success');
    setCurrentActionDescription(`Completed ${actions.length} browser action${actions.length === 1 ? '' : 's'}`);
  };

  const handleApproveAction = async () => {
    if (!pendingApproval) return;
    const action = pendingApproval;
    const pendingPlan = pendingPlanRef.current;
    const executionEpoch = executionEpochRef.current;
    setPendingApproval(null);
    if (!pendingPlan) return;
    if (pendingPlan) {
      if (cancelExecutionRef.current) return;
      const currentDecision = defaultActionPolicy.evaluate(action, approvalMode);
      if (currentDecision.requiresApproval && pendingApproval !== action) {
        setCurrentActionDescription('Approval is no longer valid for this action. Review the updated request.');
        pendingPlanRef.current = null;
        return;
      }
      if (!await defaultChromeBrowserActionExecutor.canExecute(action)) {
        setAssistantState('error');
        setCurrentActionDescription('This action is not valid for the current browser executor.');
        pendingPlanRef.current = null;
        return;
      }
      if (executionEpoch !== executionEpochRef.current) return;
      // The approval click is explicit confirmation for this exact action; safety is re-evaluated above.
      setAssistantState('executing');
      setCurrentActionDescription(`Executing approved: [${action.type}]`);
      await defaultChromeStorageTaskMemoryStore.updateTaskStatus(pendingPlan.taskId, 'in_progress');
      if (executionEpoch !== executionEpochRef.current) return;
      const result = await defaultChromeBrowserActionExecutor.execute(action);
      const persistedResult = action.type === 'read_page' && result.data && typeof result.data === 'object'
        ? { ...result, data: { url: (result.data as any).url, title: (result.data as any).title, textLength: String((result.data as any).text || '').length } }
        : result;
      await defaultChromeStorageTaskMemoryStore.recordStepResult(pendingPlan.taskId, pendingPlan.nextIndex, persistedResult);
      if (executionEpoch !== executionEpochRef.current) {
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(pendingPlan.taskId, 'cancelled');
        setTasks(await defaultChromeStorageTaskMemoryStore.listTasks());
        return;
      }
      if (!result.success) {
        pendingPlanRef.current = null;
        setAssistantState('error');
        setCurrentActionDescription(result.message);
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(pendingPlan.taskId, 'failed');
        return;
      }
      if (cancelExecutionRef.current) {
        await defaultChromeStorageTaskMemoryStore.updateTaskStatus(pendingPlan.taskId, 'cancelled');
        setAssistantState('idle');
        setCurrentActionDescription('Cancelled. No further actions will run.');
        return;
      }
      executionNotesRef.current = [...executionNotesRef.current, {
        id: `execution_${Date.now()}_approved`, role: 'assistant' as const, content: `Confirmed browser action result: ${result.message}${result.data ? ` ${JSON.stringify(result.data).slice(0, 1200)}` : ''}`,
        timestamp: Date.now(), language,
      }].slice(-6);
      pendingPlanRef.current = null;
      await executeActionSafely(pendingPlan.actions, pendingPlan.taskId, pendingPlan.nextIndex);
    } else {
      setAssistantState('executing');
      setCurrentActionDescription(`Executing approved: [${action.type}]`);
      const result = await defaultChromeBrowserActionExecutor.execute(action);
      setAssistantState(result.success ? 'success' : 'error');
      setCurrentActionDescription(result.message);
    }
  };

  const handleRejectAction = () => {
    if (!pendingApproval) return;
    setPendingApproval(null);
    executionEpochRef.current += 1;
    pendingPlanRef.current = null;
    setAssistantState('idle');
    setCurrentActionDescription('Action cancelled by user');
    if (activeTaskIdRef.current) void defaultChromeStorageTaskMemoryStore.updateTaskStatus(activeTaskIdRef.current, 'cancelled');
  };

  const handleResumeTask = async (taskId: string) => {
    const task = await defaultChromeStorageTaskMemoryStore.getTask(taskId);
    if (!task) {
      setCurrentActionDescription('That saved task is no longer available.');
      return;
    }
    const page = await getActivePageContext();
    const manager = new ResumableTaskManager(defaultChromeStorageTaskMemoryStore);
    const decision = manager.assessResumption(task, page?.url);
    if (!decision.canResume) {
      setCurrentActionDescription(decision.reason);
      return;
    }
    if (decision.requiresUserConfirmation && !window.confirm(`${decision.reason}\n\nResume from the first unfinished step?`)) return;

    cancelExecutionRef.current = false;
    activeTaskIdRef.current = task.id;
    await executeActionSafely(task.steps.map((step) => step.action), task.id, decision.nextStepIndex);
  };

  // Send conversation message with recent turns and active page context.
  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || inputText;
    if (!promptToSend.trim()) return;
    if (isCancellationPrompt(promptToSend)) {
      const cancelMessage: ConversationMessage = {
        id: `msg_${Date.now()}_cancel`, role: 'user', content: promptToSend, timestamp: Date.now(), language,
      };
      messagesRef.current = [...messagesRef.current, cancelMessage];
      setMessages(messagesRef.current);
      setInputText('');
      await cancelCurrentWork();
      return;
    }
    if (isSendingMessageRef.current) {
      pendingReplacementPromptRef.current = promptToSend;
      chatRequestEpochRef.current += 1;
      if (activeTaskIdRef.current || pendingPlanRef.current) await supersedeActiveTask();
      setInputText('');
      return;
    }
    if (activeTaskIdRef.current || pendingPlanRef.current) await supersedeActiveTask();
    cancelExecutionRef.current = false;
    isSendingMessageRef.current = true;
    const requestEpoch = ++chatRequestEpochRef.current;

    const userMsg: ConversationMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
      language,
    };

    // Commit synchronously so quick transcript events cannot submit stale history.
    const historySnapshot = [...messagesRef.current];
    const messagesWithUser = [...historySnapshot, userMsg];
    messagesRef.current = messagesWithUser;
    setMessages(messagesWithUser);
    setInputText('');
    setAssistantState('thinking');
    setCurrentActionDescription(`Thinking...`);

    try {
      const pageContext = await getActivePageContext();
      if (requestEpoch !== chatRequestEpochRef.current) return;

      // Send recent conversation and the active page so follow-up references resolve correctly.
      const result = await defaultBackendAiClient.chat(
        promptToSend,
        language,
        [...historySnapshot.filter((message) => message.id !== 'init_msg'), ...executionNotesRef.current].slice(-12),
        pageContext,
      );
      if (requestEpoch !== chatRequestEpochRef.current) return;

      const assistantMsg: ConversationMessage = {
        id: `msg_${Date.now()}_ai`,
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
        language,
        suggestedActions: result.suggestedActions,
      };
      messagesRef.current = [...messagesRef.current, assistantMsg];
      setMessages(messagesRef.current);

      // Speak response aloud if TTS enabled
      if (ttsEnabled && result.reply) {
        voicePipeline.speak(result.reply, language).catch((e) => {
          console.warn('TTS playback error:', e);
        });
      }

      // If the chat provider returned browser actions, ask for approval / execute.
      const actions = result.suggestedActions ?? [];
      if (actions.length > 0) {
        const newTask = await defaultChromeStorageTaskMemoryStore.createTask(promptToSend, language, actions);
        if (requestEpoch !== chatRequestEpochRef.current) {
          await defaultChromeStorageTaskMemoryStore.updateTaskStatus(newTask.id, 'cancelled');
          return;
        }
        activeTaskIdRef.current = newTask.id;
        setCurrentActionDescription(`Plan ready: ${actions.length} action${actions.length > 1 ? 's' : ''} — awaiting approval`);
        await executeActionSafely(actions, newTask.id);
      } else {
        // Still clarifying — no actions yet, stay in conversation
        setAssistantState('idle');
        setCurrentActionDescription('Awaiting your response...');
      }
    } catch (err) {
      if (requestEpoch !== chatRequestEpochRef.current) return;
      setAssistantState('error');
      const errMsg = (err as Error).message;
      setCurrentActionDescription(`Error: ${errMsg}`);
      const errorReply: ConversationMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Sorry, I couldn't reach the AI backend. Make sure the backend server is running (npm run backend:dev). Error: ${errMsg}`,
        timestamp: Date.now(),
        language,
      };
      messagesRef.current = [...messagesRef.current, errorReply];
      setMessages(messagesRef.current);
    } finally {
      isSendingMessageRef.current = false;
      const replacementPrompt = pendingReplacementPromptRef.current;
      if (replacementPrompt) {
        pendingReplacementPromptRef.current = null;
        void handleSendMessage(replacementPrompt);
      }
    }
  };

  const handleToggleVoice = async () => {
    if (voiceState === 'listening') {
      await voicePipeline.stopListening();
    } else {
      try {
        voicePipeline.setLanguage(language);
        await voicePipeline.startListening();
      } catch (err) {
        console.error('Failed to start voice input:', err);
      }
    }
  };

  const handleToggleLivekit = async () => {
    try {
      if (
        livekitState === 'connected' ||
        livekitState === 'listening' ||
        livekitState === 'speaking' ||
        livekitState === 'thinking'
      ) {
        await livekitVoiceClient.disconnect();
      } else {
        setLivekitError(null);
        await livekitVoiceClient.connect(language);
      }
    } catch (err) {
      setLivekitError((err as Error).message);
    }
  };

  const handleInterruptLivekit = () => {
    livekitVoiceClient.interrupt();
  };

  const handleOpenMicPermissionTab = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html?mic=request') });
    } else {
      navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {});
    }
  };

  if (isMicRequestTab) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-950 text-slate-100 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center text-3xl shadow-lg">
          🎙️
        </div>
        <h1 className="text-xl font-bold">Microphone Permission</h1>
        <p className="text-sm text-slate-300 max-w-sm">
          Chrome requires one-time permission for Handsfree to access your microphone for hands-free voice control.
        </p>
        {micGranted ? (
          <div className="bg-emerald-950/80 border border-emerald-600 text-emerald-300 rounded-xl p-4 text-sm font-semibold space-y-2">
            <div>✅ Microphone access granted!</div>
            <p className="text-xs text-slate-300 font-normal">You can close this tab and return to the Handsfree sidebar.</p>
            <button
              onClick={() => window.close()}
              className="mt-2 py-1.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs"
            >
              Close Tab
            </button>
          </div>
        ) : (
          <button
            onClick={async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach((t) => t.stop());
                setMicGranted(true);
              } catch {
                alert('Microphone access was denied. Please click the tune/lock icon in the Chrome address bar to allow microphone.');
              }
            }}
            className="py-3 px-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold shadow-lg text-sm"
          >
            Click to Allow Microphone in Chrome
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100 p-3.5 space-y-3.5 font-sans select-none overflow-y-auto pb-12">
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
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Tracking Mode
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
          <div className="flex items-center space-x-2">
            <span>AI Assistant</span>
            {voiceState === 'listening' && (
              <span className="text-[10px] text-rose-400 animate-pulse font-mono flex items-center space-x-1">
                <span>●</span> <span>Listening</span>
              </span>
            )}
            {voiceState === 'speaking' && (
              <span className="text-[10px] text-amber-400 animate-pulse font-mono flex items-center space-x-1">
                <span>🔊</span> <span>Speaking</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                ttsEnabled ? 'bg-indigo-950 border-indigo-700 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500'
              }`}
              title={ttsEnabled ? 'Voice output enabled' : 'Voice output muted'}
            >
              {ttsEnabled ? '🔊 Audio On' : '🔇 Audio Off'}
            </button>
            <span className="text-[10px] text-slate-400 uppercase">{language} Mode</span>
          </div>
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
          <button
            type="button"
            onClick={handleToggleVoice}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center space-x-1 ${
              voiceState === 'listening'
                ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                : voiceState === 'speaking'
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
            title={voiceState === 'listening' ? 'Listening... click to stop' : 'Click to speak using your voice'}
          >
            <span>{voiceState === 'listening' ? '🔴' : voiceState === 'speaking' ? '🔊' : '🎙️'}</span>
            <span className="hidden sm:inline">
              {voiceState === 'listening' ? 'Listening' : voiceState === 'speaking' ? 'Speaking' : 'Voice'}
            </span>
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={
              voiceState === 'listening'
                ? 'Listening to your voice...'
                : language === 'hi'
                ? 'कमांड टाइप करें या माइक दबाकर बोलें...'
                : language === 'mr'
                ? 'आदेश प्रविष्ट करा किंवा बोला...'
                : 'Type command or click Voice to speak...'
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
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-slate-400">{tasks.length} tasks</span>
            <button
              type="button"
              onClick={async () => {
                await defaultChromeStorageTaskMemoryStore.clearHistory();
                messagesRef.current = [{
                  id: 'init_msg', role: 'assistant', content: 'Welcome to Handsfree. Select tracking mode or issue a voice/text goal below.', timestamp: Date.now(), language: 'en',
                }];
                executionNotesRef.current = [];
                setMessages(messagesRef.current);
                setTasks([]);
              }}
              className="text-[10px] text-slate-400 hover:text-white"
              title="Clear conversation and saved task data"
            >
              Clear history
            </button>
          </div>
        </div>
        <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
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
                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => void handleResumeTask(task.id)}
                    className="ml-2 text-[10px] text-indigo-300 hover:text-white"
                  >
                    Resume
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* LiveKit Real-Time Voice Agent (At the bottom / "neeche") */}
      <div className="bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-xl p-3.5 border border-indigo-500/50 space-y-3 shadow-lg shadow-indigo-950/40">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-white flex items-center space-x-1.5">
              <span>🎙️</span>
              <span>LiveKit Voice Agent</span>
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase bg-indigo-950 text-indigo-300 border border-indigo-700/60">
              WebRTC
            </span>
          </div>
          <span
            className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 ${
              livekitState === 'connected' || livekitState === 'listening'
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500 animate-pulse'
                : livekitState === 'speaking'
                ? 'bg-amber-950/90 text-amber-300 border border-amber-500 animate-pulse'
                : livekitState === 'thinking'
                ? 'bg-purple-950/90 text-purple-300 border border-purple-500 animate-pulse'
                : livekitState === 'connecting'
                ? 'bg-sky-950/90 text-sky-300 border border-sky-500'
                : livekitState === 'error'
                ? 'bg-rose-950/90 text-rose-300 border border-rose-500'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <span>●</span>
            <span className="capitalize">{livekitState}</span>
          </span>
        </div>

        {/* Real Error Display */}
        {livekitError && (
          <div className="bg-rose-950/90 border border-rose-600/80 rounded-lg p-2.5 text-xs text-rose-200 space-y-2">
            <div className="font-semibold flex items-center space-x-1 text-rose-300">
              <span>⚠️</span>
              <span>LiveKit Voice Error</span>
            </div>
            <p className="font-mono text-[11px] leading-relaxed break-words">{livekitError}</p>
            <button
              type="button"
              onClick={handleOpenMicPermissionTab}
              className="py-1 px-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-semibold shadow flex items-center space-x-1"
            >
              <span>🎙️</span>
              <span>Open Chrome Microphone Permission Tab</span>
            </button>
          </div>
        )}

        {/* Live Conversation Transcript */}
        {(livekitTranscript.userText || livekitTranscript.aiText) && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-2 text-xs max-h-36 overflow-y-auto">
            {livekitTranscript.userText && (
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block mb-0.5">You (Voice)</span>
                <span className="inline-block bg-indigo-600 text-white rounded-lg px-2.5 py-1 text-xs text-left">
                  {livekitTranscript.userText}
                </span>
              </div>
            )}
            {livekitTranscript.aiText && (
              <div className="text-left">
                <span className="text-[10px] text-indigo-400 block mb-0.5">Handsfree Agent</span>
                <span className="inline-block bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1 text-xs">
                  {livekitTranscript.aiText}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2 pt-0.5">
          <button
            type="button"
            onClick={handleToggleLivekit}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold shadow transition-all flex items-center justify-center space-x-1.5 ${
              livekitState === 'connected' ||
              livekitState === 'listening' ||
              livekitState === 'speaking' ||
              livekitState === 'thinking'
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            <span>
              {livekitState === 'connected' ||
              livekitState === 'listening' ||
              livekitState === 'speaking' ||
              livekitState === 'thinking'
                ? '⏹️ Disconnect Voice'
                : '🎙️ Connect LiveKit Voice'}
            </span>
          </button>

          {(livekitState === 'speaking' || livekitState === 'thinking') && (
            <button
              type="button"
              onClick={handleInterruptLivekit}
              className="py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center space-x-1"
              title="Interrupt agent speech immediately"
            >
              <span>✋</span>
              <span>Interrupt</span>
            </button>
          )}
        </div>

        {/* Quick Voice Text Input (Fallback / Type-to-speak) */}
        <div className="flex space-x-1.5 pt-1">
          <input
            type="text"
            value={livekitManualInput}
            onChange={(e) => setLivekitManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && livekitManualInput.trim()) {
                livekitVoiceClient.sendAgentMessage(livekitManualInput.trim());
                setLivekitManualInput('');
              }
            }}
            placeholder="Type voice prompt to LiveKit..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={() => {
              if (livekitManualInput.trim()) {
                livekitVoiceClient.sendAgentMessage(livekitManualInput.trim());
                setLivekitManualInput('');
              }
            }}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
          >
            Speak
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-0.5">
          <span>
            Language: <strong className="text-indigo-300 uppercase">{language}</strong>
          </span>
          <span>
            Mode: <strong className="text-slate-300">LiveKit WebRTC</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
