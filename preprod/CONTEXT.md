# Contexte de developpement - Pokekanto

Ce fichier sert de reference rapide pour les deux devs du projet. Il doit rester simple, concret et a jour.

## Objectif du projet

Pokekanto est une page web statique qui lance une ROM GBA fournie par le joueur, lit la position du personnage en memoire, synchronise cette position en P2P, puis affiche l'ami par-dessus l'ecran de jeu.

Priorite actuelle : ameliorer l'experience multijoueur sans heberger ni distribuer de ROM.

## Regles de code

- Un fichier JS = une responsabilite claire.
- Un fichier JS expose au maximum un module public dans `window.Valdoria`.
- Les petites fonctions privees dans un fichier sont autorisees si elles servent la meme responsabilite.
- Si une fonction devient longue ou gere plusieurs sujets, creer un nouveau fichier JS.
- Ne pas melanger UI, reseau, emulateur et lecture memoire dans le meme fichier.
- Garder le projet sans build : HTML, CSS et JS simples.
- Preferer du code lisible a une abstraction trop compliquee.
- Les commentaires doivent expliquer les choix non evidents, pas repeter le code.

## Regles CSS

- Ne pas mettre de CSS directement dans le HTML.
- Interdit : balises `<style>` dans `index.html`.
- Interdit : attributs `style=""` sur les elements HTML.
- Tout le CSS doit rester dans `assets/css/main.css`, sauf decision explicite de separer en plusieurs fichiers CSS.
- Structurer le CSS par blocs commentes : base, layout, boutons, panneaux, ecran de jeu, mobile, debug.
- Reutiliser les classes existantes avant d'en creer de nouvelles.
- Eviter les styles trop specifiques si une classe simple suffit.
- Garder les tailles et espacements coherents pour desktop et mobile.
- Toute modification visuelle doit etre testee sur desktop et mobile.

## Structure actuelle

- `index.html` : structure de la page et imports.
- `assets/css/main.css` : styles.
- `assets/js/dom.js` : helpers DOM ($, setStatus). Chargé en premier.
- `assets/js/state.js` : etat partage (gba, myPos, joueurs…).
- `assets/js/audio.js` : worklet audio (Catmull-Rom, passe-bas, controle de debit).
- `assets/js/emulator.js` : chargement ROM, sauvegardes, controle emulateur.
- `assets/js/emulator-iodine.js` : integration IodineGBA, moteur d'emulation PAR DEFAUT (plus rapide, charge a la demande). gbajs2 reste en secours via ?core=gbajs2.
- `assets/js/position.js` : lecture de position et genre en RAM GBA.
- `assets/js/raccourcis.js` : panneau de personnalisation des touches clavier.
- `assets/js/tchat.js` : tchat general et amis via Firebase.
- `assets/js/network.js` : connexion au monde partage Firebase, envoi de position.
- `assets/js/lieux.js` : localisation des amis (table lieux extraite de la ROM FR + publication monde/joueurs/LOC|tag + suivi des amis). PRESENCE DECOUPEE PAR CARTE ET PAR LAYER (cle composite + requete de plage, eco) ; 3 layers de 200 joueurs max + file d'attente.
- `assets/js/siolink.js` : emulation cable link GBA via WebRTC + signaling Firebase.
- `assets/js/linkroom.js` : lobby Cable Club (combat / echange avec un ami).
- `assets/js/cloudsave.js` : sauvegarde .sav compressee dans le cloud (Firebase) + code de recuperation (VALD-XXXX).
- `assets/js/echange.js` : echange de Pokemon — lit/ecrit la RAM GBA, transport Firebase (boite aux lettres async + echange en direct atomique).
- `assets/js/combat.js` : donnees de combat lues dans la ROM (stats, attaques, types, noms FR, sprites) + decodage de l'equipe du joueur.
- `assets/js/combat-ui.js` : ecran de combat local (vs IA) et EN LIGNE — client Showdown anime (replay-embed dans une iframe) + moteur @pkmn/sim (mecaniques) + matchmaking aleatoire / defi ami via Firebase. Boutons + journal en francais. Combat 6v6 complet (equipe entiere + changements + KO). Alimente le classement Elo apres un combat aleatoire.
- `assets/js/ladder.js` : classement Elo saisonnier des combats aleatoires (top 20, PC, bas a droite). Reset auto tous les 6 mois via la cle de saison. Stocke monde/ladder/<saison>.
- `assets/js/sprites.js` : rendu du sprite du joueur distant (homme10.png / fille8.png).
- `assets/js/overlay.js` : boucle d'affichage des joueurs distants sur le canvas overlay.
- `assets/js/debug.js` : panneau debug (position, joueurs en ligne).
- `assets/js/roms.js` : memoire des ROMs par langue (IndexedDB) + ecran d'accueil (choix de langue, lancement).
- `assets/js/app.js` : branchement general, boucle de jeu.
- `assets/js/touch-controls.js` : controles mobiles tactiles.
- `assets/js/fullscreen.js` : gestion du mode plein ecran.
- `assets/img/homme10.png` : sprite sheet du joueur masculin (3 cols x 4 lignes).
- `assets/img/fille8.png` : sprite sheet du joueur feminin (3 cols x 4 lignes).

Ordre de chargement dans index.html : dom → state → audio → emulator → emulator-iodine →
position → raccourcis → lieux → tchat → network → siolink → linkroom → cloudsave → echange →
combat → ladder → combat-ui → sprites → overlay → debug → roms → app → touch-controls → fullscreen.

## Regles ROM et legal

- Ne jamais commit de fichier `.gba`, `.gbc`, `.gb`, `.nds`, `.sav`, `.zip` contenant une ROM.
- Le joueur doit fournir sa propre ROM localement.
- Si un hack ROM est cree plus tard, distribuer uniquement un patch `.bps` ou `.ips`.
- Ne pas mettre de contenu Nintendo extrait directement dans le depot.

## Workflow Git

- Travailler sur une branche par sujet.
- Faire des commits petits, lisibles et testables.
- Un commit = une intention claire.
- Ne pas melanger refactor, fix bug et nouvelle feature dans le meme commit.
- Avant commit : verifier que la page charge, que la console navigateur n'a pas d'erreur evidente, et que le mode concerne fonctionne.

## Format des commits

Utiliser un format simple inspire de Conventional Commits :

```text
type(scope): resume court

Details utiles si necessaire :
- ce qui a change
- pourquoi
- comment tester
```

Types recommandes :

- `feat` : nouvelle fonctionnalite.
- `fix` : correction de bug.
- `refactor` : changement interne sans nouveau comportement.
- `style` : CSS ou presentation.
- `docs` : documentation.
- `test` : ajout ou correction de tests/verifications.
- `chore` : maintenance sans impact produit.

Exemples :

```text
feat(overlay): anime le sprite distant selon sa direction

- ajoute une interpolation plus fluide entre deux positions reseau
- conserve le rendu sur canvas overlay
- test manuel : deux navigateurs sur la meme map
```

```text
fix(position): stabilise la detection du save block

- garde la derniere adresse valide tant que la lecture reste coherente
- evite de scanner toute la RAM trop souvent
- test manuel : debug ouvert pendant un changement de map
```

```text
docs(context): ajoute les regles de collaboration
```

## Pull requests et relecture

- Decrire le probleme resolu.
- Lister les fichiers importants modifies.
- Ajouter les tests manuels faits.
- Signaler clairement ce qui reste fragile ou incomplet.
- Ne pas valider une PR qui casse le chargement de ROM, la sauvegarde locale ou les controles de base.

## Tests manuels minimum

Pour une modification UI :

- Charger la page.
- Verifier desktop et mobile.
- Verifier qu'aucun texte important ne deborde.

Pour une modification emulateur/sauvegarde :

- Charger une ROM.
- Lancer le jeu.
- Tester sauvegarde locale et export `.sav` si concerne.

Pour une modification reseau/multijoueur :

- Ouvrir deux onglets ou deux navigateurs.
- Creer un salon.
- Rejoindre avec le code.
- Verifier que la position s'affiche correctement sur une meme map.
- Verifier le comportement quand les joueurs changent de map.

Pour le combat (local et en ligne) :

- Lancer le jeu, aller sur la carte, ouvrir le combat (bouton epee en haut).
- Entrainement : verifier l'affichage des Pokemon, les animations, les attaques en francais.
- En ligne : 2 appareils avec des sauvegardes differentes -> Aleatoire (les deux) ou Defier un ami (par tag), verifier l'appariement, la notification et le combat synchronise.

## Decisions techniques importantes

- Moteur d'emulation : IodineGBA par defaut (emulator-iodine.js), gbajs2 en secours (?core=gbajs2).
- L'ami sur la carte = overlay (il n'existe pas dans le moteur du jeu), position synchronisee via Firebase.
- COMBAT : ne passe PAS par l'emulation du cable. Systeme maison = on LIT l'equipe dans la RAM, le moteur @pkmn/sim (Showdown) calcule le combat (mecaniques Gen 3 exactes), et le client Showdown (replay-embed.js dans une iframe isolee) l'affiche anime. EN LIGNE = Firebase hote-autorite : l'hote fait tourner le sim et pousse le log, l'invite envoie ses coups. Matchmaking aleatoire (file d'attente FIFO, ticket numerote) + defi ami (notif via monde/echanges). Chemins Firebase ouverts utilises : monde/sessions/* et monde/echanges/*.
- ECHANGE : meme principe (lit/ecrit la RAM + transport Firebase), pas le cable.
- Le cable link reel (siolink.js / linkroom.js, Cable Club) reste dispo mais n'est pas la voie du combat principal (mur de la synchro temps reel).
- PRESENCE ECO : chaque joueur n'ecrit/ne telecharge QUE les joueurs de sa carte (cle composite dans monde/joueurs + requete de plage), pas le monde entier -> tient ~1000 joueurs sous 10 Go/mois. Bande passante Firebase = quota mensuel (reset chaque mois) ; stockage auto-nettoye (onDisconnect).
- LAYERS (facon WoW) : 3 layers de 200 joueurs max, placement auto, menu deroulant (Reglages PC / menu mobile), changement fluide sans redemarrage, file d'attente FIFO au-dela de 600. Le layer prefixe la cle de presence.
- CLASSEMENT (ladder.js) : Elo (depart 1000, K=32) des combats ALEATOIRES uniquement, top 20 en bas a droite (PC). Saisonnier : reset auto tous les 6 mois via la cle de saison. Stocke monde/ladder/<saison>/<tag> (necessite une regle Firebase dediee, indexOn elo).
- REGLES FIREBASE : strictes et par-chemin (structure PLATE imposee ; nouveaux noeuds top-level refuses par defaut). Un vrai nouveau noeud (ex : ladder) demande une regle cote console Firebase ; sinon encoder l'info dans une cle composite sous un chemin deja ouvert (monde/joueurs).
- VOLUME par defaut a 20% ; bouton Discord dans les Reglages (PC + mobile) ; sur mobile : curseur volume + boutons HUD (Amis / Echange / Combat) compacts ; legende "?" masquee sur PC.
- Le projet doit rester compatible GitHub Pages.
- Toute dependance externe doit etre justifiee dans la PR.
