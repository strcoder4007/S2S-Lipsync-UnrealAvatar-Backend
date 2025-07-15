import React, { useRef, useState } from 'react';
import './App.css';

type Message = {
  id: number;
  sender: 'user' | 'bot';
  type: 'text' | 'audio';
  content: string;
  audioUrl?: string;
};

const API_URL = 'http://localhost:8000/chat';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom on new message
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send text to backend
  const sendTextToBackend = async (text: string) => {
    const formData = new FormData();
    formData.append('prompt', text);
    try {
      const res = await fetch(`${API_URL}/text`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      return data.response || 'No response';
    } catch (e) {
      return 'Error contacting backend';
    }
  };

  // Send audio to backend
  const sendAudioToBackend = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    try {
      const res = await fetch(`${API_URL}/audio`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      return data;
    } catch (e) {
      return { error: 'Error contacting backend' };
    }
  };

  // Handle text input send
  const handleSend = async () => {
    if (input.trim() === '') return;
    const newMsg: Message = {
      id: Date.now(),
      sender: 'user',
      type: 'text',
      content: input,
    };
    setMessages((msgs) => [...msgs, newMsg]);
    setInput('');
    // Send to backend
    const botReply = await sendTextToBackend(input);
    setMessages((msgs) => [
      ...msgs,
      {
        id: Date.now() + 1,
        sender: 'bot',
        type: 'text',
        content: botReply,
      },
    ]);
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  // Handle audio recording
  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorder?.stop();
    } else {
      // Start recording
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Audio recording not supported in this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new window.MediaRecorder(stream);
        setMediaRecorder(recorder);
        setAudioChunks([]);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            setAudioChunks((chunks) => [...chunks, e.data]);
          }
        };
        recorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const audioUrl = URL.createObjectURL(audioBlob);
          const newMsg: Message = {
            id: Date.now(),
            sender: 'user',
            type: 'audio',
            content: '',
            audioUrl,
          };
          setMessages((msgs) => [...msgs, newMsg]);
          // Send to backend
          const data = await sendAudioToBackend(audioBlob);
          if (data.error) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: Date.now() + 1,
                sender: 'bot',
                type: 'text',
                content: data.error,
              },
            ]);
          } else {
            // Show transcript and response
            setMessages((msgs) => [
              ...msgs,
              {
                id: Date.now() + 2,
                sender: 'bot',
                type: 'text',
                content: `Transcript: ${data.transcript || ''}`,
              },
              {
                id: Date.now() + 3,
                sender: 'bot',
                type: 'text',
                content: data.response || '',
              },
            ]);
          }
        };
        recorder.start();
        setIsRecording(true);
        recorder.onstart = () => setIsRecording(true);
        recorder.onpause = () => setIsRecording(false);
        recorder.onresume = () => setIsRecording(true);
        recorder.onerror = () => setIsRecording(false);
        recorder.onstop = () => setIsRecording(false);
      } catch (err) {
        alert('Could not start audio recording.');
      }
    }
  };

  // Stop recording when mediaRecorder stops
  React.useEffect(() => {
    if (!mediaRecorder) return;
    const handleStop = () => setIsRecording(false);
    mediaRecorder.addEventListener('stop', handleStop);
    return () => {
      mediaRecorder.removeEventListener('stop', handleStop);
    };
  }, [mediaRecorder]);

  return (
    <div className="chat-app">
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
                <audio controls src={msg.audioUrl} style={{ width: '200px' }} />
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
          {/* Microphone SVG */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill={isRecording ? '#e53935' : '#333'}
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2" stroke={isRecording ? '#e53935' : '#333'} strokeWidth="2" fill="none" />
            <line x1="12" y1="22" x2="12" y2="18" stroke={isRecording ? '#e53935' : '#333'} strokeWidth="2" />
            <line x1="8" y1="22" x2="16" y2="22" stroke={isRecording ? '#e53935' : '#333'} strokeWidth="2" />
          </svg>
        </button>
        <button className="send-btn" onClick={handleSend} disabled={isRecording || input.trim() === ''}>
          Send
        </button>
      </div>
    </div>
  );
}

export default App;
