# -*- coding: utf-8 -*-
"""
worker.py — Moteur backend du SaaS Video Studio (100 % local).

Pipeline complet :
    1. Script      : Ollama (Mistral / Llama3) -> JSON structure (scenes)
    2. Voix        : XTTSv2 (Coqui) avec clonage a partir d'un echantillon
    3. Images      : Stable Diffusion (diffusers) en format vertical
    4. Sous-titres : Whisper (word timestamps) -> fichier .ass anime
    5. Mixage      : FFmpeg (voix + musique auto-duckee via sidechaincompress + SFX)
    6. Rendu       : 1080x1920, H.264 / AAC, pret pour Shorts / TikTok / Reels

Le module est utilisable de deux facons :

  * en bibliotheque  : `from worker import create_job, run_job`
  * en sous-processus : `python worker.py --job <job_id>`

C'est ce second mode qu'utilise `app.py` : Streamlit relance son script a
chaque interaction, un thread serait donc fragile. Le worker ecrit sa
progression dans `data/jobs/<id>.json`, que l'UI relit en boucle. Bonus :
les modeles IA (plusieurs Go de VRAM) sont liberes a la fin du process.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

# ---------------------------------------------------------------------------
# Chemins & constantes
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
JOBS_DIR = DATA_DIR / "jobs"
WORK_DIR = DATA_DIR / "work"
OUTPUT_DIR = BASE_DIR / "output"
ASSETS_DIR = BASE_DIR / "assets"
MUSIC_DIR = ASSETS_DIR / "music"
SFX_DIR = ASSETS_DIR / "sfx"
VOICES_DIR = ASSETS_DIR / "voices"

for _directory in (JOBS_DIR, WORK_DIR, OUTPUT_DIR, MUSIC_DIR, SFX_DIR, VOICES_DIR):
    _directory.mkdir(parents=True, exist_ok=True)

VIDEO_W, VIDEO_H = 1080, 1920
FPS = 30
# Les images sont generees plus grandes que le cadre final : le zoompan de
# FFmpeg pioche dedans pour l'effet Ken Burns sans crenelage.
RENDER_W, RENDER_H = VIDEO_W * 2, VIDEO_H * 2

# Conserve pour compatibilite ; l'adresse fait foi dans LLM_PROVIDERS["ollama"].
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_PENDING_REVIEW = "pending_review"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_PUBLISHED = "published"
STATUS_FAILED = "failed"

# Cache process-local : un modele charge une seule fois par execution.
_MODEL_CACHE: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Parametres d'un job
# ---------------------------------------------------------------------------


@dataclass
class JobSettings:
    """Tous les reglages exposes dans l'onglet "Studio IA & Actus"."""

    # --- Contenu ---
    topic: str = ""
    context: str = ""            # resume de l'actu source (optionnel)
    source_url: str = ""
    language: str = "fr"
    tone: str = "punchy et intriguant"
    n_scenes: int = 6
    words_per_scene: int = 22

    # --- Modele de langage (voir LLM_PROVIDERS) ---
    llm_provider: str = "ollama"
    llm_model: str = ""          # vide => premier modele connu du fournisseur
    llm_base_url: str = ""       # vide => adresse par defaut du fournisseur
    llm_temperature: float = 0.85
    # Conserve pour relire les jobs crees avant l'ajout des autres fournisseurs.
    ollama_model: str = ""

    # --- XTTSv2 ---
    tts_model: str = "tts_models/multilingual/multi-dataset/xtts_v2"
    voice_sample: str = ""       # wav 6-20 s ; vide => voix par defaut du modele
    tts_speed: float = 1.05

    # --- Stable Diffusion ---
    sd_model: str = "stabilityai/stable-diffusion-xl-base-1.0"
    sd_steps: int = 28
    sd_guidance: float = 6.5
    sd_width: int = 832
    sd_height: int = 1216
    sd_style: str = "cinematic, dramatic lighting, ultra detailed, 8k, depth of field"
    sd_negative: str = "text, watermark, logo, blurry, lowres, deformed, extra limbs"
    seed: int = -1               # -1 => aleatoire

    # --- Moteur visuel (voir VIDEO_ENGINES) ---
    video_engine: str = "stills"
    video_model: str = ""        # vide => modele par defaut du moteur
    animated_scenes: int = 1     # 0 = toutes ; 1 = le hook seulement (Wan est lent)
    wan_steps: int = 30
    wan_guidance: float = 5.0

    # --- Whisper / sous-titres ---
    whisper_model: str = "small"
    subtitles: bool = True
    subtitle_color: str = "&H00FFFFFF"      # blanc (format ASS : &HAABBGGRR)
    subtitle_highlight: str = "&H0000D7FF"  # jaune/or
    subtitle_size: int = 78
    words_per_caption: int = 3

    # --- Audio / musique ---
    music_track: str = ""        # nom de fichier dans assets/music
    music_volume_db: float = -18.0
    ducking: bool = True
    ducking_threshold: float = 0.045
    ducking_ratio: float = 9.0
    ducking_release: int = 350   # ms

    # --- Bruitages ---
    sfx_enabled: bool = True
    sfx_volume_db: float = -12.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def __post_init__(self) -> None:
        if self.llm_provider not in LLM_PROVIDERS:
            self.llm_provider = DEFAULT_PROVIDER
        if self.video_engine not in VIDEO_ENGINES:
            self.video_engine = DEFAULT_VIDEO_ENGINE
        if not self.llm_model:
            # Migration des anciens jobs (ollama_model faisait office de
            # llm_model), puis repli sur le premier modele connu.
            fallbacks = LLM_PROVIDERS[self.llm_provider].fallback_models
            self.llm_model = self.ollama_model or (fallbacks[0] if fallbacks else "")

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "JobSettings":
        data = data or {}
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})


# ---------------------------------------------------------------------------
# Persistance des jobs (JSON sur disque, ecriture atomique)
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def save_job(job: dict[str, Any]) -> dict[str, Any]:
    """Ecrit le job de facon atomique (tmp + os.replace) : l'UI lit en //."""
    job["updated_at"] = _now()
    path = job_path(job["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return job


def load_job(job_id: str) -> dict[str, Any] | None:
    path = job_path(job_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # Lecture pendant une ecriture : on laisse l'appelant re-essayer.
        return None


def list_jobs(status: str | list[str] | None = None) -> list[dict[str, Any]]:
    """Liste les jobs, du plus recent au plus ancien, filtres par statut."""
    wanted = [status] if isinstance(status, str) else status
    jobs: list[dict[str, Any]] = []
    for path in JOBS_DIR.glob("*.json"):
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if wanted and job.get("status") not in wanted:
            continue
        jobs.append(job)
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


def update_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    job = load_job(job_id)
    if job is None:
        return None
    job.update(fields)
    return save_job(job)


def create_job(settings: JobSettings, title_hint: str = "") -> dict[str, Any]:
    """Cree un job en statut `queued` et retourne son dictionnaire."""
    job_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    job = {
        "id": job_id,
        "created_at": _now(),
        "updated_at": _now(),
        "status": STATUS_QUEUED,
        "title_hint": title_hint or settings.topic,
        "settings": settings.to_dict(),
        "progress": {"step": "En attente", "pct": 0, "message": ""},
        "script": None,
        "video_path": None,
        "duration": None,
        "error": None,
        "publish": {"title": "", "description": "", "tags": [], "video_id": None},
    }
    return save_job(job)


def delete_job(job_id: str, remove_files: bool = True) -> None:
    """Supprime le job, ses fichiers de travail et sa video."""
    job = load_job(job_id)
    if remove_files and job:
        video = job.get("video_path")
        if video and Path(video).exists():
            Path(video).unlink(missing_ok=True)
    shutil.rmtree(WORK_DIR / job_id, ignore_errors=True)
    job_path(job_id).unlink(missing_ok=True)


class _Progress:
    """Petit helper qui pousse l'avancement dans le JSON du job."""

    def __init__(self, job_id: str, callback: Callable[[str, int, str], None] | None = None):
        self.job_id = job_id
        self.callback = callback

    def __call__(self, step: str, pct: int, message: str = "") -> None:
        update_job(self.job_id, progress={"step": step, "pct": int(pct), "message": message})
        if self.callback:
            self.callback(step, int(pct), message)
        print(f"[{pct:3d}%] {step} {('- ' + message) if message else ''}", flush=True)


# ---------------------------------------------------------------------------
# Utilitaires FFmpeg
# ---------------------------------------------------------------------------


def ffmpeg_bin(name: str = "ffmpeg") -> str:
    """
    Localise ffmpeg / ffprobe : variable d'env, dossier ./bin (mode portable),
    puis PATH. Leve une erreur explicite plutot qu'un obscur FileNotFoundError.
    """
    env_key = f"{name.upper()}_BINARY"
    if os.environ.get(env_key):
        return os.environ[env_key]
    local = BASE_DIR / "bin" / (f"{name}.exe" if os.name == "nt" else name)
    if local.exists():
        return str(local)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError(
        f"{name} est introuvable. Installez FFmpeg puis ajoutez-le au PATH, "
        f"ou deposez {name}.exe dans le dossier 'bin' a cote de app.py."
    )


def run_ffmpeg(args: list[str], cwd: Path | None = None) -> None:
    """Execute FFmpeg en silencieux ; remonte les 25 dernieres lignes si echec."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *args]
    proc = subprocess.run(
        cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-25:])
        raise RuntimeError(f"FFmpeg a echoue (code {proc.returncode}) :\n{tail}")


def media_duration(path: str | Path) -> float:
    """Duree d'un media en secondes (via ffprobe)."""
    proc = subprocess.run(
        [ffmpeg_bin("ffprobe"), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(proc.stdout.strip())
    except ValueError:
        raise RuntimeError(f"Impossible de lire la duree de {path}")


# ---------------------------------------------------------------------------
# Fournisseurs de LLM
#
# Le Studio n'est pas lie a Ollama : chaque fournisseur ci-dessous expose la
# meme operation, "rends-moi un objet JSON". Un fournisseur = une entree du
# registre LLM_PROVIDERS, ce qui rend l'ajout d'un nouveau moteur trivial.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LLMProvider:
    """Description d'un moteur de generation de texte."""

    key: str
    label: str
    kind: str                    # ollama | openai | anthropic | gemini
    base_url: str = ""
    env_var: str = ""            # variable d'environnement portant la cle
    local: bool = False          # tourne sur la machine, aucune cle requise
    editable_url: bool = False   # l'utilisateur peut changer l'adresse
    fallback_models: tuple[str, ...] = ()
    hint: str = ""
    free_tier: str = ""          # ce que le palier gratuit autorise
    signup_url: str = ""         # ou obtenir la cle, gratuitement
    models_url: str = ""         # si le listing n'est pas a {base}/models
    free_only_marker: str = ""   # ne garder que les modeles contenant ce texte
    # Familles a preselectionner, par ordre de preference. Ce sont des
    # fragments, pas des identifiants exacts : les noms varient d'un hebergeur
    # a l'autre (qwen3:8b, qwen/qwen3-...:free, qwen-3-32b...).
    recommended_models: tuple[str, ...] = ()

    @property
    def needs_key(self) -> bool:
        return not self.local


# L'ordre du dictionnaire est celui de la liste deroulante : d'abord ce qui
# tourne chez vous sans limite, ensuite les services a quota gratuit.
#
# Regle de ce registre : aucun fournisseur payant. OpenAI et Anthropic n'ont
# pas de palier gratuit, ils n'y figurent donc pas. Les quotas ci-dessous
# changent regulierement : ils sont indicatifs, l'app n'en depend pas.
LLM_PROVIDERS: dict[str, LLMProvider] = {
    "ollama": LLMProvider(
        key="ollama", label="🖥️ Ollama (local)", kind="ollama",
        base_url=OLLAMA_URL, local=True, editable_url=True,
        fallback_models=("qwen3:8b", "qwen3:14b", "mistral", "llama3"),
        recommended_models=("qwen3", "mistral", "llama3"),
        free_tier="Gratuit et illimite — tourne sur votre machine",
        signup_url="https://ollama.com",
        hint="Demarrez 'ollama serve' puis installez un modele : "
             "ollama pull qwen3:8b (8 Go de VRAM) ou qwen3:14b (16 Go).",
    ),
    "lmstudio": LLMProvider(
        key="lmstudio", label="🖥️ LM Studio / serveur compatible OpenAI (local)",
        kind="openai", base_url="http://127.0.0.1:1234/v1",
        local=True, editable_url=True,
        free_tier="Gratuit et illimite — tourne sur votre machine",
        signup_url="https://lmstudio.ai",
        hint="Fonctionne avec LM Studio, llama.cpp, vLLM, Jan... "
             "Adaptez l'adresse si besoin.",
    ),
    "google": LLMProvider(
        key="google", label="☁️ Google Gemini (gratuit)", kind="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        env_var="GEMINI_API_KEY",
        free_tier="Palier gratuit sans carte bancaire, quotas par minute et par jour",
        signup_url="https://aistudio.google.com/apikey",
        hint="Cle gratuite sur aistudio.google.com (Google AI Studio).",
    ),
    "groq": LLMProvider(
        key="groq", label="☁️ Groq (gratuit, tres rapide)", kind="openai",
        base_url="https://api.groq.com/openai/v1", env_var="GROQ_API_KEY",
        free_tier="Palier gratuit sans carte bancaire, limite en requetes par minute",
        signup_url="https://console.groq.com/keys",
        hint="Cle gratuite sur console.groq.com. Modeles ouverts, debit tres eleve.",
        recommended_models=("qwen", "llama", "gpt-oss"),
    ),
    "cerebras": LLMProvider(
        key="cerebras", label="☁️ Cerebras (gratuit)", kind="openai",
        base_url="https://api.cerebras.ai/v1", env_var="CEREBRAS_API_KEY",
        free_tier="Palier gratuit sans carte bancaire, quota de jetons par jour",
        signup_url="https://cloud.cerebras.ai",
        hint="Cle gratuite sur cloud.cerebras.ai.",
        recommended_models=("qwen", "llama"),
    ),
    "mistral": LLMProvider(
        key="mistral", label="☁️ Mistral AI (gratuit)", kind="openai",
        base_url="https://api.mistral.ai/v1", env_var="MISTRAL_API_KEY",
        free_tier="Palier gratuit (offre 'Experiment'), quotas par minute",
        signup_url="https://console.mistral.ai/api-keys",
        hint="Cle gratuite sur console.mistral.ai. Bon francais.",
    ),
    "openrouter": LLMProvider(
        key="openrouter", label="☁️ OpenRouter — modeles gratuits uniquement",
        kind="openai", base_url="https://openrouter.ai/api/v1",
        env_var="OPENROUTER_API_KEY", free_only_marker=":free",
        free_tier="Seuls les modeles suffixes ':free' sont proposes : "
                  "facturation impossible",
        signup_url="https://openrouter.ai/keys",
        hint="Cle gratuite sur openrouter.ai. La liste est filtree sur les "
             "modeles gratuits, les modeles payants du catalogue sont masques.",
        recommended_models=("qwen", "kimi", "deepseek", "llama"),
    ),
    "github": LLMProvider(
        key="github", label="☁️ GitHub Models (gratuit)", kind="openai",
        base_url="https://models.github.ai/inference",
        models_url="https://models.github.ai/catalog/models",
        env_var="GITHUB_TOKEN",
        free_tier="Gratuit pour tout compte GitHub, quotas par minute et par jour",
        signup_url="https://github.com/settings/personal-access-tokens",
        hint="Jeton d'acces personnel GitHub avec la permission 'models:read'.",
        recommended_models=("qwen", "llama", "phi"),
    ),
    "openai_compatible": LLMProvider(
        key="openai_compatible", label="🔌 Autre API compatible OpenAI",
        kind="openai", base_url="", env_var="LLM_API_KEY", editable_url=True,
        free_tier="Depend du service que vous indiquez",
        hint="Pour brancher un autre service : indiquez son adresse de base "
             "et sa cle. Verifiez vous-meme ses conditions tarifaires.",
    ),
}

DEFAULT_PROVIDER = "ollama"
LLM_TIMEOUT_LOCAL = 900    # un modele local sur CPU peut etre tres lent
LLM_TIMEOUT_CLOUD = 180

# Les cles API ne transitent JAMAIS par le JSON d'un job : ce fichier reste le
# seul endroit ou elles sont ecrites, en plus des variables d'environnement.
KEYS_FILE = DATA_DIR / "llm_keys.json"


def get_provider(key: str) -> LLMProvider:
    return LLM_PROVIDERS.get(key) or LLM_PROVIDERS[DEFAULT_PROVIDER]


def _read_keys() -> dict[str, str]:
    if not KEYS_FILE.exists():
        return {}
    try:
        return json.loads(KEYS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def get_api_key(provider_key: str) -> str:
    """
    Cle du fournisseur : variable d'environnement d'abord, fichier ensuite.

    L'environnement est prioritaire pour qu'une cle d'entreprise definie au
    niveau du systeme ne soit jamais masquee par une saisie dans l'interface.
    """
    provider = get_provider(provider_key)
    if provider.local:
        return ""
    if provider.env_var and os.environ.get(provider.env_var):
        return os.environ[provider.env_var].strip()
    return str(_read_keys().get(provider.key, "")).strip()


def set_api_key(provider_key: str, value: str) -> None:
    """Enregistre (ou efface, si vide) la cle d'un fournisseur."""
    keys = _read_keys()
    value = (value or "").strip()
    if value:
        keys[provider_key] = value
    else:
        keys.pop(provider_key, None)
    KEYS_FILE.write_text(json.dumps(keys, indent=2), encoding="utf-8")
    try:
        os.chmod(KEYS_FILE, 0o600)  # sans effet sous Windows, utile ailleurs
    except OSError:
        pass


def provider_base_url(settings: "JobSettings") -> str:
    """Adresse a interroger : celle du job si renseignee, sinon celle du registre."""
    provider = get_provider(settings.llm_provider)
    return (settings.llm_base_url or provider.base_url).rstrip("/")


# --- Listing des modeles ----------------------------------------------------


def keep_free_models(provider: LLMProvider, models: list[str]) -> list[str]:
    """
    Restreint la liste aux modeles gratuits quand le fournisseur en melange.

    OpenRouter, par exemple, expose un catalogue mixte : seuls les
    identifiants suffixes ':free' sont sans facturation possible. Filtrer ici
    plutot que dans l'interface garantit qu'aucun modele payant ne peut etre
    selectionne, meme par un job cree en ligne de commande.
    """
    if not provider.free_only_marker:
        return models
    return [m for m in models if provider.free_only_marker in m]


def filter_models(query: str, models: list[str]) -> list[str]:
    """Filtre la liste sur un fragment saisi par l'utilisateur (ex : "qwen")."""
    query = (query or "").strip().lower()
    if not query:
        return models
    return [m for m in models if query in m.lower()]


def preferred_model(provider: LLMProvider, models: list[str]) -> str:
    """
    Modele a preselectionner parmi ceux reellement disponibles.

    On compare par fragment : le meme modele s'appelle "qwen3:8b" chez Ollama
    et "qwen/qwen3-30b-a3b:free" chez OpenRouter.
    """
    for wanted in provider.recommended_models:
        for model in models:
            if wanted in model.lower():
                return model
    return models[0] if models else ""


def list_llm_models(provider_key: str, base_url: str = "") -> list[str]:
    """
    Modeles disponibles chez un fournisseur, pour alimenter la liste deroulante.

    Retourne une liste vide si le service est injoignable ou la cle absente :
    l'interface bascule alors sur une saisie libre plutot que d'echouer.
    """
    provider = get_provider(provider_key)
    url = (base_url or provider.base_url).rstrip("/")
    key = get_api_key(provider.key)

    try:
        if provider.kind == "ollama":
            response = requests.get(f"{url}/api/tags", timeout=5)
            response.raise_for_status()
            return sorted(m["name"] for m in response.json().get("models", []))

        if provider.kind == "openai":
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            response = requests.get(provider.models_url or f"{url}/models",
                                    headers=headers, timeout=10)
            response.raise_for_status()
            body = response.json()
            # {"data": [...]} chez la plupart, tableau nu chez GitHub Models.
            entries = body.get("data", body) if isinstance(body, dict) else body
            ids = [m["id"] for m in entries if isinstance(m, dict) and m.get("id")]
            return keep_free_models(provider, sorted(ids))

        if provider.kind == "gemini":
            if not key:
                return []
            response = requests.get(f"{url}/models", params={"key": key}, timeout=10)
            response.raise_for_status()
            return sorted(
                m["name"].removeprefix("models/")
                for m in response.json().get("models", [])
                if "generateContent" in m.get("supportedGenerationMethods", [])
            )
    except Exception:  # service eteint, cle invalide, reseau coupe...
        return list(provider.fallback_models)

    return list(provider.fallback_models)


# --- Construction des requetes (fonctions pures, donc testables) ------------


def build_ollama_payload(settings: "JobSettings", system: str, prompt: str) -> dict[str, Any]:
    return {
        "model": settings.llm_model,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "format": "json",  # Ollama contraint alors la sortie a du JSON valide
        "options": {"temperature": settings.llm_temperature, "num_predict": 1600},
    }


def build_openai_payload(settings: "JobSettings", system: str, prompt: str) -> dict[str, Any]:
    return {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": settings.llm_temperature,
        "response_format": {"type": "json_object"},
    }


def build_gemini_payload(settings: "JobSettings", system: str, prompt: str) -> dict[str, Any]:
    return {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": settings.llm_temperature,
            "responseMimeType": "application/json",
        },
    }


# --- Appels ----------------------------------------------------------------


def _call_ollama(settings: "JobSettings", system: str, prompt: str) -> str:
    url = provider_base_url(settings)
    response = requests.post(
        f"{url}/api/generate", json=build_ollama_payload(settings, system, prompt),
        timeout=LLM_TIMEOUT_LOCAL,
    )
    response.raise_for_status()
    return response.json().get("response", "")


def _call_openai(settings: "JobSettings", system: str, prompt: str) -> str:
    provider = get_provider(settings.llm_provider)
    url = provider_base_url(settings)
    key = get_api_key(provider.key)
    if provider.needs_key and not key:
        raise RuntimeError(_missing_key_message(provider))

    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload = build_openai_payload(settings, system, prompt)
    timeout = LLM_TIMEOUT_LOCAL if provider.local else LLM_TIMEOUT_CLOUD

    response = requests.post(f"{url}/chat/completions", json=payload,
                             headers=headers, timeout=timeout)
    if response.status_code == 400 and "response_format" in response.text:
        # Beaucoup de serveurs locaux ignorent le mode JSON : on reessaie sans,
        # le prompt systeme et l'extracteur tolerant prennent le relais.
        payload.pop("response_format", None)
        response = requests.post(f"{url}/chat/completions", json=payload,
                                 headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _call_gemini(settings: "JobSettings", system: str, prompt: str) -> str:
    provider = get_provider(settings.llm_provider)
    key = get_api_key(provider.key)
    if not key:
        raise RuntimeError(_missing_key_message(provider))

    url = f"{provider_base_url(settings)}/models/{settings.llm_model}:generateContent"
    response = requests.post(
        url, params={"key": key}, json=build_gemini_payload(settings, system, prompt),
        timeout=LLM_TIMEOUT_CLOUD,
    )
    response.raise_for_status()
    candidates = response.json().get("candidates", [])
    if not candidates:
        raise RuntimeError("Gemini n'a retourne aucune reponse (filtre de securite ?).")
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(part.get("text", "") for part in parts)


_LLM_DISPATCH: dict[str, Callable[["JobSettings", str, str], str]] = {
    "ollama": _call_ollama,
    "openai": _call_openai,
    "gemini": _call_gemini,
}


def _missing_key_message(provider: LLMProvider) -> str:
    return (
        f"Aucune cle API pour {provider.label}. Renseignez-la dans "
        f"l'onglet Studio IA (section Fournisseur) ou definissez la variable "
        f"d'environnement {provider.env_var}."
    )


def llm_complete(settings: "JobSettings", system: str, prompt: str) -> str:
    """Interroge le fournisseur choisi et retourne le texte brut produit."""
    provider = get_provider(settings.llm_provider)
    if not settings.llm_model:
        raise RuntimeError(f"Aucun modele selectionne pour {provider.label}.")
    return _LLM_DISPATCH[provider.kind](settings, system, prompt)


def llm_status(provider_key: str, base_url: str = "") -> tuple[bool, str]:
    """(disponible, message) — utilise par le diagnostic et par l'interface."""
    provider = get_provider(provider_key)
    if provider.needs_key and not get_api_key(provider.key):
        return False, f"cle absente ({provider.env_var})"
    models = list_llm_models(provider_key, base_url)
    if not models:
        return False, "injoignable ou aucun modele disponible"
    return True, f"{len(models)} modele(s) disponible(s)"


# ---------------------------------------------------------------------------
# Moteurs visuels
#
# Par defaut, une image fixe par scene animee par un zoom lent (Ken Burns) :
# c'est rapide et tourne sur n'importe quelle machine. Wan 2.2 (Alibaba,
# Apache 2.0) genere de vrais clips animes en local — l'equivalent libre le
# plus proche de Veo 3 / Kling, qui restent des API payantes sans palier
# gratuit et n'ont donc pas leur place ici. Le cout de Wan se paie en temps
# de calcul, pas en dollars : quelques minutes par clip sur une carte recente.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VideoEngine:
    """Moteur produisant les visuels de chaque scene."""

    key: str
    label: str
    kind: str                       # stills | wan
    model_id: str = ""
    min_vram_gb: int = 0
    seconds_per_clip: int = 4
    hint: str = ""


VIDEO_ENGINES: dict[str, VideoEngine] = {
    "stills": VideoEngine(
        key="stills",
        label="🖼️ Images Stable Diffusion + Ken Burns (rapide)",
        kind="stills",
        hint="Une image fixe par scene, animee par un zoom lent. "
             "Le plus rapide, tourne sur n'importe quelle machine.",
    ),
    "wan": VideoEngine(
        key="wan",
        label="🎬 Wan 2.2 — video generee en local (gratuit, lent)",
        kind="wan",
        model_id="Wan-AI/Wan2.2-TI2V-5B-Diffusers",
        min_vram_gb=8,
        seconds_per_clip=4,
        hint="Genere de vrais clips animes (mouvement de camera et de "
             "sujet), pas un simple zoom sur une image fixe. Gratuit et "
             "illimite — le cout se paie en temps de calcul : quelques "
             "minutes par scene sur une carte recente, avec repli CPU sur "
             "8 Go de VRAM. C'est l'equivalent local le plus proche de "
             "services comme Veo ou Kling, qui restent payants sans palier "
             "gratuit et ne sont donc pas proposes ici.",
    ),
}

DEFAULT_VIDEO_ENGINE = "stills"


def get_video_engine(key: str) -> VideoEngine:
    return VIDEO_ENGINES.get(key) or VIDEO_ENGINES[DEFAULT_VIDEO_ENGINE]


def scenes_to_animate(settings: "JobSettings", n_scenes: int) -> list[int]:
    """
    Index des scenes confiees au moteur video genere.

    `animated_scenes = 0` anime tout ; une valeur N n'anime que les N
    premieres. Wan etant lent (plusieurs minutes par clip), c'est le levier
    principal pour garder un temps de rendu raisonnable : le hook est la
    seule scene qui decide vraiment de la retention, animer la suite coute
    du temps de calcul pour un gain marginal.
    """
    engine = get_video_engine(settings.video_engine)
    if engine.kind == "stills":
        return []
    if settings.animated_scenes <= 0:
        return list(range(n_scenes))
    return list(range(min(settings.animated_scenes, n_scenes)))


def estimate_video_render_minutes(settings: "JobSettings", n_scenes: int) -> float:
    """Estimation grossiere du temps de rendu supplementaire, pour l'UI."""
    engine = get_video_engine(settings.video_engine)
    if engine.kind != "wan":
        return 0.0
    # Tres approximatif : quelques minutes par clip sur une carte recente.
    minutes_per_clip = 4.5
    return round(len(scenes_to_animate(settings, n_scenes)) * minutes_per_clip, 1)


# ---------------------------------------------------------------------------
# Etape 1 — Script (LLM)
# ---------------------------------------------------------------------------

SCRIPT_SYSTEM_PROMPT = """Tu es un scenariste expert en videos courtes virales (YouTube Shorts, TikTok, Reels).
Tu ecris des scripts "faceless" : une voix off raconte, des images illustrent.

REGLES ABSOLUES :
- La toute premiere phrase est un HOOK qui doit stopper le scroll en moins de 2 secondes.
- Une seule idee par scene, phrases courtes, vocabulaire simple, present de narration.
- Aucune mention de "dans cette video", "abonnez-vous" au milieu, aucun emoji dans la narration.
- La derniere scene se termine par une question ouverte ou une chute qui donne envie de commenter.
- Le champ image_prompt est en ANGLAIS, purement visuel, sans texte ni logo, sans nom de personne reelle.
- Le champ sfx est un mot-cle simple parmi : whoosh, impact, riser, click, boom, ambient, page, sparkle.

Tu reponds UNIQUEMENT avec un objet JSON valide, sans commentaire ni bloc de code."""

SCRIPT_USER_TEMPLATE = """Sujet : {topic}
{context_block}
Langue de la narration : {language}
Ton : {tone}
Nombre de scenes : {n_scenes}
Longueur cible par scene : environ {words} mots.

Reponds avec ce schema JSON exact :
{{
  "title": "titre YouTube accrocheur, moins de 70 caracteres",
  "description": "2 a 3 phrases de description",
  "hashtags": ["#exemple", "#shorts"],
  "scenes": [
    {{"narration": "texte lu par la voix off",
      "image_prompt": "english visual description",
      "sfx": "whoosh"}}
  ]
}}"""


def _extract_json(raw: str) -> dict[str, Any]:
    """Recupere le premier objet JSON d'une reponse LLM (robuste au bavardage)."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    if start == -1:
        raise ValueError("Aucun JSON trouve dans la reponse du modele.")
    depth, in_string, escaped = 0, False, False
    for i, char in enumerate(raw[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return json.loads(raw[start : i + 1])
    raise ValueError("JSON incomplet dans la reponse du modele.")


def ollama_available() -> bool:
    """Raccourci historique : Ollama repond-il ?"""
    return llm_status("ollama")[0]


def list_ollama_models() -> list[str]:
    """Raccourci historique : modeles installes dans Ollama."""
    return list_llm_models("ollama")


def generate_script(settings: JobSettings, retries: int = 2) -> dict[str, Any]:
    """
    Demande un script au fournisseur choisi et retourne un script normalise.

    Le prompt et le post-traitement sont identiques quel que soit le moteur :
    seul l'appel reseau change (voir llm_complete).
    """
    context_block = ""
    if settings.context:
        context_block = (
            "Contexte factuel a respecter (ne rien inventer qui le contredise) :\n"
            f"{settings.context}\n"
        )

    prompt = SCRIPT_USER_TEMPLATE.format(
        topic=settings.topic,
        context_block=context_block,
        language=settings.language,
        tone=settings.tone,
        n_scenes=settings.n_scenes,
        words=settings.words_per_scene,
    )

    provider = get_provider(settings.llm_provider)
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        try:
            raw = llm_complete(settings, SCRIPT_SYSTEM_PROMPT, prompt)
            return _normalize_script(_extract_json(raw), settings)
        except RuntimeError:
            # Cle manquante, refus du modele... : reessayer n'y changera rien.
            raise
        except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
        except Exception as exc:  # erreurs propres au SDK d'un fournisseur
            last_error = exc
            time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(
        f"{provider.label} n'a pas produit de script exploitable apres "
        f"{retries + 1} tentatives ({last_error}). Modele demande : "
        f"'{settings.llm_model}'. {provider.hint}"
    )


_ALLOWED_SFX = {"whoosh", "impact", "riser", "click", "boom", "ambient", "page", "sparkle"}


def _normalize_script(data: dict[str, Any], settings: JobSettings) -> dict[str, Any]:
    """Valide / repare la sortie du LLM pour que le pipeline ne casse jamais."""
    scenes_raw = data.get("scenes") or []
    if not isinstance(scenes_raw, list) or not scenes_raw:
        raise ValueError("Le script retourne ne contient aucune scene.")

    scenes: list[dict[str, str]] = []
    for index, scene in enumerate(scenes_raw[: settings.n_scenes]):
        if isinstance(scene, str):
            scene = {"narration": scene}
        narration = str(scene.get("narration") or scene.get("text") or "").strip()
        if not narration:
            continue
        image_prompt = str(scene.get("image_prompt") or scene.get("visual") or "").strip()
        if not image_prompt:
            image_prompt = f"cinematic illustration about {settings.topic}"
        sfx = str(scene.get("sfx") or "").strip().lower()
        scenes.append(
            {
                "narration": narration,
                "image_prompt": f"{image_prompt}, {settings.sd_style}",
                "sfx": sfx if sfx in _ALLOWED_SFX else "whoosh",
                "index": index,
            }
        )

    if not scenes:
        raise ValueError("Toutes les scenes du script sont vides.")

    hashtags = data.get("hashtags") or ["#shorts"]
    if isinstance(hashtags, str):
        hashtags = [h.strip() for h in hashtags.split() if h.strip()]

    return {
        "title": str(data.get("title") or settings.topic)[:95],
        "description": str(data.get("description") or ""),
        "hashtags": [h if h.startswith("#") else f"#{h}" for h in hashtags][:8],
        "scenes": scenes,
        "full_text": " ".join(s["narration"] for s in scenes),
    }


# ---------------------------------------------------------------------------
# Etape 2 — Voix off avec XTTSv2 (Coqui)
# ---------------------------------------------------------------------------

DEFAULT_XTTS_SPEAKER = "Ana Florence"  # voix interne si aucun echantillon fourni
SCENE_GAP = 0.18  # respiration entre deux scenes (secondes)


def _load_tts(settings: JobSettings):
    """Charge XTTSv2 une seule fois par process (2 a 3 Go de VRAM)."""
    key = f"tts::{settings.tts_model}"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    # Evite le prompt interactif d'acceptation de licence Coqui.
    os.environ.setdefault("COQUI_TOS_AGREED", "1")
    import torch  # import tardif : ~5 s de chargement
    from TTS.api import TTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tts = TTS(settings.tts_model).to(device)
    _MODEL_CACHE[key] = tts
    return tts


def _normalize_wav(src: Path, dst: Path) -> None:
    """Ramene un wav en 48 kHz stereo pour que la concatenation soit sure."""
    run_ffmpeg(["-i", str(src), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(dst)])


def synthesize_voice(
    scenes: list[dict[str, Any]], workdir: Path, settings: JobSettings,
    progress: _Progress | None = None,
) -> tuple[Path, list[tuple[float, float]]]:
    """
    Genere la voix off scene par scene puis assemble la piste complete.

    Retourne (chemin_voix, temps_de_debut_de_chaque_scene). Les timings
    servent ensuite au calage des images et des bruitages.
    """
    tts = _load_tts(settings)
    voice_dir = workdir / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)

    speaker_wav = settings.voice_sample or ""
    if speaker_wav and not Path(speaker_wav).exists():
        candidate = VOICES_DIR / speaker_wav
        speaker_wav = str(candidate) if candidate.exists() else ""

    kwargs: dict[str, Any] = {"language": settings.language, "speed": settings.tts_speed}
    if speaker_wav:
        kwargs["speaker_wav"] = speaker_wav
    else:
        kwargs["speaker"] = DEFAULT_XTTS_SPEAKER

    durations: list[float] = []
    normalized: list[Path] = []

    for index, scene in enumerate(scenes):
        raw = voice_dir / f"scene_{index:02d}_raw.wav"
        clean = voice_dir / f"scene_{index:02d}.wav"
        tts.tts_to_file(text=scene["narration"], file_path=str(raw), **kwargs)
        _normalize_wav(raw, clean)
        durations.append(media_duration(clean))
        normalized.append(clean)
        if progress:
            pct = 20 + int(15 * (index + 1) / len(scenes))
            progress("Voix off (XTTSv2)", pct, f"scene {index + 1}/{len(scenes)}")

    # Silence de respiration insere entre les scenes.
    silence = voice_dir / "gap.wav"
    run_ffmpeg([
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", f"{SCENE_GAP}", "-c:a", "pcm_s16le", str(silence),
    ])

    concat_list = voice_dir / "concat.txt"
    lines: list[str] = []
    for index, path in enumerate(normalized):
        lines.append(f"file '{path.name}'")
        if index < len(normalized) - 1:
            lines.append(f"file '{silence.name}'")
    concat_list.write_text("\n".join(lines), encoding="utf-8")

    voice_path = workdir / "voice.wav"
    run_ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", concat_list.name,
         "-c:a", "pcm_s16le", str(voice_path)],
        cwd=voice_dir,
    )

    starts: list[float] = []
    cursor = 0.0
    for duration in durations:
        starts.append(cursor)
        cursor += duration + SCENE_GAP

    # La duree affichee de chaque scene inclut la respiration qui la suit.
    scene_durations = [d + SCENE_GAP for d in durations[:-1]] + [durations[-1]]
    return voice_path, list(zip(starts, scene_durations))


# ---------------------------------------------------------------------------
# Etape 3 — Images avec Stable Diffusion
# ---------------------------------------------------------------------------


def _load_sd(settings: JobSettings):
    """Charge le pipeline diffusers, avec offload CPU si la VRAM est juste."""
    key = f"sd::{settings.sd_model}"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    import torch
    from diffusers import AutoPipelineForText2Image

    use_cuda = torch.cuda.is_available()
    pipe = AutoPipelineForText2Image.from_pretrained(
        settings.sd_model,
        torch_dtype=torch.float16 if use_cuda else torch.float32,
        use_safetensors=True,
    )
    if use_cuda:
        # Libere la VRAM entre les sous-modeles : indispensable sur 8 Go.
        pipe.enable_model_cpu_offload()
        pipe.enable_vae_slicing()
    else:
        pipe = pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)
    _MODEL_CACHE[key] = pipe
    return pipe


def _load_wan(settings: "JobSettings"):
    """
    Charge le pipeline Wan 2.2 (diffusers), avec offload CPU sur VRAM limitee.

    Meme logique que _load_sd : le modele est lourd (5 milliards de
    parametres), on le garde en cache process-local et on decharge entre les
    sous-modules pour tenir sur une carte a 8 Go.
    """
    model_id = settings.video_model or get_video_engine("wan").model_id
    key = f"wan::{model_id}"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    import torch
    from diffusers import AutoencoderKLWan, WanPipeline
    from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler

    use_cuda = torch.cuda.is_available()
    vae = AutoencoderKLWan.from_pretrained(model_id, subfolder="vae",
                                           torch_dtype=torch.float32)
    pipe = WanPipeline.from_pretrained(
        model_id, vae=vae, torch_dtype=torch.bfloat16 if use_cuda else torch.float32
    )
    pipe.scheduler = UniPCMultistepScheduler.from_config(
        pipe.scheduler.config, flow_shift=5.0
    )
    if use_cuda:
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)
    _MODEL_CACHE[key] = pipe
    return pipe


def generate_wan_clip(prompt: str, destination: Path, settings: "JobSettings",
                      seconds: int = 4) -> Path:
    """Genere un clip anime avec Wan 2.2 et l'ecrit dans `destination`."""
    import torch
    from diffusers.utils import export_to_video

    pipe = _load_wan(settings)
    # 24 fps, 4n+1 images : contrainte du VAE video de Wan (compression temporelle).
    num_frames = max(9, int(round(seconds * 24 / 4)) * 4 + 1)
    generator = torch.Generator(device="cpu").manual_seed(random.randint(0, 2**31 - 1))

    with torch.inference_mode():
        frames = pipe(
            prompt=prompt,
            negative_prompt=settings.sd_negative,
            width=832, height=480,          # format large ; recadre au montage
            num_frames=num_frames,
            guidance_scale=settings.wan_guidance,
            num_inference_steps=settings.wan_steps,
            generator=generator,
        ).frames[0]

    export_to_video(frames, str(destination), fps=24)
    return destination


def generate_scene_clips(
    scenes: list[dict[str, Any]], timings: list[tuple[float, float]],
    workdir: Path, settings: "JobSettings", progress: "_Progress | None" = None,
) -> dict[int, Path]:
    """
    Genere un clip anime pour les scenes selectionnees (moteur "wan").

    Les scenes non animees gardent leur image fixe. En cas d'echec sur une
    scene (VRAM insuffisante, timeout...), on retombe sur l'image plutot que
    de faire echouer toute la video.
    """
    engine = get_video_engine(settings.video_engine)
    wanted = scenes_to_animate(settings, len(scenes))
    if not wanted or engine.kind != "wan":
        return {}

    clips_dir = workdir / "generated"
    clips_dir.mkdir(parents=True, exist_ok=True)
    produced: dict[int, Path] = {}

    for position, index in enumerate(wanted, start=1):
        destination = clips_dir / f"scene_{index:02d}.mp4"
        prompt = scenes[index]["image_prompt"]
        duration = timings[index][1]
        if progress:
            progress("Clips video (Wan 2.2)", 36 + int(20 * position / len(wanted)),
                     f"scene {index + 1}/{len(scenes)} — peut prendre plusieurs minutes")
        try:
            produced[index] = generate_wan_clip(prompt, destination, settings,
                                                seconds=duration)
        except Exception as exc:
            if progress:
                progress("Clips video (Wan 2.2)", 36,
                         f"scene {index + 1} en echec, image fixe conservee : {exc}")
    return produced


def generate_images(
    scenes: list[dict[str, Any]], workdir: Path, settings: JobSettings,
    progress: _Progress | None = None,
) -> list[Path]:
    """Genere une image verticale par scene."""
    import torch

    pipe = _load_sd(settings)
    images_dir = workdir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    base_seed = settings.seed if settings.seed >= 0 else random.randint(0, 2**31 - 1)
    paths: list[Path] = []

    for index, scene in enumerate(scenes):
        generator = torch.Generator(device="cpu").manual_seed(base_seed + index)
        image = pipe(
            prompt=scene["image_prompt"],
            negative_prompt=settings.sd_negative,
            num_inference_steps=settings.sd_steps,
            guidance_scale=settings.sd_guidance,
            width=settings.sd_width,
            height=settings.sd_height,
            generator=generator,
        ).images[0]
        path = images_dir / f"scene_{index:02d}.png"
        image.save(path)
        paths.append(path)
        if progress:
            pct = 35 + int(25 * (index + 1) / len(scenes))
            progress("Images (Stable Diffusion)", pct, f"image {index + 1}/{len(scenes)}")

    return paths


# ---------------------------------------------------------------------------
# Etape 4 — Sous-titres animes avec Whisper
# ---------------------------------------------------------------------------

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Studio,Montserrat,{size},{color},{color},&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,6,3,2,80,80,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{int(hours)}:{int(minutes):02d}:{secs:05.2f}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").strip()


def transcribe_words(audio_path: Path, settings: JobSettings) -> list[dict[str, Any]]:
    """Retourne les mots horodates de la voix off (Whisper local)."""
    key = f"whisper::{settings.whisper_model}"
    if key not in _MODEL_CACHE:
        import whisper

        _MODEL_CACHE[key] = whisper.load_model(settings.whisper_model)
    model = _MODEL_CACHE[key]

    result = model.transcribe(
        str(audio_path),
        language=settings.language,
        word_timestamps=True,
        fp16=False,
        verbose=False,
    )

    words: list[dict[str, Any]] = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            token = str(word.get("word", "")).strip()
            if token:
                words.append(
                    {"word": token, "start": float(word["start"]), "end": float(word["end"])}
                )
    return words


def write_ass(words: list[dict[str, Any]], path: Path, settings: JobSettings) -> None:
    """
    Ecrit un .ass facon TikTok : les mots apparaissent par petits groupes,
    le mot en cours de lecture est surligne (effet "karaoke pop").
    """
    lines = [
        ASS_HEADER.format(
            w=VIDEO_W, h=VIDEO_H, size=settings.subtitle_size, color=settings.subtitle_color
        )
    ]

    group_size = max(1, settings.words_per_caption)
    for start_index in range(0, len(words), group_size):
        group = words[start_index : start_index + group_size]
        tokens = [_ass_escape(w["word"]) for w in group]

        for position, word in enumerate(group):
            rendered = []
            for token_index, token in enumerate(tokens):
                if token_index == position:
                    rendered.append(
                        f"{{\\c{settings.subtitle_highlight}\\fscx112\\fscy112}}"
                        f"{token}{{\\c{settings.subtitle_color}\\fscx100\\fscy100}}"
                    )
                else:
                    rendered.append(token)
            text = " ".join(rendered)

            start = word["start"]
            # Le dernier mot du groupe reste affiche jusqu'au groupe suivant.
            end = word["end"] if position < len(group) - 1 else word["end"] + 0.08
            fade = "{\\fad(90,60)}" if position == 0 else ""
            lines.append(
                f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Studio,,0,0,0,,{fade}{text}"
            )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Etape 5 — Montage video (Ken Burns) et mixage audio (ducking + SFX)
# ---------------------------------------------------------------------------


def build_visual_track(
    images: list[Path], timings: list[tuple[float, float]], workdir: Path,
    generated: dict[int, Path] | None = None,
) -> Path:
    """
    Construit la piste video verticale, scene par scene, puis la concatene.

    Une scene disposant d'un clip Wan genere l'utilise ; les autres retombent
    sur leur image fixe animee d'un zoom lent (Ken Burns). Tous les segments
    sont reencodes aux memes parametres, condition pour que la concatenation
    par demuxer fonctionne.
    """
    generated = generated or {}
    clips_dir = workdir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    clips: list[Path] = []

    for index, (image, (_, duration)) in enumerate(zip(images, timings)):
        clip = clips_dir / f"clip_{index:02d}.mp4"

        source = generated.get(index)
        if source and Path(source).exists():
            # -stream_loop -1 : si le clip genere est plus court que la
            # narration de la scene, il boucle au lieu de laisser un trou.
            run_ffmpeg([
                "-stream_loop", "-1", "-i", str(source),
                "-t", f"{duration:.3f}",
                "-vf", (
                    f"scale={VIDEO_W}:{VIDEO_H}:force_original_aspect_ratio=increase,"
                    f"crop={VIDEO_W}:{VIDEO_H},fps={FPS},format=yuv420p"
                ),
                "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p", "-an", str(clip),
            ])
            clips.append(clip)
            continue

        frames = max(2, int(round(duration * FPS)))
        zoom_in = index % 2 == 0
        # zoompan travaille image par image : z depend de "on" (frame courante).
        if zoom_in:
            zoom_expr = f"1.02+0.13*on/{frames}"
        else:
            zoom_expr = f"1.15-0.13*on/{frames}"

        vf = (
            f"scale={RENDER_W}:{RENDER_H}:force_original_aspect_ratio=increase,"
            f"crop={RENDER_W}:{RENDER_H},"
            f"zoompan=z='{zoom_expr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d={frames}:s={VIDEO_W}x{VIDEO_H}:fps={FPS},"
            f"format=yuv420p"
        )

        run_ffmpeg([
            "-loop", "1", "-framerate", str(FPS), "-i", str(image),
            "-t", f"{duration:.3f}", "-vf", vf,
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-an", str(clip),
        ])
        clips.append(clip)

    concat_list = clips_dir / "concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{c.name}'" for c in clips), encoding="utf-8"
    )
    track = workdir / "visual_track.mp4"
    run_ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", concat_list.name, "-c", "copy", str(track)],
        cwd=clips_dir,
    )
    return track


def pick_sfx(keyword: str) -> Path | None:
    """
    Associe un mot-cle de bruitage a un fichier de assets/sfx.
    Cherche d'abord un nom contenant le mot-cle, sinon tire au hasard.
    """
    candidates = [
        p for p in SFX_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in {".wav", ".mp3", ".ogg", ".m4a"}
    ] if SFX_DIR.exists() else []
    if not candidates:
        return None
    matching = [p for p in candidates if keyword and keyword in p.stem.lower()]
    return random.choice(matching or candidates)


def build_audio_filter(
    settings: JobSettings, has_music: bool, sfx_delays_ms: list[int]
) -> str:
    """
    Construit le graphe audio FFmpeg. Fonction pure (testable sans FFmpeg).

    Ordre des entrees attendu : 0=video, 1=voix, 2=musique (si presente),
    puis un flux par bruitage.

    Le ducking utilise `sidechaincompress` : la voix pilote la compression
    de la musique, qui baisse automatiquement des que quelqu'un parle.
    """
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    parts = [f"[1:a]{fmt},volume=1.0[voice_base]"]
    mix_labels: list[str] = []

    if has_music:
        parts.append(f"[2:a]{fmt},volume={settings.music_volume_db:.1f}dB[music_raw]")
        if settings.ducking:
            # La voix est dupliquee : une copie audible, une copie sidechain.
            parts.append("[voice_base]asplit=2[voice_out][voice_key]")
            parts.append(
                f"[music_raw][voice_key]sidechaincompress="
                f"threshold={settings.ducking_threshold}:"
                f"ratio={settings.ducking_ratio}:"
                f"attack=15:release={settings.ducking_release}:"
                f"makeup=1:level_sc=1[music_out]"
            )
        else:
            parts.append("[voice_base]anull[voice_out]")
            parts.append("[music_raw]anull[music_out]")
        mix_labels += ["[voice_out]", "[music_out]"]
    else:
        parts.append("[voice_base]anull[voice_out]")
        mix_labels.append("[voice_out]")

    sfx_offset = 3 if has_music else 2
    for position, delay in enumerate(sfx_delays_ms):
        stream = sfx_offset + position
        label = f"[sfx{position}]"
        parts.append(
            f"[{stream}:a]{fmt},volume={settings.sfx_volume_db:.1f}dB,"
            f"adelay={delay}|{delay},apad=pad_dur=0.1{label}"
        )
        mix_labels.append(label)

    if len(mix_labels) == 1:
        parts.append(f"{mix_labels[0]}anull[mixed]")
    else:
        # normalize=0 : sans cela amix divise le volume par le nombre d'entrees.
        parts.append(
            f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:"
            f"duration=first:normalize=0:dropout_transition=0[mixed]"
        )
    # Filet de securite contre la saturation apres le mixage.
    parts.append("[mixed]alimiter=limit=0.95:level=0,aresample=48000[audio]")
    return ";".join(parts)


def render_final(
    slideshow: Path, voice: Path, subtitles: Path | None,
    sfx_plan: list[tuple[Path, float]], settings: JobSettings,
    workdir: Path, output_path: Path,
) -> Path:
    """Assemble video + audio mixe + sous-titres et encode le rendu final."""
    music_path: Path | None = None
    if settings.music_track:
        candidate = Path(settings.music_track)
        if not candidate.exists():
            candidate = MUSIC_DIR / settings.music_track
        if candidate.exists():
            music_path = candidate

    # Ordre impose par build_audio_filter : 0=video, 1=voix, 2=musique, puis SFX.
    inputs: list[str] = ["-i", str(slideshow), "-i", str(voice)]
    if music_path:
        # -stream_loop -1 : la musique boucle jusqu'a la fin de la voix.
        inputs += ["-stream_loop", "-1", "-i", str(music_path)]

    delays_ms: list[int] = []
    for sfx_file, start in sfx_plan:
        inputs += ["-i", str(sfx_file)]
        delays_ms.append(int(round(start * 1000)))

    audio_filter = build_audio_filter(settings, music_path is not None, delays_ms)

    if subtitles is not None:
        # Chemin relatif + cwd : evite l'echappement du "C:" sous Windows,
        # que le filtre ass interprete sinon comme un separateur d'options.
        video_filter = f"[0:v]ass={subtitles.name}[video]"
        video_map = "[video]"
    else:
        video_filter = "[0:v]null[video]"
        video_map = "[video]"

    run_ffmpeg(
        [
            *inputs,
            "-filter_complex", f"{audio_filter};{video_filter}",
            "-map", video_map, "-map", "[audio]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-r", str(FPS), "-g", str(FPS * 2),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart",
            "-shortest",
            str(output_path),
        ],
        cwd=workdir,
    )
    return output_path


# ---------------------------------------------------------------------------
# Orchestration complete d'un job
# ---------------------------------------------------------------------------


def run_job(job_id: str, keep_workdir: bool = False,
            callback: Callable[[str, int, str], None] | None = None) -> dict[str, Any]:
    """
    Execute le pipeline de bout en bout pour un job donne.

    Le statut final est `pending_review` (la video attend la moderation)
    ou `failed` (le message d'erreur est stocke dans le job).
    """
    job = load_job(job_id)
    if job is None:
        raise ValueError(f"Job introuvable : {job_id}")

    settings = JobSettings.from_dict(job.get("settings"))
    progress = _Progress(job_id, callback)
    workdir = WORK_DIR / job_id
    workdir.mkdir(parents=True, exist_ok=True)

    update_job(job_id, status=STATUS_RUNNING, error=None)
    started = time.time()

    try:
        # 1. Script -----------------------------------------------------------
        provider = get_provider(settings.llm_provider)
        progress("Ecriture du script", 5, f"{provider.label} · {settings.llm_model}")
        script = generate_script(settings)
        update_job(job_id, script=script)
        progress("Script pret", 18, f"{len(script['scenes'])} scenes")

        # 2. Voix -------------------------------------------------------------
        progress("Voix off (XTTSv2)", 20, "chargement du modele")
        voice_path, timings = synthesize_voice(script["scenes"], workdir, settings, progress)

        # 3. Images -----------------------------------------------------------
        progress("Images (Stable Diffusion)", 36, "chargement du modele")
        images = generate_images(script["scenes"], workdir, settings, progress)

        # 4. Sous-titres ------------------------------------------------------
        subtitles_path: Path | None = None
        if settings.subtitles:
            progress("Sous-titres (Whisper)", 62, settings.whisper_model)
            words = transcribe_words(voice_path, settings)
            if words:
                subtitles_path = workdir / "subs.ass"
                write_ass(words, subtitles_path, settings)

        # 4 bis. Clips video generes (Wan 2.2) ---------------------------------
        generated: dict[int, Path] = {}
        if get_video_engine(settings.video_engine).kind == "wan":
            generated = generate_scene_clips(
                script["scenes"], timings, workdir, settings, progress
            )
            update_job(job_id, animated_scenes=sorted(generated))

        # 5. Piste video --------------------------------------------------------
        progress("Montage de la piste video", 72,
                 f"{len(generated)} clip(s) genere(s)" if generated else "effet Ken Burns")
        slideshow = build_visual_track(images, timings, workdir, generated)

        # 6. Bruitages --------------------------------------------------------
        sfx_plan: list[tuple[Path, float]] = []
        if settings.sfx_enabled:
            for scene, (start, _) in zip(script["scenes"], timings):
                sfx_file = pick_sfx(scene.get("sfx", ""))
                if sfx_file:
                    # Le bruitage est joue legerement avant le changement d'image.
                    sfx_plan.append((sfx_file, max(0.0, start - 0.08)))
            progress("Bruitages", 80, f"{len(sfx_plan)} SFX places")

        # 7. Rendu final ------------------------------------------------------
        progress("Mixage & rendu final (FFmpeg)", 85,
                 "ducking actif" if settings.ducking and settings.music_track else "")
        output_path = OUTPUT_DIR / f"{job_id}.mp4"
        render_final(slideshow, voice_path, subtitles_path, sfx_plan,
                     settings, workdir, output_path)

        duration = media_duration(output_path)
        job = update_job(
            job_id,
            status=STATUS_PENDING_REVIEW,
            video_path=str(output_path),
            duration=round(duration, 2),
            render_seconds=round(time.time() - started, 1),
            publish={
                "title": script["title"],
                "description": (
                    f"{script['description']}\n\n{' '.join(script['hashtags'])}"
                ).strip(),
                "tags": [h.lstrip("#") for h in script["hashtags"]],
                "video_id": None,
            },
        )
        progress("Termine", 100, f"{duration:.1f} s de video")

        if not keep_workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return job or {}

    except Exception as exc:  # remonte proprement l'erreur jusqu'a l'UI
        update_job(job_id, status=STATUS_FAILED, error=f"{type(exc).__name__}: {exc}")
        progress("Echec", 100, str(exc)[:200])
        raise


def launch_job_subprocess(job_id: str, keep_workdir: bool = False) -> subprocess.Popen:
    """
    Lance le pipeline dans un process separe (mode utilise par Streamlit).

    Les logs sont ecrits dans data/work/<id>.log pour pouvoir diagnostiquer
    une generation qui echoue sans bloquer l'interface.
    """
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    log_file = open(WORK_DIR / f"{job_id}.log", "w", encoding="utf-8", errors="replace")
    args = [sys.executable, str(BASE_DIR / "worker.py"), "--job", job_id]
    if keep_workdir:
        args.append("--keep-workdir")

    creation_flags = 0
    if os.name == "nt":  # pas de fenetre console qui s'ouvre sous Windows
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    return subprocess.Popen(
        args, cwd=str(BASE_DIR), stdout=log_file, stderr=subprocess.STDOUT,
        creationflags=creation_flags,
    )


def job_log(job_id: str, tail: int = 40) -> str:
    path = WORK_DIR / f"{job_id}.log"
    if not path.exists():
        return ""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-tail:])


# ---------------------------------------------------------------------------
# YouTube Data API v3 — upload et statistiques
# ---------------------------------------------------------------------------

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
CLIENT_SECRET_FILE = BASE_DIR / "client_secret.json"
TOKEN_FILE = DATA_DIR / "youtube_token.json"


def youtube_configured() -> bool:
    return CLIENT_SECRET_FILE.exists()


def youtube_service():
    """
    Retourne un client YouTube authentifie.

    Au premier appel, une fenetre de navigateur s'ouvre pour l'autorisation
    Google ; le jeton est ensuite conserve dans data/youtube_token.json.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds: Credentials | None = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), YOUTUBE_SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CLIENT_SECRET_FILE.exists():
                raise RuntimeError(
                    "client_secret.json est absent. Creez des identifiants OAuth "
                    "(type 'Application de bureau') dans Google Cloud Console, "
                    "activez YouTube Data API v3, puis deposez le fichier a la "
                    "racine du Studio."
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CLIENT_SECRET_FILE), YOUTUBE_SCOPES
            )
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def upload_short(
    video_path: str | Path, title: str, description: str,
    tags: list[str] | None = None, privacy: str = "private",
    category_id: str = "22",
    on_progress: Callable[[int], None] | None = None,
) -> str:
    """
    Envoie la video sur YouTube en Short et retourne l'ID de la video.

    Rappel : YouTube classe automatiquement en Short toute video verticale
    de moins de 3 minutes ; ajouter #Shorts au titre aide la detection.
    """
    from googleapiclient.http import MediaFileUpload

    service = youtube_service()
    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:4900],
            "tags": (tags or [])[:15],
            "categoryId": category_id,
        },
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(str(video_path), chunksize=4 * 1024 * 1024, resumable=True)
    request = service.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and on_progress:
            on_progress(int(status.progress() * 100))
    return response["id"]


def fetch_video_stats(video_ids: list[str]) -> dict[str, dict[str, int]]:
    """Statistiques (vues, likes, commentaires) pour une liste de videos."""
    if not video_ids:
        return {}
    service = youtube_service()
    stats: dict[str, dict[str, int]] = {}
    for start in range(0, len(video_ids), 50):  # l'API accepte 50 IDs par appel
        chunk = video_ids[start : start + 50]
        response = service.videos().list(part="statistics", id=",".join(chunk)).execute()
        for item in response.get("items", []):
            raw = item.get("statistics", {})
            stats[item["id"]] = {
                "views": int(raw.get("viewCount", 0)),
                "likes": int(raw.get("likeCount", 0)),
                "comments": int(raw.get("commentCount", 0)),
            }
    return stats


def estimate_revenue(views: int, rpm: float) -> float:
    """Revenu estime : le RPM est exprime en euros pour 1000 vues."""
    return round(views / 1000.0 * rpm, 2)


# ---------------------------------------------------------------------------
# Point d'entree CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Moteur SaaS Video Studio")
    parser.add_argument("--job", help="ID du job a executer")
    parser.add_argument("--keep-workdir", action="store_true",
                        help="Conserver les fichiers intermediaires (debug)")
    parser.add_argument("--topic", help="Creer et lancer un job directement")
    parser.add_argument("--doctor", action="store_true",
                        help="Verifier l'environnement (FFmpeg, Ollama, GPU)")
    args = parser.parse_args()

    if args.doctor:
        return doctor()

    job_id = args.job
    if not job_id:
        if not args.topic:
            parser.error("Fournissez --job, --topic ou --doctor.")
        job_id = create_job(JobSettings(topic=args.topic), title_hint=args.topic)["id"]
        print(f"Job cree : {job_id}")

    try:
        run_job(job_id, keep_workdir=args.keep_workdir)
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        return 1
    return 0


def doctor() -> int:
    """Diagnostic rapide de l'installation (utilise aussi par l'UI)."""
    checks: list[tuple[str, bool, str]] = []

    try:
        checks.append(("FFmpeg", True, ffmpeg_bin()))
    except RuntimeError as exc:
        checks.append(("FFmpeg", False, str(exc)))

    for provider in LLM_PROVIDERS.values():
        ok, detail = llm_status(provider.key)
        # Un fournisseur cloud non configure est normal : on ne l'affiche pas
        # comme une erreur tant qu'aucune cle n'a ete renseignee.
        if not ok and provider.needs_key and not get_api_key(provider.key):
            detail = "non configure (optionnel)"
        checks.append((provider.label, ok, detail))

    try:
        import torch

        cuda = torch.cuda.is_available()
        checks.append((
            "GPU (CUDA)", cuda,
            torch.cuda.get_device_name(0) if cuda else "CPU uniquement (tres lent)",
        ))
    except ImportError:
        checks.append(("GPU (CUDA)", False, "PyTorch non installe"))

    checks.append((
        "Musiques", any(MUSIC_DIR.glob("*")), f"{len(list(MUSIC_DIR.glob('*')))} fichier(s)"
    ))
    checks.append((
        "Bruitages", any(SFX_DIR.glob("*")), f"{len(list(SFX_DIR.glob('*')))} fichier(s)"
    ))
    checks.append(("YouTube API", youtube_configured(),
                   "client_secret.json present" if youtube_configured() else "non configure"))

    for name, ok, detail in checks:
        print(f"[{'OK ' if ok else 'KO '}] {name:<12} {detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
