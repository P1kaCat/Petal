# Petal

Petal est une première version de launcher Minecraft Java pour Windows, avec une interface française qui réunit Modrinth et CurseForge.

## Essayer l’application

Pour lancer le projet depuis ce dépôt, suivre la section **Développer** ci-dessous. La commande `pnpm dist` crée `dist/Petal 0.1.1.exe`. Cet exécutable portable ne nécessite aucun environnement Node.js pour être utilisé. Les exécutables et les dépendances installées ne sont pas inclus dans le dépôt. Cette version de développement n’est pas signée avec un certificat d’éditeur.

1. Créer un profil avec un nom, une version de Minecraft et Fabric, Forge ou NeoForge.
2. Rechercher des mods dans **Découvrir**. Le profil sélectionné filtre les résultats par version et chargeur.
3. Cliquer sur **Installer**. Petal résout les dépendances requises de cette source et vérifie les empreintes des fichiers avant de les installer.
4. Dans **Mes profils**, **Installer le jeu** prépare Minecraft, Java et le chargeur. Le premier téléchargement peut dépasser 1 Go. Les fichiers vérifiés sont réutilisés entre les profils.
5. Configurer le compte Microsoft dans **Réglages**, puis cliquer sur **Jouer**.

Les sauvegardes, mods et configurations sont séparés par profil. Un mod peut être activé, désactivé, retiré ou mis à jour individuellement. Un fichier retiré est conservé dans le sous-dossier `removed` du profil. Le bouton **Dossier** permet d’y accéder, ainsi qu’aux journaux Minecraft dans `logs`.

## CurseForge

La recherche et les téléchargements CurseForge utilisent la [Core API officielle](https://docs.curseforge.com/rest-api/), qui exige une clé `x-api-key`.

Obtenir une clé auprès de CurseForge, puis la saisir dans **Réglages → CurseForge**. Petal chiffre la clé avec le stockage sécurisé de Windows ; elle n’est jamais intégrée au code ou affichée à nouveau dans le formulaire. Laisser le champ vide conserve la clé enregistrée ; la case de retrait permet de l’effacer.

Sans clé, Modrinth reste utilisable et l’interface indique que CurseForge est désactivé. Lorsqu’un fichier CurseForge ne propose pas de `downloadUrl`, Petal refuse son téléchargement automatique. Utiliser le lien de sa page, télécharger le `.jar`, puis **Mes profils → Importer un .jar**. La compatibilité et les dépendances d’un import manuel restent à vérifier.

## Microsoft et Minecraft Java

Petal utilise [MSMC](https://github.com/Hanro50/MSMC) pour la connexion Microsoft et les échanges Xbox/Minecraft. Le mot de passe est saisi dans la fenêtre Microsoft. Le jeton de renouvellement reste chiffré sur l’ordinateur ; le jeton Minecraft reste en mémoire.

L’application requiert son propre identifiant Microsoft. Il n’y a pas d’identifiant emprunté à un autre launcher dans le code.

1. Créer une inscription d’application dans [Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), avec les comptes Microsoft personnels autorisés.
2. Configurer une plateforme d’application mobile / de bureau et l’URI de retour `https://login.live.com/oauth20_desktop.srf`, selon la configuration du client public utilisé par MSMC. Voir la [documentation des URI de retour](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
3. Copier l’**ID d’application (client)** dans les réglages de Petal et enregistrer.
4. Cliquer sur **Se connecter** avec un compte possédant Minecraft Java.

L’inscription OAuth seule ne garantit pas que les services Xbox et Minecraft accepteront l’application. Si le service refuse l’identifiant (notamment `Invalid app registration`), obtenir les autorisations nécessaires pour l’application auprès des services concernés. La connexion et le lancement d’une partie authentifiée n’ont pas été validés avec un compte utilisateur dans cette session.

Pour une distribution publique, l’identifiant de Petal pourra être préconfiguré une fois l’application enregistrée et autorisée. Une clé CurseForge distribuée dans un exécutable ne peut pas être considérée comme secrète : prévoir une stratégie d’accès adaptée avant de publier largement.

## Java et chargeurs

Petal lit le manifeste officiel de Minecraft pour choisir le composant Java requis et télécharge le runtime fourni par Mojang. Un chemin `java.exe` personnalisé peut remplacer ce comportement, mais sa version majeure doit correspondre à celle demandée par Minecraft.

Fabric utilise les métadonnées officielles Fabric. Forge utilise la version recommandée, ou la dernière version annoncée dans les promotions officielles. NeoForge sélectionne une version stable correspondant à la version Minecraft. Le chargeur retenu est mémorisé par profil pour conserver un environnement reproductible.

Les téléchargements du jeu disposent d’un pool de connexions limité et de trois tentatives de reprise en cas d’interruption. Un échec reste visible dans l’interface ; une nouvelle préparation vérifie et réutilise le cache existant.

## Développer

Prérequis : Node.js 22 ou supérieur et pnpm 11. Le projet utilise Electron, des fichiers HTML/CSS/JavaScript sans compilation d’interface, et les bibliothèques `@xmcl` pour Minecraft.

```powershell
pnpm install --frozen-lockfile
pnpm start
```

Créer l’exécutable Windows :

```powershell
pnpm dist
```

Les versions de `@xmcl/core` et `@xmcl/installer` sont fixées et leur combinaison a été vérifiée. La version plus récente essayée au début du projet présentait une dépendance manquante lors du chargement ; ne pas les actualiser sans refaire les tests d’installation et de lancement.

## Vérifications

```powershell
pnpm test
node scripts/integration.cjs
```

Les tests unitaires couvrent les chemins de fichiers Windows, la persistance, les filtres API, une API indisponible, les dépendances cycliques, les versions imposées par les dépendances, les incompatibilités déclarées, les collisions de fichiers, les empreintes, le retour à l’installation précédente après un échec et les reprises réseau.

Le test d’intégration télécharge réellement Minecraft 1.21.1, Java 21, Fabric, Forge et NeoForge. Il installe également Iris et Sodium via Modrinth et vérifie les arguments de démarrage. Ses données sont isolées dans `artifacts/integration`, sans lancer de partie ou connecter un compte.

Le mode de test de l’interface utilise un dossier séparé :

```powershell
$env:PETAL_SMOKE_TEST = '1'
$env:PETAL_DATA_DIR = "$PWD/artifacts/smoke"
pnpm start
```

Il vérifie la création d’un profil, une installation Modrinth réelle depuis l’interface, les réglages persistants et le rejet d’une méthode IPC inconnue. Il produit `checks.json`, `smoke.json`, `preview.png` et `profiles.png`, puis ferme l’application. Retirer ces deux variables d’environnement avant un lancement normal.

## Données et limites de cette alpha

Les données ordinaires se trouvent sous `%APPDATA%/petal-launcher/data` (le chemin exact est affiché dans les réglages). `state.json` contient les profils ; `credentials.json` contient uniquement un bloc chiffré. Les fichiers chiffrés sont liés au compte Windows : reconfigurer les identifiants après un transfert sur un autre ordinateur. Ne pas publier ces fichiers ni les caches de tests.

- Les deux plateformes conservent leurs identifiants et leurs résultats distincts. Les noms identiques ne sont pas fusionnés automatiquement. Éviter d’installer le même mod depuis les deux sources : leurs métadonnées ne permettent pas toujours d’établir une correspondance fiable.
- Les conflits contrôlés sont ceux déclarés par les plateformes et les collisions de noms de fichiers. Cela ne garantit pas que tous les mods pourront fonctionner ensemble.
- L’installation de mods est restaurée après un échec de téléchargement ou d’enregistrement géré. La récupération automatique après une coupure brutale pendant la copie des fichiers reste à ajouter.
- Les mises à jour sont déclenchées individuellement. Les dépendances explicitement fixées par un autre mod empêchent une mise à jour incompatible.
- Cette version gère les mods `.jar`. L’import/export de modpacks `.mrpack` et des archives CurseForge, les shaders, les resource packs et la gestion multi-compte ne sont pas encore implémentés.
- La préparation réelle de Minecraft et des chargeurs est testable sans connexion Microsoft. Les chemins CurseForge nécessitent une clé valide et le lancement d’une partie nécessite un compte et une application autorisés ; ces deux parcours restent à vérifier avec ces accès.

Références : [API Modrinth](https://docs.modrinth.com/api/), [recherche Modrinth](https://docs.modrinth.com/api/operations/searchprojects/), [Minecraft Launcher Core](https://github.com/Voxelum/x-minecraft-launcher).
