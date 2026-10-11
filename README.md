<div align="center">

  <img src="assets/bnb.png" alt="Handsfree Logo" width="220" style="border-radius: 50%; box-shadow: 0 10px 30px rgba(0, 166, 125, 0.25);" />

  # Handsfree
  ### **Browse Beyond Your Hands**

  **An AI-Powered Multimodal Chrome Assistant bridging Human Intent and the Web through On-Device Computer Vision, Real-Time Conversational Voice, and Risk-Governed Browser Automation.**

  <p align="center">
    <a href="#overview"><img src="https://img.shields.io/badge/Status-Hackathon_Showcase-00A67D?style=for-the-badge&logo=rocket&logoColor=white" /></a>
    <a href="#architecture"><img src="https://img.shields.io/badge/Extension-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
    <a href="#technology-stack"><img src="https://img.shields.io/badge/Vision-MediaPipe_60FPS-0097A7?style=for-the-badge&logo=google&logoColor=white" /></a>
    <a href="#key-features"><img src="https://img.shields.io/badge/Voice-LiveKit_WebRTC-FF6B35?style=for-the-badge&logo=webrtc&logoColor=white" /></a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/React_18-20232A?style=flat-square&logo=react&logoColor=61DAFB" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
    <img src="https://img.shields.io/badge/Vite_5-646CFF?style=flat-square&logo=vite&logoColor=white" />
    <img src="https://img.shields.io/badge/Google_Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=white" />
    <img src="https://img.shields.io/badge/Sarvam_AI_Multilingual-FF6B35?style=flat-square&logo=voice&logoColor=white" />
    <img src="https://img.shields.io/badge/Safety-Zod_Validated-306998?style=flat-square&logo=zod&logoColor=white" />
  </p>

  <p align="center">
    <a href="#overview">Overview</a> •
    <a href="#system-architecture">System Architecture</a> •
    <a href="#core-capabilities">Core Capabilities</a> •
    <a href="#interaction-matrix">Interaction Matrix</a> •
    <a href="#technology-stack">Tech Stack</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#security--privacy">Security & Safety</a> •
    <a href="#team-mac-n-code">Team</a>
  </p>

</div>

---

## 🌟 Overview

The modern web was built for two hands, a physical mouse, and a mechanical keyboard. For millions of individuals with motor impairments, temporary injuries, situational disabilities, or multitaskers in hands-busy environments, this legacy paradigm creates friction and barriers.

**Handsfree** is a next-generation Chrome Extension that breaks this barrier. By harmonizing **real-time on-device computer vision**, **ultra-low latency WebRTC voice streaming**, and **autonomous agentic planning**, Handsfree transforms standard web browsing into a fluid, hands-free experience.

Navigate complex web pages, click links, fill search inputs, trigger smart summarization, and control tabs using **only your head posture, natural hand gestures, or conversational voice commands in English, Hindi, and Marathi**.

```
   ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
   │   VISION INPUT   │       │   VOICE INPUT    │       │   INTENT ENGINE  │
   │  Head Tracking   │  ───► │  Real-time Audio │  ───► │  Multi-Step Plan │
   │  Hand Gestures   │       │  Multilingual    │       │  Safety Policies │
   └──────────────────┘       └──────────────────┘       └──────────────────┘
                                                                   │
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │  BROWSER ACTION  │
                                                         │  Virtual Cursor  │
                                                         │  DOM Interaction │
                                                         └──────────────────┘
```

---

## 🏛️ System Architecture

Handsfree utilizes a distributed, modular pipeline designed for **zero-latency UI responsiveness**, **client-side privacy isolation**, and **zero-trust safety enforcement**.

### 1. End-to-End Multimodal Dataflow

```mermaid
flowchart TD
    subgraph ClientPerception[" Client-Side Perception Layer (Chrome Extension MV3) "]
        direction TB
        CAM["Webcam Feed<br/>(Local Stream)"] --> MP_FACE["MediaPipe Face Landmarker<br/>468 Mesh Landmarks"]
        CAM --> MP_HAND["MediaPipe Hand Landmarker<br/>21 3D Joint Points"]
        
        MP_FACE --> KALMAN["Kalman Filter & EMA<br/>Coordinate Smoothing"]
        MP_HAND --> GESTURE["Gesture State Machine<br/>Pinch · Palm · Fist · Swipe"]
        
        MIC["Microphone Audio"] --> LK_CLIENT["LiveKit WebRTC Audio Track<br/>Ultra-Low Latency Streaming"]
    end

    subgraph CoreEngine[" Handsfree Extension Core & Sidepanel "]
        KALMAN --> CURSOR["Virtual Cursor Controller<br/>Sub-pixel Coordinate Mapper"]
        GESTURE --> CLICK_ENG["Gesture Trigger Engine<br/>Hover / Pinch / Hold Detector"]
        
        CURSOR --> DOM_OVERLAY["Injected DOM Content Script<br/>Visual Cursor · Interactive Highlights"]
        CLICK_ENG --> DOM_OVERLAY
    end

    subgraph BackendGateway[" Secure Backend Services (:4000) "]
        LK_CLIENT <==> LK_SERVER["LiveKit WebRTC Gateway<br/>Real-Time Audio Transport"]
        LK_SERVER <==> AI_BRIDGE["Multilingual Voice & Intent Bridge"]
        
        AI_BRIDGE --> GEMINI["Google Gemini 1.5 / 2.0<br/>Conversational Understanding"]
        AI_BRIDGE --> SARVAM["Sarvam AI Engine<br/>Hindi · Marathi · English TTS & STT"]
    end

    subgraph SafetyAndExecution[" Agent Execution & Risk Governance "]
        AI_BRIDGE --> PLANNER["Multi-Step Task Planner<br/>Decomposes High-Level Goals"]
        PLANNER --> POLICY["Zero-Trust Policy Enforcer<br/>Zod Schema Validation & Risk Tiering"]
        
        POLICY -->|Low Risk: Auto-Exec| EXECUTOR["Chrome Action Executor<br/>Tabs · Navigation · Script Injection"]
        POLICY -->|High/Critical: Requires Auth| CONFIRM["Human-in-the-Loop Dialog<br/>Sidepanel User Confirmation"]
        CONFIRM -->|Approved| EXECUTOR
        CONFIRM -->|Declined| REJECT["Action Aborted & Feedback"]
        
        EXECUTOR --> DOM_OVERLAY
    end

    style ClientPerception fill:#0b132b,stroke:#48bfe3,stroke-width:2px,color:#fff
    style CoreEngine fill:#1c2541,stroke:#5bc0be,stroke-width:2px,color:#fff
    style BackendGateway fill:#22223b,stroke:#c9ada7,stroke-width:2px,color:#fff
    style SafetyAndExecution fill:#1b263b,stroke:#00a67d,stroke-width:2px,color:#fff
```

### 2. Multi-Tier Action Policy & Safety Pipeline

```mermaid
flowchart LR
    A["Raw User Intent<br/>Voice / Gesture"] --> B["Zod Schema Validator<br/>Sanitizes URLs, coordinates, commands"]
    B --> C{"Risk Classification"}
    
    C -->|Low Risk<br/>Scroll, Back, Forward| D["Direct Execution<br/>Instant Dispatch"]
    C -->|Medium Risk<br/>Tab Switch, Simple Clicks| E["Visual Indication<br/>Hover Feedback & Log"]
    C -->|High / Sensitive<br/>Form Submits, URL Nav| F["Explicit Confirmation<br/>Voice / Click Approval Modal"]
    
    D --> G["Chrome Action Runtime"]
    E --> G
    F -->|Approved| G
    F -->|Timeout / Cancel| H["Safe Fallback"]

    style A fill:#EDE9FE,stroke:#7C3AED,color:#312E81
    style B fill:#DBEAFE,stroke:#2563EB,color:#1E3A8A
    style C fill:#FEF3C7,stroke:#D97706,color:#78350F
    style D fill:#D1FAE5,stroke:#059669,color:#064E3B
    style E fill:#CFFAFE,stroke:#0891B2,color:#164E63
    style F fill:#FCE7F3,stroke:#DB2777,color:#831843
    style G fill:#DCFCE7,stroke:#16A34A,color:#14532D
```

---

## ⚡ Core Capabilities

### 🎯 1. On-Device Vision Tracking
- **60 FPS Dual Pipeline:** Computes 468 facial mesh landmarks and 21 3D hand points concurrently in WebAssembly via `@mediapipe/tasks-vision`.
- **Kalman & Exponential Smoothing:** Eliminates natural micro-tremors, head jitter, and webcam sensor noise for precise sub-pixel mouse targeting.
- **Dynamic Head Tracking:** Moves the pointer intuitively based on nose-tip and facial vectors with user-configurable sensitivity and deadzones.
- **Multi-Gesture Recognition:**
  - **Index-to-Thumb Pinch:** Instant left-click.
  - **Pinch & Hold:** Drag-and-drop, text selection, and continuous interaction.
  - **Open Palm:** Dynamic deceleration and precision mode.
  - **Closed Fist:** Interaction freeze / safety lock.

### 🗣️ 2. Conversational Multilingual Voice (LiveKit + Sarvam AI)
- **Ultra-Low Latency Streaming:** Powered by LiveKit WebRTC data and media channels for conversational interaction without awkward round-trip delays.
- **Multilingual Support:** Converses fluently and understands browser commands in **English, Hindi (हिंदी), and Marathi (मराठी)**.
- **Instant Interruption:** Spoken agent responses immediately duck or pause when the user speaks, mimicking true human conversation.
- **Smart Fallback:** Automatic failover to browser Web Speech API when offline or running in standalone mode.

### 🧠 3. Autonomous Multi-Step Planning
- **Sub-Goal Decomposition:** Converts high-level user commands into ordered execution trees.  
  *(e.g., "Search for cheap flights from Mumbai to Delhi on Google Flights and pick the morning option")*
- **DOM Self-Healing & Visual Feedback:** Intelligent selector heuristics targeting visible clickable elements, forms, and buttons with interactive element highlights.

### 🛡️ 4. Zero-Trust Policy & Safety Enforcer
- **Human-in-the-Loop Execution:** Consequential operations (such as payments, navigation to unverified domains, or form submissions) trigger visual confirmation dialogs.
- **Zod Schema Hardening:** Every payload is validated against strict types before execution—eliminating prompt injection hazards and errant agent commands.
- **Zero Webcam Transmission:** Camera frames are evaluated **100% on the local client machine**. Only processed landmark coordinates remain in memory; raw video is never sent over any network.

---

## 🎮 Interaction Matrix

| Input Modality | Action / Gesture | Browser Behavior | Safety Level |
|---|---|---|:---:|
| **Head Movement** | Subtle tilt or pan | Moves virtual screen cursor across active viewport | `Low` |
| **Hand Gesture** | Pinch (Index + Thumb) | Left Click / Trigger focused link or button | `Medium` |
| **Hand Gesture** | Pinch & Hold (>400ms) | Element Drag & Drop / Continuous Slider Control | `Medium` |
| **Hand Gesture** | Open Palm Facing Camera | Precision Mode (Dampens speed for fine selection) | `Low` |
| **Hand Gesture** | Closed Fist | Global Tracking Pause (Prevents misclicks) | `Safe` |
| **Voice Command** | *"Scroll down"* / *"खाली स्क्रोल करा"* | Smooth page scroll downwards by calibrated viewport delta | `Low` |
| **Voice Command** | *"Click on Documentation"* | Resolves DOM link text and dispatches verified click | `Medium` |
| **Voice Command** | *"Open YouTube in a new tab"* | Spawns tab and loads authenticated target URL | `Low` |
| **Voice Command** | *"Summarize this article"* | Gathers page text, runs Gemini summary in sidepanel | `Safe` |

---

## 🛠️ Technology Stack

<div align="center">

| Domain | Technology | Key Role in Handsfree |
|:---|:---|:---|
| **Frontend Framework** | `React 18 + TypeScript` | Type-safe Sidepanel UI, status overlays, reactive calibration controls |
| **Styling & Design** | `Tailwind CSS` | Modern glassmorphism design system, dark-mode styling, smooth transitions |
| **Build & Tooling** | `Vite 5` + `Rollup` | Dual-bundle architecture (Sidepanel / Background / Injected Content Script) |
| **Extension Platform** | `Chrome Manifest V3` | Service workers, isolated DOM content scripts, sidePanel API |
| **Computer Vision** | `Google MediaPipe` | On-device WebAssembly vision models (Face Mesh & Hand Landmarks) |
| **Voice Infrastructure** | `LiveKit WebRTC` | Full-duplex audio rooms, low-latency streaming audio transport |
| **Multilingual AI** | `Sarvam AI` | Indic language speech-to-text and voice synthesis (Hindi, Marathi, English) |
| **Conversational LLM** | `Google Gemini 1.5/2.0` | High-reasoning intent classification and multi-step plan generation |
| **Validation & Safety** | `Zod` | Runtime schema validation, strict action boundaries, policy enforcement |
| **Testing** | `Vitest` + `Playwright` | Unit tests for tracking algorithms, end-to-end browser automation suites |

</div>

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18.0.0 or higher
- **npm** v9.0.0 or higher
- **Google Chrome** (Version 116+ recommended for Manifest V3 sidePanel support)
- A webcam and microphone

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/How2Invade/MacandCode_college_round.git
cd MacandCode_college_round
npm install
```

---

### Step 2: Configure Environment Variables

Create your local `.env` file from the provided example:

```bash
cp .env.example .env
```

Add your API credentials in `.env`:

```env
# Backend Server Configuration
BACKEND_PORT=4000
BACKEND_HOST=localhost

# LiveKit WebRTC Infrastructure (https://cloud.livekit.io)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# Multimodal LLM & Indic Voice (https://aistudio.google.com & https://sarvam.ai)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
SARVAM_API_KEY=your_sarvam_api_key
SARVAM_CHAT_MODEL=sarvam-105b-conversations

# Extension Debugging
VITE_ENABLE_DEBUG_LOGS=true
```

> **Security Note:** All private API keys and tokens reside strictly in the backend runtime. The client Chrome Extension communicates with the backend gateway via authenticated local WebRTC / HTTP channels.

---

### Step 3: Run the Development Server & Backend

In your primary terminal, start the secure backend voice & agent service:

```bash
npm run backend:dev
```
*(You will see: `[Handsfree Backend] Secure AI gateway listening on http://localhost:4000`)*

In a second terminal, launch the Vite compiler in watch mode:

```bash
npm run dev
```

---

### Step 4: Build the Extension

To compile the production Manifest V3 extension bundle:

```bash
npm run build
```

This compiles TypeScript, packages the content scripts via `vite.content.config.ts`, copies `manifest.json`, and outputs the complete extension package to the **`dist/`** directory.

---

### Step 5: Load into Google Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the upper-right corner.
3. Click the **Load unpacked** button.
4. Select the **`dist`** folder inside this project directory.
5. Open any webpage, click the **Handsfree** puzzle icon, and pin it to open the Sidepanel!

---

## 🔒 Security & Privacy by Design

- 🛡️ **Edge-Only Video Processing:** The webcam stream is strictly bound to on-device MediaPipe models in the browser sandbox. Video frames **never leave the user's machine**.
- 🛡️ **Zero-Trust Action Boundaries:** The AI agent cannot execute unrestricted arbitrary code. Actions are constrained to a predefined Zod-validated allowlist (`click_element`, `scroll_page`, `type_text`, `navigate_back`, `open_url`).
- 🛡️ **Confirmation Safeguards:** Critical operations (e.g. financial workflows, OAuth, or external redirects) trigger non-bypassable user confirmation prompts.
- 🛡️ **Ephemeral Memory:** Landmark coordinates and audio buffers are handled in memory and discarded immediately upon processing.

---

## 🔮 Vision & Impact

Accessibility is not a feature toggle—it is a fundamental human right in the digital era. **Handsfree** demonstrates how the convergence of **on-device computer vision**, **multimodal language models**, and **real-time WebRTC infrastructure** can redefine computer accessibility.

We are building toward a future where computing adapts to humans—not the other way around.

---

## 👥 Team Mac n Code

Crafted with passion, caffeine, and a commitment to accessible tech for all.

<div align="center">

| Team Member | Role & Focus |
|:---|:---|
| **Jeet Chavan** | Vision Pipeline & Landmark Stabilization |
| **Meet Mangaonkar** | Core Architecture, Extension Infrastructure & Content Script Engineering |
| **Sanika Lobo** | UI/UX Design System, Sidepanel Engineering & Accessibility Experience |
| **Yash Masaye** | Real-Time Voice Pipeline, LiveKit WebRTC & Multilingual AI Integration |

<br/>

<p align="center">
  <img src="assets/bnb.png" alt="Handsfree Logo" width="80" />
</p>

**Handsfree — Browse Beyond Your Hands.**

</div>
