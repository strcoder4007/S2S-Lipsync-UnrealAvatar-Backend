# Frontend - S2S-Lipsync-UnrealAvatar

This is the React frontend for the speech-to-speech lipsync system, providing a chat interface for users to interact with an AI-powered avatar using text or voice.

## Project Overview

- Users can send text or record audio messages.
- The frontend communicates with the backend via WebSocket for real-time interaction.
- Supports both English and Arabic.
- Displays streaming LLM responses and transcripts in a chat UI.

## Full Architecture & Dataflow

```
[User]
   |
   |  (Text input / Audio recording)
   v
[React Frontend (this app)]
   |
   |  (WebSocket: audio/text)
   v
[Backend (Node.js/Express/WebSocket)]
   |
   |--[Audio]--> [Deepgram STT] --transcript-->
   |--[Text/Transcript]--> [OpenAI GPT-4] --response-->
   |--[LLM Sentence]--> [ElevenLabs TTS] --audio-->
   |--[gRPC Client (audio2face, Python)] --> [Unreal Engine Avatar]
```

- The frontend sends audio or text to the backend via WebSocket.
- Receives transcripts and streaming LLM responses from the backend.
- The backend handles all AI, TTS, and avatar animation logic (see backend/README.md for details).

## How to Run

### Prerequisites

- Node.js (v16+ recommended)
- The backend server running (see `../backend/README.md`)

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Start the development server

```bash
npm start
```

- The app will open at [http://localhost:3000](http://localhost:3000)
- Ensure the backend is running at `ws://localhost:8000/ws` for full functionality.

## File Structure

- `src/App.tsx` - Main chat UI and WebSocket logic.
- `src/` - React components, styles, and entry point.

## Customization

- You can change the backend WebSocket URL in `src/App.tsx` (`WS_URL` constant).
- The UI supports both English and Arabic (language selector in the chat header).

## Reference: Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

### Available Scripts

In the project directory, you can run:

- `npm start` - Runs the app in development mode.
- `npm test` - Launches the test runner.
- `npm run build` - Builds the app for production.
- `npm run eject` - Ejects the app for full configuration control.

See the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started) for more information.
