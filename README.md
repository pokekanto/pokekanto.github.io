# Pokekanto — Aventure à deux

Émulateur GBA dans le navigateur + couche multijoueur : chaque joueur charge sa propre ROM (Rouge Feu ou hack basé dessus), et une couche de code lit la position du joueur dans la mémoire du jeu, l'échange en pair-à-pair, et affiche ton ami comme un personnage directement dans ton écran de jeu quand vous êtes sur la même map.

**Important : aucune ROM n'est hébergée ici.** Chaque joueur fournit sa propre ROM, qui reste sur son ordinateur. Ce dépôt ne contient que du code original (émulateur gbajs2 sous licence BSD, chargé depuis un CDN).

## Comment jouer

1. Ouvre la page : https://osvalt16.github.io/Valdoria/
2. Entre ton pseudo, clique sur **Choisir ma ROM (.gba)** et sélectionne ta ROM
3. Optionnel : clique sur **Utiliser une sauvegarde (.sav)** si tu veux charger une sauvegarde existante
4. Le jeu se lance (flèches = croix, Z = A, X = B, Entrée = Start, \ = Select)
5. Sauvegarde depuis le menu du jeu : Pokekanto remplace automatiquement le slot local de cette ROM dans le navigateur
6. Joueur 1 : clique **Créer un salon** et envoie le code à ton ami
7. Joueur 2 : entre le code et clique **Rejoindre**
8. Quand vous êtes sur la même map, vous vous voyez dans le jeu !

Sur mobile, le bouton **PokéKanto** ouvre les options de réseau/sauvegarde, et **Menu jeu** envoie la touche Start au jeu. Les contrôles tactiles affichent A/B, L/R, Start/Select et un joystick.

## Comment ça marche

- L'émulateur [gbajs2](https://github.com/andychase/gbajs2) fait tourner la ROM en JavaScript
- Les sauvegardes `.sav` sont lues localement et injectées dans l'émulateur avant le lancement de la ROM
- Quand le jeu écrit sa sauvegarde, Pokekanto remplace le slot local unique de cette ROM et permet aussi l'import/export `.sav`
- Un export `.sav` contient uniquement la sauvegarde faite depuis le menu du jeu, pas un instantané de l'émulateur
- Les écrans tactiles utilisent une couche de contrôles mobile reliée directement au clavier virtuel GBA
- La couche multijoueur lit en RAM le pointeur du bloc de sauvegarde (position X/Y + numéro de map du joueur), 8 fois par seconde
- Les positions s'échangent en P2P (PeerJS / WebRTC), sans serveur de jeu
- Un canvas transparent par-dessus l'écran dessine un personnage pixel-art original à la position de l'ami

Si la position n'est pas lue (lien "debug" en bas pour vérifier), l'adresse du pointeur peut être ajustée via l'URL : `?sb1=0x03005008`.

## Architecture

Le projet reste une page statique compatible GitHub Pages, sans étape de build.

- `index.html` contient uniquement la structure de la page et les imports
- `assets/css/main.css` regroupe les styles
- `assets/js/dom.js` centralise les accès DOM courants
- `assets/js/state.js` porte l'état partagé de l'application
- `assets/js/emulator.js` démarre et pilote l'émulateur
- `assets/js/position.js` lit la position du joueur en mémoire
- `assets/js/network.js` gère les salons PeerJS et les échanges P2P
- `assets/js/overlay.js` dessine le fantôme de l'ami
- `assets/js/debug.js` met à jour le panneau debug
- `assets/js/app.js` branche les événements UI et la boucle de jeu

## Mettre en ligne (GitHub Pages)

Depuis ce dossier, dans un terminal :

```
git init
git add .
git commit -m "Page de jeu Pokekanto"
git branch -M main
git remote add origin https://github.com/osvalt16/Valdoria.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source : Deploy from a branch → main / (root) → Save**.
La page sera en ligne quelques minutes plus tard sur `https://osvalt16.github.io/Valdoria/`.

⚠️ Le fichier `.gitignore` empêche d'envoyer les ROMs par accident. Ne le supprime pas et ne pousse jamais de fichier `.gba` sur GitHub.

## Idées pour la suite

- Vrai sprite animé à la place du fantôme (lecture de la direction du personnage)
- Chat texte intégré
- Plus de 2 joueurs dans le même salon
- Échanges et combats via émulation du câble link
