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

const PORT = 8000;

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODE = process.env.MODE || 'audio'; // Default to 'audio'

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

// Helper function for handling LLM stream, sentence splitting, and TTS
const handleLlmStream = async (prompt, ws, language = 'en') => {
  const promptWithLimit = `${prompt}\n\nPlease answer in no more than 2/3 sentences and 150 words.`;
  
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: promptWithLimit }],
      max_tokens: 300,
      stream: true,
    });

    let llmResponse = "";
    let sentenceBuffer = "";
    const sentenceQueue = [];
    let processingQueue = false;

    const processSentenceQueue = async () => {
      if (processingQueue) return;
      processingQueue = true;
      try {
        while (sentenceQueue.length > 0) {
          const sentence = sentenceQueue.shift();
          if (!sentence) continue;
          try {
            console.log(`[Backend] Processing sentence for TTS: "${sentence}"`);
            const ttsAudioMp3 = await ttsWithElevenLabs({
              text: sentence,
              apiKey: ELEVENLABS_API_KEY,
              language: language,
            });

            if (MODE === 'audio-with-avatar') {
              const wavBuffer = await convertMp3ToWavPcm16kMono(ttsAudioMp3);
              await sendWavToGrpcClient(wavBuffer, 16000, "ws://localhost:8765");
              console.log('[Backend] Sent TTS audio for sentence to grpc_client.py');
            } else {
              // In 'audio' mode, send the MP3 directly to the frontend
              ws.send(JSON.stringify({ type: 'audio_chunk', chunk: ttsAudioMp3.toString('base64') }));
              console.log('[Backend] Sent TTS audio chunk to frontend');
            }
          } catch (err) {
            console.error('[Backend] Error in TTS or sending audio for sentence:', err);
          }
        }
      } finally {
        processingQueue = false;
      }
    };

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        llmResponse += content;
        sentenceBuffer += content;
        
        ws.send(JSON.stringify({ type: 'llm_chunk', chunk: llmResponse }));

        // Only extract and queue complete sentences during streaming
        const sentenceEndRegex = /(?<!\b(Mr|Mrs|Dr|Ms|Sr|Jr)\.)([.?!]|\.\.\.)\s/g;
        let match;
        let lastIndex = 0;
        while ((match = sentenceEndRegex.exec(sentenceBuffer)) !== null) {
          const sentence = sentenceBuffer.substring(lastIndex, match.index + match[0].length).trim();
          if (sentence) {
            sentenceQueue.push(sentence);
          }
          lastIndex = sentenceEndRegex.lastIndex;
        }
        // Only keep the incomplete part in the buffer
        sentenceBuffer = sentenceBuffer.slice(lastIndex);
      }
    }

    // After streaming, process any remaining sentence in the buffer
    const remainingSentence = sentenceBuffer.trim();
    if (remainingSentence) {
      sentenceQueue.push(remainingSentence);
    }
    // Start processing the queue once, after all sentences are queued
    if (!processingQueue) {
      processSentenceQueue();
    }

    ws.send(JSON.stringify({ type: 'llm_response_complete', response: llmResponse }));
    console.log('[Backend] LLM stream finished. Full response:', llmResponse);

  } catch (error) {
    console.error("[Backend] Error in handleLlmStream:", error);
    ws.send(JSON.stringify({ type: 'error', error: `LLM stream failed: ${error.message || 'An unknown error occurred.'}` }));
  }
};

// WebSocket for audio streaming
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  let lastAudioMimeType = null;
  let lastLanguage = 'en'; // Default to English

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

      // Handle mime type message (may include language)
      if (parsed && parsed.type === 'audio-mime' && parsed.mimeType) {
        lastAudioMimeType = parsed.mimeType;
        if (parsed.language && (parsed.language === 'en' || parsed.language === 'ar')) {
          lastLanguage = parsed.language;
        }
        console.log('[Backend] Received audio mimeType:', lastAudioMimeType, 'language:', lastLanguage);
        return;
      }

      // Handle text message (may include language)
      if (parsed && parsed.type === 'text' && parsed.prompt) {
        if (parsed.language && (parsed.language === 'en' || parsed.language === 'ar')) {
          lastLanguage = parsed.language;
        }
        console.log('[Backend] Handling text message:', parsed.prompt, 'language:', lastLanguage);
        await handleLlmStream(parsed.prompt, ws, lastLanguage);
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
                model: 'whisper',
                language: lastLanguage || 'en',
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

            // Generate and stream LLM response
            await handleLlmStream(transcript, ws, lastLanguage);

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
