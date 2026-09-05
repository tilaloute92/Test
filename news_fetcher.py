# -*- coding: utf-8 -*-
"""
news_fetcher.py — Veille d'actualite via les flux RSS de Google News.

Ce module est volontairement sans dependance lourde : il ne fait que
recuperer, nettoyer et dedupliquer les titres du jour pour alimenter le
Studio IA. Aucun modele d'IA n'est charge ici.

Utilisation :
    from news_fetcher import fetch_trends, TOPIC_PRESETS
    trends = fetch_trends("science espace", limit=5)
    for t in trends:
        print(t.title, "-", t.source)
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import quote_plus

import feedparser

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RSS_TEMPLATE = (
    "https://news.google.com/rss/search"
    "?q={query}&hl={lang}-{country}&gl={country}&ceid={country}:{lang}"
)

# Themes pre-configures proposes dans l'UI (Studio IA & Actus).
TOPIC_PRESETS: dict[str, str] = {
    "🚀 Science & Espace": "science espace astronomie",
    "🤖 Intelligence Artificielle": "intelligence artificielle IA",
    "💰 Economie & Finance": "economie finance bourse",
    "🧠 Psychologie & Cerveau": "psychologie cerveau neurosciences",
    "🌍 Nature & Animaux": "nature animaux decouverte",
    "🕵️ Histoire & Mysteres": "histoire mystere archeologie",
    "⚽ Sport": "sport resultats",
    "🎮 Tech & Gaming": "technologie jeux video",
}

# Fenetres temporelles supportees par l'operateur `when:` de Google News.
TIME_WINDOWS: dict[str, str] = {
    "Dernieres 24h": "1d",
    "3 derniers jours": "3d",
    "7 derniers jours": "7d",
}

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")
# Google News suffixe systematiquement le titre par " - Nom du media".
_SOURCE_SUFFIX_RE = re.compile(r"\s+[-–—]\s+[^-–—]{2,40}$")


# ---------------------------------------------------------------------------
# Modele de donnees
# ---------------------------------------------------------------------------


@dataclass
class Trend:
    """Une tendance / actualite prete a etre transformee en Short."""

    title: str
    source: str
    link: str
    published: str  # ISO 8601, UTC
    summary: str = ""

    @property
    def published_dt(self) -> datetime | None:
        try:
            return datetime.fromisoformat(self.published)
        except (TypeError, ValueError):
            return None

    def age_label(self) -> str:
        """Retourne un age lisible ("il y a 3 h") pour l'affichage Streamlit."""
        dt = self.published_dt
        if dt is None:
            return "date inconnue"
        delta = datetime.now(timezone.utc) - dt
        if delta < timedelta(minutes=60):
            return f"il y a {max(1, int(delta.total_seconds() // 60))} min"
        if delta < timedelta(days=1):
            return f"il y a {int(delta.total_seconds() // 3600)} h"
        return f"il y a {delta.days} j"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Nettoyage
# ---------------------------------------------------------------------------


def _clean_html(raw: str) -> str:
    """Supprime les balises HTML et normalise les espaces."""
    if not raw:
        return ""
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    return _SPACE_RE.sub(" ", text).strip()


def _split_title_source(raw_title: str, fallback_source: str = "") -> tuple[str, str]:
    """Separe "Titre de l'article - Le Monde" en (titre, media)."""
    title = _clean_html(raw_title)
    source = fallback_source
    match = _SOURCE_SUFFIX_RE.search(title)
    if match:
        source = match.group(0).lstrip(" -–—").strip() or fallback_source
        title = title[: match.start()].strip()
    return title, source


def _normalize(text: str) -> str:
    """Forme canonique (sans accent, sans ponctuation) pour la deduplication."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return _SPACE_RE.sub(" ", text).strip()


def _is_duplicate(candidate: str, kept: list[str], threshold: float = 0.72) -> bool:
    """Vrai si le titre ressemble trop a un titre deja retenu."""
    norm = _normalize(candidate)
    if not norm:
        return True
    for other in kept:
        if SequenceMatcher(None, norm, other).ratio() >= threshold:
            return True
    return False


def _parse_date(entry: Any) -> str:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if parsed:
        return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------


def build_feed_url(query: str, lang: str = "fr", country: str = "FR", when: str = "1d") -> str:
    """Construit l'URL RSS Google News pour une recherche donnee."""
    full_query = query.strip()
    if when:
        full_query = f"{full_query} when:{when}"
    return RSS_TEMPLATE.format(
        query=quote_plus(full_query), lang=lang, country=country.upper()
    )


def fetch_trends(
    query: str,
    limit: int = 5,
    lang: str = "fr",
    country: str = "FR",
    when: str = "1d",
    min_title_length: int = 25,
) -> list[Trend]:
    """
    Recupere les tendances du jour pour une thematique.

    Retourne au maximum `limit` elements, dedupliques et tries du plus
    recent au plus ancien. Ne leve jamais d'exception reseau : en cas
    d'echec la liste retournee est vide (l'UI affiche alors un message).
    """
    url = build_feed_url(query, lang=lang, country=country, when=when)
    try:
        feed = feedparser.parse(url)
    except Exception:  # pragma: no cover - defensif (reseau / parsing)
        return []

    entries = list(getattr(feed, "entries", []) or [])
    entries.sort(key=lambda e: _parse_date(e), reverse=True)

    trends: list[Trend] = []
    seen: list[str] = []

    for entry in entries:
        fallback_source = ""
        source_obj = getattr(entry, "source", None)
        if source_obj is not None:
            fallback_source = getattr(source_obj, "title", "") or ""

        title, source = _split_title_source(getattr(entry, "title", ""), fallback_source)
        if len(title) < min_title_length:
            continue
        if _is_duplicate(title, seen):
            continue

        seen.append(_normalize(title))
        trends.append(
            Trend(
                title=title,
                source=source or "Google News",
                link=getattr(entry, "link", ""),
                published=_parse_date(entry),
                summary=_clean_html(getattr(entry, "summary", ""))[:400],
            )
        )
        if len(trends) >= limit:
            break

    return trends


def fetch_multi(
    queries: list[str], per_query: int = 3, **kwargs: Any
) -> list[Trend]:
    """Agrege plusieurs thematiques en une seule liste dedupliquee."""
    aggregated: list[Trend] = []
    seen: list[str] = []
    for query in queries:
        for trend in fetch_trends(query, limit=per_query, **kwargs):
            if _is_duplicate(trend.title, seen):
                continue
            seen.append(_normalize(trend.title))
            aggregated.append(trend)
    aggregated.sort(key=lambda t: t.published, reverse=True)
    return aggregated


if __name__ == "__main__":  # Test manuel : python news_fetcher.py "science espace"
    import sys

    topic = sys.argv[1] if len(sys.argv) > 1 else "science espace"
    for i, item in enumerate(fetch_trends(topic), start=1):
        print(f"{i}. [{item.source} / {item.age_label()}] {item.title}")
