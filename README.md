# Peared

A lightweight WebRTC library for peer-to-peer multiplayer games with a host/client model.

## Features

- **Zero-Config Setup** - Built-in UI and default Firebase for instant prototyping
- **P2P Networking** - Direct WebRTC connections between players
- **Firebase Signaling** - Room codes and public room discovery
- **Dual Channels** - Reliable (ordered, guaranteed) and unreliable (fast, may drop) data channels
- **Voice Chat** - Built-in voice with echo cancellation and noise suppression
- **Interpolation** - Smooth remote player rendering with configurable delay
- **Persistence** - IndexedDB storage for world saves and player identity
- **Host Migration** - Automatic failover when host disconnects
- **Reconnection** - Automatic reconnection attempts on connection loss
- **Ping/Quality** - Built-in latency measurement and connection quality tracking

## Quick Start (Zero-Config)

The fastest way to add multiplayer to your game:

### 1. Include Peared

```html
<script src="lib/peared.js"></script>
```

That's it - Firebase SDK loads automatically when needed.

### 2. Initialize with Built-in UI

```javascript
const peared = new Peared({
    ui: true,  // That's it! Includes default Firebase + popup UI

    onPlayerJoin: (player) => {
        console.log(`${player.name} joined!`);
        game.addPlayer(player);
    },
    onPlayerLeave: (player) => {
        game.removePlayer(player.id);
    },
    onUnreliableMessage: (from, type, data) => {
        if (type === 'pos') {
            peared.pushStateForInterpolation(from, data);
        }
    }
});

// Show the multiplayer popup when user clicks a button
document.getElementById('multiplayer-btn').onclick = () => peared.showPopup();
```

The built-in UI handles:
- Player name input with saved identity
- Host/Join tabs
- Room code generation and entry
- Public room browser with auto-refresh
- Connected players list
- All styled and mobile-friendly

## Custom Setup (Advanced)

For production apps, provide your own Firebase config:

```javascript
const peared = new Peared({
    firebaseConfig: {
        apiKey: "your-api-key",
        authDomain: "your-app.firebaseapp.com",
        databaseURL: "https://your-app.firebasedatabase.app",
        projectId: "your-project-id"
    },
    gameId: 'my-game',

    onPlayerJoin: (player) => { /* ... */ },
    onPlayerLeave: (player) => { /* ... */ },
    onMessage: (from, type, data) => { /* ... */ },
    onStateChange: (state, isHost) => { /* ... */ }
});

// Manual hosting/joining
const roomCode = await peared.createRoom('PlayerName', true);
await peared.joinRoom('ABC123', 'PlayerName');
```

## Sending Messages

```javascript
// Reliable (ordered, guaranteed delivery)
peared.send('chat', { message: 'Hello!' });

// Unreliable (fast, for position updates)
peared.sendUnreliable('pos', { x: 100, y: 200 });

// Host-only: broadcast to all
peared.broadcast('game-event', { type: 'explosion', x: 50, y: 50 });
```

## API Reference

### Constructor Options

```javascript
new Peared({
    // === Built-in UI ===
    ui: true,                           // Enable built-in popup UI + default Firebase

    // === Callbacks ===
    onPlayerJoin: (player) => {},       // Player connected
    onPlayerLeave: (player) => {},      // Player disconnected
    onMessage: (from, type, data) => {},         // Reliable message received
    onUnreliableMessage: (from, type, data) => {}, // Unreliable message
    onStateChange: (state, isHost) => {},        // Connection state changed
    onConnectionQualityChange: (peerId, quality, ping) => {}, // Quality changed
    onHostMigration: (player, event) => {},      // Host migration occurred

    // === State Sync ===
    getState: () => gameState,          // Host: provide current state
    onStateSync: (state) => {},         // Client: receive state

    // === Configuration ===
    interpolationDelay: 100,            // ms of interpolation buffer
    gameId: 'my-game',                  // Enable persistence
    autoSaveInterval: 30000,            // Auto-save interval (0 to disable)
    enableHostMigration: true,          // Enable automatic host migration
    reconnectAttempts: 3,               // Reconnection attempts
    reconnectDelay: 2000,               // Delay between attempts
    pingInterval: 2000,                 // Ping measurement interval

    // === Firebase ===
    firebaseConfig: { ... },            // Firebase config (or use ui:true for default)

    // === WebRTC ===
    iceServers: [                       // Custom ICE servers
        { urls: 'stun:stun.l.google.com:19302' }
    ]
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isHost` | boolean | Whether this instance is the host |
| `localPlayer` | object | Local player info `{ id, name, color, isHost }` |
| `roomCode` | string | Current room code (if using Firebase) |
| `state` | string | Connection state: `'disconnected'`, `'hosting'`, `'connected'` |
| `interpolator` | Interpolator | Built-in interpolator instance |
| `ui` | PearedUI | Built-in UI instance (if `ui: true`) |

### Core Methods

#### UI (when `ui: true`)

```javascript
peared.showPopup()   // Show the multiplayer popup
peared.hidePopup()   // Hide the popup
```

#### Connection

```javascript
// Host a game
peared.host(playerName)  // Returns: player object

// With Firebase
await peared.createRoom(playerName, isPublic)  // Returns: roomCode
await peared.joinRoom(roomCode, playerName)    // Returns: room info
await peared.getPublicRooms()                  // Returns: room[]
peared.onRoomsUpdate(callback)                 // Subscribe to room list

// Disconnect
peared.close()
```

#### Messaging

```javascript
// Reliable (guaranteed delivery, ordered)
peared.send(type, data)              // Send to host (client) or all (host)
peared.broadcast(type, data)         // Host only: send to all clients
peared.sendTo(peerId, type, data)    // Send to specific peer

// Unreliable (fast, may drop - use for positions)
peared.sendUnreliable(type, data)
peared.broadcastUnreliable(type, data)
```

#### Players

```javascript
peared.getPlayers()  // Returns: player[]
// Each player: { id, name, color, isHost }
```

#### Connection Quality

```javascript
peared.getPeerStats(peerId)   // Returns: { ping, quality } or null
peared.getAllPeerStats()      // Returns: Map<peerId, { ping, quality }>
peared.getAveragePing()       // Returns: number (ms)

// Quality values: 'excellent' (<50ms), 'good' (<100ms), 'fair' (<200ms), 'poor' (>=200ms)
```

#### Interpolation

```javascript
// Push state for interpolation (called on message receive)
peared.pushStateForInterpolation(playerId, { x, y, angle })

// Get interpolated state (call in render loop)
const smooth = peared.getInterpolatedState(playerId)
// Returns: { x, y, angle } with smooth values
```

### Voice Chat

```javascript
await peared.enableVoice()     // Request mic access, returns: boolean
peared.disableVoice()          // Stop voice chat
peared.mute()                  // Mute local mic
peared.unmute()                // Unmute local mic
peared.toggleMute()            // Toggle, returns: new muted state
peared.isVoiceEnabled()        // Returns: boolean
peared.isMuted()               // Returns: boolean
peared.setPlayerVolume(playerId, volume)  // Set remote player volume (0-1)
```

### Persistence

```javascript
// Identity
await peared.saveIdentity({ name, color, pin })
await peared.loadIdentity()    // Returns: { name, color, settings, hasPin }
await peared.verifyPin(pin)    // Returns: boolean

// Worlds
await peared.listWorlds()      // Returns: world[]
await peared.saveWorld(id, name, data, password)
await peared.loadWorld(id, password)  // Returns: world or null
await peared.deleteWorld(id)
await peared.exportWorld(id)   // Returns: compressed string
await peared.importWorld(exportString, newName)

// Auto-save (host only)
peared.startAutoSave(getStateFn, worldId, worldName)
peared.stopAutoSave()
```

## State Synchronization

Peared provides automatic state sync when players join:

```javascript
const peared = new Peared({
    // Host provides current game state
    getState: () => {
        const state = {};
        players.forEach((p, id) => {
            state[id] = { x: p.x, y: p.y, score: p.score };
        });
        return state;
    },

    // Clients receive and apply state
    onStateSync: (state) => {
        Object.entries(state).forEach(([id, data]) => {
            updatePlayer(id, data);
        });
    }
});
```

## High-Frequency Updates (Position)

Use unreliable channel for position updates to avoid head-of-line blocking:

```javascript
// Sender (throttled)
let lastSend = 0;
function onMove(pos) {
    if (Date.now() - lastSend >= 50) {  // 20 updates/sec max
        peared.sendUnreliable('pos', pos);
        lastSend = Date.now();
    }
}

// Receiver
const peared = new Peared({
    onUnreliableMessage: (from, type, data) => {
        if (type === 'pos') {
            // Push to interpolation buffer for smooth rendering
            peared.pushStateForInterpolation(from, data);
        }
    }
});

// Render loop
function render() {
    players.forEach((player, id) => {
        if (id !== localPlayerId) {
            const smooth = peared.getInterpolatedState(id);
            if (smooth) {
                drawPlayer(smooth.x, smooth.y);
            }
        }
    });
}
```

## Host Migration

When the host disconnects, the next player automatically becomes host:

```javascript
const peared = new Peared({
    enableHostMigration: true,  // Default: true

    onHostMigration: (player, event) => {
        if (event === 'became_host') {
            console.log('You are now the host!');
        } else if (event === 'host_changed') {
            console.log(`${player.name} is now hosting`);
        }
    }
});
```

## Connection Quality Monitoring

```javascript
const peared = new Peared({
    pingInterval: 2000,  // Check every 2 seconds

    onConnectionQualityChange: (peerId, quality, ping) => {
        console.log(`Connection quality: ${quality} (${ping}ms)`);
        // quality: 'excellent', 'good', 'fair', 'poor'
    }
});

// Manual check
const stats = peared.getPeerStats(peerId);
console.log(`Ping: ${stats.ping}ms, Quality: ${stats.quality}`);
```

## Example: Simple Multiplayer Game

```javascript
const peared = new Peared({
    firebaseConfig: { /* ... */ },
    gameId: 'simple-game',

    onPlayerJoin: (player) => {
        game.addPlayer(player);
        updateUI();
    },

    onPlayerLeave: (player) => {
        game.removePlayer(player.id);
        updateUI();
    },

    onUnreliableMessage: (from, type, data) => {
        if (type === 'pos') {
            peared.pushStateForInterpolation(from, data);
        }
    },

    onMessage: (from, type, data) => {
        if (type === 'chat') {
            showChatMessage(from, data.message);
        }
    },

    getState: () => game.getState(),
    onStateSync: (state) => game.applyState(state)
});

// Host button
document.getElementById('host-btn').onclick = async () => {
    const code = await peared.createRoom('Player1');
    document.getElementById('room-code').textContent = code;
};

// Join button
document.getElementById('join-btn').onclick = async () => {
    const code = document.getElementById('code-input').value;
    await peared.joinRoom(code, 'Player2');
};

// Game loop
function gameLoop() {
    // Update local player
    if (moved) {
        peared.sendUnreliable('pos', { x: player.x, y: player.y });
    }

    // Render with interpolation
    game.players.forEach((p, id) => {
        if (id !== peared.localPlayer?.id) {
            const smooth = peared.getInterpolatedState(id);
            if (smooth) {
                p.renderX = smooth.x;
                p.renderY = smooth.y;
            }
        }
    });

    requestAnimationFrame(gameLoop);
}
```

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

Requires WebRTC support. Mobile browsers supported.

## License

MIT
