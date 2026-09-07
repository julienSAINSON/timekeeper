# Tests

## Tests automatisés navigateur

Ouvrir `tests/run-tests.html` dans un navigateur ou le servir depuis le serveur statique du projet. La page exécute des tests unitaires et d'intégration sur les modules métier sans dépendance npm.

La suite couvre :

- migration et validation des données de plénière ;
- validation des créneaux, couverture et chevauchements ;
- calculs de chronomètre, pauses, durées réduites et statuts ;
- rendu de la timeline, retards, avance au démarrage et dépassements ;
- non-double comptage du dépassement lorsqu'un créneau est revisité.
- l'ouverture de l'onglet Monitoring depuis Présentation, sa route `?view=monitoring` et la navigation synchronisée dans les deux sens en bac à sable.

## Fixture PDF

Le fichier `tests/fixtures/test.pdf` est un document de six pages versionné avec le projet. Utilisez-le pour les parcours E2E d'import, de rendu et de navigation PDF; aucun fichier du poste local n'est nécessaire.

## Tests E2E automatisés

Servez le dépôt depuis sa racine, puis ouvrez `http://localhost:8080/tests/run-e2e-tests.html`. Le banc charge automatiquement `tests/fixtures/test.pdf` et vérifie l'import, le rendu, la navigation, la pause, la reprise et la sortie du mode présentation. Il restaure la configuration locale préexistante après l'exécution.

```bash
python -m http.server 8080
```

Avec un JDK récent, vous pouvez aussi utiliser:

```bash
jwebserver -p 8080 -d "CHEMIN_ABSOLU_VERS_LE_PROJET" -o none
```

## Parcours E2E à vérifier avant livraison

1. Créer un projet, renseigner un nom, importer un PDF, définir la plénière et les créneaux, puis sauvegarder.
2. Renommer un projet sauvegardé et vérifier les trois actions : mise à jour de l'existant, création d'un projet, annulation.
3. Ouvrir puis supprimer un projet depuis « Mes projets » ; vérifier que la popin se ferme après suppression du dernier projet.
4. Démarrer une présentation, parcourir les slides, vérifier la pause/reprise, le plein écran et l'export CSV.
5. Dépasser un créneau, aller sur le créneau suivant puis revenir au précédent ; vérifier que le dépassement n'est pas doublé dans la timeline.
6. Démarrer avant l'heure prévue ; vérifier que le segment d'avance disparaît progressivement et que le curseur reste à gauche jusqu'à l'heure prévue.
7. Lancer le tutoriel sur écran large et mobile ; vérifier l'ouverture éclairée, les cinq étapes, les boutons, les flèches et `Échap`.
8. Connecté avec Google, sauvegarder un projet puis démarrer la plénière. Vérifier que les URL Présentation et Monitoring contiennent le même paramètre `sessionId`, que navigation et pause/reprise se reflètent dans les deux sens, puis recharger l'un des deux onglets. L'état de session doit être restauré ; réimporter le PDF dans Présentation pour retrouver le rendu après rechargement.
9. Connecté avec Google et après exécution du script Supabase, lancer une session puis ouvrir Monitoring. Vérifier que le QR code encode l'URL `/r/{roomToken}`, qu'un second lancement du même projet génère un token différent, puis scanner le code. La page mobile publique doit afficher « Vous êtes connecté » sans demander de compte et sans proposer de contrôle MC. Tester aussi une URL `/r/` avec un token invalide, qui doit afficher une indisponibilité sans erreur technique.
10. Après exécution du script Supabase, démarrer une session Google et ouvrir Monitoring. Scanner son QR code, saisir puis envoyer « Pouvez-vous préciser ce point ? » sans recharger Monitoring. La question doit apparaître automatiquement avec le statut « En attente ». La sélectionner, cliquer « Marquer comme traitée », puis envoyer une seconde question depuis le téléphone ; elle doit apparaître également.
11. Démarrer une seconde session, envoyer une question à son Room puis vérifier que le Monitoring de la première session ne la reçoit jamais. Avec un navigateur anonyme, vérifier qu'une requête directe de lecture ou modification de `tk_session_questions` est refusée ; seul l'appel de création avec le `roomToken` valide doit réussir.
12. Dans Configuration, ajoutez un créneau `quiz`, renseignez une question, les propositions A et B puis une bonne réponse. Sauvegardez le projet, rechargez-le et vérifiez que le contenu et l'identifiant du Quiz sont conservés. L'exécution publique sera couverte dans une étape ultérieure.
13. Après exécution du script Supabase, préparez un Quiz valide, démarrez deux sessions du même projet et utilisez le SQL Editor ou les appels RPC pour vérifier : une réponse valide est créée pour chaque session, une seconde réponse du même participant échoue, deux participants peuvent répondre, et une option invalide ou un slot non-Quiz est refusé. Avec le rôle `anon`, vérifiez qu'une lecture directe de `tk_quiz_responses` est refusée. Avec le présentateur propriétaire, `get_owned_quiz_response_summary(session_id, quiz_id)` retourne uniquement `quizId`, `totalResponses` et les compteurs agrégés par proposition de la session demandée ; avec un autre utilisateur, elle est refusée. Vérifiez enfin que `get_public_room_activity` ne contient jamais `correctOptionId`, l'état de session ou les réponses des autres participants.
14. Ouvrir Monitoring pendant un Quiz actif, puis répondre depuis deux navigateurs participants. Le panneau « Quiz en cours » doit afficher immédiatement les propositions configurées, les compteurs à zéro, puis leur répartition et le total après chaque réponse. Recharger Monitoring pendant le Quiz : les mêmes compteurs doivent être reconstruits. Sortir de la plage de slides Quiz doit masquer le panneau. Dans Supabase Realtime, seuls les événements de `tk_quiz_response_events` sont reçus par Monitoring : ils ne contiennent ni `participant_id` ni réponse individuelle.