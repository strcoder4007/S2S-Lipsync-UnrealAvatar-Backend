// backend/deepgram.js
const WebSocket = require('ws');

function connectToDeepgram({ apiKey, sampleRate = 16000, encoding = 'linear16', onTranscript, onError }) {
  // Use Sec‑WebSocket‑Protocol for auth (Deepgram supports this method)
  const protocols = ['token', apiKey];
  const uri = `wss://api.deepgram.com/v1/listen?model=whisper&language=ar`;

  const ws = new WebSocket(uri, protocols);

  ws.on('open', () => {
    console.log('Deepgram connection opened');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.channel && msg.channel.alternatives && msg.channel.alternatives[0]) {
        const transcript = msg.channel.alternatives[0].transcript;
        const isFinal = msg.is_final || false;
        if (transcript && onTranscript) {
          onTranscript(transcript, isFinal);
        }
      }
    } catch (err) {
      onError && onError(err);
    }
  });

  ws.on('error', (err) => {
    onError && onError(err);
  });

  ws.on('close', (code, reason) => {
    console.log(`Deepgram connection closed: ${code} ${reason}`);
  });

  return {
    sendAudio: (audioBuffer) => {
      if (!audioBuffer || audioBuffer.length === 0) return;
      ws.send(audioBuffer);
    },
    close: () => {
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      ws.close();
    },
    ws,
  };
}

module.exports = { connectToDeepgram };
