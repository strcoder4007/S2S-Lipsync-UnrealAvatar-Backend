# Backend - S2S-Lipsync-UnrealAvatar

This backend powers the speech-to-speech lipsync system, handling audio transcription, LLM response generation, text-to-speech, and real-time avatar animation via gRPC.

## Features

- Receives audio or text from the frontend via WebSocket.
- Converts audio to the required format and transcribes it using Deepgram.
- Streams the transcript and LLM (OpenAI GPT-4) responses back to the frontend.
- Converts LLM responses to speech using ElevenLabs TTS.
- Sends generated speech audio to the NVIDIA Audio2Face gRPC client for real-time avatar lipsync.
- Supports both English and Arabic.

## Architecture & Dataflow

```
[Frontend]
   |
   |  (WebSocket: audio/text)
   v
[Express + WebSocket Server (Node.js)]
   |
   |--[Audio]--> [FFmpeg] --convert--> [Deepgram API] --transcript-->
   |                                                    |
   |<------------------- transcript ---------------------|
   |
   |--[Transcript/Text]--> [OpenAI GPT-4] --response-->
   |                                      |
   |<----------- streamed LLM response ----|
   |
   |--[LLM Sentence]--> [ElevenLabs TTS] --MP3-->
   |                        |
   |                        v
   |                 [FFmpeg: MP3->WAV]
   |                        |
   |                        v
   |         [gRPC Client (audio2face, Python)] -- WebSocket -->
   |                        |
   |                 [Unreal Engine Avatar]
```

- Audio or text is sent from the frontend to the backend via WebSocket.
- Audio is converted to linear PCM and sent to Deepgram for transcription.
- The transcript is sent to the frontend and to OpenAI for LLM response.
- The LLM response is streamed back to the frontend and split into sentences.
- Each sentence is sent to ElevenLabs for TTS, converted to WAV, and sent to the audio2face gRPC client for avatar animation.

## How to Run

### Prerequisites

- Node.js (v16+ recommended)
- Python 3.8+ (for audio2face gRPC client)
- FFmpeg (ffmpeg-static is used, but system ffmpeg can be used if needed)
- Deepgram, ElevenLabs, and OpenAI API keys
- NVIDIA Audio2Face running with gRPC server enabled

### 1. Install Node.js dependencies

```bash
cd backend
npm install
```

### 2. Set up environment variables

Create a `.env` file in the `backend/` directory with the following:

```
DEEPGRAM_API_KEY=your_deepgram_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
OPENAI_API_KEY=your_openai_api_key
```

### 3. (Optional) Set up Python gRPC client

Install Python dependencies for audio2face:

```bash
cd audio2face
pip install -r requirements.txt
```

Start the gRPC client (ensure Audio2Face is running):

```bash
python grpc_client.py
```

### 4. Start the backend server

```bash
cd ..
node server.js
```

The backend will listen on `ws://localhost:8000/ws` for WebSocket connections.

## File Structure

- `server.js` - Main Express/WebSocket server, orchestrates all backend logic.
- `deepgram.js` - Handles Deepgram API integration for speech-to-text.
- `elevenlabs.js` - Handles ElevenLabs API integration for text-to-speech.
- `audio2face/` - Python gRPC client for sending audio to NVIDIA Audio2Face.

## API/Endpoints

- WebSocket endpoint: `ws://localhost:8000/ws`
  - Send audio (binary) or text (JSON) messages.
  - Receives transcripts, LLM responses, and error messages.

## WebSocket Usage with curl

You can use [curl](https://curl.se/) (version 7.86.0 or newer) to connect to the backend WebSocket, send audio or text, and receive responses. 

### Prerequisites

- curl 7.86.0+ (check with `curl --version`)
- The backend server running and listening on `ws://localhost:8000/ws`

### Send Audio (Binary) via WebSocket

```bash
curl --no-buffer --include \
  --header "Connection: Upgrade" \
  --header "Upgrade: websocket" \
  --header "Host: localhost:8000" \
  --header "Origin: http://localhost:8000" \
  --header "Sec-WebSocket-Key: SGVsbG9Xb3JsZA==" \
  --header "Sec-WebSocket-Version: 13" \
  --data-binary "@path/to/audio.wav" \
  "ws://localhost:8000/ws"
```

- Replace `@path/to/audio.wav` with the path to your audio file (must be in a supported format, e.g., WAV or MP3).
- The server will respond with transcript and LLM responses over the WebSocket.

### Send Text (JSON) via WebSocket

```bash
curl --no-buffer --include \
  --header "Connection: Upgrade" \
  --header "Upgrade: websocket" \
  --header "Host: localhost:8000" \
  --header "Origin: http://localhost:8000" \
  --header "Sec-WebSocket-Key: SGVsbG9Xb3JsZA==" \
  --header "Sec-WebSocket-Version: 13" \
  --header "Content-Type: application/json" \
  --data '{"text": "Hello, how are you?"}' \
  "ws://localhost:8000/ws"
```

- Replace the JSON payload as needed.

### Receiving Responses

- curl will print the server's responses to stdout as they arrive.
- Responses may include transcripts, LLM responses, and error messages in JSON format.

**Note:** For more advanced WebSocket interaction (e.g., full-duplex streaming), consider using tools like [websocat](https://github.com/vi/websocat) or a dedicated WebSocket client.

## Notes

- Ensure all API keys are valid and Audio2Face is running for full functionality.
- The backend is designed to be run locally for development and testing.
