# Vérification de Petal 0.1.0

Vérifications effectuées le 4 octobre 2026 sous Windows.

| Parcours | Résultat |
| --- | --- |
| Tests automatisés de persistance, API, dépendances, installation et reprise | 13 tests réussis |
| Démarrage Electron avec le vrai pont IPC | Réussi |
| Création d’un profil depuis le formulaire | Réussie |
| Recherche Modrinth réelle | Réussie |
| Installation réelle de Sodium depuis l’interface | Réussie |
| Enregistrement des réglages avec chiffrement Windows disponible | Réussi |
| Rejet d’une méthode IPC inconnue | Réussi |
| Installation d’Iris et de sa dépendance Sodium via Modrinth | Réussie |
| Préparation Minecraft 1.21.1 + Java 21 + Fabric 0.19.5 | Réussie |
| Préparation Minecraft 1.21.1 + Java 21 + Forge 52.1.0 | Réussie |
| Préparation Minecraft 1.21.1 + Java 21 + NeoForge 21.1.255 | Réussie |
| Génération des arguments de lancement des trois profils | Réussie, sans paramètres non résolus |
| Construction de l’exécutable portable Windows | Réussie |
| Test du portable sans les outils de développement | Réussi : profil, installation Sodium, réglages et IPC |
| API CurseForge avec une clé valide | Non vérifiée : aucune clé fournie |
| Connexion Microsoft et lancement d’une partie authentifiée | Non vérifiés : aucun compte connecté ni identifiant d’application fourni |

L’installation initiale des ressources Minecraft a rencontré des erreurs réseau. Une nouvelle préparation a complété le cache ; le code a ensuite été amélioré avec un pool de connexions limité et trois tentatives de reprise. Les trois profils et leurs arguments ont été revérifiés après ces changements.

Les tests d’intégration utilisent des dossiers isolés sous `artifacts/`. Ils n’ont pas modifié une installation Minecraft existante. Les captures `artifacts/smoke-final/preview.png` et `artifacts/smoke-final/profiles.png` montrent la véritable interface Electron. Les rapports détaillés figurent dans `artifacts/integration/report.json` et `artifacts/smoke-final/checks.json`.

Les résultats de préparation s’appliquent à Minecraft 1.21.1 et aux versions de chargeurs ci-dessus. Ils ne constituent pas une vérification de toutes les versions Minecraft ni de la compatibilité de tous les mods.

## Bannière de la version 0.1.1

La bannière utilise une texture originale du panorama de Minecraft Java 1.20.6, avec les cerisiers au coucher du soleil. L’empreinte du fichier correspond à celle du manifeste officiel de Mojang. L’illustration générée initialement proposée a été retirée des ressources de l’application. La disposition et la lisibilité du texte ont été vérifiées sur une capture de l’interface Electron ; les quatre contrôles du mode de test de l’interface passent également avec la nouvelle bannière.
