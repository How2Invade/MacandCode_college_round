# LiveKit Real-Time Conversational AI Setup Guide

Handsfree integrates **LiveKit WebRTC** directly into the Chrome extension sidebar to provide natural, low-latency conversational voice control with spoken audio responses, instant speech interruption, and seamless browser-action execution.

---

## 1. Required Credentials & Where to Get Them

All secrets belong exclusively in `backend/.env` (never bundled in client-side extension code).

| Service | Environment Variable | Purpose | Free Tier Details & Sign-Up Link |
|---|---|---|---|
| **LiveKit Cloud** | `LIVEKIT_URL`<br>`LIVEKIT_API_KEY`<br>`LIVEKIT_API_SECRET` | Real-time WebRTC audio room and data channel | **Free Tier:** 50 GB monthly bandwidth, unlimited rooms.<br>👉 [https://cloud.livekit.io](https://cloud.livekit.io) → Create Project → Project Settings → **Keys** |
| **Google Gemini** | `GEMINI_API_KEY`<br>`GEMINI_MODEL=gemini-3.8-flash` | Multilingual collaborative conversational LLM (EN, HI, MR) | **Free Tier:** Standard tier available with Google AI Studio key.<br>👉 [https://aistudio.google.com/](https://aistudio.google.com/) → **Get API key** |
| **Groq** *(Optional)* | `GROQ_API_KEY` | Ultra-fast Llama-3.3-70B / Whisper STT alternative | **Free Tier:** High-rate free tier on Groq Cloud.<br>👉 [https://console.groq.com/](https://console.groq.com/) |
| **Deepgram** *(Optional)* | `DEEPGRAM_API_KEY` | Real-time multilingual streaming STT / Aura TTS | **Free Credit:** $200 free credit on signup.<br>👉 [https://deepgram.com/](https://deepgram.com/) |
| **Cartesia** *(Optional)* | `CARTESIA_API_KEY` | Ultra-low latency (<100ms) Sonic voice TTS | **Free Tier:** Free testing tier.<br>👉 [https://cartesia.ai/](https://cartesia.ai/) |

---

## 2. Configuration (`backend/.env`)

Ensure your `backend/.env` contains your LiveKit credentials and LLM key:

```env
# Backend Server
BACKEND_PORT=4000
BACKEND_HOST=localhost

# LiveKit WebRTC
LIVEKIT_URL=wss://your-project-subdomain.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# AI Conversational Model
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash

```

---

## 3. How to Start Everything

### Step 1 — Start the Backend Server
```bash
cd /Users/yashmasaye/Desktop/bnb26/MacandCode_college_round
npm run backend:dev
```
You should see:
`[Handsfree Backend] Secure AI gateway listening on http://localhost:4000`

### Step 2 — Build the Extension
```bash
npm run build
```
This builds the TypeScript code and bundles the extension into `dist/`.

### Step 3 — Load / Reload in Chrome
1. Open Chrome and go to `chrome://extensions`.
2. Ensure **Developer mode** (top-right toggle) is ON.
3. If already loaded, click the **🔄 Reload** button on the **Handsfree** extension card. (If not loaded, click **Load unpacked** and select the project root directory).
4. Open any webpage (e.g. `https://google.com`), click the Handsfree extension icon to open the **Sidebar**.

---

## 4. Manual Test Procedure

1. **Verify Backend Status**:
   In your terminal or browser, open:
   ```bash
   curl http://localhost:4000/api/livekit/status
   ```
   Should return: `{"status":"ok","configured":true,"serverUrl":"wss://..."}`.

2. **Connect LiveKit Voice in the Sidepanel**:
   - Scroll to the bottom of the sidebar to the **🎙️ LiveKit Voice Agent** card.
   - Click **🎙️ Connect LiveKit Voice**.
   - The status badge will change from `⚪ Ready` → `🟡 Connecting` → `🟢 Connected` / `🔴 Listening`.
   - Chrome will request microphone permission on first use. Click **Allow**.

3. **Natural Conversational Flow & Multi-Turn Clarification**:
   - **Speak**: *"Write an essay on my favorite animal."*
   - Notice the live transcript bubble captures your speech.
   - The agent will speak back aloud: *"I'd love to help! Which animal is your favorite, and do you have a target length...?"*
   - **Speak**: *"Snow leopards, about 300 words."*
   - The agent outlines the plan and asks: *"Here is my plan: 1. Open Google Docs, 2. Write essay... Shall I go ahead?"*

4. **Test Real-Time Interruption**:
   - While the AI is speaking its response, click the **✋ Interrupt** button or start speaking again.
   - The agent's audio stops immediately, and state resets to `Listening`.

5. **Approval System & Browser Execution**:
   - **Speak**: *"Yes, go ahead."*
   - In **Ask Mode**, the Amber Human Approval Banner will appear with the generated action (`open_url` → `https://docs.new`).
   - Click **Approve** (or switch Approval Mode to **Auto**).
   - Sanika's browser action executor runs the action and records it in Task History.

6. **Multilingual Test**:
   - Select **हिन्दी** in the Language toggle.
   - Speak: *"सर्च बॉक्स पर क्लिक करो"* or *"ताजमहल के बारे में बताओ"*.
   - The AI converses and responds naturally in Hindi!
