import asyncio
import websockets
import numpy as np
import soundfile as sf
import io
import time
import audio2face_pb2
import audio2face_pb2_grpc
import grpc
import json # For parsing the header

A2F_GRPC_URL = "localhost:50051"
INSTANCE_NAME = "/World/audio2face/PlayerStreaming"

# Global queue for audio data (audio_data, samplerate, websocket_id_for_logging)
audio_queue = asyncio.Queue()

# Counter and lock for unique WebSocket connection IDs for logging
websocket_counter = 0
websocket_counter_lock = asyncio.Lock()

async def audio_processor():
    """
    Continuously processes audio from the queue and sends it to Audio2Face.
    Ensures sequential playback.
    """
    print("Audio processor worker started.")
    while True:
        try:
            audio_data, samplerate, ws_id = await audio_queue.get()
            print(f"[Processor WS-{ws_id}] Got audio from queue. Shape: {audio_data.shape}, Samplerate: {samplerate}")

            chunk_size = int(samplerate // 10)  # 0.1s per chunk
            sleep_between_chunks = 0.04  # Original value from user's code
            block_until_playback_is_finished = True

            def grpc_stream_generator():
                # First message: start_marker
                start_marker = audio2face_pb2.PushAudioRequestStart(
                    instance_name=INSTANCE_NAME,
                    samplerate=int(samplerate),
                    block_until_playback_is_finished=block_until_playback_is_finished
                )
                yield audio2face_pb2.PushAudioStreamRequest(start_marker=start_marker)
                
                # Then send PCM chunks
                total_samples = len(audio_data)
                for i in range(0, total_samples, chunk_size):
                    chunk = audio_data[i:i+chunk_size]
                    yield audio2face_pb2.PushAudioStreamRequest(audio_data=chunk.astype(np.float32).tobytes())
                    # This sleep paces the data transfer to Audio2Face.
                    # Since this worker is dedicated, time.sleep() is acceptable here,
                    # as the gRPC call itself is blocking when block_until_playback_is_finished=True.
                    time.sleep(sleep_between_chunks)
                print(f"[Processor WS-{ws_id}] Finished yielding all chunks to gRPC.")

            try:
                with grpc.insecure_channel(A2F_GRPC_URL) as channel:
                    stub = audio2face_pb2_grpc.Audio2FaceStub(channel)
                    print(f"[Processor WS-{ws_id}] Starting gRPC PushAudioStream to Audio2Face...")
                    response = stub.PushAudioStream(grpc_stream_generator())
                    print(f"[Processor WS-{ws_id}] Audio2Face gRPC streaming response: Success={response.success}, Message='{response.message}'")
            except Exception as e:
                print(f"[Processor WS-{ws_id}] Failed to stream audio to Audio2Face: {e}")
            finally:
                audio_queue.task_done() # Signal that the item from the queue is processed
                print(f"[Processor WS-{ws_id}] Task done.")
        except asyncio.CancelledError:
            print("[Processor] Audio processor task cancelled.")
            break # Exit loop if cancelled
        except Exception as e:
            print(f"[Processor] Error in audio_processor loop: {e}")
            # If an error occurs before task_done() for a dequeued item, ensure it's called.
            # This might be complex if the error is before item retrieval.
            # For simplicity, we assume task_done is reached or cancellation handles it.
            # If an item was retrieved but processing failed mid-way, ensure task_done.
            if 'ws_id' in locals() and audio_queue.unfinished_tasks > 0 : # Check if ws_id is defined (item was dequeued)
                 # This check is a bit heuristic; robust error handling might need more state.
                 print(f"[Processor WS-{ws_id}] Ensuring task_done due to error during processing.")
                 audio_queue.task_done()


async def handle_audio_stream(websocket, path):
    global websocket_counter
    async with websocket_counter_lock:
        ws_id = websocket_counter
        websocket_counter += 1
    
    print(f"WebSocket client WS-{ws_id} connected.")
    samplerate = None

    try:
        # Expect the first message to be a JSON header with sample rate info
        header_message = await websocket.recv()
        if not isinstance(header_message, str): # JSON header should be a string
            print(f"[WS-{ws_id}] [ERROR] Expected JSON header (string) as first message, got {type(header_message)}.")
            await websocket.close()
            return
        
        try:
            header_data = json.loads(header_message)
            samplerate = int(header_data.get("sample_rate", 16000)) # Default if not provided
            print(f"[WS-{ws_id}] Received stream header: samplerate={samplerate}")
        except json.JSONDecodeError:
            print(f"[WS-{ws_id}] [ERROR] Failed to parse JSON header: {header_message}")
            await websocket.close()
            return

        # Receive the full WAV buffer from the WebSocket
        audio_buffer = bytearray()
        while True:
            message = await websocket.recv()
            if isinstance(message, bytes):
                audio_buffer.extend(message)
            elif isinstance(message, str) and message.upper() == "END":
                print(f"[WS-{ws_id}] Received END signal from client.")
                break
            else:
                print(f"[WS-{ws_id}] [WARN] Received unexpected message type or content: {type(message)} - '{message[:50]}...'")


        if not audio_buffer:
            print(f"[WS-{ws_id}] [WARN] Received empty audio buffer. Nothing to process.")
            return
            
        print(f"[WS-{ws_id}] Received {len(audio_buffer)} bytes of audio data. Decoding WAV...")

        # Decode WAV to float32 PCM
        try:
            audio_io = io.BytesIO(audio_buffer)
            with sf.SoundFile(audio_io, 'r') as sf_file:
                audio_data_raw = sf_file.read(dtype="float32")
                # Validate samplerate from header against file, prioritize header.
                if sf_file.samplerate != samplerate:
                    print(f"[WS-{ws_id}] [WARN] Samplerate mismatch: Header={samplerate}, File={sf_file.samplerate}. Using header rate.")
            print(f"[WS-{ws_id}] Decoded audio: shape={audio_data_raw.shape}, samplerate from header={samplerate}")
        except Exception as e:
            print(f"[WS-{ws_id}] Failed to decode WAV: {e}")
            return

        # Only mono audio is supported by Audio2Face typically
        if len(audio_data_raw.shape) > 1:
            audio_data_mono = np.average(audio_data_raw, axis=1)
            print(f"[WS-{ws_id}] Audio converted to mono.")
        else:
            audio_data_mono = audio_data_raw

        # Put the processed audio data and samplerate into the queue
        await audio_queue.put((audio_data_mono, samplerate, ws_id))
        print(f"[WS-{ws_id}] Audio data added to the processing queue.")

    except websockets.exceptions.ConnectionClosed:
        print(f"[WS-{ws_id}] Connection closed normally by client.")
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"[WS-{ws_id}] Connection closed with error: {e}")
    except websockets.exceptions.ConnectionClosedOK:
        print(f"[WS-{ws_id}] Connection closed OK by client.")
    except Exception as e:
        print(f"[WS-{ws_id}] Unexpected error in handle_audio_stream: {e}")
    finally:
        print(f"[WS-{ws_id}] Client disconnected.")
        # WebSocket is automatically closed when handler exits or due to `async with websockets.serve`

async def main():
    print("Starting WebSocket audio stream server on ws://0.0.0.0:8765")
    
    # Start the single audio processor worker task
    processor_task = asyncio.create_task(audio_processor())
    
    server_instance = await websockets.serve(handle_audio_stream, "0.0.0.0", 8765, max_size=None, max_queue=None)
    
    try:
        await asyncio.Future()  # Run forever until a signal (like KeyboardInterrupt)
    except KeyboardInterrupt:
        print("\nKeyboardInterrupt received. Shutting down server...")
    except asyncio.CancelledError:
        print("\nMain task cancelled. Shutting down server...") # e.g. if run in a larger app
    finally:
        print("Initiating shutdown sequence...")
        # 1. Stop accepting new connections
        server_instance.close()
        print("WebSocket server stopped accepting new connections.")
        await server_instance.wait_closed()
        print("WebSocket server fully closed.")

        # 2. Signal the processor task to stop and wait for it to finish processing queued items
        #    or just cancel it if immediate shutdown is preferred.
        #    For graceful shutdown, one might wait for audio_queue.join() before cancelling.
        #    For now, direct cancellation:
        if not processor_task.done():
            processor_task.cancel()
            try:
                await processor_task
            except asyncio.CancelledError:
                print("Audio processor task successfully cancelled.")
            except Exception as e:
                print(f"Error during processor task cleanup: {e}")
        
        # Wait for the queue to be fully processed (optional, for graceful shutdown)
        # print("Waiting for audio queue to empty...")
        # await audio_queue.join() # This ensures all task_done() calls have happened
        # print("Audio queue empty.")

        print("Shutdown complete.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # This is handled in main's finally block now, but good to have top-level catch.
        print("Application terminated by user.")
    except Exception as e:
        print(f"Unhandled exception at top level: {e}")
