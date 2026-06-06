import cv2
import threading
import time
import base64
import numpy as np
from deepface import DeepFace
import mediapipe as mp
import asyncio

# ------- PARAMETERS (tune these) -------
EYE_CONTACT_THRESH = 0.035   # threshold for simple head/eye alignment check
EMOTION_THROTTLE_SECONDS = 3.0 # Only analyze emotion every N seconds
LOOK_AWAY_NOTIFICATION_SECONDS = 8.0 # Notify if looked away for N continuous seconds
NOTIFICATION_COOLDOWN = 30.0 # Only notify once every 30 seconds
# ---------------------------------------

def landmarks_to_bbox(landmarks, w, h, pad=0.2):
    """Compute bounding box for face mesh landmarks with padding (normalized -> px)."""
    xs = [lm.x for lm in landmarks]
    ys = [lm.y for lm in landmarks]
    min_x = max(int((min(xs) - pad) * w), 0)
    max_x = min(int((max(xs) + pad) * w), w - 1)
    min_y = max(int((min(ys) - pad) * h), 0)
    max_y = min(int((max(ys) + pad) * h), h - 1)
    return min_x, min_y, max_x, max_y

def estimate_eye_contact(landmarks):
    """
    Simple heuristic: compare center of eyes vs nose x-position.
    Returns True if within threshold -> looking forward.
    """
    LEFT_EYE = [33, 133]    # outer/inner
    RIGHT_EYE = [362, 263]
    NOSE_TIP = 1

    left_x = (landmarks[LEFT_EYE[0]].x + landmarks[LEFT_EYE[1]].x) / 2.0
    right_x = (landmarks[RIGHT_EYE[0]].x + landmarks[RIGHT_EYE[1]].x) / 2.0
    nose_x = landmarks[NOSE_TIP].x

    center_eyes = (left_x + right_x) / 2.0
    diff = abs(center_eyes - nose_x)
    return diff < EYE_CONTACT_THRESH

class ComputerVisionAgent:
    def __init__(self):
        # Mediapipe setup
        try:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(refine_landmarks=True, max_num_faces=1)
        except Exception as e:
            print(f"Warning: Failed to initialize Mediapipe FaceMesh: {e}")
            self.face_mesh = None
        
        # State
        self.total_frames_processed = 0
        self.frames_with_face = 0
        self.frames_with_eye_contact = 0
        
        self.look_away_events = 0
        self.long_look_away_events = 0
        
        # Tracking look aways
        self.is_looking_away = False
        self.look_away_start_time = 0
        self.last_notification_time = 0
        
        # Emotion tracking
        self.dominant_emotions_count = {
            "happy": 0, "sad": 0, "angry": 0, "fear": 0, "surprise": 0, "neutral": 0, "disgust": 0
        }
        self.last_emotion_analysis_time = 0
        self.analyzing_emotion = False
        self.lock = threading.Lock()

    def decode_base64_frame(self, base64_string):
        img_data = base64.b64decode(base64_string)
        np_arr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return frame

    def analyze_emotion_thread(self, face_crop):
        try:
            with self.lock:
                self.analyzing_emotion = True
                
            res = DeepFace.analyze(face_crop, actions=['emotion'], enforce_detection=False, detector_backend='mediapipe')
            dominant_emotion = res[0].get('dominant_emotion')
            
            with self.lock:
                if dominant_emotion in self.dominant_emotions_count:
                    self.dominant_emotions_count[dominant_emotion] += 1
                else:
                    self.dominant_emotions_count[dominant_emotion] = 1
        except Exception as e:
            pass
        finally:
            with self.lock:
                self.analyzing_emotion = False

    async def process_frame(self, base64_image: str) -> bool:
        """
        Process a single frame.
        Returns True if a notification should be sent to the frontend.
        """
        try:
            if self.face_mesh is None:
                return False
            frame = self.decode_base64_frame(base64_image)
            if frame is None:
                return False
                
            self.total_frames_processed += 1
            now = time.time()
            
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(frame_rgb)
            
            face_present = False
            eye_contact_bool = False
            face_crop = None
            
            if results.multi_face_landmarks:
                face_present = True
                self.frames_with_face += 1
                face_landmarks = results.multi_face_landmarks[0].landmark
                ih, iw, _ = frame.shape
                
                try:
                    eye_contact_bool = estimate_eye_contact(face_landmarks)
                except Exception:
                    eye_contact_bool = False
                    
                if eye_contact_bool:
                    self.frames_with_eye_contact += 1
                    
                x1, y1, x2, y2 = landmarks_to_bbox(face_landmarks, iw, ih, pad=0.25)
                if x2 - x1 > 20 and y2 - y1 > 20:
                    face_crop = frame[y1:y2, x1:x2].copy()
                    
            # Look Away Logic
            # Consider "looking away" if face is missing or no eye contact
            looking_away_now = not face_present or not eye_contact_bool
            
            if looking_away_now and not self.is_looking_away:
                self.is_looking_away = True
                self.look_away_start_time = now
                self.look_away_events += 1
            elif not looking_away_now and self.is_looking_away:
                self.is_looking_away = False
                
            notify_frontend = False
            if self.is_looking_away:
                duration = now - self.look_away_start_time
                if duration >= LOOK_AWAY_NOTIFICATION_SECONDS:
                    if (now - self.last_notification_time) >= NOTIFICATION_COOLDOWN:
                        notify_frontend = True
                        self.last_notification_time = now
                        self.long_look_away_events += 1
                        
            # Emotion Analysis Trigger
            with self.lock:
                is_analyzing = self.analyzing_emotion
                
            if face_present and face_crop is not None and not is_analyzing:
                if (now - self.last_emotion_analysis_time) >= EMOTION_THROTTLE_SECONDS:
                    self.last_emotion_analysis_time = now
                    t = threading.Thread(target=self.analyze_emotion_thread, args=(face_crop,), daemon=True)
                    t.start()
                    
            return notify_frontend
            
        except Exception as e:
            print(f"CV Agent Error: {e}")
            return False

    def get_session_metrics(self):
        """Calculate and return final metrics for the session"""
        presence_percentage = (self.frames_with_face / self.total_frames_processed * 100) if self.total_frames_processed > 0 else 0
        eye_contact_percentage = (self.frames_with_eye_contact / self.total_frames_processed * 100) if self.total_frames_processed > 0 else 0
        engagement_percentage = (presence_percentage * 0.5) + (eye_contact_percentage * 0.5)
        
        # Calculate Confidence Score from emotions
        # Confident emotions: happy, neutral. Stress: fear, sad, angry, disgust.
        total_emotions = sum(self.dominant_emotions_count.values())
        if total_emotions > 0:
            confident_count = self.dominant_emotions_count.get("happy", 0) + self.dominant_emotions_count.get("neutral", 0)
            confidence_score = (confident_count / total_emotions) * 100
        else:
            confidence_score = 50.0 # default neutral

        # Calculate base 100-scale scores for DB
        eye_contact_score = eye_contact_percentage
        attentiveness_score = presence_percentage
        engagement_score = engagement_percentage
        
        return {
            "eye_contact_score": round(eye_contact_score, 2),
            "attentiveness_score": round(attentiveness_score, 2),
            "engagement_score": round(engagement_score, 2),
            "confidence_score": round(confidence_score, 2),
            "eye_contact_percentage": round(eye_contact_percentage, 2),
            "presence_percentage": round(presence_percentage, 2),
            "engagement_percentage": round(engagement_percentage, 2),
            "look_away_events": self.look_away_events,
            "long_look_away_events": self.long_look_away_events,
            "dominant_emotions": self.dominant_emotions_count,
            "total_frames_processed": self.total_frames_processed
        }
