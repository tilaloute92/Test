# 🎬 SaaS Video Studio

Application **Desktop Windows** qui automatise la production de vidéos courtes
(Shorts / TikTok / Reels) pour des chaînes *faceless*. Tout tourne **en local** :
aucun abonnement, aucune donnée envoyée à un service tiers (hors publication YouTube).

```
Google News ─┐
             ├─> LLM au choix (script) ─> XTTSv2 (voix) ─> Stable Diffusion (images)
             │                            │                ou Wan 2.2 (clips animés)
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
| **Ollama** *(ou un autre fournisseur, voir plus bas)* | [ollama.com](https://ollama.com) | `ollama pull qwen3:8b` |
| **Musiques / bruitages** | vos fichiers | déposez-les dans `assets\music` et `assets\sfx` |

Puis lancez **`lancer_studio.bat`** : le navigateur s'ouvre sur `localhost:8501`.

> Vérifiez votre installation à tout moment : `venv\Scripts\python worker.py --doctor`

## Choisir le modele qui ecrit les scripts (que du gratuit)

L'onglet **✨ Studio IA & Actus** expose deux listes deroulantes : le
**fournisseur**, puis le **modele**. La liste des modeles est interrogee en
direct ; si le service est eteint ou la cle absente, le champ devient une
saisie libre.

**Aucun fournisseur payant n'est propose.** OpenAI et Anthropic n'ayant pas de
palier gratuit, ils ne figurent pas dans la liste.

| Fournisseur | Cle | Ce que donne le gratuit |
|---|---|---|
| 🖥️ **Ollama** (local) | aucune | **Illimite**, tourne sur votre machine (Qwen3, Mistral, Llama...) |
| 🖥️ **LM Studio / serveur compatible OpenAI** (local) | aucune | **Illimite**, tourne sur votre machine |
| ☁️ [Google Gemini](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | Palier gratuit sans carte bancaire, quotas /min et /jour |
| ☁️ [Groq](https://console.groq.com/keys) | `GROQ_API_KEY` | Palier gratuit sans carte, tres rapide |
| ☁️ [Cerebras](https://cloud.cerebras.ai) | `CEREBRAS_API_KEY` | Palier gratuit sans carte, quota de jetons /jour |
| ☁️ [Mistral AI](https://console.mistral.ai/api-keys) | `MISTRAL_API_KEY` | Palier gratuit (« Experiment »), bon francais |
| ☁️ [OpenRouter](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` | **Seuls les modeles `:free` sont affiches** |
| ☁️ [GitHub Models](https://github.com/settings/personal-access-tokens) | `GITHUB_TOKEN` | Gratuit avec un compte GitHub (permission `models:read`) |
| 🔌 Autre API compatible OpenAI | `LLM_API_KEY` | A vous de verifier ses tarifs |

Pour OpenRouter, le filtrage est fait dans `worker.py`, pas dans l'interface :
un modele payant ne peut donc pas etre selectionne, meme depuis la ligne de
commande.

### Ou trouver Qwen, Kimi et les autres familles

Au-dela de huit modeles, un champ **« Filtrer les modeles »** apparait sous la
liste : tapez `qwen`, `kimi` ou `llama` pour la reduire. Le filtre porte sur
l'identifiant, ce qui marche quel que soit l'hebergeur (`qwen3:8b` chez Ollama,
`qwen/qwen3-30b-a3b:free` chez OpenRouter).

**Qwen est accessible gratuitement par plusieurs chemins**, et c'est le modele
preselectionne par defaut :

| Voie | Comment |
|---|---|
| En local | `ollama pull qwen3:8b` (8 Go de VRAM) ou `qwen3:14b` (16 Go) — Apache 2.0 |
| Groq, Cerebras | Qwen figure dans leur catalogue gratuit, la liste le remonte |
| OpenRouter | les variantes `qwen/...:free` apparaissent automatiquement |

**Kimi K3, en revanche, n'a aucune voie gratuite par API.** Le modele est sorti
en juillet 2026 en poids ouverts, mais :

- son API officielle est **payante** (~3 $ / 15 $ par million de jetons) ;
- ses 2,8 **milliers de milliards** de parametres le rendent inexecutable sur un
  PC, meme tres bien equipe — les poids ouverts ne servent qu'a des serveurs ;
- il est gratuit sur kimi.com, mais uniquement via l'interface web, sans API.

Si une variante gratuite de Kimi apparait chez OpenRouter, **elle s'affichera
d'elle-meme** dans la liste filtree : rien n'est code en dur cote modeles.

### Trois choses a savoir sur ces paliers gratuits

1. **Ils sont limites en debit**, pas en duree : quelques dizaines de requetes
   par minute ou par jour selon le service. Pour de gros volumes, revenez a
   Ollama en local.
2. **Vos donnees servent souvent a entrainer les modeles.** C'est la
   contrepartie habituelle du gratuit. Si le sujet de vos videos est sensible,
   restez en local.
3. **Les quotas changent.** Ceux indiques ici sont donnes a titre indicatif :
   l'application n'en depend pas et affiche simplement ce que le service repond.

**Ou vont les cles ?** Une cle saisie dans l'interface est ecrite dans
`data/llm_keys.json` (ignore par Git). Une variable d'environnement du meme nom
est toujours prioritaire. Les cles ne sont **jamais** recopiees dans les
fichiers de job — un test le verifie.

**Ajouter un fournisseur** revient a ajouter une entree dans le dictionnaire
`LLM_PROVIDERS` de `worker.py`. Si son API est compatible OpenAI (`kind:
"openai"`), il n'y a pas une ligne de code supplementaire a ecrire.

## Moteur visuel : images fixes ou video generee

Par defaut, chaque scene est une image Stable Diffusion animee d'un zoom
lent (Ken Burns) — rapide, tourne sur n'importe quelle machine.

Un second moteur est disponible dans **✨ Studio IA & Actus** › *Parametres
avances* › onglet **🎬 Video** : **[Wan 2.2](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers)**
(Alibaba, licence Apache 2.0), qui genere de vrais clips animes en local —
mouvement de camera et de sujet, pas un simple zoom sur une image figee.

**Ce que Wan est, et ce qu'il n'est pas :** c'est l'equivalent local et
gratuit le plus proche de services comme Veo 3 ou Kling. Ces deux-la ne sont
**pas proposes** dans le Studio : leurs API sont payantes des la premiere
seconde (~0,40 $/s pour Veo, forfait prepaye pour Kling), sans aucun palier
gratuit — meme leur abonnement grand public ne donne pas acces a l'API. Wan
tourne entierement sur votre machine, gratuitement et sans limite, mais le
cout se paie en **temps de calcul** :

| | Ken Burns (defaut) | Wan 2.2 |
|---|---|---|
| Cout | Gratuit, instantane | Gratuit, mais lent |
| VRAM recommandee | celle de Stable Diffusion | 8 Go minimum (repli CPU sinon) |
| Par scene animee | — | ≈ 4-5 minutes sur une carte recente |
| Rendu | zoom/travelling sur une image | vrai mouvement genere |

Le curseur **« Scenes animees par Wan »** limite le cout en temps : `1`
(par defaut) n'anime que le hook — la scene qui decide vraiment de la
retention — le reste garde une image fixe ; `0` anime toutes les scenes,
au prix de plusieurs dizaines de minutes de rendu supplementaire.

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
