import pyaudio
import grpc
import audio2face_pb2, audio2face_pb2_grpc
 
# Setup Audio2Face gRPC connection
channel = grpc.insecure_channel("localhost:50051")
stub = audio2face_pb2_grpc.Audio2FaceStub(channel)
 
# Setup microphone stream
pa = pyaudio.PyAudio()
stream = pa.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=1024)
 
while True:
    data = stream.read(1024)
    msg = audio2face_pb2.PushAudioRequest(
        instance_name="/World/audio2face/PlayerStreaming",
        samplerate=16000,
        audio_data=data,
        block_until_playback_is_finished=False
    )
    response = stub.PushAudio(msg)
    print(response)
