# -*- coding: utf-8 -*-
"""
app.py — Interface Streamlit du SaaS Video Studio.

Quatre sections accessibles depuis la barre laterale :
    🚦 Moderation   : valider ou rejeter les videos generees
    🚀 Publications : titrer, decrire et publier sur YouTube Shorts
    ✨ Studio IA    : creer une video sur mesure ou depuis l'actu du jour
    📊 Analytics    : vues, likes et revenus estimes

Lancement :  streamlit run app.py   (ou double-clic sur lancer_studio.bat)
"""

from __future__ import annotations

import hashlib
import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import streamlit as st

import worker
from news_fetcher import TIME_WINDOWS, TOPIC_PRESETS, fetch_trends
from worker import (
    DEFAULT_PROVIDER,
    LLM_PROVIDERS,
    JobSettings,
    STATUS_APPROVED,
    STATUS_FAILED,
    STATUS_PENDING_REVIEW,
    STATUS_PUBLISHED,
    STATUS_QUEUED,
    STATUS_REJECTED,
    STATUS_RUNNING,
)

st.set_page_config(
    page_title="SaaS Video Studio",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Design system "Apple" : fond clair, cartes blanches arrondies, boutons pilules
# ---------------------------------------------------------------------------

APPLE_CSS = """
<style>
:root {
    --bg:        #f5f5f7;
    --card:      #ffffff;
    --ink:       #1d1d1f;
    --ink-soft:  #6e6e73;
    --accent:    #0071e3;
    --accent-dk: #0060c0;
    --line:      #e6e6eb;
    --radius:    18px;
}

html, body, [class*="css"], .stApp {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
                 "Helvetica Neue", Inter, sans-serif;
    color: var(--ink);
}
.stApp { background: var(--bg); }
.block-container { padding-top: 2.4rem; max-width: 1180px; }

/* --- Titres --- */
h1 { font-weight: 700; letter-spacing: -0.026em; }
h2 { font-weight: 650; letter-spacing: -0.018em; }
h3 { font-weight: 600; letter-spacing: -0.012em; }
.subtitle { color: var(--ink-soft); font-size: 1.02rem; margin: -0.5rem 0 1.7rem 0; }

/* --- Cartes ---
   st.container(border=True) pose sa bordure sur le <div stVerticalBlock>
   interne. Comme ce testid habille aussi la sidebar et tous les blocs de la
   page, on marque chaque carte avec un <span class="studio-card"> en premier
   enfant et on la cible via :has(). */
div[data-testid="stVerticalBlock"]:has(
    > div[data-testid="stElementContainer"]:first-child span.studio-card) {
    background: var(--card) !important;
    border: 1px solid var(--line) !important;
    border-radius: var(--radius) !important;
    padding: 1.35rem 1.6rem 1.2rem 1.6rem !important;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.05);
    margin-bottom: 1.15rem;
}
.studio-card { display: none; }
.card-title {
    font-size: 1.22rem; font-weight: 620; letter-spacing: -0.012em;
    margin: 0 0 .15rem 0;
}
.card-meta { color: var(--ink-soft); font-size: .85rem; margin-bottom: .35rem; }
/* Les champs se detachent du blanc de la carte par un gris tres leger. */
.stMain .stTextInput input, .stMain .stTextArea textarea,
.stMain div[data-baseweb="select"] > div {
    background: #f7f7f9 !important; border-color: var(--line) !important;
}

/* --- Badges de statut --- */
.badge {
    display: inline-block; padding: .16rem .68rem; border-radius: 999px;
    font-size: .72rem; font-weight: 600; vertical-align: middle;
    margin-left: .45rem; position: relative; top: -2px;
}
.badge-wait { background: #fff3e0; color: #b26a00; }
.badge-ok   { background: #e6f8ea; color: #1e7a35; }
.badge-live { background: #e8f1ff; color: #0057c2; }
.badge-ko   { background: #ffeceb; color: #c22a22; }

/* --- Boutons pilules ---
   Les selecteurs ciblent l'attribut `kind` : Streamlit l'expose sur chaque
   bouton, et on evite ainsi de repeindre ceux de sa propre barre d'outils. */
.stApp button[kind="primary"], .stApp button[kind="primaryFormSubmit"] {
    border-radius: 999px !important;
    background: var(--accent) !important;
    border: 1px solid var(--accent) !important;
    color: #fff !important;
    font-weight: 550 !important;
    padding: .5rem 1.5rem !important;
    transition: background .15s ease, transform .1s ease;
}
.stApp button[kind="primary"]:hover, .stApp button[kind="primaryFormSubmit"]:hover {
    background: var(--accent-dk) !important; border-color: var(--accent-dk) !important;
    transform: translateY(-1px);
}
.stApp button[kind="secondary"], .stApp button[kind="secondaryFormSubmit"],
.stApp button[kind="tertiary"] {
    border-radius: 999px !important;
    background: #fff !important;
    border: 1px solid var(--line) !important;
    color: var(--ink) !important;
    font-weight: 500 !important;
    padding: .5rem 1.4rem !important;
}
.stApp button[kind="secondary"]:hover, .stApp button[kind="secondaryFormSubmit"]:hover {
    background: #f2f2f5 !important; border-color: #d8d8de !important; color: var(--ink) !important;
}
.stApp button:focus-visible { box-shadow: 0 0 0 4px rgba(0,113,227,.2) !important; }

/* --- Champs de saisie --- */
.stTextInput input, .stTextArea textarea, .stNumberInput input {
    border-radius: 12px !important; background: #fff !important;
}
div[data-baseweb="select"] > div { border-radius: 12px !important; background: #fff !important; }

/* --- Sidebar --- */
section[data-testid="stSidebar"] {
    background: #fbfbfd; border-right: 1px solid var(--line);
}
section[data-testid="stSidebar"] .stRadio label { font-size: 1rem; padding: .16rem 0; }
section[data-testid="stSidebar"] div[data-testid="stLayoutWrapper"] {
    box-shadow: none;
}

/* --- Metriques --- */
div[data-testid="stMetric"] {
    background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1rem 1.2rem;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
div[data-testid="stMetricLabel"] { color: var(--ink-soft); font-weight: 500; }
div[data-testid="stMetricValue"] { font-weight: 620; letter-spacing: -0.02em; }

/* --- Formulaires : la carte fait deja office de cadre --- */
div[data-testid="stForm"] {
    border: none !important; padding: 0 !important; background: transparent;
}

/* --- Expander (parametres avances) --- */
div[data-testid="stExpander"] details {
    background: var(--card); border: 1px solid var(--line) !important;
    border-radius: var(--radius) !important; box-shadow: none;
}

/* --- Tableaux & divers --- */
div[data-testid="stDataFrame"] { border-radius: 14px; overflow: hidden; border: 1px solid var(--line); }
.stProgress > div > div > div > div { background: var(--accent); }
hr { border-color: var(--line); }
/* Barre d'outils Streamlit (bouton Deploy) : sans objet en local. */
[data-testid="stToolbar"], [data-testid="stAppDeployButton"], #MainMenu, footer {
    display: none !important;
}
[data-testid="stDecoration"] { display: none !important; }
</style>
"""

st.markdown(APPLE_CSS, unsafe_allow_html=True)

BADGES = {
    STATUS_QUEUED: ("badge-wait", "En file"),
    STATUS_RUNNING: ("badge-live", "Generation"),
    STATUS_PENDING_REVIEW: ("badge-wait", "A moderer"),
    STATUS_APPROVED: ("badge-ok", "Validee"),
    STATUS_REJECTED: ("badge-ko", "Rejetee"),
    STATUS_PUBLISHED: ("badge-live", "Publiee"),
    STATUS_FAILED: ("badge-ko", "Echec"),
}


def badge(status: str) -> str:
    css_class, label = BADGES.get(status, ("badge-wait", status))
    return f'<span class="badge {css_class}">{label}</span>'


@contextmanager
def card(title: str = "", meta: str = "", status: str | None = None):
    """
    Carte blanche arrondie englobant reellement son contenu.

    On s'appuie sur st.container(border=True) plutot que sur un <div> injecte :
    Streamlit referme les balises brutes a la fin de leur propre bloc, un div
    ouvert a la main ne peut donc pas envelopper les widgets qui suivent.
    """
    with st.container(border=True):
        st.markdown(
            '<span class="studio-card"></span>'
            + (f'<div class="card-title">{title}'
               f'{badge(status) if status else ""}</div>' if title else "")
            + (f'<div class="card-meta">{meta}</div>' if meta else ""),
            unsafe_allow_html=True,
        )
        yield


def human_date(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%d/%m %H:%M")
    except (TypeError, ValueError):
        return "?"


@st.cache_data(ttl=120, show_spinner=False)
def cached_models(provider_key: str, base_url: str, key_fingerprint: str) -> list[str]:
    """
    Modeles d'un fournisseur, avec cache court.

    Streamlit rejoue le script a chaque interaction : sans cache, chaque clic
    declencherait un appel reseau. `key_fingerprint` ne sert qu'a invalider le
    cache quand la cle change — la cle elle-meme n'est jamais passee ici.
    """
    return worker.list_llm_models(provider_key, base_url)


def key_fingerprint(provider_key: str) -> str:
    key = worker.get_api_key(provider_key)
    return hashlib.sha256(key.encode()).hexdigest()[:12] if key else ""


def asset_choices(directory: Path, label_none: str = "Aucune") -> list[str]:
    files = sorted(
        p.name for p in directory.glob("*")
        if p.is_file() and p.suffix.lower() in {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
    )
    return [label_none] + files


# ---------------------------------------------------------------------------
# Barre laterale
# ---------------------------------------------------------------------------

with st.sidebar:
    st.markdown("## 🎬 Video Studio")
    st.caption("Automatisation Shorts • 100 % local")

    page = st.radio(
        "Navigation",
        ["🚦 Moderation", "🚀 Publications", "✨ Studio IA & Actus", "📊 Analytics"],
        label_visibility="collapsed",
    )

    st.divider()
    pending = len(worker.list_jobs(STATUS_PENDING_REVIEW))
    approved = len(worker.list_jobs(STATUS_APPROVED))
    published = len(worker.list_jobs(STATUS_PUBLISHED))
    st.markdown(
        f"**File d'attente**\n\n"
        f"- 🟠 A moderer : **{pending}**\n"
        f"- 🟢 Pretes a publier : **{approved}**\n"
        f"- 🔵 Publiees : **{published}**"
    )

    st.divider()
    with st.expander("🩺 Diagnostic"):
        if st.button("Verifier l'installation", use_container_width=True):
            try:
                st.write("FFmpeg :", worker.ffmpeg_bin())
            except RuntimeError as exc:
                st.error(str(exc))
            for provider in LLM_PROVIDERS.values():
                ok, detail = worker.llm_status(provider.key)
                if ok:
                    st.success(f"{provider.label} : {detail}")
                elif provider.needs_key and not worker.get_api_key(provider.key):
                    st.caption(f"{provider.label} : non configure")
                else:
                    st.warning(f"{provider.label} : {detail}")
            st.write("YouTube API :", "configuree" if worker.youtube_configured() else "absente")


# ---------------------------------------------------------------------------
# 🚦 Moderation
# ---------------------------------------------------------------------------


def page_moderation() -> None:
    st.title("🚦 Moderation")
    st.markdown(
        '<p class="subtitle">Visionnez chaque video generee, puis validez-la pour '
        "la publication ou rejetez-la.</p>",
        unsafe_allow_html=True,
    )

    jobs = worker.list_jobs([STATUS_PENDING_REVIEW, STATUS_FAILED])
    if not jobs:
        st.info(
            "Aucune video en attente. Rendez-vous dans **✨ Studio IA & Actus** "
            "pour en creer une."
        )
        return

    for job in jobs:
        job_id = job["id"]
        script = job.get("script") or {}
        title = script.get("title") or job.get("title_hint") or job_id
        meta = (
            f"{human_date(job['created_at'])} &nbsp;•&nbsp; {job.get('duration') or '?'} s "
            f"&nbsp;•&nbsp; rendu en {job.get('render_seconds', '?')} s"
        )

        with card(title, meta, status=job["status"]):
            if job["status"] == STATUS_FAILED:
                st.error(job.get("error") or "Erreur inconnue")
                with st.expander("Journal technique"):
                    st.code(worker.job_log(job_id) or "(vide)", language="text")
                if st.button("🗑️ Supprimer", key=f"del_{job_id}"):
                    worker.delete_job(job_id)
                    st.rerun()
                continue

            left, right = st.columns([1, 1.35], gap="large")
            with left:
                video_path = job.get("video_path")
                if video_path and Path(video_path).exists():
                    st.video(video_path)
                else:
                    st.warning("Fichier video introuvable.")

            with right:
                st.markdown("**Script**")
                for index, scene in enumerate(script.get("scenes", []), start=1):
                    st.markdown(f"`{index}.` {scene['narration']}")
                if script.get("hashtags"):
                    st.caption(" ".join(script["hashtags"]))

                col_ok, col_ko = st.columns(2)
                if col_ok.button("✅ Valider", key=f"ok_{job_id}", type="primary",
                                 use_container_width=True):
                    worker.update_job(job_id, status=STATUS_APPROVED)
                    st.toast("Video validee, direction Publications 🚀")
                    st.rerun()
                if col_ko.button("❌ Rejeter", key=f"ko_{job_id}",
                                 use_container_width=True):
                    worker.update_job(job_id, status=STATUS_REJECTED)
                    st.rerun()


# ---------------------------------------------------------------------------
# 🚀 Publications
# ---------------------------------------------------------------------------


def page_publications() -> None:
    st.title("🚀 Publications")
    st.markdown(
        '<p class="subtitle">Finalisez les metadonnees puis envoyez directement '
        "sur votre chaine YouTube Shorts.</p>",
        unsafe_allow_html=True,
    )

    if not worker.youtube_configured():
        st.warning(
            "**YouTube non configure.** Creez des identifiants OAuth de type "
            "*Application de bureau* dans Google Cloud Console, activez "
            "*YouTube Data API v3*, puis deposez le fichier `client_secret.json` "
            "a la racine du Studio."
        )

    jobs = worker.list_jobs(STATUS_APPROVED)
    if not jobs:
        st.info("Aucune video validee pour l'instant.")
        return

    for job in jobs:
        job_id = job["id"]
        publish = job.get("publish") or {}
        title = publish.get("title") or job.get("title_hint") or job_id
        meta = f"{human_date(job['created_at'])} &nbsp;•&nbsp; {job.get('duration') or '?'} s"

        with card(title, meta, status=job["status"]):
            left, right = st.columns([1, 1.35], gap="large")
            with left:
                if job.get("video_path") and Path(job["video_path"]).exists():
                    st.video(job["video_path"])

            with right:
                with st.form(f"publish_{job_id}"):
                    new_title = st.text_input(
                        "Titre", value=publish.get("title", ""), max_chars=100,
                        help="Ajoutez #Shorts pour aider YouTube a classer la video.",
                    )
                    description = st.text_area(
                        "Description", value=publish.get("description", ""), height=130
                    )
                    tags = st.text_input(
                        "Tags (separes par des virgules)",
                        value=", ".join(publish.get("tags", [])),
                    )
                    privacy = st.selectbox(
                        "Visibilite", ["public", "unlisted", "private"], index=0,
                        format_func=lambda v: {"public": "Publique",
                                               "unlisted": "Non repertoriee",
                                               "private": "Privee"}[v],
                    )
                    submitted = st.form_submit_button(
                        "📤 Publier sur YouTube", type="primary",
                        use_container_width=True,
                    )

                if submitted:
                    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
                    worker.update_job(
                        job_id,
                        publish={**publish, "title": new_title,
                                 "description": description, "tags": tag_list},
                    )
                    bar = st.progress(0, text="Envoi en cours...")
                    try:
                        video_id = worker.upload_short(
                            job["video_path"], new_title, description, tag_list,
                            privacy=privacy,
                            on_progress=lambda pct: bar.progress(
                                pct, text=f"Envoi... {pct} %"
                            ),
                        )
                    except Exception as exc:
                        bar.empty()
                        st.error(f"Echec de l'upload : {exc}")
                    else:
                        bar.progress(100, text="Termine")
                        worker.update_job(
                            job_id, status=STATUS_PUBLISHED,
                            published_at=datetime.now().astimezone().isoformat(),
                            publish={**publish, "title": new_title,
                                     "description": description, "tags": tag_list,
                                     "video_id": video_id},
                        )
                        st.success(f"Publiee : https://youtube.com/shorts/{video_id}")
                        time.sleep(1.5)
                        st.rerun()


# ---------------------------------------------------------------------------
# ✨ Studio IA & Actus
# ---------------------------------------------------------------------------


def page_studio() -> None:
    st.title("✨ Studio IA & Actus")
    st.markdown(
        '<p class="subtitle">Ecrivez votre sujet, ou laissez l\'actualite du jour '
        "vous l'apporter.</p>",
        unsafe_allow_html=True,
    )

    running_id = st.session_state.get("running_job")
    if running_id:
        _render_running_job(running_id)
        return

    # --- Veille d'actualite --------------------------------------------------
    with card("📰 Actualite du jour", "Flux RSS Google News, dedoublonne"):
        col_a, col_b, col_c = st.columns([2, 1.2, 1])
        preset = col_a.selectbox("Thematique", list(TOPIC_PRESETS.keys()))
        window = col_b.selectbox("Periode", list(TIME_WINDOWS.keys()))
        col_c.markdown("<div style='height:1.85rem'></div>", unsafe_allow_html=True)
        if col_c.button("🔄 Recuperer", use_container_width=True):
            with st.spinner("Lecture du flux Google News..."):
                st.session_state["trends"] = [
                    t.to_dict()
                    for t in fetch_trends(TOPIC_PRESETS[preset], limit=5,
                                          when=TIME_WINDOWS[window])
                ]
            if not st.session_state["trends"]:
                st.warning("Aucune actualite recuperee (verifiez votre connexion).")

        trends = st.session_state.get("trends", [])
        if trends:
            st.markdown("")
        for index, trend in enumerate(trends):
            row_text, row_button = st.columns([5, 1])
            row_text.markdown(
                f"**{trend['title']}**  \n"
                f"<span class='card-meta'>{trend['source']}</span>",
                unsafe_allow_html=True,
            )
            if row_button.button("Utiliser", key=f"use_{index}", use_container_width=True):
                st.session_state["topic_value"] = trend["title"]
                st.session_state["context_value"] = trend.get("summary", "")
                st.session_state["source_url"] = trend.get("link", "")
                st.rerun()

    # --- Formulaire de creation ---------------------------------------------
    with card("🎬 Nouvelle video", "Les parametres avances sont facultatifs"):
        topic = st.text_input(
            "Sujet de la video",
            value=st.session_state.get("topic_value", ""),
            placeholder="Ex : Pourquoi Jupiter protege la Terre des asteroides",
        )
        context = st.text_area(
            "Contexte / faits a respecter (optionnel)",
            value=st.session_state.get("context_value", ""),
            height=90,
        )

        # --- Choix du moteur d'ecriture -------------------------------------
        col_prov, col_model = st.columns([1, 1])
        provider_key = col_prov.selectbox(
            "Fournisseur du script",
            options=list(LLM_PROVIDERS),
            index=list(LLM_PROVIDERS).index(
                st.session_state.get("llm_provider", DEFAULT_PROVIDER)
            ),
            format_func=lambda k: LLM_PROVIDERS[k].label,
            key="llm_provider",
        )
        provider = worker.get_provider(provider_key)
        st.caption(
            f"💚 {provider.free_tier}"
            + (f" · [obtenir une cle gratuite]({provider.signup_url})"
               if provider.signup_url and provider.needs_key else "")
        )

        base_url = provider.base_url
        if provider.editable_url:
            base_url = st.text_input(
                "Adresse du serveur", value=provider.base_url,
                key=f"base_url_{provider_key}",
            )

        if provider.needs_key:
            stored = worker.get_api_key(provider_key)
            from_env = bool(provider.env_var and os.environ.get(provider.env_var))
            label = "🔑 Cle API — " + (
                f"fournie par {provider.env_var}" if from_env
                else "enregistree" if stored else "requise"
            )
            with st.expander(label, expanded=not stored):
                if from_env:
                    st.caption(
                        f"La variable d'environnement {provider.env_var} est "
                        "prioritaire sur toute saisie ici."
                    )
                entered = st.text_input(
                    "Cle", value="", type="password",
                    placeholder="collez la cle puis enregistrez",
                    key=f"key_{provider_key}",
                    help="Stockee en clair dans data/llm_keys.json, hors du "
                         "depot Git et jamais copiee dans les jobs.",
                )
                col_save, col_clear = st.columns(2)
                if col_save.button("Enregistrer", key=f"save_{provider_key}",
                                   type="primary", use_container_width=True):
                    worker.set_api_key(provider_key, entered)
                    cached_models.clear()
                    st.rerun()
                if stored and col_clear.button("Oublier", key=f"clear_{provider_key}",
                                               use_container_width=True):
                    worker.set_api_key(provider_key, "")
                    cached_models.clear()
                    st.rerun()

        available = cached_models(provider_key, base_url, key_fingerprint(provider_key))
        if available:
            default_model = st.session_state.get(f"model_{provider_key}")
            index = available.index(default_model) if default_model in available else 0
            llm_model = col_model.selectbox(
                "Modele", available, index=index, key=f"model_{provider_key}"
            )
        else:
            # Service eteint ou cle absente : saisie libre plutot qu'un blocage.
            llm_model = col_model.text_input(
                "Modele", value="", placeholder="identifiant du modele",
                key=f"model_txt_{provider_key}",
            )
            st.caption(f"ℹ️ Liste des modeles indisponible. {provider.hint}")

        col2, col3 = st.columns(2)
        n_scenes = col2.slider("Nombre de scenes", 3, 12, 6)
        language = col3.selectbox("Langue", ["fr", "en", "es", "de", "it"], index=0)

        with st.expander("⚙️ Parametres avances"):
            tab_voice, tab_image, tab_audio, tab_subs = st.tabs(
                ["🎙️ Voix", "🖼️ Images", "🎵 Audio", "💬 Sous-titres"]
            )

            with tab_voice:
                voices = asset_choices(worker.VOICES_DIR, "Voix par defaut (XTTS)")
                voice_sample = st.selectbox(
                    "Echantillon a cloner", voices,
                    help="Deposez un WAV mono de 6 a 20 s dans assets/voices.",
                )
                tts_speed = st.slider("Debit de parole", 0.8, 1.4, 1.05, 0.05)
                tone = st.text_input("Ton narratif", value="punchy et intriguant")

            with tab_image:
                sd_model = st.text_input(
                    "Modele Stable Diffusion",
                    value="stabilityai/stable-diffusion-xl-base-1.0",
                )
                sd_steps = st.slider("Etapes de diffusion", 12, 50, 28)
                sd_style = st.text_input(
                    "Style visuel",
                    value="cinematic, dramatic lighting, ultra detailed, 8k, depth of field",
                )
                seed = st.number_input("Seed (-1 = aleatoire)", value=-1, step=1)

            with tab_audio:
                music_track = st.selectbox(
                    "Musique de fond", asset_choices(worker.MUSIC_DIR)
                )
                music_volume = st.slider("Volume musique (dB)", -35.0, -3.0, -18.0, 0.5)
                ducking = st.checkbox(
                    "Auto-ducking (la musique baisse quand la voix parle)", value=True
                )
                duck_ratio = st.slider("Force du ducking", 2.0, 20.0, 9.0, 0.5,
                                       disabled=not ducking)
                sfx_enabled = st.checkbox(
                    "Bruitages a chaque changement d'image", value=True
                )
                sfx_volume = st.slider("Volume bruitages (dB)", -30.0, 0.0, -12.0, 0.5,
                                       disabled=not sfx_enabled)

            with tab_subs:
                subtitles = st.checkbox("Sous-titres animes", value=True)
                whisper_model = st.selectbox(
                    "Modele Whisper", ["tiny", "base", "small", "medium", "large-v3"],
                    index=2, disabled=not subtitles,
                )
                words_per_caption = st.slider("Mots par sous-titre", 1, 5, 3,
                                              disabled=not subtitles)
                subtitle_size = st.slider("Taille du texte", 50, 110, 78,
                                          disabled=not subtitles)

        launch = st.button("🚀 Generer la video", use_container_width=True, type="primary")

    if launch:
        if not topic.strip():
            st.error("Indiquez un sujet (ou choisissez une actualite ci-dessus).")
            return
        if not llm_model.strip():
            st.error(f"Choisissez un modele pour {provider.label}.")
            return

        settings = JobSettings(
            topic=topic.strip(),
            context=context.strip(),
            source_url=st.session_state.get("source_url", ""),
            language=language,
            tone=tone,
            n_scenes=n_scenes,
            llm_provider=provider_key,
            llm_model=llm_model,
            llm_base_url=base_url if provider.editable_url else "",
            voice_sample="" if voice_sample.startswith("Voix par defaut") else voice_sample,
            tts_speed=tts_speed,
            sd_model=sd_model,
            sd_steps=sd_steps,
            sd_style=sd_style,
            seed=int(seed),
            whisper_model=whisper_model,
            subtitles=subtitles,
            words_per_caption=words_per_caption,
            subtitle_size=subtitle_size,
            music_track="" if music_track == "Aucune" else music_track,
            music_volume_db=music_volume,
            ducking=ducking,
            ducking_ratio=duck_ratio,
            sfx_enabled=sfx_enabled,
            sfx_volume_db=sfx_volume,
        )
        job = worker.create_job(settings, title_hint=topic.strip())
        worker.launch_job_subprocess(job["id"])
        st.session_state["running_job"] = job["id"]
        st.rerun()


def _render_running_job(job_id: str) -> None:
    """Affiche la progression du job en cours et rafraichit toutes les 2 s."""
    job = worker.load_job(job_id)
    if job is None:
        st.session_state.pop("running_job", None)
        st.rerun()
        return

    progress = job.get("progress") or {}
    status = job.get("status")

    with card("🎬 Generation en cours", job.get("title_hint", ""), status=status):
        st.progress(
            min(100, int(progress.get("pct", 0))) / 100,
            text=f"{progress.get('step', 'Demarrage')} — {progress.get('message', '')}",
        )
        with st.expander("Journal technique"):
            st.code(worker.job_log(job_id) or "(en attente...)", language="text")

        if status == STATUS_PENDING_REVIEW:
            st.success("Video generee ! Elle vous attend dans **🚦 Moderation**.")
            if job.get("video_path") and Path(job["video_path"]).exists():
                st.video(job["video_path"])
            if st.button("Creer une autre video", type="primary"):
                st.session_state.pop("running_job", None)
                st.rerun()
            return

        if status == STATUS_FAILED:
            st.error(job.get("error") or "Erreur inconnue")
            if st.button("Retour au Studio", type="primary"):
                st.session_state.pop("running_job", None)
                st.rerun()
            return

    time.sleep(2)
    st.rerun()


# ---------------------------------------------------------------------------
# 📊 Analytics
# ---------------------------------------------------------------------------


def page_analytics() -> None:
    st.title("📊 Analytics")
    st.markdown(
        '<p class="subtitle">Performances reelles de vos Shorts et estimation '
        "de revenus.</p>",
        unsafe_allow_html=True,
    )

    published = worker.list_jobs(STATUS_PUBLISHED)
    video_ids = [
        j["publish"]["video_id"] for j in published
        if (j.get("publish") or {}).get("video_id")
    ]

    col_rpm, col_refresh = st.columns([3, 1])
    rpm = col_rpm.slider(
        "RPM estime (€ pour 1000 vues)", 0.05, 5.0, 0.35, 0.05,
        help="Le RPM des Shorts varie fortement selon la niche et le pays. "
             "Ajustez-le avec la valeur reelle de votre YouTube Studio.",
    )
    col_refresh.markdown("<div style='height:1.8rem'></div>", unsafe_allow_html=True)
    refresh = col_refresh.button("🔄 Actualiser", use_container_width=True)

    if not video_ids:
        st.info("Aucune video publiee pour l'instant.")
        return

    if refresh or "stats_cache" not in st.session_state:
        try:
            with st.spinner("Interrogation de l'API YouTube..."):
                st.session_state["stats_cache"] = worker.fetch_video_stats(video_ids)
        except Exception as exc:
            st.error(f"Impossible de recuperer les statistiques : {exc}")
            st.session_state.setdefault("stats_cache", {})

    stats = st.session_state.get("stats_cache", {})
    total_views = sum(s["views"] for s in stats.values())
    total_likes = sum(s["likes"] for s in stats.values())
    total_comments = sum(s["comments"] for s in stats.values())
    revenue = worker.estimate_revenue(total_views, rpm)

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Videos publiees", len(video_ids))
    col2.metric("Vues cumulees", f"{total_views:,}".replace(",", " "))
    col3.metric("Likes", f"{total_likes:,}".replace(",", " "))
    col4.metric("Revenus estimes", f"{revenue:,.2f} €".replace(",", " "))

    engagement = (total_likes + total_comments) / total_views * 100 if total_views else 0
    st.caption(f"Taux d'engagement moyen : **{engagement:.2f} %**")

    st.divider()
    st.subheader("Detail par video")

    rows = []
    for job in published:
        video_id = (job.get("publish") or {}).get("video_id")
        entry = stats.get(video_id, {"views": 0, "likes": 0, "comments": 0})
        rows.append(
            {
                "Titre": (job.get("publish") or {}).get("title", job["id"])[:60],
                "Publiee le": human_date(job.get("published_at", job["created_at"])),
                "Vues": entry["views"],
                "Likes": entry["likes"],
                "Commentaires": entry["comments"],
                "Revenus (€)": worker.estimate_revenue(entry["views"], rpm),
                "Lien": f"https://youtube.com/shorts/{video_id}",
            }
        )

    st.dataframe(
        rows,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Vues": st.column_config.NumberColumn("Vues", format="%d"),
            "Likes": st.column_config.NumberColumn("Likes", format="%d"),
            "Revenus (€)": st.column_config.NumberColumn("Revenus (€)", format="%.2f €"),
            "Lien": st.column_config.LinkColumn("Lien", display_text="Ouvrir"),
        },
    )

    if any(row["Vues"] for row in rows):
        st.subheader("Vues par video")
        st.bar_chart({row["Titre"]: row["Vues"] for row in rows})


# ---------------------------------------------------------------------------
# Routage
# ---------------------------------------------------------------------------

if page.startswith("🚦"):
    page_moderation()
elif page.startswith("🚀"):
    page_publications()
elif page.startswith("✨"):
    page_studio()
else:
    page_analytics()
