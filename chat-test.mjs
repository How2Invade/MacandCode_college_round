/**
 * Handsfree AI — Interactive Chat Test
 * Run this while the backend is running to have a real conversation with the AI.
 *
 * Usage:
 *   node chat-test.mjs
 *   node chat-test.mjs hi       (for Hindi)
 *   node chat-test.mjs mr       (for Marathi)
 */

import readline from 'readline';

const BACKEND_URL = 'http://localhost:4000';
const language = process.argv[2] || 'en';
const history = [];

const LANG_LABELS = { en: 'English', hi: 'Hindi (हिन्दी)', mr: 'Marathi (मराठी)' };
const YOU_LABEL  = { en: 'You', hi: 'आप', mr: 'तुम्ही' };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║   🤖  Handsfree AI — Conversational Chat Test    ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log(`  Language : ${LANG_LABELS[language] || language}`);
console.log(`  Backend  : ${BACKEND_URL}/api/chat`);
console.log('  Type your message and press Enter.');
console.log('  Type  exit  or  quit  to stop.\n');

async function sendMessage(prompt) {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      language,
      history: history.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return await res.json();
}

function printAssistant(text) {
  console.log('\n🤖  Handsfree AI:\n');
  const words = text.split(' ');
  let line = '    ';
  for (const word of words) {
    if (line.length + word.length + 1 > 76) {
      console.log(line);
      line = '    ' + word + ' ';
    } else {
      line += word + ' ';
    }
  }
  if (line.trim()) console.log(line);
  console.log();
}

function printActions(actions) {
  if (!actions || actions.length === 0) return;
  console.log(`  📋  ${actions.length} Browser Action${actions.length > 1 ? 's' : ''} Generated:`);
  for (const a of actions) {
    if (a.type === 'open_url')           console.log(`      • open_url         → ${a.url}`);
    else if (a.type === 'type_text')     console.log(`      • type_text         → "${a.text?.slice(0, 60)}${a.text?.length > 60 ? '…' : ''}"`);
    else if (a.type === 'click_element') console.log(`      • click_element     → #${a.targetId}`);
    else if (a.type === 'scroll_page')   console.log(`      • scroll_page       → ${a.direction} by ${a.amount}px`);
    else if (a.type === 'navigate')      console.log(`      • navigate          → ${a.direction}`);
    else if (a.type === 'switch_tab')    console.log(`      • switch_tab        → ${a.direction}`);
    else if (a.type === 'read_page')     console.log(`      • read_page`);
  }
  console.log();
}

function askQuestion(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  // Check backend health first
  try {
    const health = await fetch(`${BACKEND_URL}/health`).then(r => r.json());
    if (health.status !== 'ok') throw new Error('unhealthy');
    console.log(`  ✅  Backend is online (${health.service})\n`);
  } catch {
    console.error(`  ❌  Cannot reach backend at ${BACKEND_URL}`);
    console.error(`      Start it first with:\n\n      npm run backend:dev\n`);
    process.exit(1);
  }

  while (true) {
    let userInput;
    try {
      userInput = await askQuestion(`${YOU_LABEL[language] || 'You'}: `);
    } catch {
      break;
    }

    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', 'bye', 'q'].includes(trimmed.toLowerCase())) {
      console.log('\n  👋  Goodbye!\n');
      break;
    }

    try {
      console.log('\n  ⏳  Thinking…');
      const data = await sendMessage(trimmed);

      history.push({ role: 'user',      content: trimmed });
      history.push({ role: 'assistant', content: data.reply });

      printAssistant(data.reply);
      printActions(data.actions);

      if (data.costEstimate) {
        console.log(`  💰  tokens: ${data.costEstimate.tokensUsed ?? '?'}  |  model: ${data.costEstimate.model ?? '?'}\n`);
      }
    } catch (err) {
      console.error(`\n  ⚠️  Error: ${err.message}\n`);
    }
  }

  rl.close();
}

main();
