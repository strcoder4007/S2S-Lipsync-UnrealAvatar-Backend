from flask import Flask, request, jsonify
import os, io, requests, soundfile as sf, time, re

app = Flask(__name__)

A2F_REST_URL = "http://localhost:8011"
DEFAULT_PLAYER = os.environ.get("A2F_INSTANCE_NAME", "/World/audio2face/Player")
DEFAULT_DIR = os.environ.get("A2F_AUDIO_DIR", "C:/Users/mynam/Downloads/S2S-Lipsync-UnrealAvatar-Backend")

def get_sorted_audio_indices(directory):
    files = os.listdir(directory)
    return sorted(int(m.group(1)) for m in
                  (re.match(r"message_(\d+)\.wav$", f) for f in files)
                  if m)

@app.route('/push_audio', methods=['POST'])
def push_audio():
    # Determine payload type and save file
    if request.content_type.startswith('multipart/form-data'):
        audio_file = request.files.get('audio')
        if not audio_file:
            return jsonify({"error":"No audio file"}), 400
        instance = request.form.get('instance_name', DEFAULT_PLAYER)
        dir_path = request.form.get('dir_path', DEFAULT_DIR)
        index = request.form.get('index', '0')
        file_name = f"message_{index}.wav"
        save_path = os.path.join(dir_path, file_name)
        os.makedirs(dir_path, exist_ok=True)
        audio_file.save(save_path)

    elif request.is_json:
        data = request.get_json()
        audio_fpath = data.get('audio_fpath')
        instance = data.get('instance_name', DEFAULT_PLAYER)
        dir_path = data.get('dir_path', DEFAULT_DIR)
        index = data.get('index', '0')
        if not audio_fpath or not os.path.isfile(audio_fpath):
            return jsonify({"error":"Missing or invalid audio_fpath"}), 400
        file_name = f"message_{index}.wav"
        save_path = os.path.join(dir_path, file_name)
        os.makedirs(dir_path, exist_ok=True)
        with open(audio_fpath, 'rb') as src, open(save_path, 'wb') as dst:
            dst.write(src.read())
    else:
        return jsonify({"error":"Unsupported Content-Type"}), 415

    # Use a single requests.Session for all requests
    sess = requests.Session()

    # Disable looping before playing
    try:
        resp = sess.post(
            f"{A2F_REST_URL}/A2F/Player/SetLooping",
            json={"a2f_player": instance, "loop_audio": False},
            timeout=5
        )
        resp.raise_for_status()
    except Exception as e:
        return jsonify({"error": f"Failed SetLooping: {e}", "response": getattr(resp, 'text', None)}), 500

    # Play all messages >= index in order
    try:
        indices = get_sorted_audio_indices(dir_path)
        if not indices:
            return jsonify({"error":"No audio files found"}), 400

        start_i = int(index)
        play_results = []
        for i in indices:
            if i < start_i: continue
            fname = f"message_{i}.wav"
            fpath = os.path.join(dir_path, fname)

            # Set track
            st = sess.post(f"{A2F_REST_URL}/A2F/Player/SetTrack",
                           json={"a2f_player":instance,"file_name":fname,"time_range":[0,-1]}, timeout=5)
            st.raise_for_status()

            # Play
            pl = sess.post(f"{A2F_REST_URL}/A2F/Player/Play",
                           json={"a2f_player":instance,"file_name":fname}, timeout=5)
            pl.raise_for_status()

            # Sleep for duration - short padding
            with sf.SoundFile(fpath) as f:
                duration = len(f)/f.samplerate
            time.sleep(max(0, duration - 0.05))

            # Pause
            ps = sess.post(f"{A2F_REST_URL}/A2F/Player/Pause",
                           json={"a2f_player":instance}, timeout=5)
            ps.raise_for_status()

            play_results.append({
                "file":fname,
                "play":pl.json(),
                "pause":ps.json(),
                "duration":duration
            })

        return jsonify({
            "status":"success",
            "played":[r["file"] for r in play_results],
            "details":play_results,
            "dir":dir_path
        })

    except Exception as e:
        return jsonify({"error":f"Playback error: {e}"}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
