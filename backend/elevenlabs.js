// backend/elevenlabs.js

const axios = require('axios');

async function ttsWithElevenLabs({ text, apiKey, voiceId = "56AoDkrOh6qfVPDXZ7Pt", modelId = "eleven_flash_v2_5" }) {
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
