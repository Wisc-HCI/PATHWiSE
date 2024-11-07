import websockets
import json
from vosk import Model, KaldiRecognizer
import base64
import os
import numpy as np
import logging
import time
from collections import deque
import asyncio
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Load Vosk model from cache
model_path = "vosk-model-small-en-us-0.15"
model_dir = os.path.join(os.path.expanduser("~"), ".cache", "vosk", model_path)

if not os.path.exists(model_dir):
    print("Downloading Vosk model...")
    from vosk import download_model
    download_model(model_path)

vosk_model = Model(model_dir)

# Load sentence transformer model
sentence_model = SentenceTransformer('all-MiniLM-L6-v2')

intent_categories = {
    "positive": [
        "Yes, I'd like to add more",
        "I have something else to say",
        "There's more I want to discuss",
        "I'm not finished yet",
        "I want to continue"
    ],
    "negative": [
        "No, I'm done",
        "That's all I have to say",
        "I'm finished",
        "Nothing more to add",
        "Let's move on"
    ],
    "uncertain": [
        "I'm not sure",
        "Maybe",
        "I might have something",
        "I need to think about it",
        "Give me a moment"
    ]
}

intent_embeddings = {
    category: sentence_model.encode(phrases) for category, phrases in intent_categories.items()
}

def classify_intent(text):
    text_embedding = sentence_model.encode([text])[0]
    similarities = {}
    for category, embeddings in intent_embeddings.items():
        category_similarity = cosine_similarity([text_embedding], embeddings)[0]
        similarities[category] = np.mean(category_similarity)
    return max(similarities, key=similarities.get)

# Base parameters
CALIBRATION_DURATION = 3.0  # Seconds to calibrate
CALIBRATION_MARGIN = 10  # dB above background noise
MIN_SILENCE_DURATION = 1.0
FRAME_DURATION = 0.025
BUFFER_SIZE = 15
MIN_AUDIO_SIZE = 2048
SPEECH_TIMEOUT = 3.0
SILENCE_RMS_WINDOW = 5

class AudioBuffer:
    def __init__(self, maxlen=BUFFER_SIZE):
        self.buffer = deque(maxlen=maxlen)
        self.current_size = 0
        self.last_speech_time = time.time()
        self.rms_values = deque(maxlen=SILENCE_RMS_WINDOW)
        self.silent_frames_count = 0
        self.background_db = None
        self.silence_threshold_db = None
        self.is_calibrated = False
        self.calibration_samples = []

    def add(self, audio_data):
        self.buffer.append(audio_data)
        self.current_size += len(audio_data)
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        rms = np.sqrt(np.mean(np.square(audio_array.astype(float))))
        self.rms_values.append(rms)
        if not self.is_calibrated:
            self.calibration_samples.append(rms)

    def calibrate(self):
        if len(self.calibration_samples) < 10:
            return False
        background_rms = np.mean(self.calibration_samples)
        self.background_db = 20 * np.log10(max(background_rms, 1e-10))
        self.silence_threshold_db = self.background_db + CALIBRATION_MARGIN
        logging.info(f"Background noise level: {self.background_db:.2f} dB")
        logging.info(f"Silence threshold set to: {self.silence_threshold_db:.2f} dB")
        self.is_calibrated = True
        self.calibration_samples = []
        return True

    def is_silent(self):
        if not self.is_calibrated or not self.rms_values:
            return False
        avg_rms = np.mean(self.rms_values)
        current_db = 20 * np.log10(max(avg_rms, 1e-10))
        return current_db < self.silence_threshold_db

    def get_and_clear(self):
        if self.current_size < MIN_AUDIO_SIZE:
            return None
        combined = np.concatenate([np.frombuffer(chunk, dtype=np.int16)
                                   for chunk in self.buffer])
        self.buffer.clear()
        self.current_size = 0
        return combined.tobytes()

async def nlp_server(websocket, path):
    print("Client connected")
    audio_buffer = AudioBuffer()
    last_transcript = ""
    silence_start_time = None
    is_speaking = False
    speech_detected = False
    calibration_start_time = None

    await websocket.send(json.dumps({
        'type': 'calibration_start',
        'message': 'Please remain silent for background noise calibration...'
    }))
    calibration_start_time = time.time()

    local_recognizer = KaldiRecognizer(vosk_model, 16000)

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                if data['type'] == 'classify_intent':
                    intent = classify_intent(data['text'])
                    await websocket.send(json.dumps({
                        'type': 'intent_classification',
                        'intent': intent
                    }))
                elif data['type'] == 'audio_data':
                    audio_bytes = base64.b64decode(data['audio'])
                    current_time = time.time()

                    if not audio_buffer.is_calibrated:
                        audio_buffer.add(audio_bytes)
                        if current_time - calibration_start_time >= CALIBRATION_DURATION:
                            if audio_buffer.calibrate():
                                await websocket.send(json.dumps({
                                    'type': 'calibration_complete',
                                    'background_db': audio_buffer.background_db,
                                    'threshold_db': audio_buffer.silence_threshold_db
                                }))
                            continue
                        continue

                    audio_buffer.add(audio_bytes)
                    is_silent = audio_buffer.is_silent()

                    combined_audio = audio_buffer.get_and_clear()
                    if combined_audio:
                        if local_recognizer.AcceptWaveform(combined_audio):
                            result = json.loads(local_recognizer.Result())
                            if result.get('text'):
                                current_text = result['text']
                                if current_text != last_transcript:
                                    logging.info(f"Recognized: {current_text}")
                                    await websocket.send(json.dumps({
                                        'type': 'speech_recognized',
                                        'result': {'text': current_text}
                                    }))
                                    last_transcript = current_text
                                is_speaking = True

                    if not is_silent:
                        if not speech_detected:
                            logging.info("Speech detected")
                            speech_detected = True
                            silence_start_time = None

                    if is_silent and is_speaking:
                        if silence_start_time is None:
                            silence_start_time = current_time
                        silence_duration = current_time - silence_start_time
                        if silence_duration >= MIN_SILENCE_DURATION:
                            logging.info(f"Silence detected after {silence_duration:.2f} seconds")
                            final_result = local_recognizer.FinalResult()
                            final_dict = json.loads(final_result)
                            if final_dict.get('text'):
                                logging.info(f"Recognized (final): {final_dict['text']}")
                                await websocket.send(json.dumps({
                                    'type': 'speech_recognized',
                                    'result': {'text': final_dict['text']}
                                }))

                            await websocket.send(json.dumps({
                                'type': 'silence_detected',
                                'duration': silence_duration
                            }))

                            speech_detected = False
                            is_speaking = False
                            local_recognizer = KaldiRecognizer(vosk_model, 16000)
                            last_transcript = ""
                            silence_start_time = None

            except Exception as e:
                logging.error(f"Error processing message: {e}")
                continue

    except websockets.exceptions.ConnectionClosed:
        logging.info("Client disconnected")
    except Exception as e:
        logging.error(f"Connection error: {e}")

if __name__ == "__main__":
    server = websockets.serve(nlp_server, "localhost", 8765)
    print("NLP Server started on ws://localhost:8765")
    asyncio.get_event_loop().run_until_complete(server)
    asyncio.get_event_loop().run_forever()