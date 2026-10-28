# Séquentia : site de génération et de relecture de fiches

Site statique (GitHub Pages) pour générer, relire, valider et exporter des fiches, et importer des cours en Markdown, depuis un iPad. Aucun serveur : l'app tourne dans le navigateur, appelle Gemini avec ta clé et lit/écrit tes fiches dans ton dépôt privé `Fiches`.

- Spec : `docs/superpowers/specs/2026-10-26-sequentia-site-design.md`
- Plan d'implémentation : `docs/superpowers/plans/2026-10-26-sequentia-site.md`

## Mise en route

1. **Dépôt du site** : crée un dépôt **public** (GitHub Pages gratuit l'exige) et pousse ce projet. Il ne contient ni fiches, ni cours, ni polices.
2. **Activer Pages** : *Settings → Pages → Source : GitHub Actions*. Le workflow `deploy` publie `dist/` à chaque envoi sur `main`.
3. **Jeton GitHub** (sur ton compte) : *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
   - *Repository access* : **Only select repositories**, uniquement `Fiches`.
   - *Permissions → Repository permissions → Contents* : **Read and write**.
   - *Expiration* : une date (par exemple 90 jours).
4. **Réglages dans l'app** : colle ta clé Gemini (Google AI Studio), le jeton, le propriétaire et le nom du dépôt (`Fiches`), puis « Tester la connexion » pour GitHub et pour Gemini. Ces valeurs restent sur l'appareil.
5. **Écran d'accueil de l'iPad** : dans Safari, *Partager → Sur l'écran d'accueil*. Safari peut effacer les données d'un site visité rarement, sauf s'il est installé ainsi (à vérifier sur ton iPad).
6. **Contenu du dépôt `Fiches`** : `charte.md`, `fonts/` (`Andaluz-Regular.otf`, `melbourne.ttf`, `melbournebold.ttf`), puis `corpus/json/<matière>/` et `corpus/cours/<matière>/` remplis par l'app. Pour la checklist de relecture, ajoute dans `charte.md` une section `## Checklist de relecture` (une puce par contrôle) ; sinon, trois contrôles par défaut s'appliquent.

## Développement

```bash
npm ci
npm test        # Vitest + jsdom
npm run build   # tsc + vite build, sortie dans dist/
npm run dev
```

Parité avec `validate.py` (en local, avec un dossier de fiches) : `node scripts/parity.mjs ../Fiches/corpus/json` doit donner les mêmes verdicts OK/ERREUR que `python validate.py`.

## Checklist de contrôle manuel (à faire sur l'iPad)

Les tests automatiques ne couvrent ni les écrans, ni Safari. Coche chaque ligne :

- [ ] Le site s'ouvre depuis l'écran d'accueil, plein écran, avec l'icône.
- [ ] Réglages : « Tester la connexion » répond « connecté » pour GitHub et pour Gemini.
- [ ] Les polices Andaluz et Melbourne se chargent (titres des fiches en Andaluz, titres de section en Melbourne) ; sans jeton, Inter prend le relais.
- [ ] Thème : les quatre préréglages ; mode Auto, Clair et Sombre ; en Auto, la bascule suit le réglage de l'iPad ; alerte de contraste sur une couleur illisible ; « Réinitialiser le thème ».
- [ ] **Générer** : importer un brief (`continuite-2-tvi.json`), lancer, voir la progression par tour ; vérifier qu'une fiche arrive en brouillon ; le compteur de requêtes avance.
- [ ] **Relire** : modifier un bloc, voir l'aperçu et les contrôles changer ; cocher la checklist ; **Valider** n'est actif qu'ensuite ; valider crée un commit dans `Fiches/corpus/json/…` ; provoquer un conflit (modifier le fichier sur GitHub puis valider) : l'app propose comparer, écraser ou annuler.
- [ ] **Bibliothèque** : la fiche validée apparaît ; filtres et recherche ; « Marquer comme exemple de style » ; « Refaire à partir de ce brief ».
- [ ] **Export PDF** : l'impression Safari donne des pages aux bonnes dimensions ; « Enregistrer dans Fichiers » ; formules et polices visibles.
- [ ] **Export PNG** : l'image n'est pas blanche, formules et polices visibles. Sinon : retire le bouton PNG de `src/ui/Library.tsx` et garde le PDF (spec §12, risque 1).
- [ ] **Cours** : importer un PDF de 3 pages, lancer, relire côte à côte (page source à gauche, rendu à droite), enregistrer ; retrouver le cours dans la Bibliothèque ; couper le réseau en cours d'import puis reprendre : la progression est conservée.
- [ ] Hors connexion : un message clair s'affiche à l'enregistrement et le brouillon est conservé.

## Limites connues

- Le site ne se recharge pas hors connexion (pas de service worker).
- L'icône est un gabarit : remplace `public/*.png` par le logo Séquentia.
- Les appels réels à Gemini et à GitHub n'ont été testés qu'avec des réponses simulées.
