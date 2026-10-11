import { SupportedLanguage } from './types';

export interface SynthesizedSpeech {
  audio: Buffer;
  contentType: string;
}

export async function synthesizeSpeech(text: string, language: SupportedLanguage): Promise<SynthesizedSpeech> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY is not configured in backend/.env.');

  const languageCode = language === 'en' ? 'en-IN' : language === 'hi' ? 'hi-IN' : 'mr-IN';
  // Use Sarvam's recommended male speakers for each supported language.
  const speaker = language === 'hi' ? 'shubh' : 'ratan';
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      text,
      language_code: languageCode,
      model: 'bulbul:v3',
      speaker,
      output_audio_codec: 'wav',
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Sarvam TTS error (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const encodedAudio = data.audios?.[0];
  if (typeof encodedAudio !== 'string') throw new Error('Sarvam TTS returned no audio.');
  return { audio: Buffer.from(encodedAudio, 'base64'), contentType: 'audio/wav' };
}
