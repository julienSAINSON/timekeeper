# SAFe Timekeeper

Application web front-end pour piloter le temps d'une plénière SAFe avec un PDF projeté, une timeline lisible de loin et une dette de temps visible en permanence.

## Fonctionnalités V1

- Import d'un PDF avec détection automatique du nombre de pages
- Saisie des heures de début et de fin de plénière à la minute près
- Configuration manuelle des créneaux avec validations
- Visualisation proportionnelle du temps non dédié aux slides dans la timeline
- Sauvegarde locale de la configuration via `localStorage`
- Mode présentation avec rendu PDF via PDF.js
- Navigation clavier et boutons
- Chronomètre global et chronomètre du créneau courant
- États visuels vert, orange, rouge
- Affichage de la dette de temps et de la fin estimée
- Pause, reprise, reset et plein écran

## Structure

```text
/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── config.js
│   ├── pdfViewer.js
│   ├── supabase.js
│   ├── timeline.js
│   └── timer.js
├── supabase/
│   └── schema.sql
└── README.md
```

## Synchronisation Supabase

La configuration et l'état de présentation peuvent être partagés au moyen d'un lien, sans compte utilisateur. Donnez d'abord un nom au projet, puis utilisez « Sauvegarder » : lors du premier enregistrement, le lien partagé est créé automatiquement. Le PDF reste local : chaque personne qui ouvre le lien doit l'importer avant de démarrer la présentation.

1. Dans Supabase, ouvrez `SQL Editor`.
2. Copiez puis exécutez tout le contenu de [supabase/schema.sql](supabase/schema.sql).
3. Déployez l'application puis utilisez le bouton « Créer un lien partagé ».

Après toute mise à jour du projet, réexécutez ce script : il crée ou met à jour les fonctions Supabase, notamment la suppression de projet.

Le lien contient un jeton UUID qui donne accès à la plénière. Partagez-le uniquement avec les personnes autorisées à voir ou modifier cette configuration.

Le bouton « Nouveau projet » remet la configuration locale à zéro sans supprimer les projets sauvegardés. Le bouton « Mes projets » liste les projets partagés ouverts sur le navigateur courant. Le bouton « Ouvrir » charge leur dernière configuration pour modification ; le PDF doit alors être réimporté avant le lancement. Le bouton « Supprimer » efface définitivement le projet de Supabase et invalide son lien partagé.

Avant d'ouvrir un autre projet, de créer un nouveau projet ou d'effacer la configuration, l'application demande confirmation lorsque le projet courant contient des modifications qui ne sont pas encore sauvegardées.

## Lancer localement

Option la plus simple :

1. Cloner le dépôt.
2. Ouvrir `index.html` dans Chrome.

Cette ouverture directe en `file://` fonctionne mieux avec la configuration actuelle de `PDF.js`, mais un serveur local reste plus fiable selon les règles de sécurité du navigateur et les extensions installées.

Option recommandée pour éviter les limitations possibles de certains navigateurs avec les modules et les workers PDF :

1. Cloner le dépôt.
2. Servir le dossier avec un serveur statique léger.
3. Ouvrir l'URL locale dans Chrome.

Exemples :

```bash
python -m http.server 8080
```

ou

```bash
npx serve .
```

Puis ouvrir `http://localhost:8080` ou l'URL affichée.

## Déploiement GitHub Pages

1. Pousser le contenu du dépôt sur GitHub.
2. Aller dans `Settings` > `Pages`.
3. Choisir la branche à publier, par exemple `main`, dossier `/root`.
4. Enregistrer.
5. Ouvrir l'URL GitHub Pages générée.

Le projet est 100 % front-end, sans build, donc le déploiement est direct.

## Notes d'usage

- Le PDF importe est conserve en memoire pour la session en cours.
- La configuration des creneaux est sauvegardee dans le navigateur courant.
- Les heures de début et de fin définissent la durée globale de la plénière. La somme des créneaux ne peut pas la dépasser.
- Quand les créneaux sont plus courts que la plénière, le reliquat apparaît comme « Temps non dédié » dans la timeline.
- Apres un rechargement de page, il faut reimporter le PDF avant de relancer la presentation.
- La dette de temps affichée en V1 correspond au dépassement du créneau actuel tant que ses slides ne sont pas terminées.
- Le planning reste fixe volontairement pour rendre le retard visible, sans redistribuer automatiquement les durées suivantes.
