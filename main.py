import asyncio
import websockets
import sounddevice as sd
import queue
import os
import json
import time
from dotenv import load_dotenv
from elevenlabs import stream, set_api_key
from openai import AsyncOpenAI

load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

set_api_key(ELEVENLABS_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

SAMPLE_RATE = 16000
CHANNELS = 1

async def microphone_stream():
    q = queue.Queue()
    def callback(indata, frames, time, status):
        q.put(indata.copy())

    stream_in = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype='int16',
        blocksize=1024,
        callback=callback
    )
    stream_in.start()
    try:
        loop = asyncio.get_running_loop()
        while True:
            data = await loop.run_in_executor(None, q.get)
            if data is not None:
                audio_bytes = data.tobytes()
                if audio_bytes:
                    yield audio_bytes
    finally:
        stream_in.stop()

async def transcribe_and_chat():
    uri = (
        "wss://api.deepgram.com/v1/listen"
        "?punctuate=true"
        "&language=en-US"
        "&encoding=linear16"
        f"&sample_rate={SAMPLE_RATE}"
    )
    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    async with websockets.connect(uri, extra_headers=headers) as ws:
        mic_ready_time = None

        async def keep_alive():
            while True:
                await asyncio.sleep(5)
                await ws.send(json.dumps({"type": "KeepAlive"}))

        async def send_audio():
            async for chunk in microphone_stream():
                await ws.send(chunk)

        async def receive_transcript():
            nonlocal mic_ready_time
            print("Listening...")
            mic_ready_time = time.monotonic()  # Start timer when mic is ready to listen
            while True:
                msg = await ws.recv()
                end_deepgram = time.monotonic()
                data = json.loads(msg)
                transcript = (
                    data.get("channel", {})
                        .get("alternatives", [{}])[0]
                        .get("transcript")
                )
                if transcript:
                    if mic_ready_time is not None:
                        deepgram_latency = end_deepgram - mic_ready_time
                        print(f"[TRANSCRIPT] {transcript}")
                        print(f"[LATENCY] Deepgram latency: {deepgram_latency:.3f} seconds")
                    else:
                        print(f"[TRANSCRIPT] {transcript}")
                        print("[WARNING] mic_ready_time was not set for Deepgram latency.")
                    mic_ready_time = time.monotonic()  # Reset timer for next utterance
                    await generate_response(transcript)

        await asyncio.gather(keep_alive(), send_audio(), receive_transcript())

from elevenlabs import generate
import sounddevice as sd
import numpy as np
import io
import tempfile
import subprocess
import wave

import re

async def generate_response(prompt):
    print("Thinking…")
    # Add instruction for max 100 words to the prompt
    prompt_with_limit = f"{prompt}\n\nPlease answer in no more than 2/3 sentences and 150 words."
    # Start timer for LLM latency (time to first token)
    start_llm = time.monotonic()
    response = await openai_client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt_with_limit}],
        stream=True,
        max_tokens=300
    )

    # --- Sentence segmentation function ---
    def split_sentences(text):
        # List of abbreviations to protect
        abbreviations = [
            "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "St.", "vs.", "etc.", "e.g.", "i.e.",
            "Fig.", "No.", "pp.", "Inc.", "Ltd.", "Co.", "Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.",
            "Aug.", "Sep.", "Sept.", "Oct.", "Nov.", "Dec."
        ]
        # Protect abbreviations by replacing the period with a special token
        ABBR_TOKEN = "<ABBR_DOT>"
        for abbr in abbreviations:
            text = text.replace(abbr, abbr.replace(".", ABBR_TOKEN))
        # Protect numbers like "3." (digit followed by period)
        text = re.sub(r"(\d)\.", r"\1<NUM_DOT>", text)
        # Split at sentence-ending punctuation followed by whitespace (or end of string)
        sentences = re.split(r'(?<=[.?!])\s+', text)
        # Restore abbreviations and numbers
        sentences = [s.replace(ABBR_TOKEN, ".").replace("<NUM_DOT>", ".") for s in sentences]
        # Remove empty
        return [s for s in sentences if s.strip()]
    # --- End sentence segmentation ---

    # Streaming LLM output, buffer sentences, send to TTS as soon as a sentence is complete
    buffer = ""
    audio_queue = []
    first_token_time = None
    full = ""
    import threading

    # Helper: Play audio in sequence
    def play_audio_sequence(audio_queue):
        for audio_array, samplerate in audio_queue:
            sd.play(audio_array, samplerate=samplerate)
            sd.wait()

    # Helper: Convert MP3 bytes to numpy array (same as before)
    def mp3_bytes_to_audio_array(full_audio):
        try:
            from pydub import AudioSegment
            audio_segment = AudioSegment.from_mp3(io.BytesIO(full_audio))
            audio_array = np.array(audio_segment.get_array_of_samples())
            if audio_segment.channels == 2:
                audio_array = audio_array.reshape((-1, 2))
                audio_array = audio_array.mean(axis=1)
            audio_array = audio_array.astype(np.float32)
            if np.max(np.abs(audio_array)) > 0:
                audio_array = audio_array / np.max(np.abs(audio_array)) * 0.8
            samplerate = audio_segment.frame_rate
            return audio_array, samplerate
        except ImportError:
            pass
        except Exception:
            pass
        # Fallbacks omitted for brevity (reuse from previous code if needed)
        return None, None

    print_buffer = ""
    async for event in response:  # Fixed: Changed from 'for' to 'async for'
        part = event.choices[0].delta.content or ""
        if first_token_time is None:
            first_token_time = time.monotonic()
            llm_first_token_latency = first_token_time - start_llm
            print(f"\n[LATENCY] LLM latency (time to first token): {llm_first_token_latency:.3f} seconds")
        print(part, end="", flush=True)
        print_buffer += part
        buffer += part
        full += part

        # Try to split sentences from buffer
        sentences = split_sentences(buffer)
        # If at least one complete sentence, process all except last (which may be incomplete)
        if len(sentences) > 1:
            for sent in sentences[:-1]:
                sentence = sent.strip()
                if not sentence:
                    continue
                # Send to ElevenLabs, get audio, append to queue
                try:
                    audio_stream = generate(
                        text=sentence,
                        voice="56AoDkrOh6qfVPDXZ7Pt",
                        model="eleven_flash_v2_5",
                        stream=True,
                        api_key=ELEVENLABS_API_KEY
                    )
                    audio_chunks = []
                    for chunk in audio_stream:
                        if chunk and len(chunk) > 0:
                            audio_chunks.append(chunk)
                    if audio_chunks:
                        full_audio = b''.join(audio_chunks)
                        audio_array, samplerate = mp3_bytes_to_audio_array(full_audio)
                        if audio_array is not None:
                            audio_queue.append((audio_array, samplerate))
                except Exception as e:
                    print(f"[ERROR] TTS generation error for sentence: {e}")
            # Keep the last (possibly incomplete) sentence in buffer
            buffer = sentences[-1]

    # After streaming, process any remaining buffer as a sentence
    last_sentence = buffer.strip()
    if last_sentence:
        try:
            audio_stream = generate(
                text=last_sentence,
                voice="56AoDkrOh6qfVPDXZ7Pt",
                model="eleven_flash_v2_5",
                stream=True,
                api_key=ELEVENLABS_API_KEY
            )
            audio_chunks = []
            for chunk in audio_stream:
                if chunk and len(chunk) > 0:
                    audio_chunks.append(chunk)
            if audio_chunks:
                full_audio = b''.join(audio_chunks)
                audio_array, samplerate = mp3_bytes_to_audio_array(full_audio)
                if audio_array is not None:
                    audio_queue.append((audio_array, samplerate))
        except Exception as e:
            print(f"[ERROR] TTS generation error for last sentence: {e}")

    # Optionally, keep total LLM latency (full response)
    end_llm = time.monotonic()
    llm_total_latency = end_llm - start_llm
    print(f"\n[LATENCY] LLM latency (full response): {llm_total_latency:.3f} seconds")

    print("\nSpeaking…")
    # Play all audios in sequence
    if audio_queue:
        play_audio_sequence(audio_queue)
        print(f"[DEBUG] Audio playback completed")
    else:
        print("[WARNING] No audio chunks received")

if __name__ == "__main__":
    asyncio.run(transcribe_and_chat())
