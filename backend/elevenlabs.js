// backend/elevenlabs.js

const axios = require('axios');

async function ttsWithElevenLabs({ text, apiKey, language = 'en', modelId = "eleven_flash_v2_5" }) {
  const voiceId = language === 'ar' 
    ? process.env.ELEVENLABS_VOICE_ID_AR_F 
    : process.env.ELEVENLABS_VOICE_ID;

  if (!voiceId) {
    throw new Error(`Voice ID for language '${language}' is not configured in .env. Make sure ELEVENLABS_VOICE_ID and ELEVENLABS_VOICE_ID_AR_F are set.`);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
  try {
    const response = await axios({
      method: 'post',
      url,
      data: {
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 }
      },
      headers: {
        "xi-api-key": apiKey,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json"
      },
      responseType: 'arraybuffer'
    });
    return response.data; // MP3 audio buffer
  } catch (err) {
    throw new Error(`ElevenLabs TTS error: ${err.response?.data?.detail || err.message}`);
  }
}

module.exports = { ttsWithElevenLabs };
