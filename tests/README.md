# Tests

## Tests automatisés navigateur

Ouvrir `tests/run-tests.html` dans un navigateur ou le servir depuis le serveur statique du projet. La page exécute des tests unitaires et d'intégration sur les modules métier sans dépendance npm.

La suite couvre :

- migration et validation des données de plénière ;
- validation des créneaux, couverture et chevauchements ;
- calculs de chronomètre, pauses, durées réduites et statuts ;
- rendu de la timeline, retards, avance au démarrage et dépassements ;
- non-double comptage du dépassement lorsqu'un créneau est revisité.

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