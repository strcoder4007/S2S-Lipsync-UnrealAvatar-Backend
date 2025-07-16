// backend/server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const { OpenAI } = require('openai');
const { connectToDeepgram } = require('./deepgram');
const { ttsWithElevenLabs } = require('./elevenlabs');
const WebSocketClient = require('ws');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const cors = require('cors');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8000;

// Load API keys from .env
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Express health check
 */
app.get('/', (req, res) => {
  res.send('Node.js + Express backend is running.');
});

/**
 * POST /chat/text
 * Body: form-data { prompt: string }
 * Returns: { response: string }
 */
app.post('/chat/text', async (req, res) => {
  try {
    const prompt = req.body.prompt || (req.body && req.body.get && req.body.get('prompt'));
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const promptWithLimit = `${prompt}\n\nPlease answer in no more than 2/3 sentences and 150 words.`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: promptWithLimit }],
      max_tokens: 300,
    });
    const llmResponse = completion.choices[0]?.message?.content || "";
    res.json({ response: llmResponse });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * POST /chat/audio
 * Body: form-data { file: audio }
 * Returns: { transcript: string, response: string }
 */
const multer = require('multer');
const upload = multer();

app.post('/chat/audio', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });

    // Send audio to Deepgram for transcription
    const deepgramRes = await axios.post(
      'https://api.deepgram.com/v1/listen',
      req.file.buffer,
      {
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/wav',
        },
      }
    );
    const transcript = deepgramRes.data.results.channels[0].alternatives[0].transcript || '';

    // Call OpenAI for response
    const promptWithLimit = `${transcript}\n\nPlease answer in no more than 2/3 sentences and 150 words.`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: promptWithLimit }],
      max_tokens: 300,
    });
    const llmResponse = completion.choices[0]?.message?.content || "";
    res.json({ transcript, response: llmResponse });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * Helper: Convert MP3 buffer to WAV (PCM, mono, 16kHz) using ffmpeg
 * Returns: Promise<Buffer> (WAV buffer)
 */
const convertMp3ToWavPcm16kMono = (mp3Buffer) => {
  return new Promise((resolve, reject) => {
    const tempInput = path.join(__dirname, `temp_input_${Date.now()}.mp3`);
    const tempOutput = path.join(__dirname, `temp_output_${Date.now()}.wav`);
    fs.writeFileSync(tempInput, mp3Buffer);
    ffmpeg(tempInput)
      .inputFormat('mp3')
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(tempOutput)
      .on('end', () => {
        try {
          const wavBuffer = fs.readFileSync(tempOutput);
          fs.unlinkSync(tempInput);
          fs.unlinkSync(tempOutput);
          resolve(wavBuffer);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(tempInput);
          fs.unlinkSync(tempOutput);
        } catch {}
        reject(err);
      })
      .run();
  });
};


const sendWavToGrpcClient = async (wavBuffer, sampleRate = 16000, wsUrl = "ws://localhost:8765") => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClient(wsUrl);
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      // Send JSON header
      ws.send(JSON.stringify({ sample_rate: sampleRate }));
      // Send WAV buffer in chunks
      const chunkSize = 4096;
      for (let i = 0; i < wavBuffer.length; i += chunkSize) {
        ws.send(wavBuffer.slice(i, i + chunkSize));
      }
      // Send END signal
      ws.send("END");
      // Print log immediately after sending audio
      console.log(`[Backend] Sent ${wavBuffer.length} bytes of WAV audio to grpc_client.py via WebSocket (${wsUrl})`);
      ws.close();
      resolve();
    });
    ws.on('error', (err) => {
      reject(err);
    });
  });
};

// Helper function to convert audio to linear PCM
const convertToLinearPCM = (audioBuffer, mimeType) => {
  return new Promise((resolve, reject) => {
    // Create temporary files
    const tempInput = path.join(__dirname, `temp_input_${Date.now()}.audio`);
    const tempOutput = path.join(__dirname, `temp_output_${Date.now()}.wav`);
    
    // Write input buffer to temporary file
    fs.writeFileSync(tempInput, audioBuffer);
    
    // Determine input format based on mimeType
    let inputFormat = 'wav'; // default
    if (mimeType) {
      if (mimeType.includes('webm')) inputFormat = 'webm';
      else if (mimeType.includes('ogg')) inputFormat = 'ogg';
      else if (mimeType.includes('mp3')) inputFormat = 'mp3';
      else if (mimeType.includes('wav')) inputFormat = 'wav';
    }
    
    console.log(`[Backend] Converting audio: ${inputFormat} -> linear PCM`);
    
    ffmpeg(tempInput)
      .inputFormat(inputFormat)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(tempOutput)
      .on('end', () => {
        try {
          const pcmBuffer = fs.readFileSync(tempOutput);
          // Clean up temp files
          fs.unlinkSync(tempInput);
          fs.unlinkSync(tempOutput);
          console.log(`[Backend] Audio conversion successful, PCM size: ${pcmBuffer.length}`);
          resolve(pcmBuffer);
        } catch (err) {
          console.error('[Backend] Error reading converted audio:', err);
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('[Backend] FFmpeg conversion error:', err);
        // Clean up temp files
        try {
          fs.unlinkSync(tempInput);
          fs.unlinkSync(tempOutput);
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        reject(err);
      })
      .run();
  });
};

// WebSocket for audio streaming
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  let lastAudioMimeType = null;

  ws.on('message', async (message) => {
    try {
      console.log(`[Backend] Received message, type: ${typeof message}, size: ${message.length}`);

      // Try to parse as JSON for control messages
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = null;
      }

      // Handle mime type message
      if (parsed && parsed.type === 'audio-mime' && parsed.mimeType) {
        lastAudioMimeType = parsed.mimeType;
        console.log('[Backend] Received audio mimeType:', lastAudioMimeType);
        return;
      }

      // Handle text message
      if (parsed && parsed.type === 'text' && parsed.prompt) {
        console.log('[Backend] Handling text message:', parsed.prompt);
        const promptWithLimit = `${parsed.prompt}\n\nPlease answer in no more than 2/3 sentences and 150 words.`;
        const completion = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: promptWithLimit }],
          max_tokens: 300,
        });
        const llmResponse = completion.choices[0]?.message?.content || "";
        ws.send(JSON.stringify({ type: 'llm_response', response: llmResponse }));

        // --- TTS and send to grpc_client.py ---
        try {
          // Generate TTS audio (MP3) from LLM response
          const ttsAudioMp3 = await ttsWithElevenLabs({
            text: llmResponse,
            apiKey: ELEVENLABS_API_KEY,
            // voiceId and modelId use defaults
          });
          // Convert MP3 to WAV (PCM, mono, 16kHz)
          const wavBuffer = await convertMp3ToWavPcm16kMono(ttsAudioMp3);
          // Send WAV to grpc_client.py via WebSocket
          await sendWavToGrpcClient(wavBuffer, 16000, "ws://localhost:8765");
          console.log('[Backend] Sent TTS audio to grpc_client.py via WebSocket');
        } catch (err) {
          console.error('[Backend] Error in TTS or sending audio to grpc_client:', err);
        }
        // --- End TTS and send ---

        return;
      }

      // Handle audio buffer
      if (Buffer.isBuffer(message)) {
        console.log('[Backend] Processing audio buffer, size:', message.length);
        
        // Check if buffer is too small (just header)
        if (message.length < 100) {
          console.log('[Backend] Audio buffer too small, likely empty audio');
          ws.send(JSON.stringify({ type: 'error', error: 'Audio buffer is too small or empty' }));
          return;
        }

        try {
          // Convert audio to linear PCM format for Deepgram
          const pcmBuffer = await convertToLinearPCM(message, lastAudioMimeType);
          
          // Send to Deepgram for transcription
          const deepgramResponse = await axios.post(
            'https://api.deepgram.com/v1/listen',
            pcmBuffer,
            {
              headers: {
                'Authorization': `Token ${DEEPGRAM_API_KEY}`,
                'Content-Type': 'audio/wav',
              },
              params: {
                model: 'nova-2',
                language: 'en-US',
                filler_words: false,
                punctuate: true,
              }
            }
          );

          const transcript = deepgramResponse.data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          console.log('[Backend] Deepgram transcript:', transcript);

          if (transcript.trim()) {
            // Send transcript to frontend
            ws.send(JSON.stringify({ type: 'transcript', transcript }));

            // Generate LLM response
            const promptWithLimit = `${transcript}\n\nPlease answer in no more than 2/3 sentences and 150 words.`;
            const completion = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [{ role: "user", content: promptWithLimit }],
              max_tokens: 300,
            });
            const llmResponse = completion.choices[0]?.message?.content || "";
            
            // Send LLM response to frontend
            ws.send(JSON.stringify({ type: 'llm_response', response: llmResponse }));

            // --- TTS and send to grpc_client.py ---
            try {
              // Generate TTS audio (MP3) from LLM response
              const ttsAudioMp3 = await ttsWithElevenLabs({
                text: llmResponse,
                apiKey: ELEVENLABS_API_KEY,
                // voiceId and modelId use defaults
              });
              // Convert MP3 to WAV (PCM, mono, 16kHz)
              const wavBuffer = await convertMp3ToWavPcm16kMono(ttsAudioMp3);
              // Send WAV to grpc_client.py via WebSocket
              await sendWavToGrpcClient(wavBuffer, 16000, "ws://localhost:8765");
              console.log('[Backend] Sent TTS audio to grpc_client.py via WebSocket (from audio buffer handler)');
            } catch (err) {
              console.error('[Backend] Error in TTS or sending audio to grpc_client (from audio buffer handler):', err);
            }
            // --- End TTS and send ---

          } else {
            ws.send(JSON.stringify({ type: 'error', error: 'No speech detected in audio' }));
          }

        } catch (err) {
          console.error('[Backend] Error processing audio:', err);
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Audio processing failed: ' + (err.message || String(err)) 
          }));
        }
      }
    } catch (err) {
      console.error('[Backend] Error in WebSocket message handler:', err);
      ws.send(JSON.stringify({ type: 'error', error: err.message || String(err) }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log('WebSocket connection closed', code, reason && reason.toString());
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});
