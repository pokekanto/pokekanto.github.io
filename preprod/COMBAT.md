# Système de combat — Valdoria

## État actuel

Le système de combat est opérationnel côté infrastructure. Le lobby, le matchmaking, la connexion WebRTC et le câble link SIO sont implémentés. La validité du handshake Fire Red doit encore être confirmée par des tests en conditions réelles.

---

## Comment faire un combat

### 1. Configurer la map du Cable Club (première fois)

1. Lance une ROM Pokémon Rouge Feu
2. Va dans un Centre Pokémon → entre dans le Cable Club (2ème étage)
3. Ouvre le menu **PokéKanto** → section **⚔️ Cable Club**
4. Clique **📍 Enregistrer cette map**

La map est sauvegardée dans ton navigateur. Le lobby s'ouvre automatiquement à chaque entrée.

### 2. Trouver un adversaire

Quand tu entres dans le Cable Club, le lobby s'ouvre avec trois options :

- **⚔️ Combat aléatoire** — premier joueur disponible dans la salle
- **⚔️ Défier un ami ▾** — liste de tes amis (tag `Nom#1234`) présents dans la salle

### 3. Établir la connexion

Quand l'adversaire accepte le défi :

1. L'UI affiche **"⏳ Établissement du câble link…"**
2. Puis **"🔗 Câble branché ! Parle au PNJ pour commencer le combat."**

### 4. Lancer le combat dans le jeu

Une fois le câble branché, les deux joueurs parlent au PNJ du Cable Club dans le jeu. La ROM gère le combat via ses menus natifs — Valdoria se contente de faire transiter les données.

---

## Architecture technique

### Infrastructure complète (implémentée)

**Lobby — Firebase Realtime Database**

```
monde/
  linkroom/<id>   — joueurs présents dans le Cable Club { pseudo, tag, ts }
  defis/<id>      — défis entrants { de, pseudo, tag, type, sid, ts, accepte? }
  sessions/<sid>/ — signaling WebRTC
    offer         — SDP offre (maître)
    answer        — SDP réponse (esclave)
    ice_master/   — candidats ICE du maître
    ice_slave/    — candidats ICE de l'esclave
```

**Câble link — WebRTC DataChannel (`assets/js/siolink.js`)**

- Connexion peer-to-peer via `RTCPeerConnection` (STUN Google)
- Signaling échangé via Firebase (pas de serveur supplémentaire)
- `RTCDataChannel` ordonné et fiable pour les données SIO
- Timeout de connexion : 30 secondes

**SIO Normal 32-bit — GBA (`js/sio.js`)**

- `writeSIOCNT` : détecte le démarrage d'un transfert (bit 7), lit `SIODATA32`, délègue à `siolink`
- `readSIOCNT` : reflète le bit busy pendant l'attente des données du pair
- `completeNormal32Transfer(remoteData)` : appelé par `siolink` quand les données arrivent, écrit dans les registres IO et déclenche `IRQ_SIO`
- `readTxData32()` : utilisé par l'esclave pour lire ses données TX sans démarrer de transfert

**Protocole d'échange SIO entre les deux navigateurs**

```
Maître (isMaster=true)          Esclave (isMaster=false)
        |                               |
writeSIOCNT(start=1)                    |
        |---{ t:"sio", d:masterTx }--→ |
        |                     completeNormal32Transfer(masterTx)
        |                     channel.send({ t:"sio_ack", d:slaveTx })
        | ←--{ t:"sio_ack", d:slaveTx }|
completeNormal32Transfer(slaveTx)       |
```

**Rôles maître/esclave**

- **Maître** : joueur qui a envoyé le défi (drive l'horloge SIO, SIOCNT bit 0 = 1)
- **Esclave** : joueur qui a accepté (horloge externe, SIOCNT bit 0 = 0)
- Le maître crée l'offre WebRTC, l'esclave répond

### Fichiers concernés

| Fichier | Rôle |
|---|---|
| `js/sio.js` | Port SIO GBA — Normal 32-bit implémenté |
| `assets/js/siolink.js` | Câble link WebRTC + signaling Firebase |
| `assets/js/linkroom.js` | Lobby, matchmaking, lancement de siolink |
| `assets/js/network.js` | Broadcast du tag, lecture du tag des autres joueurs |
| `assets/js/tchat.js` | Fournit le tag `Nom#1234` au module linkroom |
| `assets/js/app.js` | Appelle `linkroom.check(pos)` toutes les 125 ms |
| `assets/js/position.js` | Lit les coordonnées de map `g` et `m` depuis la RAM GBA |

---

## Compatibilité ROM

- **FR + EN** → ✅ compatible (même génération, même structure SIO)
- **FR + hack basé sur FR** → ✅ en général
- **Fire Red + Emerald** → ❌ protocoles SIO incompatibles

En Phase future : vérification automatique du code ROM (`cart.code`) avant connexion.

---

## Débogage

Ouvrir la console du navigateur (`F12`). Les logs `[siolink]` indiquent :
- `Rôle : maître / esclave`
- `Offre envoyée / Réponse reçue`
- `DataChannel ouvert`
- `SIO TX → <hex>` / `SIO RX ← <hex>`

Si le jeu ne propose pas les menus après "Câble branché", vérifier les échanges SIO dans la console pour identifier où le handshake Fire Red diverge.
