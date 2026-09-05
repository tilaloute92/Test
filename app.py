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

import time
from datetime import datetime
from pathlib import Path

import streamlit as st

import worker
from news_fetcher import TIME_WINDOWS, TOPIC_PRESETS, fetch_trends
from worker import (
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
    --line:      #e8e8ed;
    --ok:        #34c759;
    --warn:      #ff9f0a;
    --danger:    #ff3b30;
    --radius:    18px;
}

html, body, [class*="css"], .stApp {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI",
                 "Helvetica Neue", sans-serif;
    color: var(--ink);
}
.stApp { background: var(--bg); }
.block-container { padding-top: 2.2rem; max-width: 1180px; }

/* --- Titres --- */
h1 { font-weight: 700; letter-spacing: -0.025em; font-size: 2.4rem; }
h2 { font-weight: 650; letter-spacing: -0.018em; }
h3 { font-weight: 600; letter-spacing: -0.012em; font-size: 1.15rem; }
.subtitle { color: var(--ink-soft); font-size: 1.02rem; margin: -0.4rem 0 1.6rem 0; }

/* --- Cartes --- */
.card {
    background: var(--card);
    border-radius: var(--radius);
    padding: 1.4rem 1.6rem;
    border: 1px solid var(--line);
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.05);
    margin-bottom: 1.1rem;
}
.card h3 { margin: 0 0 .35rem 0; }
.card .meta { color: var(--ink-soft); font-size: .86rem; }

/* --- Badges de statut --- */
.badge {
    display: inline-block; padding: .18rem .7rem; border-radius: 999px;
    font-size: .74rem; font-weight: 600; letter-spacing: .01em;
}
.badge-wait  { background: #fff4e0; color: #b26a00; }
.badge-ok    { background: #e6f8ea; color: #1e7a35; }
.badge-live  { background: #e6f0ff; color: #0057c2; }
.badge-ko    { background: #ffe9e8; color: #c22a22; }

/* --- Boutons pilules --- */
.stButton > button, .stDownloadButton > button, .stFormSubmitButton > button {
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--accent);
    color: #fff;
    font-weight: 550;
    padding: .5rem 1.4rem;
    transition: background .15s ease, transform .1s ease;
}
.stButton > button:hover, .stDownloadButton > button:hover,
.stFormSubmitButton > button:hover {
    background: var(--accent-dk); color: #fff; transform: translateY(-1px);
}
.stButton > button:focus { box-shadow: 0 0 0 4px rgba(0,113,227,.18) !important; }
/* Bouton secondaire : contour gris */
.stButton > button[kind="secondary"] {
    background: #ffffff; color: var(--ink); border: 1px solid var(--line);
}
.stButton > button[kind="secondary"]:hover { background: #f0f0f3; color: var(--ink); }

/* --- Champs --- */
.stTextInput input, .stTextArea textarea, .stNumberInput input, .stSelectbox div[data-baseweb] {
    border-radius: 12px !important;
}

/* --- Sidebar --- */
section[data-testid="stSidebar"] {
    background: #fbfbfd; border-right: 1px solid var(--line);
}
section[data-testid="stSidebar"] .stRadio label { font-size: 1rem; padding: .18rem 0; }

/* --- Metriques --- */
div[data-testid="stMetric"] {
    background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 1rem 1.2rem;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
div[data-testid="stMetricLabel"] { color: var(--ink-soft); font-weight: 500; }

/* --- Expander (parametres avances) --- */
div[data-testid="stExpander"] {
    background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); box-shadow: none;
}

/* --- Divers --- */
.stProgress > div > div > div > div { background: var(--accent); }
hr { border-color: var(--line); }
footer, #MainMenu { visibility: hidden; }
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


def card_open(title: str, meta: str = "", status: str | None = None) -> None:
    status_html = f" {badge(status)}" if status else ""
    st.markdown(
        f'<div class="card"><h3>{title}{status_html}</h3>'
        f'<div class="meta">{meta}</div>',
        unsafe_allow_html=True,
    )


def card_close() -> None:
    st.markdown("</div>", unsafe_allow_html=True)


def human_date(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%d/%m %H:%M")
    except (TypeError, ValueError):
        return "?"


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
            models = worker.list_ollama_models()
            if models:
                st.success(f"Ollama : {', '.join(models)}")
            else:
                st.error(f"Ollama injoignable ({worker.OLLAMA_URL})")
            st.write("YouTube API :", "configuree" if worker.youtube_configured() else "absente")


# ---------------------------------------------------------------------------
# 🚦 Moderation
# ---------------------------------------------------------------------------


def page_moderation() -> None:
    st.title("🚦 Moderation")
    st.markdown(
        '<p class="subtitle">Visionnez chaque video generee, puis validez-la '
        "pour la publication ou rejetez-la.</p>",
        unsafe_allow_html=True,
    )

    jobs = worker.list_jobs([STATUS_PENDING_REVIEW, STATUS_FAILED])
    if not jobs:
        st.info("Aucune video en attente. Rendez-vous dans **✨ Studio IA & Actus** pour en creer une.")
        return

    for job in jobs:
        job_id = job["id"]
        script = job.get("script") or {}
        title = script.get("title") or job.get("title_hint") or job_id

        card_open(
            title,
            meta=f"{human_date(job['created_at'])} • {job.get('duration') or '?'} s "
                 f"• rendu en {job.get('render_seconds', '?')} s",
            status=job["status"],
        )

        if job["status"] == STATUS_FAILED:
            st.error(job.get("error") or "Erreur inconnue")
            with st.expander("Journal technique"):
                st.code(worker.job_log(job_id) or "(vide)", language="text")
            if st.button("🗑️ Supprimer", key=f"del_{job_id}", type="secondary"):
                worker.delete_job(job_id)
                st.rerun()
            card_close()
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
            if col_ok.button("✅ Valider", key=f"ok_{job_id}", use_container_width=True):
                worker.update_job(job_id, status=STATUS_APPROVED)
                st.toast("Video validee, direction Publications 🚀")
                st.rerun()
            if col_ko.button("❌ Rejeter", key=f"ko_{job_id}", type="secondary",
                             use_container_width=True):
                worker.update_job(job_id, status=STATUS_REJECTED)
                st.rerun()

        card_close()


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
        card_open(
            publish.get("title") or job.get("title_hint") or job_id,
            meta=f"{human_date(job['created_at'])} • {job.get('duration') or '?'} s",
            status=job["status"],
        )

        left, right = st.columns([1, 1.35], gap="large")
        with left:
            if job.get("video_path") and Path(job["video_path"]).exists():
                st.video(job["video_path"])

        with right:
            with st.form(f"publish_{job_id}"):
                title = st.text_input(
                    "Titre", value=publish.get("title", ""), max_chars=100,
                    help="Ajoutez #Shorts pour aider YouTube a classer la video.",
                )
                description = st.text_area(
                    "Description", value=publish.get("description", ""), height=140
                )
                tags = st.text_input(
                    "Tags (separes par des virgules)",
                    value=", ".join(publish.get("tags", [])),
                )
                privacy = st.selectbox(
                    "Visibilite", ["public", "unlisted", "private"], index=0,
                    format_func=lambda v: {"public": "Publique", "unlisted": "Non repertoriee",
                                           "private": "Privee"}[v],
                )
                submitted = st.form_submit_button("📤 Publier sur YouTube",
                                                  use_container_width=True)

            if submitted:
                tag_list = [t.strip() for t in tags.split(",") if t.strip()]
                worker.update_job(
                    job_id,
                    publish={**publish, "title": title, "description": description,
                             "tags": tag_list},
                )
                bar = st.progress(0, text="Envoi en cours...")
                try:
                    video_id = worker.upload_short(
                        job["video_path"], title, description, tag_list, privacy=privacy,
                        on_progress=lambda pct: bar.progress(pct, text=f"Envoi... {pct} %"),
                    )
                except Exception as exc:
                    bar.empty()
                    st.error(f"Echec de l'upload : {exc}")
                else:
                    bar.progress(100, text="Termine")
                    worker.update_job(
                        job_id, status=STATUS_PUBLISHED,
                        published_at=datetime.now().astimezone().isoformat(),
                        publish={**publish, "title": title, "description": description,
                                 "tags": tag_list, "video_id": video_id},
                    )
                    st.success(f"Publiee : https://youtube.com/shorts/{video_id}")
                    time.sleep(1.5)
                    st.rerun()

        card_close()


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
    card_open("📰 Actualite du jour", "Flux RSS Google News, dedoublonne")
    col_a, col_b, col_c = st.columns([2, 1.2, 1])
    preset = col_a.selectbox("Thematique", list(TOPIC_PRESETS.keys()))
    window = col_b.selectbox("Periode", list(TIME_WINDOWS.keys()))
    col_c.markdown("<div style='height:1.8rem'></div>", unsafe_allow_html=True)
    if col_c.button("🔄 Recuperer", use_container_width=True):
        with st.spinner("Lecture du flux Google News..."):
            st.session_state["trends"] = [
                t.to_dict()
                for t in fetch_trends(TOPIC_PRESETS[preset], limit=5,
                                      when=TIME_WINDOWS[window])
            ]
        if not st.session_state["trends"]:
            st.warning("Aucune actualite recuperee (verifiez votre connexion).")

    for index, trend in enumerate(st.session_state.get("trends", [])):
        row_text, row_button = st.columns([5, 1])
        row_text.markdown(f"**{trend['title']}**  \n`{trend['source']}`")
        if row_button.button("Utiliser", key=f"use_{index}", type="secondary",
                             use_container_width=True):
            st.session_state["topic_value"] = trend["title"]
            st.session_state["context_value"] = trend.get("summary", "")
            st.session_state["source_url"] = trend.get("link", "")
            st.rerun()
    card_close()

    # --- Formulaire de creation ---------------------------------------------
    card_open("🎬 Nouvelle video", "Les parametres avances sont facultatifs")

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

    col1, col2, col3 = st.columns(3)
    models = worker.list_ollama_models() or ["mistral", "llama3"]
    ollama_model = col1.selectbox("Modele Ollama", models)
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
            music_choices = asset_choices(worker.MUSIC_DIR)
            music_track = st.selectbox("Musique de fond", music_choices)
            music_volume = st.slider("Volume musique (dB)", -35.0, -3.0, -18.0, 0.5)
            ducking = st.checkbox(
                "Auto-ducking (la musique baisse quand la voix parle)", value=True
            )
            duck_ratio = st.slider("Force du ducking", 2.0, 20.0, 9.0, 0.5,
                                   disabled=not ducking)
            sfx_enabled = st.checkbox("Bruitages a chaque changement d'image", value=True)
            sfx_volume = st.slider("Volume bruitages (dB)", -30.0, 0.0, -12.0, 0.5,
                                   disabled=not sfx_enabled)

        with tab_subs:
            subtitles = st.checkbox("Sous-titres animes", value=True)
            whisper_model = st.selectbox(
                "Modele Whisper", ["tiny", "base", "small", "medium", "large-v3"], index=2,
                disabled=not subtitles,
            )
            words_per_caption = st.slider("Mots par sous-titre", 1, 5, 3,
                                          disabled=not subtitles)
            subtitle_size = st.slider("Taille du texte", 50, 110, 78, disabled=not subtitles)

    launch = st.button("🚀 Generer la video", use_container_width=True, type="primary")
    card_close()

    if launch:
        if not topic.strip():
            st.error("Indiquez un sujet (ou choisissez une actualite ci-dessus).")
            return

        settings = JobSettings(
            topic=topic.strip(),
            context=context.strip(),
            source_url=st.session_state.get("source_url", ""),
            language=language,
            tone=tone,
            n_scenes=n_scenes,
            ollama_model=ollama_model,
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

    card_open("🎬 Generation en cours", job.get("title_hint", ""), status=status)
    st.progress(
        min(100, int(progress.get("pct", 0))) / 100,
        text=f"{progress.get('step', 'Demarrage')} — {progress.get('message', '')}",
    )
    with st.expander("Journal technique"):
        st.code(worker.job_log(job_id) or "(en attente...)", language="text")
    card_close()

    if status == STATUS_PENDING_REVIEW:
        st.success("Video generee ! Elle vous attend dans **🚦 Moderation**.")
        if job.get("video_path") and Path(job["video_path"]).exists():
            st.video(job["video_path"])
        if st.button("Creer une autre video"):
            st.session_state.pop("running_job", None)
            st.rerun()
        return

    if status == STATUS_FAILED:
        st.error(job.get("error") or "Erreur inconnue")
        if st.button("Retour au Studio"):
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
        column_config={"Lien": st.column_config.LinkColumn("Lien", display_text="Ouvrir")},
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
