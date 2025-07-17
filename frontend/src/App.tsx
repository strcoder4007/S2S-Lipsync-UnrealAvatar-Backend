import React, { useRef, useState, useEffect } from 'react';
import './App.css';

type Message = {
  id: number;
  sender: 'user' | 'bot';
  type: 'text' | 'audio';
  content: string;
  audioUrl?: string;
  isStreaming?: boolean;
};

const WS_URL = 'ws://localhost:8000/ws';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [wsStatusText, setWsStatusText] = useState<string>('Connecting...');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Establish WebSocket connection
  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    setWs(socket);

    socket.onopen = () => {
      setWsStatus('connected');
      setWsStatusText('Connected');
    };

    socket.onerror = (err) => {
      console.error('[Frontend] WebSocket error:', err);
      setWsStatus('error');
      setWsStatusText('WebSocket error');
    };

    socket.onclose = () => {
      setWsStatus('closed');
      setWsStatusText('WebSocket connection closed');
    };

    return () => {
      socket.close();
    };
  }, []);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!ws) return;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        setMessages(prevMsgs => {
          const newMsgs = [...prevMsgs];
          const lastMsg = newMsgs[newMsgs.length - 1];

          if (data.type === 'llm_chunk') {
            if (lastMsg && lastMsg.sender === 'bot' && lastMsg.isStreaming) {
              lastMsg.content += data.chunk;
            }
            return newMsgs;
          }
          
          if (data.type === 'llm_response_complete') {
            if (lastMsg && lastMsg.sender === 'bot' && lastMsg.isStreaming) {
              lastMsg.content = data.response;
              lastMsg.isStreaming = false;
            }
            return newMsgs;
          }
          
          if (data.type === 'transcript') {
            newMsgs.push({
              id: Date.now(),
              sender: 'user',
              type: 'text',
              content: data.transcript,
            });
            // Add a placeholder for the bot's response
            newMsgs.push({
              id: Date.now() + 1,
              sender: 'bot',
              type: 'text',
              content: '',
              isStreaming: true,
            });
            return newMsgs;
          }

          if (data.type === 'error') {
            if (lastMsg && lastMsg.sender === 'bot' && lastMsg.isStreaming) {
              lastMsg.content = `Error: ${data.error}`;
              lastMsg.isStreaming = false;
            } else {
              newMsgs.push({
                id: Date.now(),
                sender: 'bot',
                type: 'text',
                content: `Error: ${data.error}`,
              });
            }
            return newMsgs;
          }

          return prevMsgs;
        });
      } catch (err) {
        console.error('[Frontend] Error parsing WebSocket message:', err);
      }
    };
  }, [ws]);

  // Send text to backend via WebSocket
  const sendTextToBackend = (text: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', prompt: text }));
    }
  };

  // Send audio to backend via WebSocket
  const sendAudioToBackend = (audioBlob: Blob) => {
    console.log('[Frontend] Sending audio to backend, size:', audioBlob.size, 'type:', audioBlob.type);
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Send mimeType first
      ws.send(JSON.stringify({ type: 'audio-mime', mimeType: audioBlob.type }));
      
      // Then send the audio data
      const reader = new FileReader();
      reader.onload = function () {
        if (reader.result && reader.result instanceof ArrayBuffer) {
          console.log('[Frontend] Sending audio buffer, size:', reader.result.byteLength);
          ws.send(reader.result);
        }
      };
      reader.readAsArrayBuffer(audioBlob);
    } else {
      console.error('[Frontend] WebSocket not open, cannot send audio');
    }
  };

  // Handle text input send
  const handleSend = () => {
    if (input.trim() === '') return;
    const userMsg: Message = {
      id: Date.now(),
      sender: 'user',
      type: 'text',
      content: input,
    };
    const botPlaceholder: Message = {
      id: Date.now() + 1,
      sender: 'bot',
      type: 'text',
      content: '',
      isStreaming: true,
    };
    setMessages((msgs) => [...msgs, userMsg, botPlaceholder]);
    sendTextToBackend(input);
    setInput('');
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  // Enhanced WAV encoder that handles actual audio data
  const encodeWAV = (audioBuffer: AudioBuffer): Blob => {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    // Get audio data
    const channelData = [];
    for (let i = 0; i < numChannels; i++) {
      channelData.push(audioBuffer.getChannelData(i));
    }

    // Interleave channels if stereo
    let samples: Float32Array;
    if (numChannels === 2) {
      samples = new Float32Array(audioBuffer.length * 2);
      for (let i = 0; i < audioBuffer.length; i++) {
        samples[i * 2] = channelData[0][i];
        samples[i * 2 + 1] = channelData[1][i];
      }
    } else {
      samples = channelData[0];
    }

    // Create buffer
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitDepth / 8, true);
    view.setUint16(32, numChannels * bitDepth / 8, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  // Handle audio recording
  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      console.log('[Frontend] Stopping recording');
      if (mediaRecorder) {
        mediaRecorder.stop();
      }
    } else {
      // Start recording
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Audio recording not supported in this browser.');
        return;
      }

      try {
        console.log('[Frontend] Starting recording');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          }
        });

        // Use a more compatible MIME type
        let mimeType = 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        } else {
          mimeType = ''; // Let browser decide
        }

        console.log('[Frontend] Using MediaRecorder mimeType:', mimeType);

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        setMediaRecorder(recorder);

        const audioChunks: Blob[] = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
            console.log('[Frontend] Audio chunk received, size:', event.data.size);
          }
        };

        recorder.onstop = async () => {
          console.log('[Frontend] Recording stopped, processing audio...');
          setIsRecording(false);
          
          // Stop all tracks to release microphone
          stream.getTracks().forEach(track => track.stop());

          if (audioChunks.length === 0) {
            console.error('[Frontend] No audio chunks received');
            return;
          }

          const audioBlob = new Blob(audioChunks, { type: recorder.mimeType });
          console.log('[Frontend] Created audio blob, size:', audioBlob.size, 'type:', audioBlob.type);

          if (audioBlob.size === 0) {
            console.error('[Frontend] Audio blob is empty');
            return;
          }

          // Send to backend
          sendAudioToBackend(audioBlob);
        };

        recorder.onerror = (event) => {
          console.error('[Frontend] MediaRecorder error:', event);
          setIsRecording(false);
        };

        recorder.start(1000); // Collect data every second
        setIsRecording(true);
        
      } catch (err) {
        console.error('[Frontend] Error starting recording:', err);
        alert('Could not start audio recording: ' + err);
      }
    }
  };

  return (
    <div className="chat-app">
      <div className="ws-status-bar">
        <span
          className="ws-status-indicator"
          style={{
            backgroundColor:
              wsStatus === 'connected'
                ? '#4caf50'
                : wsStatus === 'connecting'
                ? '#ffb300'
                : '#e53935',
          }}
        />
        <span className="ws-status-text">{wsStatusText}</span>
      </div>
      <div className="chat-header">
        <h2>Chat Assistant</h2>
      </div>
      <div className="chat-body">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-bubble ${msg.sender === 'user' ? 'user' : 'bot'}`}
          >
            {msg.type === 'text' ? (
              <span>{msg.content}</span>
            ) : (
              msg.audioUrl && (
                <div>
                  <div style={{ marginBottom: '8px' }}>🎤 {msg.content}</div>
                  <audio controls src={msg.audioUrl} style={{ width: '200px' }} />
                </div>
              )
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div className="chat-footer">
        <input
          type="text"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRecording}
        />
        <button
          className={`mic-btn${isRecording ? ' recording' : ''}`}
          onClick={handleMicClick}
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill={isRecording ? '#e53935' : '#fff'}
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2" stroke={isRecording ? '#e53935' : '#fff'} strokeWidth="2" fill="none" />
            <line x1="12" y1="22" x2="12" y2="18" stroke={isRecording ? '#e53935' : '#fff'} strokeWidth="2" />
            <line x1="8" y1="22" x2="16" y2="22" stroke={isRecording ? '#e53935' : '#fff'} strokeWidth="2" />
          </svg>
        </button>
        <button className="send-btn" onClick={handleSend} disabled={isRecording || input.trim() === ''}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="#fff"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block' }}
          >
            <path d="M3 20l18-8-18-8v7l13 1-13 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default App;
