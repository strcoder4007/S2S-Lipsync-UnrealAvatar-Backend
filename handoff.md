# S2S-Lipsync-UnrealAvatar-Backend - Project Handoff

## 1. Project Overview

**S2S-Lipsync-UnrealAvatar-Backend** is a speech-to-speech lipsync system using Unreal Engine avatars. It synchronizes generated audio with 3D avatar lip movements.

### Purpose
- Generate audio from text (TTS)
- Create lipsync data for Unreal Engine avatars
- Real-time avatar animation

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js / Express |
| **Frontend** | Node.js (served static) |
| **Avatar** | Unreal Engine |
| **TTS** | External API (configurable) |
| **Lipsync** | Custom algorithm |
| **PM2** | Process management |

---

## 3. File Structure

```
S2S-Lipsync-UnrealAvatar-Backend/
├── backend/               # Express API server
├── frontend/              # Frontend client
├── images/                # Avatar images/assets
├── docker-compose.yml     # Docker setup
├── ecosystem.config.js    # PM2 config
└── trigger.bat           # Windows trigger script
```

---

## 4. Running the Project

### With PM2
```bash
cd ~/Projects/S2S-Lipsync-UnrealAvatar-Backend
pm2 start ecosystem.config.js
```

### With Docker
```bash
docker-compose up
```

---

## 5. Key Components

- **backend/** - API endpoints for TTS and lipsync generation
- **frontend/** - Client UI for controlling avatar
- **trigger.bat** - Windows launch script

---

## 6. What a New Agent Needs to Know

- Check backend/ for API logic
- frontend/ contains the control interface
- ecosystem.config.js defines the PM2 process structure

---

*Generated: February 21, 2026*
