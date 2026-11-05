# Banc d'essai — tenue en charge d'une page

## À quoi ça sert

Savoir, chiffres à l'appui, combien d'équipements une page supporte avant de devenir
pénible. Le seuil d'avertissement affiché dans l'application (`SEUIL_PAGE_CHARGEE`
dans `Canvas.tsx`) vient d'ici : si vous le changez, remesurez.

## Comment s'en servir

```bash
npm run build
npx vite preview --port 4173 &
node tools/banc/generer-schema.mjs 300
node tools/banc/generer-schema.mjs 800
node tools/banc/generer-schema.mjs 2000
node tools/banc/mesurer.mjs http://127.0.0.1:4173/
```

Mesurez toujours sur `vite preview`, jamais sur `vite` : le serveur de développement est
environ deux fois plus lent, et donnerait des chiffres dont on tirerait de mauvaises
conclusions.

Le générateur produit une topologie plausible — cœur redondé, distribution par bâtiment,
accès par étage, serveurs et postes — avec des coordonnées en couches. Des équipements
tous placés au même point fausseraient la mesure.

## Relevé de référence

Build de production, Chromium, fenêtre 1600×950. Médiane de cinq prises.

| équipements | ouverture | redessin complet | recherche inventaire | filtre VLAN | placement auto |
|---|---|---|---|---|---|
| 29 | 1 685 ms | 110 ms | 101 ms | 51 ms | 177 ms |
| 300 | 1 950 ms | 247 ms | 144 ms | 83 ms | 323 ms |
| 800 | 2 810 ms | 618 ms | 122 ms | 225 ms | 749 ms |
| 2 000 | 5 753 ms | 2 783 ms | 124 ms | 1 034 ms | 3 410 ms |

Ce que ce relevé dit :

- **Jusqu'à 300 équipements, tout est confortable** : un redessin complet tient sous le
  quart de seconde.
- **À 800, c'est encore utilisable** — 618 ms par redessin, perceptible mais supportable.
- **À 2 000, ça ne l'est plus** : 2,4 à 2,8 s par redessin et 3,1 à 3,4 s de placement
  automatique sur trois prises. C'est le palier où le travail interactif s'arrête.
- **La recherche de l'inventaire ne bouge pas** (101 à 144 ms quelle que soit la taille) :
  le rendu par fenêtre fait son travail.

Un mot sur la mémoire : le banc la relève aussi, mais le chiffre ne vaut rien tel quel.
Trois prises identiques à 2 000 équipements ont donné 202, 441 et 853 Mo — c'est le
passage du ramasse-miettes qu'on mesure, pas la consommation de l'application. Ne tirez
aucune conclusion de cette colonne sans un protocole qui force une collecte avant la
lecture. Les temps, eux, sont reproductibles à environ 15 % près.

Le goulot est le JavaScript, pas le navigateur : la mise en page du SVG seul a été mesurée
à 0 ms, tout le temps part dans le rendu React. Il y a environ 23 éléments SVG par
équipement. Simplifier le dessin aux faibles niveaux de zoom semble la piste évidente,
mais elle se heurte à l'architecture actuelle : la scène est calculée dans un `useMemo`
dont les dépendances excluent volontairement le zoom, sans quoi chaque cran de zoom
recalculerait tout. Un gain réel demande donc de séparer « quoi dessiner » de « avec
quel niveau de détail » — un chantier, pas un réglage.
