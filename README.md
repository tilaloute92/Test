# 🎬 SaaS Video Studio

Application **Desktop Windows** qui automatise la production de vidéos courtes
(Shorts / TikTok / Reels) pour des chaînes *faceless*. Tout tourne **en local** :
aucun abonnement, aucune donnée envoyée à un service tiers (hors publication YouTube).

```
Google News ─┐
             ├─> LLM au choix (script) ─> XTTSv2 (voix) ─> Stable Diffusion (images)
             │                            │
             │                            └─> Whisper (sous-titres animés)
             │                                          │
             └──────────────> FFmpeg (Ken Burns + ducking + SFX) ─> Short 1080x1920
```

## Installation (3 étapes)

1. **Python 3.11** depuis [python.org](https://www.python.org/downloads/release/python-3119/)
   en cochant *« Add Python to PATH »*.
2. Double-cliquez sur **`install.bat`** (crée l'environnement et installe les librairies).
3. Installez les 3 briques externes :

| Brique | Où | Commande / action |
|---|---|---|
| **FFmpeg** | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) | ajoutez-le au PATH **ou** copiez `ffmpeg.exe` + `ffprobe.exe` dans `.\bin` |
| **Ollama** *(ou un autre fournisseur, voir plus bas)* | [ollama.com](https://ollama.com) | `ollama pull mistral` |
| **Musiques / bruitages** | vos fichiers | déposez-les dans `assets\music` et `assets\sfx` |

Puis lancez **`lancer_studio.bat`** : le navigateur s'ouvre sur `localhost:8501`.

> Vérifiez votre installation à tout moment : `venv\Scripts\python worker.py --doctor`

## Choisir le modele qui ecrit les scripts

L'onglet **✨ Studio IA & Actus** expose deux listes deroulantes : le
**fournisseur**, puis le **modele**. La liste des modeles est interrogee en
direct (Ollama, LM Studio, OpenAI, Mistral, Groq, Gemini) ; si le service est
eteint ou la cle absente, le champ devient une saisie libre.

| Fournisseur | Cle requise | Ou la trouver |
|---|---|---|
| 🖥️ Ollama (local) | non | `ollama pull mistral` |
| 🖥️ LM Studio / serveur compatible OpenAI (local) | non | adresse modifiable (llama.cpp, vLLM, Jan...) |
| ☁️ Anthropic (Claude) | `ANTHROPIC_API_KEY` | console.anthropic.com |
| ☁️ OpenAI | `OPENAI_API_KEY` | platform.openai.com |
| ☁️ Mistral AI | `MISTRAL_API_KEY` | console.mistral.ai |
| ☁️ Groq | `GROQ_API_KEY` | console.groq.com |
| ☁️ Google Gemini | `GEMINI_API_KEY` | aistudio.google.com |
| 🔌 Autre API compatible OpenAI | `LLM_API_KEY` | OpenRouter, Together, DeepSeek... |

Seule l'ecriture du script change de moteur : la voix, les images et les
sous-titres restent 100 % locaux.

**Ou vont les cles ?** Une cle saisie dans l'interface est ecrite dans
`data/llm_keys.json` (ignore par Git). Une variable d'environnement du meme nom
est toujours prioritaire. Les cles ne sont **jamais** recopiees dans les
fichiers de job — un test le verifie.

**Ajouter un fournisseur** revient a ajouter une entree dans le dictionnaire
`LLM_PROVIDERS` de `worker.py`. Si son API est compatible OpenAI (`kind:
"openai"`), il n'y a pas une ligne de code supplementaire a ecrire.

## Configuration YouTube (optionnelle)

1. [Google Cloud Console](https://console.cloud.google.com/) → nouveau projet.
2. Activez **YouTube Data API v3**.
3. *Identifiants* → *Créer* → **ID client OAuth** → type **Application de bureau**.
4. Téléchargez le JSON, renommez-le **`client_secret.json`**, placez-le à la racine.

La première publication ouvre une fenêtre d'autorisation Google ; le jeton est
ensuite mémorisé dans `data/youtube_token.json`.

> Le quota par défaut de l'API est de 10 000 unités/jour, soit **~6 uploads/jour**
> (1600 unités par envoi). Les statistiques ne coûtent qu'1 unité par appel.

## Les 4 onglets

| Onglet | Rôle |
|---|---|
| 🚦 **Modération** | lecteur vidéo + script, boutons *Valider* / *Rejeter* |
| 🚀 **Publications** | titre, description, tags, visibilité → upload YouTube Shorts |
| ✨ **Studio IA & Actus** | actu du jour (RSS) ou sujet libre + paramètres avancés |
| 📊 **Analytics** | vues, likes, engagement et revenus estimés via un RPM réglable |

## Architecture

| Fichier | Rôle |
|---|---|
| `news_fetcher.py` | flux RSS Google News, nettoyage et déduplication des 5 tendances |
| `worker.py` | moteur backend : fournisseurs LLM, script → voix → images → sous-titres → mixage → rendu |
| `app.py` | interface Streamlit (design system « Apple ») |
| `tests/test_units.py` | tests des fonctions pures (sans GPU ni FFmpeg) |

### Pourquoi un sous-processus plutôt qu'un thread ?

Streamlit ré-exécute son script à chaque interaction : un thread de génération
serait fragile et garderait plusieurs Go de VRAM occupés. `app.py` lance donc
`python worker.py --job <id>` ; le worker écrit sa progression dans
`data/jobs/<id>.json` que l'UI relit toutes les 2 secondes, et la VRAM est
intégralement libérée à la fin du rendu.

### Le mixage audio

Le graphe FFmpeg est construit par `build_audio_filter()` (fonction pure, testée) :

```
[voix] ──┬──────────────────────────────┐
         └─(sidechain)─> [musique] ─────┤
                            [SFX ×N] ───┴─> amix ─> alimiter ─> AAC
```

`sidechaincompress` fait baisser la musique dès que la voix parle (auto-ducking),
avec un seuil, un ratio et un temps de release réglables depuis l'interface.

## Matériel recommandé

| | Minimum | Confortable |
|---|---|---|
| GPU | 6 Go VRAM (SD 1.5) | 12 Go VRAM (SDXL) |
| RAM | 16 Go | 32 Go |
| Disque | 30 Go (modèles) | 60 Go |

Sans GPU NVIDIA, tout fonctionne sur CPU mais un Short de 40 s demande
facilement 30 à 60 minutes de rendu.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `FFmpeg est introuvable` | FFmpeg absent du PATH → copiez-le dans `.\bin` |
| `Ollama injoignable` | le service n'est pas démarré → `ollama serve`, ou basculez sur un fournisseur cloud |
| `CUDA out of memory` | baissez les étapes de diffusion, ou passez sur SD 1.5 |
| Sous-titres absents | Whisper n'a rien détecté → vérifiez la langue choisie |
| Voix robotique | échantillon trop court ou bruité → WAV mono 16 kHz, 6 à 20 s |
