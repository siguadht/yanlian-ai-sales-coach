import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]  # .../backend
PROJECT_DIR = BACKEND_DIR.parent  # 项目根目录

load_dotenv(PROJECT_DIR / ".env")


class Settings:
    def __init__(self) -> None:
        self.llm_base_url = os.getenv("LLM_BASE_URL", "").strip()
        self.llm_api_key = os.getenv("LLM_API_KEY", "").strip()
        self.llm_dialog_model = os.getenv("LLM_DIALOG_MODEL", "glm-5.3-flash").strip()
        self.llm_eval_model = os.getenv("LLM_EVAL_MODEL", "glm-5.3-flash").strip()
        self.llm_timeout = float(os.getenv("LLM_TIMEOUT", "180"))
        self.llm_max_retries = int(os.getenv("LLM_MAX_RETRIES", "2"))
        self.llm_reasoning_effort = os.getenv("LLM_REASONING_EFFORT", "low")
        self.database_url = os.getenv(
            "DATABASE_URL", f"sqlite:///{PROJECT_DIR / 'data' / 'app.db'}"
        )
        self.public_auth_enabled = os.getenv("PUBLIC_AUTH_ENABLED", "false").lower() == "true"
        self.auth_secret = os.getenv("AUTH_SECRET", "").strip()
        self.invite_codes = tuple(code.strip() for code in os.getenv("INVITE_CODES", "").split(",") if code.strip())
        self.public_ws_origin = os.getenv("PUBLIC_WS_ORIGIN", "").strip().rstrip("/")
        # 阿里云智能语音交互
        self.aliyun_access_key_id = os.getenv("ALIYUN_ACCESS_KEY_ID", "").strip()
        self.aliyun_access_key_secret = os.getenv("ALIYUN_ACCESS_KEY_SECRET", "").strip()
        self.aliyun_asr_appkey = os.getenv("ALIYUN_ASR_APP_KEY", "").strip()
        self.aliyun_tts_appkey = os.getenv("ALIYUN_TTS_APP_KEY", "").strip()
        self.aliyun_region = os.getenv("ALIYUN_REGION", "cn-shanghai").strip()
        self.aliyun_tts_voice = os.getenv("ALIYUN_TTS_VOICE", "siyue").strip()
        # 仅替换播报 TTS；麦克风 ASR 仍用已有阿里云链路。
        self.tts_provider = os.getenv("TTS_PROVIDER", "aliyun").strip().lower()
        self.doubao_tts_api_key = os.getenv("DOUBAO_TTS_API_KEY", "").strip()
        self.doubao_tts_voice = os.getenv(
            "DOUBAO_TTS_VOICE", "zh_female_vv_uranus_bigtts"
        ).strip()
        (PROJECT_DIR / "data").mkdir(exist_ok=True)


settings = Settings()
