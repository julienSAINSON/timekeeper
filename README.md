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
│   ├── supabaseConfig.js
│   ├── timeline.js
│   └── timer.js
├── supabase/
│   └── schema.sql
├── auth/
│   └── auth.js
└── README.md
```

## Synchronisation Supabase

La configuration et l'état de présentation peuvent être partagés au moyen d'un lien, sans compte utilisateur. Donnez d'abord un nom au projet, puis utilisez « Sauvegarder » : lors du premier enregistrement, le lien partagé est créé automatiquement. Le PDF reste local : chaque personne qui ouvre le lien doit l'importer avant de démarrer la présentation.

1. Dans Supabase, ouvrez `SQL Editor`.
2. Copiez puis exécutez tout le contenu de [supabase/schema.sql](supabase/schema.sql).
3. Déployez l'application puis utilisez le bouton « Créer un lien partagé ».

Après toute mise à jour du projet, réexécutez ce script : il crée ou met à jour les fonctions Supabase, notamment la suppression de projet.

Le lien contient un jeton UUID qui donne accès à la plénière. Partagez-le uniquement avec les personnes autorisées à voir ou modifier cette configuration.

## Sessions de présentation en temps réel

Un projet sauvegardé depuis un compte Google démarre une session de présentation distincte, synchronisée par Supabase Realtime. L'onglet courant devient `?view=presentation&sessionId=<uuid>` et ouvre un second onglet `?view=monitoring&sessionId=<uuid>`. La navigation, la pause, la reprise et les ajustements de dépassement sont envoyés à Supabase à chaque action, jamais à chaque tick du chronomètre.

La session est réservée au compte propriétaire du projet. Les mises à jour utilisent un verrouillage optimiste par numéro de version : si deux actions concurrentes se croisent, l'interface recharge l'état le plus récent au lieu de l'écraser. Exécutez à nouveau tout le script [supabase/schema.sql](supabase/schema.sql) avant d'utiliser cette fonctionnalité : il crée la table de sessions, les RPC protégées et la publication Realtime.

Le PDF reste volontairement dans la mémoire du navigateur et n'est jamais stocké dans la session ni transféré entre onglets. Après rechargement de l'onglet Présentation, réimportez le PDF pour retrouver son rendu ; l'état de session et la vue Monitoring sont, eux, restaurés depuis Supabase.

## Room public

Chaque session synchronisée crée un Room public distinct. Monitoring affiche son QR code et son URL sous la forme `/r/{roomToken}`. Le token est généré dans le navigateur avec `crypto.getRandomValues` sur 256 bits, encodé en Base64 URL-safe, et ne contient aucun identifiant de session ou de projet.

Le lien ouvre une page mobile dédiée sans connexion, sans interface de configuration et sans contrôle de session. Une RPC publique résout exclusivement ce token exact et ne retourne que la disponibilité de la session et son état démarré/en attente. Les tables de Rooms et de sessions restent sans accès direct pour `anon`; toutes les écritures de session et de Room restent réservées au propriétaire authentifié.

Pour GitHub Pages, [404.html](404.html) restaure un lien `/r/*` dans l'application après le fallback statique. Les autres hébergeurs doivent réécrire les chemins `/r/*` vers `index.html` ou servir cette même page 404. Le serveur local `jwebserver` ne fournit pas cette réécriture.

## Questions audience

Un participant anonyme peut poser une question depuis le Room public. Chaque question est une donnée indépendante liée à une session, avec un texte de 500 caractères maximum et l'un des statuts `pending`, `answered` ou `dismissed`. Elle ne fait partie ni du projet, ni de l'état runtime de présentation.

Le participant transmet uniquement le `roomToken` et le texte. La RPC `create_public_session_question` résout côté serveur le Room vers sa session avant l'insertion. Elle ne retourne pas l'identifiant de session. Le participant ne peut ni lire, ni modifier des questions. Monitoring charge les questions de la session de son propriétaire, puis reçoit leurs créations et changements de statut via Supabase Realtime, filtré par `session_id`.

Après chaque évolution, exécutez tout le script [supabase/schema.sql](supabase/schema.sql) dans le SQL Editor Supabase. Il crée les tables, fonctions, politiques RLS et la publication Realtime nécessaires, puis demande à PostgREST de recharger son cache de schéma.

## Accès Google et bac à sable

Au démarrage, Timekeeper propose un accès Google ou un accès sans compte au bac à sable. Les sessions Google sont persistées par Supabase : un utilisateur déjà connecté accède directement à l'application. Le bouton « Se déconnecter » ferme la session et revient à l'écran d'accès, où le bac à sable reste disponible.

Pour activer Google dans Supabase :

1. Ouvrez `Authentication` > `Providers` > `Google`, puis activez le fournisseur.
2. Renseignez le Client ID et le Client Secret créés dans Google Cloud Console. Ces secrets restent exclusivement côté Supabase.
3. Ajoutez les URL autorisées dans `Authentication` > `URL Configuration`, notamment l'URL de production de l'application et `http://localhost:8080` pour les essais locaux.
4. Dans la Google Cloud Console, ajoutez l'URL de rappel fournie par Supabase : `https://nozwjovvfcosmskzneoq.supabase.co/auth/v1/callback`.

La migration dans [supabase/schema.sql](supabase/schema.sql) ajoute la colonne nullable `user_id`. Les projets déjà présents conservent donc `user_id = null` et restent des projets publics ou bac à sable. Les nouveaux projets créés après une connexion Google reçoivent l'identifiant du compte ; les RPC de partage existantes continuent volontairement à fonctionner pour ne pas casser les liens actuels.

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

## Tests

Le projet contient un banc de tests autonome, sans dépendance npm. Ouvrez [tests/run-tests.html](tests/run-tests.html) dans un navigateur, ou servez le projet avec un serveur statique puis ouvrez `/tests/run-tests.html`.

La suite couvre les calculs de plénière et de créneaux, les pauses, les états de dépassement, les réductions, ainsi que le rendu de timeline pour les démarrages tardifs et anticipés. Les scénarios E2E à exécuter avant livraison sont décrits dans [tests/README.md](tests/README.md).

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
