# Système d'échange Pokémon — Valdoria

## État actuel

Le système d'échange est opérationnel côté infrastructure. Il utilise exactement la même connexion WebRTC et le même câble link SIO que les combats — seule la sélection dans les menus natifs du jeu diffère.

---

## Comment faire un échange

### 1. Configurer la map du Cable Club (première fois)

1. Lance une ROM Pokémon Rouge Feu
2. Va dans un Centre Pokémon → entre dans le Cable Club (2ème étage)
3. Ouvre le menu **PokéKanto** → section **⚔️ Cable Club**
4. Clique **📍 Enregistrer cette map**

### 2. Trouver un partenaire d'échange

Dans le lobby, clique **🔄 Échanger avec un ami ▾** pour voir tes amis présents dans la salle.

- Seuls les amis avec qui tu as échangé ton tag `Nom#1234` apparaissent.
- Les échanges aléatoires ne sont pas disponibles (un échange nécessite un accord mutuel).

### 3. Établir la connexion

Quand l'ami accepte :

1. L'UI affiche **"⏳ Établissement du câble link…"**
2. Puis **"🔗 Câble branché ! Parle au PNJ pour commencer l'échange."**

### 4. Lancer l'échange dans le jeu

Une fois le câble branché, parle au PNJ du Cable Club. Le jeu propose ses menus d'échange natifs — sélectionne le Pokémon à échanger comme tu le ferais sur une vraie GBA.

---

## Différence entre combat et échange

| | Combat | Échange |
|---|---|---|
| Localisation | Cable Club | Cable Club |
| Mode aléatoire | ✅ Oui | ❌ Non |
| Mode ami | ✅ Oui | ✅ Oui |
| Connexion WebRTC | ✅ Identique | ✅ Identique |
| Câble link SIO | ✅ Identique | ✅ Identique |
| Différence réelle | Menu "Combat" dans le jeu | Menu "Échange" dans le jeu |

Les deux modes utilisent exactement la même infrastructure. C'est le joueur qui choisit dans les menus natifs de Fire Red après que le câble est branché.

---

## Architecture technique

L'échange utilise la même pile que le combat, avec `type: "echange"` dans le document Firebase pour adapter les textes de l'interface.

**Protocole SIO**

Le câble link GBA transporte les données d'échange exactement comme pour les combats. Fire Red gère lui-même la sérialisation des données Pokémon échangées via le port SIO.

```
monde/
  defis/<id>      — { type: "echange", sid, de, pseudo, tag, ts }
  sessions/<sid>/ — signaling WebRTC (offer/answer/ICE)
```

**Fichiers concernés**

| Fichier | Rôle |
|---|---|
| `js/sio.js` | Port SIO GBA Normal 32-bit |
| `assets/js/siolink.js` | Câble link WebRTC (partagé combat/échange) |
| `assets/js/linkroom.js` | Lobby, bouton Échange, lancement siolink |

---

## Compatibilité ROM

- **FR + EN** → ✅ les échanges fonctionnent entre langues
- **Fire Red + Leaf Green** → ✅ compatible
- **Fire Red + Emerald** → ❌ incompatible (protocoles SIO différents)

---

## Débogage

Ouvrir la console du navigateur (`F12`). Les logs `[siolink]` montrent chaque paquet SIO échangé :

```
[siolink] Rôle : maître (initiateur WebRTC)
[siolink] Offre envoyée
[siolink] Réponse reçue
[siolink] DataChannel ouvert
[siolink] linkLayer attaché au SIO
[siolink] SIO TX → 0000000
[siolink] SIO RX ← ffff0000
```

Si le jeu ne propose pas les menus d'échange, vérifier que les deux navigateurs affichent bien "DataChannel ouvert" et que les paquets SIO s'échangent.
