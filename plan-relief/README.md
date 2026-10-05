# Plan Relief

Application web qui transforme un plan 2D (DXF ou PDF vectoriel) en maquette 3D, puis l'exporte en GLB, OBJ ou STL.

Tout tient dans `index.html` : pas d'installation ni de serveur. Les bibliothèques (Three.js, dxf-parser, pdf.js) sont chargées depuis un CDN, donc une connexion internet est nécessaire.

## Lancer

Ouvrir `index.html` dans un navigateur récent (Chrome, Edge, Firefox, Safari). Si le navigateur bloque les modules en `file://`, servir le dossier :

```bash
cd plan-relief && python3 -m http.server 8000
# puis http://localhost:8000
```

Un plan d'exemple (appartement T3) est chargé au démarrage.

## Utilisation

1. **Importer** un `.dxf` ou un `.pdf` (bouton ou glisser-déposer).
2. **Échelle** : pour un DXF, l'unité est lue dans l'en-tête (`$INSUNITS`) ou déduite de la taille du dessin. Pour un PDF, saisir l'échelle du plan (1:50, 1:100…).
3. **Calques** : choisir le rôle de chaque calque.
   - *Murs* : montés à la hauteur indiquée. Les murs en double trait sont remplis entre leurs deux faces. Un trait seul devient un mur de l'épaisseur « Murs en trait simple ». Les aplats pleins d'un PDF sont extrudés tels quels, trous compris.
   - *Fenêtres* : chaque symbole (groupe de traits qui se touchent) donne une allège, un vitrage et un linteau.
   - *Portes* : dessinées au sol. L'ouverture reste visible grâce à la coupure du mur.
   - *Plan au sol* : mobilier, sanitaires… tracés au sol.
   - *Ignorer* : cotes, textes, hachures…
4. **Dimensions** : hauteur des murs, allège et hauteur des fenêtres, dalle de sol.
5. **Exporter** : GLB (Blender, visionneuses web), OBJ (SketchUp, 3ds Max…), STL (impression 3D, orienté Z vers le haut). Coordonnées en mètres.

Les rôles sont devinés à partir des noms de calques (`MUR`, `WALL`, `CLOISON` → murs ; `FEN`, `WIN`, `VITR` → fenêtres ; `PORTE`, `DOOR` → portes ; `COTE`, `DIM`, `TEXT`, `HACH` → ignorés).

## Formats

| Format | Prise en charge |
|---|---|
| DXF | LINE, LWPOLYLINE/POLYLINE (arcs compris), ARC, CIRCLE, ELLIPSE, SPLINE (approchée), SOLID, blocs INSERT imbriqués. Textes, cotes et hachures ignorés. |
| DWG | Non lisible directement (format fermé). Convertir en DXF : AutoCAD « Enregistrer sous → DXF », ou ODA File Converter (gratuit). |
| PDF vectoriel | Tracés et aplats de la page choisie, regroupés par épaisseur et couleur, car un PDF n'a pas de calques. |
| PDF scanné | Non pris en charge : une image ne contient aucun trait exploitable. |

## Limites

- Une seule hauteur de mur pour tout le plan. Pas d'étages, de toitures ni d'escaliers.
- Pas de linteau au-dessus des portes.
- La détection des murs en double trait suppose des faces parallèles distantes de 3 cm à « Épaisseur max. » (60 cm par défaut).
