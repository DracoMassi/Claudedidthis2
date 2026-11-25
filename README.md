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
   Le test GitHub des Réglages vérifie maintenant la lecture du contenu : un jeton qui voit le dépôt mais n'a pas « Contents » est signalé avec la marche à suivre (avant, la bibliothèque affichait « Vérifie ton jeton » pour toutes les erreurs).
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

## Robustesse (erreurs 529/503, contrôle des imports, export vérifié)

- **Reprises** : surcharge (500, 502, 503, 504, 529) = attentes de 1, 2 et 4 s avec un peu d'aléa, 4 essais par modèle. Un quota court (≤ 20 s) est attendu ; un quota long fait passer au modèle suivant. Une clé refusée arrête tout de suite.
- **Modèle de secours** : Réglages → « Modèle de secours ». Il n'est essayé que si le principal reste indisponible. Vide : pas de secours.
- **Plafonds locaux** : une tentative refusée par le serveur (5xx) est remboursée dans le compteur.
- **Import de cours** : chaque lot est contrôlé (repères `<!-- page N -->` attendus, et, si le PDF a du texte, part des mots du PDF retrouvés dans la transcription, lot par lot et page par page). Un lot douteux est marqué « À contrôler » et peut être relancé seul. Une réponse coupée (MAX_TOKENS) est retranscrite page par page.
- **Reprise automatique** : après une pause réseau ou quota court, l'import repart seul (3 fois au plus).
- **Journal des appels** : « Détails des appels » (modèle, essai, résultat, durée) dans Générer et Cours.
- **Export PDF vérifié** : le PDF est fabriqué à partir des pages rendues, les pages vides sont refusées, puis le fichier est relu (en-tête, nombre de pages). « Imprimer » reste disponible pour un PDF vectoriel, mais l'appli ne peut pas savoir si le fichier a été créé.

À vérifier sur l'iPad : un PDF de plusieurs pages en mode avion à mi-parcours (pause puis reprise), un lot suspect relancé seul, et l'export PDF vérifié d'une fiche de 3 pages.

### Tâches longues, bascule de modèle, références et couleurs

- **Progression conservée** : la génération et la transcription tournent hors des écrans. En changeant d'onglet, un bandeau garde la progression visible (phrase d'état, étape, temps écoulé qui défile, compte à rebours avant reprise), le titre de l'onglet du navigateur affiche « ⏳ Tour 2/4 », et une alerte prévient avant de recharger la page. Sur iPad, mettre l'appli en arrière-plan peut suspendre la requête en cours : reste dans l'appli pendant une génération.
- **Modèle utilisé** : bouton Principal / Secours dans Réglages, Générer et Cours. Le modèle choisi passe en premier, l'autre sert de repli ; la bascule agit dès le prochain envoi.
- **Bibliothèque vers Générer** : « Envoyer vers Générer » (fiche entière) ou « Choisir des blocs pour Générer » (cases à cocher). Les blocs deviennent des références dans Générer (retrait bloc par bloc, mode « s'en inspirer » ou « les reprendre dans la fiche »). On peut aussi déposer un .json de fiche ou coller du JSON. Les références sont gardées sur l'appareil.
- **Couleurs des fiches** : Réglages → Couleurs des fiches (palettes prêtes ou personnalisées : titres, sous-titres et pièges, logo), et un choix rapide à côté de l'aperçu. Elles s'appliquent à l'aperçu, à l'impression et aux exports PDF et PNG de toutes les fiches de cet appareil ; elles ne sont pas écrites dans le JSON de la fiche (le schéma refuse les champs inconnus).

## Limites connues

- Le site ne se recharge pas hors connexion (pas de service worker).
- L'icône est un gabarit : remplace `public/*.png` par le logo Séquentia.
- Les appels réels à Gemini et à GitHub n'ont été testés qu'avec des réponses simulées.
