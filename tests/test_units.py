# -*- coding: utf-8 -*-
"""
Tests unitaires des parties "pures" du pipeline : ils tournent sans GPU,
sans FFmpeg et sans modele IA.

    python tests/test_units.py     (ou : pytest tests)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worker  # noqa: E402
from worker import (  # noqa: E402
    JobSettings,
    _ass_time,
    _extract_json,
    _normalize_script,
    build_audio_filter,
    write_ass,
)


def test_audio_filter_with_music_and_sfx() -> None:
    graph = build_audio_filter(JobSettings(), has_music=True, sfx_delays_ms=[0, 4200])
    assert "sidechaincompress" in graph          # ducking actif
    assert "[3:a]" in graph and "[4:a]" in graph  # les SFX suivent la musique
    assert "amix=inputs=4" in graph
    assert graph.endswith("[audio]")


def test_audio_filter_without_music_shifts_sfx_inputs() -> None:
    graph = build_audio_filter(JobSettings(), has_music=False, sfx_delays_ms=[500])
    assert "[2:a]" in graph          # le premier SFX prend la place de la musique
    assert "sidechaincompress" not in graph


def test_audio_filter_voice_only_skips_amix() -> None:
    graph = build_audio_filter(JobSettings(), has_music=False, sfx_delays_ms=[])
    assert "amix" not in graph


def test_ducking_can_be_disabled() -> None:
    graph = build_audio_filter(
        JobSettings(ducking=False), has_music=True, sfx_delays_ms=[]
    )
    assert "sidechaincompress" not in graph
    assert "amix=inputs=2" in graph


def test_extract_json_survives_markdown_fences() -> None:
    raw = 'Voici :\n```json\n{"title": "A", "scenes": [{"narration": "Salut"}]}\n```'
    assert _extract_json(raw)["title"] == "A"


def test_normalize_script_repairs_incomplete_scenes() -> None:
    data = {
        "scenes": [
            {"narration": "Une phrase.", "sfx": "inconnu"},  # sfx invalide -> whoosh
            {"narration": "", "image_prompt": "vide"},        # scene vide -> ignoree
        ]
    }
    script = _normalize_script(data, JobSettings(topic="Jupiter"))
    assert len(script["scenes"]) == 1
    assert script["scenes"][0]["sfx"] == "whoosh"
    assert "Jupiter" in script["scenes"][0]["image_prompt"]
    assert script["full_text"] == "Une phrase."


def test_ass_timecodes_and_dialogue_count(tmp_path: Path | None = None) -> None:
    out = Path(tmp_path or ".") / "_subs_test.ass"
    words = [
        {"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35}
        for i, w in enumerate("le ciel etait rouge ce soir".split())
    ]
    write_ass(words, out, JobSettings())
    content = out.read_text(encoding="utf-8")
    # Un evenement par mot : le mot lu est surligne dans son groupe.
    assert content.count("Dialogue:") == len(words)
    assert "Style: Studio" in content
    out.unlink()
    assert _ass_time(3661.5) == "1:01:01.50"


def test_job_lifecycle(tmp_path: Path | None = None) -> None:
    job = worker.create_job(JobSettings(topic="Test"), title_hint="Test")
    try:
        assert worker.load_job(job["id"])["status"] == worker.STATUS_QUEUED
        worker.update_job(job["id"], status=worker.STATUS_APPROVED)
        assert job["id"] in {j["id"] for j in worker.list_jobs(worker.STATUS_APPROVED)}
    finally:
        worker.delete_job(job["id"])
    assert worker.load_job(job["id"]) is None


def test_revenue_estimation() -> None:
    assert worker.estimate_revenue(125_000, 0.35) == 43.75
    assert worker.estimate_revenue(0, 2.0) == 0.0


if __name__ == "__main__":
    failures = 0
    for name, func in sorted(globals().items()):
        if name.startswith("test_") and callable(func):
            try:
                func()
                print(f"[OK] {name}")
            except AssertionError as exc:
                failures += 1
                print(f"[KO] {name} -> {exc}")
    print("\n" + ("Tous les tests passent." if not failures else f"{failures} echec(s)."))
    raise SystemExit(1 if failures else 0)
