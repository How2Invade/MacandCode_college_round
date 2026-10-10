import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# 1. Fix the Theme Toggle Class Application
theme_apply = r"(const isDark = theme === 'dark' \|\| \(theme === 'system' && window\.matchMedia\('\(prefers-color-scheme: dark\)'\)\.matches\);\n)\s*if \(isDark\) document\.body\.classList\.add\('dark'\);\n\s*else document\.body\.classList\.remove\('dark'\);"
theme_replacement = r"\1      if (isDark) document.documentElement.classList.add('dark');\n      else document.documentElement.classList.remove('dark');"
content = re.sub(theme_apply, theme_replacement, content)

# 2. Add Voice State
voice_state_target = r"(const \[inputText, setInputText\] = useState\(''\);)"
voice_state_replacement = r"\1\n  const [conversation, setConversation] = useState<{role: 'user'|'assistant', text: string}[]>([]);\n  const [isSpeaking, setIsSpeaking] = useState(false);"
content = re.sub(voice_state_target, voice_state_replacement, content)

# 3. Add Speak / Stop logic and handleReadPage
speak_logic = """
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
"""

handle_send_target = r"(const handleSendMessage = async \(overrideText\?: string\) => \{)"
content = re.sub(handle_send_target, speak_logic + r"\n  \1", content)

# 4. Update handleSendMessage to update conversation
send_msg_logic_target = r"setVoiceState\('processing'\);\n\s*setAssistantState\('thinking'\);\n\s*setCurrentActionDescription\('\.\.\.'\);\n\s*if \(!overrideText\) \{\n\s*setInputText\(''\);\n\s*\}"
send_msg_logic_replacement = r"""setVoiceState('processing');
    setAssistantState('thinking');
    setCurrentActionDescription('...');
    setConversation(prev => [...prev, {role: 'user', text: textToProcess}]);
    if (!overrideText) {
      setInputText('');
    }"""
content = re.sub(send_msg_logic_target, send_msg_logic_replacement, content)

ai_reply_target = r"const plannedActions = await defaultMockAiClient\.generatePlan\(textToProcess, voiceLanguage\);"
ai_reply_replacement = r"""const assistantReply = await defaultMockAiClient.sendMessage(textToProcess, voiceLanguage);
      setConversation(prev => [...prev, {role: 'assistant', text: assistantReply.content}]);
      speakText(assistantReply.content);
      const plannedActions = await defaultMockAiClient.generatePlan(textToProcess, voiceLanguage);"""
content = re.sub(ai_reply_target, ai_reply_replacement, content)


with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)

