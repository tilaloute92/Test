# -*- coding: utf-8 -*-
"""
Tests unitaires des parties "pures" du pipeline : ils tournent sans GPU,
sans FFmpeg et sans modele IA.

    python tests/test_units.py     (ou : pytest tests)
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import worker  # noqa: E402
from worker import (  # noqa: E402
    LLM_PROVIDERS,
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


def test_every_provider_has_a_backend_and_an_identity() -> None:
    for key, provider in LLM_PROVIDERS.items():
        assert provider.key == key
        assert provider.kind in worker._LLM_DISPATCH, f"{key}: backend inconnu"
        # Seule l'entree generique part sans adresse : l'utilisateur la saisit.
        assert provider.base_url or provider.editable_url, f"{key}: adresse manquante"
        # Un fournisseur distant doit dire quelle variable d'environnement lire.
        assert provider.local or provider.env_var, f"{key}: env_var manquante"
        # Chaque fournisseur annonce son offre gratuite et ou obtenir la cle.
        assert provider.free_tier, f"{key}: palier gratuit non documente"
        assert provider.local or provider.signup_url or provider.editable_url


def test_no_paid_only_provider_is_offered() -> None:
    """Le registre ne doit proposer que du gratuit (local ou a quota)."""
    # OpenAI et Anthropic n'ont aucun palier gratuit : ils ont ete retires.
    assert "openai" not in LLM_PROVIDERS
    assert "anthropic" not in LLM_PROVIDERS
    assert "anthropic" not in worker._LLM_DISPATCH


def test_openrouter_only_exposes_free_models() -> None:
    catalogue = [
        "deepseek/deepseek-r1:free",
        "openai/gpt-4o",            # payant : doit disparaitre
        "meta-llama/llama-3.3-70b-instruct:free",
        "anthropic/claude-sonnet-5",  # payant : doit disparaitre
    ]
    kept = worker.keep_free_models(LLM_PROVIDERS["openrouter"], catalogue)
    assert kept == ["deepseek/deepseek-r1:free",
                    "meta-llama/llama-3.3-70b-instruct:free"]
    # Un fournisseur entierement gratuit n'est pas filtre.
    assert worker.keep_free_models(LLM_PROVIDERS["groq"], ["a", "b"]) == ["a", "b"]


def test_payloads_request_json_from_each_backend() -> None:
    settings = JobSettings(llm_model="m", llm_temperature=0.7)
    assert worker.build_ollama_payload(settings, "S", "P")["format"] == "json"
    openai = worker.build_openai_payload(settings, "S", "P")
    assert openai["response_format"] == {"type": "json_object"}
    assert [m["role"] for m in openai["messages"]] == ["system", "user"]
    gemini = worker.build_gemini_payload(settings, "S", "P")
    assert gemini["generationConfig"]["responseMimeType"] == "application/json"
    assert gemini["systemInstruction"]["parts"][0]["text"] == "S"


def test_default_model_resolution_and_legacy_migration() -> None:
    assert JobSettings().llm_model == "mistral"
    # Un job ecrit avant l'ajout des fournisseurs ne reference qu'ollama_model.
    assert JobSettings.from_dict({"ollama_model": "llama3:8b"}).llm_model == "llama3:8b"
    assert JobSettings(llm_provider="ollama").llm_model == "mistral"
    # Un fournisseur inconnu retombe sur le defaut au lieu de faire planter le job.
    assert JobSettings(llm_provider="inexistant").llm_provider == worker.DEFAULT_PROVIDER


def test_api_key_precedence_and_storage() -> None:
    original_file, original_env = worker.KEYS_FILE, os.environ.get("GROQ_API_KEY")
    worker.KEYS_FILE = Path(tempfile.mkdtemp()) / "keys.json"
    os.environ.pop("GROQ_API_KEY", None)
    try:
        assert worker.get_api_key("groq") == ""
        worker.set_api_key("groq", "sk-depuis-le-fichier")
        assert worker.get_api_key("groq") == "sk-depuis-le-fichier"
        # L'environnement l'emporte sur la saisie de l'interface.
        os.environ["GROQ_API_KEY"] = "sk-depuis-l-environnement"
        assert worker.get_api_key("groq") == "sk-depuis-l-environnement"
        os.environ.pop("GROQ_API_KEY")
        worker.set_api_key("groq", "")
        assert worker.get_api_key("groq") == ""
        # Un fournisseur local n'a jamais de cle.
        assert worker.get_api_key("ollama") == ""
    finally:
        shutil.rmtree(worker.KEYS_FILE.parent, ignore_errors=True)
        worker.KEYS_FILE = original_file
        if original_env is not None:
            os.environ["GROQ_API_KEY"] = original_env


def test_job_files_never_contain_an_api_key() -> None:
    original_file = worker.KEYS_FILE
    worker.KEYS_FILE = Path(tempfile.mkdtemp()) / "keys.json"
    try:
        worker.set_api_key("groq", "sk-secret-a-ne-pas-ecrire")
        job = worker.create_job(JobSettings(llm_provider="groq", llm_model="modele-test"))
        try:
            written = worker.job_path(job["id"]).read_text(encoding="utf-8")
            assert "sk-secret-a-ne-pas-ecrire" not in written
            assert "modele-test" in written  # le modele, lui, est bien enregistre
        finally:
            worker.delete_job(job["id"])
    finally:
        shutil.rmtree(worker.KEYS_FILE.parent, ignore_errors=True)
        worker.KEYS_FILE = original_file


def test_base_url_override_wins_over_the_registry() -> None:
    assert worker.provider_base_url(JobSettings()) == LLM_PROVIDERS["ollama"].base_url
    custom = JobSettings(llm_provider="lmstudio", llm_base_url="http://192.168.1.20:1234/v1/")
    assert worker.provider_base_url(custom) == "http://192.168.1.20:1234/v1"


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
