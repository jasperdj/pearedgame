/**
 * Peared - P2P Multiplayer Gaming Library
 *
 * A lightweight WebRTC library for peer-to-peer multiplayer games
 * with a host/client model, Firebase signaling, and built-in features
 * for voice chat, persistence, and smooth interpolation.
 *
 * @version 1.0.0
 * @license MIT
 */

(function(global) {
    'use strict';

    /*=============================================
      DEFAULT FIREBASE CONFIG
      =============================================
      Free shared Firebase for quick prototyping.
      For production, use your own Firebase project.
    =============================================*/

    const DEFAULT_FIREBASE_CONFIG = {
        apiKey: "AIzaSyAA5a1OAXyFuqtRG6sgtPi7NTQSOQbji18",
        authDomain: "peared-1e0a5.firebaseapp.com",
        databaseURL: "https://peared-1e0a5-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "peared-1e0a5",
        storageBucket: "peared-1e0a5.firebasestorage.app",
        messagingSenderId: "357774303231",
        appId: "1:357774303231:web:7f4ab22291ef7498ed91ca"
    };

    /*=============================================
      FIREBASE SDK LOADER
      =============================================
      Dynamically loads Firebase SDK if not present.
    =============================================*/

    const FIREBASE_VERSION = '10.7.0';
    const FIREBASE_SCRIPTS = [
        `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`,
        `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database-compat.js`
    ];

    let firebaseLoadPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function ensureFirebaseLoaded() {
        // Already loaded
        if (global.firebase?.database) {
            return true;
        }

        // Loading in progress
        if (firebaseLoadPromise) {
            return firebaseLoadPromise;
        }

        // Start loading
        console.log('[Peared] Loading Firebase SDK...');
        firebaseLoadPromise = (async () => {
            try {
                for (const src of FIREBASE_SCRIPTS) {
                    await loadScript(src);
                }
                console.log('[Peared] Firebase SDK loaded');
                return true;
            } catch (error) {
                console.error('[Peared] Failed to load Firebase SDK:', error);
                firebaseLoadPromise = null;
                return false;
            }
        })();

        return firebaseLoadPromise;
    }

    /*=============================================
      FIREBASE SIGNALING
      =============================================
      Handles room creation, discovery, and WebRTC
      signaling via Firebase Realtime Database.
    =============================================*/

    class FirebaseSignaling {
        constructor(config) {
            this.config = config;
            this.db = null;
            this.app = null;
            this.connected = false;
            this.currentRoom = null;
            this.roomRef = null;
            this.listeners = [];
            this._initPromise = this._init();
        }

        async _init() {
            // Wait for Firebase SDK to load
            const loaded = await ensureFirebaseLoaded();
            if (!loaded || !global.firebase) {
                console.warn('[Peared] Firebase SDK not available. Room discovery disabled.');
                return;
            }

            try {
                // Check if already initialized
                if (global.firebase.apps?.length > 0) {
                    this.app = global.firebase.apps[0];
                } else {
                    this.app = global.firebase.initializeApp(this.config);
                }
                this.db = global.firebase.database();

                // Monitor connection state with timeout
                const connectionPromise = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        console.warn('[Peared Firebase] Connection timeout - Firebase may be unavailable');
                        resolve(false);
                    }, 10000);

                    this.db.ref('.info/connected').on('value', (snapshot) => {
                        this.connected = snapshot.val() === true;
                        console.log('[Peared Firebase] Connection:', this.connected ? 'online' : 'offline');
                        if (this.connected) {
                            clearTimeout(timeout);
                            resolve(true);
                        }
                    });
                });

                await connectionPromise;
                if (this.connected) {
                    console.log('[Peared Firebase] Initialized successfully');
                } else {
                    console.warn('[Peared Firebase] Could not connect to Firebase. You may need to use your own Firebase project.');
                }
            } catch (error) {
                console.error('[Peared Firebase] Initialization failed:', error);
                console.warn('[Peared Firebase] The default shared Firebase may no longer be available. Please configure your own Firebase project.');
            }
        }

        async ready() {
            await this._initPromise;
            return this.db !== null;
        }

        isConnected() {
            return this.connected && this.db !== null;
        }

        // Generate a 6-character room code
        generateRoomCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        }

        // Create a room with offer already included
        async createRoomWithOffer(hostName, isPublic = true, offer = null) {
            await this._initPromise;
            if (!this.db) throw new Error('Firebase not initialized');

            const roomCode = this.generateRoomCode();
            const roomData = {
                host: hostName,
                public: isPublic,
                created: global.firebase.database.ServerValue.TIMESTAMP,
                players: 1,
                maxPlayers: 6,
                offer: offer,
                answer: null
            };

            try {
                await this.db.ref(`rooms/${roomCode}`).set(roomData);
                this.currentRoom = roomCode;
                this.roomRef = this.db.ref(`rooms/${roomCode}`);

                // Set up cleanup on disconnect
                this.roomRef.onDisconnect().remove();

                console.log(`[Peared Firebase] Room created: ${roomCode}`);
                return roomCode;
            } catch (error) {
                console.error('[Peared Firebase] Failed to create room:', error);
                throw error;
            }
        }

        // Update room with WebRTC offer
        async setOffer(offer) {
            if (!this.roomRef) return;
            await this.roomRef.child('offer').set(offer);
        }

        // Listen for answers (host)
        onAnswer(callback) {
            if (!this.roomRef) return;

            const answerRef = this.roomRef.child('answer');
            const listener = answerRef.on('value', (snapshot) => {
                const answer = snapshot.val();
                if (answer) {
                    console.log('[Peared Firebase] Answer received');
                    callback(answer);
                    answerRef.remove();
                }
            });

            this.listeners.push({ ref: answerRef, event: 'value', callback: listener });
        }

        // Get list of public rooms
        async getPublicRooms() {
            await this._initPromise;
            if (!this.db) return [];

            try {
                const snapshot = await this.db.ref('rooms')
                    .orderByChild('public')
                    .equalTo(true)
                    .once('value');

                const rooms = [];
                snapshot.forEach((child) => {
                    const room = child.val();
                    const age = Date.now() - room.created;
                    if (age < 10 * 60 * 1000) {
                        rooms.push({
                            code: child.key,
                            ...room
                        });
                    }
                });

                return rooms;
            } catch (error) {
                console.error('[Peared Firebase] Failed to get rooms:', error);
                return [];
            }
        }

        // Join a room (client)
        async joinRoom(roomCode) {
            await this._initPromise;
            if (!this.db) throw new Error('Firebase not initialized');

            const roomRef = this.db.ref(`rooms/${roomCode.toUpperCase()}`);

            try {
                const snapshot = await roomRef.once('value');
                if (!snapshot.exists()) {
                    throw new Error('Room not found');
                }

                const room = snapshot.val();
                if (!room.offer) {
                    throw new Error('Room not ready - host is still setting up');
                }

                this.currentRoom = roomCode.toUpperCase();
                this.roomRef = roomRef;

                return room;
            } catch (error) {
                console.error('[Peared Firebase] Failed to join room:', error);
                throw error;
            }
        }

        // Submit answer (client)
        async setAnswer(answer) {
            if (!this.roomRef) return;
            await this.roomRef.child('answer').set(answer);
        }

        // Update player count
        async updatePlayerCount(count) {
            if (!this.roomRef) return;
            await this.roomRef.child('players').set(count);
        }

        // Update heartbeat timestamp
        async updateHeartbeat() {
            if (!this.roomRef) return;
            await this.roomRef.child('lastHeartbeat').set(global.firebase.database.ServerValue.TIMESTAMP);
        }

        // Subscribe to room list updates
        async onRoomsUpdate(callback) {
            await this._initPromise;
            if (!this.db) return;

            const roomsRef = this.db.ref('rooms');

            const listener = roomsRef.on('value', (snapshot) => {
                const rooms = [];
                const now = Date.now();
                snapshot.forEach((child) => {
                    const room = child.val();
                    if (room.public && room.offer) {
                        const lastActive = room.lastHeartbeat || room.created;
                        const timeSinceActive = now - lastActive;
                        if (timeSinceActive < 2 * 60 * 1000) {
                            rooms.push({
                                code: child.key,
                                ...room
                            });
                        }
                    }
                });
                callback(rooms);
            });

            this.listeners.push({ ref: roomsRef, event: 'value', callback: listener });
        }

        // Cleanup
        destroy() {
            this.listeners.forEach(({ ref, event, callback }) => {
                ref.off(event, callback);
            });
            this.listeners = [];

            if (this.roomRef) {
                this.roomRef.remove();
            }

            this.currentRoom = null;
            this.roomRef = null;
        }
    }

    /*=============================================
      PEARED PERSISTENCE
      =============================================
      Optional IndexedDB-based persistence for:
      - World saves (game state)
      - Player identity (name, color, settings)
    =============================================*/

    class PearedPersistence {
        constructor(gameId = 'peared-game') {
            this.gameId = gameId;
            this.dbName = `peared-${gameId}`;
            this.db = null;
            this._initPromise = this._initDB();
        }

        async _initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    if (!db.objectStoreNames.contains('worlds')) {
                        const worldStore = db.createObjectStore('worlds', { keyPath: 'id' });
                        worldStore.createIndex('name', 'name', { unique: false });
                        worldStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('identity')) {
                        db.createObjectStore('identity', { keyPath: 'id' });
                    }
                };
            });
        }

        async _ready() {
            await this._initPromise;
            return this.db;
        }

        // ===== WORLD PERSISTENCE =====

        async saveWorld(id, name, data, password = null) {
            const db = await this._ready();

            const world = {
                id,
                name,
                data,
                size: JSON.stringify(data).length,
                createdAt: (await this.loadWorld(id))?.createdAt || Date.now(),
                updatedAt: Date.now(),
                passwordHash: password ? await this._hashPassword(password) : null
            };

            return new Promise((resolve, reject) => {
                const tx = db.transaction('worlds', 'readwrite');
                const store = tx.objectStore('worlds');
                const request = store.put(world);
                request.onsuccess = () => resolve(world);
                request.onerror = () => reject(request.error);
            });
        }

        async loadWorld(id, password = null) {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('worlds', 'readonly');
                const store = tx.objectStore('worlds');
                const request = store.get(id);

                request.onsuccess = async () => {
                    const world = request.result;
                    if (!world) {
                        resolve(null);
                        return;
                    }

                    if (world.passwordHash) {
                        if (!password || !(await this._verifyPassword(password, world.passwordHash))) {
                            reject(new Error('Invalid password'));
                            return;
                        }
                    }

                    resolve(world);
                };
                request.onerror = () => reject(request.error);
            });
        }

        async listWorlds() {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('worlds', 'readonly');
                const store = tx.objectStore('worlds');
                const request = store.getAll();

                request.onsuccess = () => {
                    const worlds = request.result.map(w => ({
                        id: w.id,
                        name: w.name,
                        size: w.size,
                        createdAt: w.createdAt,
                        updatedAt: w.updatedAt,
                        isProtected: !!w.passwordHash
                    }));
                    worlds.sort((a, b) => b.updatedAt - a.updatedAt);
                    resolve(worlds);
                };
                request.onerror = () => reject(request.error);
            });
        }

        async deleteWorld(id) {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('worlds', 'readwrite');
                const store = tx.objectStore('worlds');
                const request = store.delete(id);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        }

        async exportWorld(id, password = null) {
            const world = await this.loadWorld(id, password);
            if (!world) return null;

            const exportData = {
                name: world.name,
                data: world.data,
                exportedAt: Date.now(),
                version: 1
            };

            const json = JSON.stringify(exportData);
            if (global.LZString) {
                return global.LZString.compressToEncodedURIComponent(json);
            }
            return btoa(json);
        }

        async importWorld(exportString, newName = null) {
            try {
                let json;
                if (global.LZString) {
                    json = global.LZString.decompressFromEncodedURIComponent(exportString);
                } else {
                    json = atob(exportString);
                }
                const exportData = JSON.parse(json);

                const id = 'world-' + Math.random().toString(36).substring(2, 10);
                return await this.saveWorld(id, newName || exportData.name, exportData.data);
            } catch (error) {
                throw new Error('Invalid world data');
            }
        }

        // ===== PLAYER IDENTITY =====

        async saveIdentity(identity) {
            const db = await this._ready();

            const record = {
                id: 'player',
                name: identity.name,
                color: identity.color,
                settings: identity.settings || {},
                pinHash: identity.pin ? await this._hashPassword(identity.pin) : null,
                updatedAt: Date.now()
            };

            return new Promise((resolve, reject) => {
                const tx = db.transaction('identity', 'readwrite');
                const store = tx.objectStore('identity');
                const request = store.put(record);
                request.onsuccess = () => resolve(record);
                request.onerror = () => reject(request.error);
            });
        }

        async loadIdentity() {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('identity', 'readonly');
                const store = tx.objectStore('identity');
                const request = store.get('player');

                request.onsuccess = () => {
                    const identity = request.result;
                    if (identity) {
                        resolve({
                            name: identity.name,
                            color: identity.color,
                            settings: identity.settings,
                            hasPin: !!identity.pinHash
                        });
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        }

        async verifyPin(pin) {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('identity', 'readonly');
                const store = tx.objectStore('identity');
                const request = store.get('player');

                request.onsuccess = async () => {
                    const identity = request.result;
                    if (!identity || !identity.pinHash) {
                        resolve(true);
                        return;
                    }
                    resolve(await this._verifyPassword(pin, identity.pinHash));
                };
                request.onerror = () => reject(request.error);
            });
        }

        async clearIdentity() {
            const db = await this._ready();

            return new Promise((resolve, reject) => {
                const tx = db.transaction('identity', 'readwrite');
                const store = tx.objectStore('identity');
                const request = store.delete('player');
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        }

        // ===== PASSWORD HELPERS =====

        async _hashPassword(password) {
            const encoder = new TextEncoder();
            const data = encoder.encode(password + this.gameId);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async _verifyPassword(password, hash) {
            const inputHash = await this._hashPassword(password);
            return inputHash === hash;
        }
    }

    /*=============================================
      INTERPOLATION HELPER
      =============================================
      Buffers position updates and smoothly lerps
      between them for fluid remote player movement.
    =============================================*/

    class Interpolator {
        constructor(options = {}) {
            this.delay = options.delay || 100;
            this.maxBufferSize = options.maxBufferSize || 10;
            this.buffers = new Map();
        }

        pushState(playerId, state) {
            if (!this.buffers.has(playerId)) {
                this.buffers.set(playerId, []);
            }

            const buffer = this.buffers.get(playerId);
            buffer.push({
                time: Date.now(),
                state: { ...state }
            });

            while (buffer.length > this.maxBufferSize) {
                buffer.shift();
            }
        }

        getState(playerId) {
            const buffer = this.buffers.get(playerId);
            if (!buffer || buffer.length === 0) return null;

            const renderTime = Date.now() - this.delay;

            let before = null;
            let after = null;

            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i].time <= renderTime) {
                    before = buffer[i];
                } else {
                    after = buffer[i];
                    break;
                }
            }

            if (!before) return buffer[0].state;
            if (!after) return before.state;

            const range = after.time - before.time;
            const progress = range > 0 ? (renderTime - before.time) / range : 0;
            const t = Math.max(0, Math.min(1, progress));

            return this._lerp(before.state, after.state, t);
        }

        _lerp(a, b, t) {
            const result = {};

            for (const key in b) {
                if (typeof b[key] === 'number' && typeof a[key] === 'number') {
                    if (key === 'angle' || key === 'rotation') {
                        result[key] = this._lerpAngle(a[key], b[key], t);
                    } else {
                        result[key] = a[key] + (b[key] - a[key]) * t;
                    }
                } else {
                    result[key] = b[key];
                }
            }

            return result;
        }

        _lerpAngle(a, b, t) {
            const diff = b - a;
            const TAU = Math.PI * 2;
            const normalized = ((diff % TAU) + TAU + Math.PI) % TAU - Math.PI;
            return a + normalized * t;
        }

        removePlayer(playerId) {
            this.buffers.delete(playerId);
        }

        clear() {
            this.buffers.clear();
        }
    }

    /*=============================================
      PEARED UI
      =============================================
      Optional stock UI for quick prototyping.
      Enable with { ui: true } option.
    =============================================*/

    const PEARED_CSS = `
.peared-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.peared-overlay.active{display:flex}
.peared-popup{background:#2d2d44;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#eee}
.peared-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.peared-header h2{font-size:20px;color:#fff;margin:0}
.peared-close{background:none;border:none;color:#888;font-size:32px;cursor:pointer;padding:8px;line-height:1;min-width:44px;min-height:44px}
.peared-close:hover{color:#fff}
.peared-tabs{display:flex;border-bottom:2px solid #444;margin-bottom:20px}
.peared-tab{flex:1;padding:14px 20px;cursor:pointer;color:#888;border-bottom:3px solid transparent;margin-bottom:-2px;text-align:center;font-size:15px;font-weight:500;background:none;border-left:none;border-right:none;border-top:none}
.peared-tab:hover{color:#ccc}
.peared-tab.active{color:#4CAF50;border-bottom-color:#4CAF50}
.peared-tab.disabled{color:#555;cursor:not-allowed}
.peared-tab.disabled:hover{color:#555}
.peared-content{display:none}
.peared-content.active{display:block}
.peared-btn{background:#4CAF50;color:white;border:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:500;cursor:pointer;width:100%;margin-bottom:10px;min-height:48px}
.peared-btn:hover{background:#45a049}
.peared-btn:disabled{background:#555;cursor:not-allowed}
.peared-btn.secondary{background:#555}
.peared-btn.secondary:hover{background:#666}
.peared-input{width:100%;padding:14px;border:1px solid #444;border-radius:8px;background:#1a1a2e;color:#fff;font-size:16px;margin-bottom:12px;min-height:48px;box-sizing:border-box}
.peared-input:focus{outline:none;border-color:#4CAF50}
.peared-status{padding:10px;border-radius:6px;margin:10px 0;font-size:14px}
.peared-status.info{background:rgba(33,150,243,0.2);color:#64B5F6}
.peared-status.success{background:rgba(76,175,80,0.2);color:#81C784}
.peared-status.error{background:rgba(244,67,54,0.2);color:#E57373}
.peared-status.warning{background:rgba(255,152,0,0.2);color:#FFB74D}
.peared-room-code-input{display:flex;gap:10px;margin-bottom:20px;align-items:stretch}
.peared-room-code-input input{flex:3;text-transform:uppercase;letter-spacing:4px;font-size:22px;text-align:center;font-weight:bold;font-family:'SF Mono',Monaco,Consolas,monospace;padding:16px 12px;min-height:56px;min-width:0;box-sizing:border-box}
.peared-room-code-input input::placeholder{letter-spacing:1px;font-size:14px;font-weight:normal}
.peared-room-code-input button{flex:0 0 auto;padding:0 20px;min-width:70px;max-width:90px;height:56px;margin-bottom:0}
.peared-room-browser{max-height:250px;overflow-y:auto;margin:10px 0}
.peared-room-item{display:flex;justify-content:space-between;align-items:center;background:#1a1a2e;padding:12px 15px;border-radius:8px;margin:8px 0;cursor:pointer;transition:background 0.2s}
.peared-room-item:hover{background:#252540}
.peared-room-info{flex:1}
.peared-room-host{font-weight:bold;color:#fff;margin-bottom:3px}
.peared-room-meta{font-size:12px;color:#888}
.peared-room-players{background:#333;padding:4px 10px;border-radius:12px;font-size:12px;margin-left:10px;flex-shrink:0}
.peared-room-players.full{background:#c0392b}
.peared-room-join-btn{padding:8px 16px;font-size:13px;margin-left:10px;width:auto;margin-bottom:0;flex-shrink:0;align-self:center}
.peared-no-rooms{text-align:center;color:#888;padding:40px 20px;font-size:15px;background:rgba(26,26,46,0.5);border-radius:8px;border:1px dashed #444}
.peared-no-rooms .emoji{font-size:32px;margin-bottom:12px;display:block}
.peared-no-rooms .subtitle{font-size:13px;color:#666;margin-top:8px}
.peared-room-code-display{background:linear-gradient(135deg,#1a1a2e 0%,#252540 100%);padding:24px 20px;border-radius:12px;text-align:center;margin:20px 0;border:2px solid #333}
.peared-room-code-display .code{font-size:42px;font-weight:bold;letter-spacing:10px;color:#4CAF50;font-family:'SF Mono',Monaco,Consolas,monospace;text-shadow:0 2px 10px rgba(76,175,80,0.3);padding:8px 0}
.peared-room-code-display .label{font-size:12px;color:#888;margin-bottom:8px}
.peared-player-setup{margin-bottom:20px}
.peared-player-setup label{display:block;margin-bottom:5px;color:#888;font-size:12px}
.peared-host-options{margin:15px 0}
.peared-host-options label{display:flex;align-items:center;gap:8px;color:#aaa;font-size:14px;cursor:pointer}
.peared-host-options input[type="checkbox"]{width:18px;height:18px}
.peared-world-section{background:#1a1a2e;padding:12px 15px;border-radius:8px;margin-bottom:15px}
.peared-world-section.hidden{display:none}
.peared-world-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.peared-world-title{color:#888;font-size:11px;text-transform:uppercase}
.peared-world-list{max-height:150px;overflow-y:auto;margin-bottom:10px}
.peared-world-item{display:flex;justify-content:space-between;align-items:center;background:#252540;padding:10px 12px;border-radius:6px;margin:6px 0}
.peared-world-item:hover{background:#2a2a50}
.peared-world-item-info{flex:1;min-width:0}
.peared-world-item-name{color:#fff;font-weight:bold;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.peared-world-item-meta{font-size:11px;color:#666;margin-top:2px}
.peared-world-item-actions{display:flex;gap:6px;margin-left:10px}
.peared-world-resume-btn{background:#4CAF50;color:white;border:none;padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer}
.peared-world-resume-btn:hover{background:#45a049}
.peared-world-delete-btn{background:#c0392b;color:white;border:none;padding:6px 10px;border-radius:4px;font-size:12px;cursor:pointer}
.peared-world-delete-btn:hover{background:#a93226}
.peared-world-info{display:flex;justify-content:space-between;align-items:center;color:#4CAF50;font-weight:bold}
.peared-pending-list{margin-top:20px}
.peared-manual-input{height:80px;font-size:10px!important;font-family:monospace}
.peared-video-container{background:#000;border-radius:8px;overflow:hidden;margin-bottom:10px}
.peared-video{width:100%;display:block}
.peared-divider{color:#666;font-size:12px;text-align:center;margin:15px 0}
.peared-refresh-btn{background:none;border:none;color:#888;cursor:pointer;padding:5px;font-size:16px}
.peared-refresh-btn:hover{color:#fff}
`;

    const PEARED_HTML = `
<div id="peared-overlay" class="peared-overlay">
    <div class="peared-popup">
        <div class="peared-header">
            <h2>Multiplayer</h2>
            <button class="peared-close" id="peared-close">&times;</button>
        </div>
        <div class="peared-player-setup">
            <label>Your Name</label>
            <input type="text" id="peared-player-name" class="peared-input" placeholder="Enter your name" maxlength="20">
        </div>
        <div class="peared-tabs">
            <div class="peared-tab active" data-tab="host">Host Game</div>
            <div class="peared-tab" data-tab="join">Join Game</div>
        </div>
        <div id="peared-tab-host" class="peared-content active">
            <p style="color:#888;margin-bottom:15px;">Start hosting and share your room code with others.</p>
            <div id="peared-world-section" class="peared-world-section hidden">
                <div class="peared-world-header">
                    <span class="peared-world-title">💾 Saved Worlds</span>
                </div>
                <div id="peared-world-list" class="peared-world-list"></div>
            </div>
            <div class="peared-host-options">
                <label><input type="checkbox" id="peared-public-room" checked> Public room (visible in browser)</label>
            </div>
            <button id="peared-start-host" class="peared-btn secondary">🎮 Start New Game</button>
            <div id="peared-host-active" style="display:none;">
                <div class="peared-room-code-display">
                    <div class="label">ROOM CODE</div>
                    <div class="code" id="peared-room-code">------</div>
                </div>
                <button id="peared-copy-code" class="peared-btn secondary">📋 Copy Room Code</button>
                <div id="peared-connected-players" class="peared-pending-list">
                    <div style="color:#888;font-size:12px;text-transform:uppercase;margin-bottom:10px;">Players</div>
                    <p id="peared-no-players" style="color:#888;font-size:14px;text-align:center;padding:20px;">Share the room code above<br><span style="color:#666;font-size:12px;">Players will appear here when they join</span></p>
                    <div id="peared-connected-list"></div>
                </div>
                <div id="peared-save-controls" style="margin-top:15px;padding:12px;background:#1a1a2e;border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div><span style="color:#888;font-size:11px;">💾 AUTO-SAVE</span><span id="peared-last-save" style="color:#666;font-size:11px;margin-left:8px;">Not saved yet</span></div>
                        <button id="peared-save-now" class="peared-btn secondary" style="padding:6px 12px;font-size:12px;width:auto;">Save Now</button>
                    </div>
                </div>
                <details style="margin-top:20px;">
                    <summary style="color:#666;cursor:pointer;font-size:12px;">Advanced: Manual Code Exchange</summary>
                    <div style="margin-top:10px;">
                        <div class="peared-status info">Share this with players without internet:</div>
                        <textarea id="peared-host-code" class="peared-input peared-manual-input" readonly></textarea>
                        <button id="peared-copy-full-code" class="peared-btn secondary" style="font-size:12px;">📋 Copy Full Code</button>
                        <div class="peared-divider">— Paste Player Response —</div>
                        <textarea id="peared-answer-input" class="peared-input peared-manual-input" placeholder="Paste response here..."></textarea>
                        <button id="peared-accept-player" class="peared-btn" style="font-size:12px;">✓ Accept</button>
                    </div>
                </details>
            </div>
        </div>
        <div id="peared-tab-join" class="peared-content">
            <div class="peared-room-code-input">
                <input type="text" id="peared-room-code-input" class="peared-input" placeholder="ROOM CODE" maxlength="6">
                <button id="peared-join-room-btn" class="peared-btn">Join</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#888;font-size:12px;text-transform:uppercase;">Public Games</span>
                <button id="peared-refresh-rooms" class="peared-refresh-btn" title="Refresh">🔄</button>
            </div>
            <div id="peared-room-browser" class="peared-room-browser">
                <div class="peared-no-rooms"><span class="emoji">🔍</span>Searching for games...</div>
            </div>
            <div id="peared-joining-status" style="display:none;margin-top:15px;">
                <div class="peared-status info">Connecting to room...</div>
            </div>
            <details style="margin-top:20px;">
                <summary style="color:#666;cursor:pointer;font-size:12px;">Advanced: Manual Code Exchange</summary>
                <div style="margin-top:10px;">
                    <div class="peared-tabs" style="border-bottom:1px solid #444;">
                        <div class="peared-tab active" data-subtab="paste">Paste Code</div>
                        <div class="peared-tab" data-subtab="scan">Scan QR</div>
                    </div>
                    <div id="peared-paste" class="peared-content active" style="margin-top:15px;">
                        <textarea id="peared-join-code" class="peared-input peared-manual-input" placeholder="Paste the host's full code here..."></textarea>
                        <button id="peared-connect-manual" class="peared-btn" style="font-size:12px;">🔗 Connect</button>
                    </div>
                    <div id="peared-scan" class="peared-content" style="margin-top:15px;">
                        <div class="peared-video-container">
                            <video id="peared-video" class="peared-video" playsinline></video>
                        </div>
                        <canvas id="peared-canvas" style="display:none;"></canvas>
                        <button id="peared-start-camera" class="peared-btn" style="margin-top:10px;font-size:12px;">📷 Start Camera</button>
                        <button id="peared-stop-camera" class="peared-btn secondary" style="display:none;font-size:12px;">Stop Camera</button>
                    </div>
                    <div id="peared-join-answer" style="display:none;margin-top:15px;">
                        <div class="peared-status warning">Send this response back to the host:</div>
                        <textarea id="peared-answer-code" class="peared-input peared-manual-input" readonly></textarea>
                        <button id="peared-copy-answer" class="peared-btn secondary" style="font-size:12px;">📋 Copy Response</button>
                    </div>
                </div>
            </details>
        </div>
        <div id="peared-popup-status" class="peared-status" style="display:none;"></div>
    </div>
</div>`;

    class PearedUI {
        constructor(peared) {
            this.peared = peared;
            this._injected = false;
            this._savedWorld = null;
            this._savedWorlds = [];
            this._worldId = 'world-default';
            this._worldName = 'Game World';
            this._lastSaveTime = null;
            this._cameraStream = null;
            this._scanning = false;
        }

        inject() {
            if (this._injected) return;
            const style = document.createElement('style');
            style.textContent = PEARED_CSS;
            document.head.appendChild(style);
            const div = document.createElement('div');
            div.innerHTML = PEARED_HTML;
            document.body.appendChild(div.firstElementChild);
            this._injected = true;
            this._setup();
            this.peared.onRoomsUpdate((rooms) => this._renderRooms(rooms));
        }

        async show() {
            if (!this._injected) this.inject();
            document.getElementById('peared-overlay').classList.add('active');
            await this._loadSavedName();
            await this._loadSavedWorlds();
            this._updateTabState();
            this._refreshRooms();
        }

        _updateTabState() {
            const joinTab = document.querySelector('.peared-tab[data-tab="join"]');
            if (joinTab) {
                if (this.peared.isHost) {
                    joinTab.classList.add('disabled');
                } else {
                    joinTab.classList.remove('disabled');
                }
            }
        }

        hide() {
            document.getElementById('peared-overlay')?.classList.remove('active');
        }

        _setup() {
            // Close handlers
            document.getElementById('peared-close').addEventListener('click', () => this.hide());
            document.getElementById('peared-overlay').addEventListener('click', (e) => {
                if (e.target.id === 'peared-overlay') this.hide();
            });

            // Main tabs (Host/Join)
            document.querySelectorAll('.peared-tabs > .peared-tab[data-tab]').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const tabName = e.target.dataset.tab;
                    if (!tabName) return;
                    // Don't allow switching to Join tab if already hosting
                    if (tabName === 'join' && this.peared.isHost) return;
                    e.target.parentElement.querySelectorAll('.peared-tab').forEach(t => t.classList.remove('active'));
                    e.target.classList.add('active');
                    document.querySelectorAll('#peared-tab-host, #peared-tab-join').forEach(c => c.classList.remove('active'));
                    document.getElementById(`peared-tab-${tabName}`)?.classList.add('active');
                });
            });

            // Subtabs (Paste Code/Scan QR)
            document.querySelectorAll('.peared-tab[data-subtab]').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const subtab = e.target.dataset.subtab;
                    if (!subtab) return;
                    e.target.parentElement.querySelectorAll('.peared-tab').forEach(t => t.classList.remove('active'));
                    e.target.classList.add('active');
                    document.querySelectorAll('#peared-paste, #peared-scan').forEach(c => c.classList.remove('active'));
                    document.getElementById(`peared-${subtab}`)?.classList.add('active');
                });
            });

            // Host controls
            document.getElementById('peared-start-host').addEventListener('click', () => this._startHosting());
            document.getElementById('peared-copy-code').addEventListener('click', () => {
                navigator.clipboard.writeText(document.getElementById('peared-room-code').textContent);
                const btn = document.getElementById('peared-copy-code');
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy Room Code', 2000);
            });
            document.getElementById('peared-save-now').addEventListener('click', () => this._saveNow());

            // Join controls
            document.getElementById('peared-join-room-btn').addEventListener('click', () => {
                const code = document.getElementById('peared-room-code-input').value.trim();
                if (code) this._joinRoom(code);
            });
            const codeInput = document.getElementById('peared-room-code-input');
            codeInput.addEventListener('input', (e) => e.target.value = e.target.value.toUpperCase());
            codeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('peared-join-room-btn').click(); });
            document.getElementById('peared-refresh-rooms').addEventListener('click', () => this._refreshRooms());

            // Manual code exchange - Host
            document.getElementById('peared-copy-full-code')?.addEventListener('click', () => {
                const code = document.getElementById('peared-host-code').value;
                navigator.clipboard.writeText(code);
                const btn = document.getElementById('peared-copy-full-code');
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy Full Code', 2000);
            });

            // Manual code exchange - Join
            document.getElementById('peared-connect-manual')?.addEventListener('click', () => this._connectManual());
            document.getElementById('peared-copy-answer')?.addEventListener('click', () => {
                const code = document.getElementById('peared-answer-code').value;
                navigator.clipboard.writeText(code);
                const btn = document.getElementById('peared-copy-answer');
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy Response', 2000);
            });

            // QR Camera controls
            document.getElementById('peared-start-camera')?.addEventListener('click', () => this._startCamera());
            document.getElementById('peared-stop-camera')?.addEventListener('click', () => this._stopCamera());

            // Manual code exchange - Host accept player
            document.getElementById('peared-accept-player')?.addEventListener('click', () => this._handleAcceptPlayer());
        }

        async _loadSavedName() {
            const identity = await this.peared.loadIdentity();
            if (identity?.name) {
                document.getElementById('peared-player-name').value = identity.name;
            }
        }

        async _loadSavedWorlds() {
            if (!this.peared.persistence) return;

            try {
                const worlds = await this.peared.listWorlds();
                const worldSection = document.getElementById('peared-world-section');
                const worldList = document.getElementById('peared-world-list');

                if (worlds && worlds.length > 0) {
                    this._savedWorlds = worlds;
                    worldSection.classList.remove('hidden');

                    worldList.innerHTML = worlds.map(w => `
                        <div class="peared-world-item" data-world-id="${w.id}">
                            <div class="peared-world-item-info">
                                <div class="peared-world-item-name">${w.name}</div>
                                <div class="peared-world-item-meta">${this._formatTimeAgo(new Date(w.updatedAt))} • ${this._formatSize(w.size)}</div>
                            </div>
                            <div class="peared-world-item-actions">
                                <button class="peared-world-resume-btn" data-world-id="${w.id}">▶ Resume</button>
                                <button class="peared-world-delete-btn" data-world-id="${w.id}">🗑</button>
                            </div>
                        </div>
                    `).join('');

                    // Add event listeners
                    worldList.querySelectorAll('.peared-world-resume-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._resumeWorld(btn.dataset.worldId);
                        });
                    });

                    worldList.querySelectorAll('.peared-world-delete-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._deleteWorld(btn.dataset.worldId);
                        });
                    });
                } else {
                    worldSection.classList.add('hidden');
                    this._savedWorlds = [];
                }
            } catch (error) {
                console.warn('[Peared UI] Failed to load saved worlds:', error);
            }
        }

        _formatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        async _resumeWorld(worldId) {
            const world = this._savedWorlds?.find(w => w.id === worldId);
            if (!world) return;

            this._worldId = world.id;
            this._worldName = world.name;
            this._savedWorld = world;

            await this._startHosting(true);
        }

        async _deleteWorld(worldId) {
            if (!confirm('Delete this world? This cannot be undone.')) return;

            try {
                await this.peared.deleteWorld(worldId);
                await this._loadSavedWorlds();
                this._status('World deleted', 'success');
            } catch (e) {
                this._status('Failed to delete world', 'error');
            }
        }

        _formatTimeAgo(date) {
            const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
            if (seconds < 60) return 'just now';
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
        }

        async _startHosting(resumeWorld = false) {
            const name = document.getElementById('peared-player-name').value || 'Host';
            const isPublic = document.getElementById('peared-public-room').checked;

            document.getElementById('peared-start-host').style.display = 'none';
            document.getElementById('peared-host-active').style.display = 'block';
            document.getElementById('peared-world-section').classList.add('hidden');
            document.getElementById('peared-room-code').textContent = '......';

            try {
                // Load saved world if resuming
                if (resumeWorld && this._savedWorld && this.peared.persistence) {
                    try {
                        const world = await this.peared.loadWorld(this._savedWorld.id);
                        if (world && world.data && this.peared.options.onStateSync) {
                            this.peared.options.onStateSync(world.data);
                            console.log('[Peared UI] Resumed from saved world:', world.name);
                        }
                    } catch (e) {
                        console.warn('[Peared UI] Failed to load saved world:', e);
                    }
                } else {
                    // New game - generate new world ID
                    this._worldId = 'world-' + Math.random().toString(36).substring(2, 10);
                    this._worldName = `${name}'s World`;
                }

                const code = await this.peared.createRoom(name, isPublic);
                document.getElementById('peared-room-code').textContent = code;

                // Populate manual code exchange textarea
                this._updateHostCode();

                // Start auto-save if getState is provided
                if (this.peared.options.getState && this.peared.persistence) {
                    const self = this;
                    this.peared.startAutoSave(
                        () => {
                            self._lastSaveTime = Date.now();
                            self._updateLastSaveUI();
                            return self.peared.options.getState();
                        },
                        this._worldId,
                        this._worldName
                    );
                    console.log('[Peared UI] Auto-save started for:', this._worldName);

                    // Update last save display periodically
                    this._lastSaveInterval = setInterval(() => {
                        if (self._lastSaveTime) self._updateLastSaveUI();
                    }, 30000);
                }
            } catch (e) {
                this._status('Failed: ' + e.message, 'error');
                document.getElementById('peared-room-code').textContent = 'ERROR';
            }
        }

        async _saveNow() {
            if (!this.peared.isHost || !this.peared.options.getState || !this.peared.persistence) {
                this._status('Cannot save - not hosting', 'error');
                return;
            }

            const btn = document.getElementById('peared-save-now');
            btn.textContent = 'Saving...';
            btn.disabled = true;

            try {
                const state = this.peared.options.getState();
                await this.peared.saveWorld(this._worldId, this._worldName, state);
                this._lastSaveTime = Date.now();
                this._updateLastSaveUI();
                btn.textContent = 'Saved!';
                setTimeout(() => {
                    btn.textContent = 'Save Now';
                    btn.disabled = false;
                }, 2000);
            } catch (e) {
                btn.textContent = 'Save Failed';
                setTimeout(() => {
                    btn.textContent = 'Save Now';
                    btn.disabled = false;
                }, 2000);
                this._status('Save failed: ' + e.message, 'error');
            }
        }

        _updateLastSaveUI() {
            const el = document.getElementById('peared-last-save');
            if (el && this._lastSaveTime) {
                el.textContent = `Last saved ${this._formatTimeAgo(new Date(this._lastSaveTime))}`;
            }
        }

        async _joinRoom(code) {
            const name = document.getElementById('peared-player-name').value || 'Player';
            const status = document.getElementById('peared-joining-status');
            status.style.display = 'block';
            status.textContent = `Connecting to ${code}...`;
            status.className = 'peared-status info';
            try {
                await this.peared.joinRoom(code, name);
                status.textContent = 'Connected!';
                status.className = 'peared-status success';
                setTimeout(() => this.hide(), 1000);
            } catch (e) {
                status.textContent = 'Error: ' + e.message;
                status.className = 'peared-status error';
            }
        }

        async _refreshRooms() {
            document.getElementById('peared-room-browser').innerHTML = '<div class="peared-no-rooms"><span class="emoji">🔍</span>Searching for games...</div>';
            this._renderRooms(await this.peared.getPublicRooms());
        }

        _renderRooms(rooms) {
            const c = document.getElementById('peared-room-browser');
            if (!c) return;

            // Filter out own room if hosting
            const myRoomCode = this.peared.roomCode;
            const filteredRooms = rooms ? rooms.filter(r => r.code !== myRoomCode) : [];

            if (!filteredRooms.length) {
                c.innerHTML = '<div class="peared-no-rooms"><span class="emoji">🎮</span>No games found<div class="subtitle">Host your own or enter a room code above</div></div>';
                return;
            }
            c.innerHTML = filteredRooms.map(r => {
                const isFull = r.players >= r.maxPlayers;
                return `<div class="peared-room-item" data-code="${r.code}">
                    <div class="peared-room-info">
                        <div class="peared-room-host">${r.host}'s Game</div>
                        <div class="peared-room-meta">Code: ${r.code}</div>
                    </div>
                    <span class="peared-room-players ${isFull ? 'full' : ''}">${r.players}/${r.maxPlayers}</span>
                    <button class="peared-btn peared-room-join-btn" ${isFull ? 'disabled' : ''}>Join</button>
                </div>`;
            }).join('');
            c.querySelectorAll('.peared-room-item').forEach(item => {
                const btn = item.querySelector('.peared-room-join-btn');
                if (btn && !btn.disabled) btn.addEventListener('click', (e) => { e.stopPropagation(); this._joinRoom(item.dataset.code); });
            });
        }

        // ===== MANUAL CODE EXCHANGE =====

        _compress(data) {
            const json = JSON.stringify(data);
            if (global.LZString) {
                const compressed = global.LZString.compressToEncodedURIComponent(json);
                return compressed.length < json.length ? compressed : json;
            }
            return btoa(unescape(encodeURIComponent(json)));
        }

        _decompress(data) {
            try {
                return JSON.parse(data);
            } catch {
                if (global.LZString) {
                    const decompressed = global.LZString.decompressFromEncodedURIComponent(data);
                    return JSON.parse(decompressed);
                }
                return JSON.parse(decodeURIComponent(escape(atob(data))));
            }
        }

        async _updateHostCode() {
            // Get the current pending connection offer data
            const pendingEntries = Array.from(this.peared.pendingConnections.entries());
            if (pendingEntries.length === 0) return;

            const [peerId, pending] = pendingEntries[pendingEntries.length - 1];

            // Get the local description (offer)
            const offer = pending.connection.localDescription;
            if (!offer) return;

            const offerData = {
                peerId,
                offer: { type: offer.type, sdp: offer.sdp },
                hostId: this.peared.localPlayer?.id,
                hostName: this.peared.localPlayer?.name
            };

            const compressed = this._compress(offerData);
            const hostCodeEl = document.getElementById('peared-host-code');
            if (hostCodeEl) {
                hostCodeEl.value = compressed;
            }
        }

        async _connectManual() {
            const code = document.getElementById('peared-join-code')?.value?.trim();
            if (!code) {
                this._status('Please paste the host\'s code first', 'error');
                return;
            }

            try {
                const offerData = this._decompress(code);

                if (!offerData.offer) {
                    this._status('Invalid code - not a host offer', 'error');
                    return;
                }

                this._status(`Connecting to ${offerData.hostName}...`, 'info');

                // Set up local player if not already
                if (!this.peared.localPlayer) {
                    const name = document.getElementById('peared-player-name').value || 'Player';
                    this.peared.localPlayer = {
                        id: this.peared._generateId(),
                        name: name,
                        color: this.peared._generateColor(),
                        isHost: false,
                        joinOrder: Date.now()
                    };
                    this.peared.allPlayers.set(this.peared.localPlayer.id, this.peared.localPlayer);
                }

                // Create answer using the Peared library's internal method
                const answerData = await this.peared._createClientAnswerFromOffer(offerData);
                const compressed = this._compress(answerData);

                // Show answer section
                document.getElementById('peared-join-answer').style.display = 'block';
                document.getElementById('peared-answer-code').value = compressed;

                this._status('Copy the response below and send it to the host!', 'warning');

            } catch (error) {
                this._status('Invalid code: ' + error.message, 'error');
            }
        }

        async _handleAcceptPlayer() {
            const code = document.getElementById('peared-answer-input')?.value?.trim();
            if (!code) {
                this._status('Please paste the player\'s response code', 'error');
                return;
            }

            try {
                const answerData = this._decompress(code);

                if (!answerData.answer) {
                    this._status('Invalid response code - not an answer', 'error');
                    return;
                }

                const success = await this.peared._processAnswer(answerData);

                if (success) {
                    this._status('Player connecting...', 'success');
                    document.getElementById('peared-answer-input').value = '';

                    // Generate new offer for next player
                    await this.peared._refreshHostOffer();
                    await this._updateHostCode();

                    this.peared.firebase?.updatePlayerCount(this.peared.getPlayers().length);
                } else {
                    this._status('Failed to accept player - invalid or expired code', 'error');
                }
            } catch (error) {
                this._status('Error accepting player: ' + error.message, 'error');
            }
        }

        // ===== QR SCANNING =====

        async _loadJsQR() {
            if (global.jsQR) return true;

            return new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
                script.onload = () => resolve(true);
                script.onerror = () => resolve(false);
                document.head.appendChild(script);
            });
        }

        async _startCamera() {
            // Load jsQR if not present
            const loaded = await this._loadJsQR();
            if (!loaded) {
                this._status('Failed to load QR scanner library', 'error');
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });

                const video = document.getElementById('peared-video');
                video.srcObject = stream;
                await video.play();

                this._cameraStream = stream;
                this._scanning = true;

                document.getElementById('peared-start-camera').style.display = 'none';
                document.getElementById('peared-stop-camera').style.display = 'block';

                this._scanQR();
            } catch (error) {
                this._status('Camera error: ' + error.message, 'error');
            }
        }

        _stopCamera() {
            this._scanning = false;
            if (this._cameraStream) {
                this._cameraStream.getTracks().forEach(t => t.stop());
                this._cameraStream = null;
            }
            const video = document.getElementById('peared-video');
            if (video) video.srcObject = null;
            document.getElementById('peared-start-camera').style.display = 'block';
            document.getElementById('peared-stop-camera').style.display = 'none';
        }

        _scanQR() {
            if (!this._scanning) return;

            const video = document.getElementById('peared-video');
            const canvas = document.getElementById('peared-canvas');

            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = global.jsQR(imageData.data, imageData.width, imageData.height);

                if (code) {
                    this._stopCamera();
                    document.getElementById('peared-join-code').value = code.data;
                    this._connectManual();
                    return;
                }
            }

            requestAnimationFrame(() => this._scanQR());
        }

        _status(msg, type = 'info') {
            const s = document.getElementById('peared-popup-status');
            s.textContent = msg;
            s.className = `peared-status ${type}`;
            s.style.display = 'block';
            setTimeout(() => s.style.display = 'none', 3000);
        }

        updateConnectedList(players, localId) {
            const container = document.getElementById('peared-connected-list');
            const noPlayersMsg = document.getElementById('peared-no-players');
            if (!container) return;

            const others = players.filter(p => p.id !== localId);
            if (!others.length) {
                container.innerHTML = '';
                if (noPlayersMsg) noPlayersMsg.style.display = 'block';
            } else {
                if (noPlayersMsg) noPlayersMsg.style.display = 'none';
                container.innerHTML = others.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;background:#1a1a2e;padding:10px;border-radius:6px;margin:5px 0;">
                        <span style="color:${p.color};font-weight:bold;">${p.name}</span>
                        <span style="color:#666;font-size:11px;">Connected</span>
                    </div>
                `).join('');
            }
        }

        /**
         * Set custom world info for saves
         * @param {string} id - Unique world identifier
         * @param {string} name - Display name for the world
         */
        setWorldInfo(id, name) {
            this._worldId = id;
            this._worldName = name;
        }

        /**
         * Get current world info
         * @returns {{ id: string, name: string, savedWorld: object|null }}
         */
        getWorldInfo() {
            return {
                id: this._worldId,
                name: this._worldName,
                savedWorld: this._savedWorld
            };
        }
    }

    /*=============================================
      PEARED - MAIN CLASS
      =============================================
      P2P multiplayer with host/client model.
    =============================================*/

    class Peared {
        constructor(options = {}) {
            // Use default Firebase if none provided and ui:true
            const firebaseConfig = options.firebaseConfig ||
                (options.ui ? DEFAULT_FIREBASE_CONFIG : null);

            this.options = {
                ui: options.ui || false,
                onPlayerJoin: options.onPlayerJoin || (() => {}),
                onPlayerLeave: options.onPlayerLeave || (() => {}),
                onMessage: options.onMessage || (() => {}),
                onUnreliableMessage: options.onUnreliableMessage || null,
                onStateChange: options.onStateChange || (() => {}),
                onConnectionQualityChange: options.onConnectionQualityChange || (() => {}),
                onHostMigration: options.onHostMigration || (() => {}),
                getState: options.getState || null,
                onStateSync: options.onStateSync || (() => {}),
                interpolationDelay: options.interpolationDelay || 100,
                gameId: options.gameId || (options.ui ? 'peared-game' : null),
                autoSaveInterval: options.autoSaveInterval || 30000,
                enableHostMigration: options.enableHostMigration !== false,
                reconnectAttempts: options.reconnectAttempts || 3,
                reconnectDelay: options.reconnectDelay || 2000,
                pingInterval: options.pingInterval || 2000,
                firebaseConfig: firebaseConfig,
                iceServers: options.iceServers || [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    {
                        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            };

            this.isHost = false;
            this.localPlayer = null;
            this.peers = new Map();
            this.pendingConnections = new Map();
            this.allPlayers = new Map();
            this.state = 'disconnected';

            // Interpolation
            this.interpolator = new Interpolator({ delay: this.options.interpolationDelay });

            // Voice chat
            this.localStream = null;
            this.voiceEnabled = false;
            this.muted = false;
            this.remoteAudios = new Map();

            // Persistence
            this.persistence = this.options.gameId ? new PearedPersistence(this.options.gameId) : null;
            this.currentWorldId = null;
            this._autoSaveInterval = null;

            // Firebase
            this.firebase = this.options.firebaseConfig ?
                new FirebaseSignaling(this.options.firebaseConfig) : null;
            this.roomCode = null;
            this._heartbeatInterval = null;

            // Connection quality tracking
            this._peerStats = new Map(); // peerId -> { ping, quality, lastPingTime, pendingPings }
            this._pingInterval = null;
            this._pingSequence = 0;

            // Reconnection state
            this._reconnecting = false;
            this._reconnectAttempts = 0;
            this._lastHostInfo = null;

            // Host migration
            this._hostCandidates = []; // Ordered list of players who can become host
            this._migrationInProgress = false;

            // UI
            this.ui = this.options.ui ? new PearedUI(this) : null;

            this._setupCleanup();
            this._log('info', 'Peared initialized');
        }

        // ===== LOGGING =====

        _log(level, message, data = null) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            const consoleMsg = `[Peared ${time}] ${message}`;
            if (level === 'error') console.error(consoleMsg, data || '');
            else if (level === 'warning') console.warn(consoleMsg, data || '');
            else console.log(consoleMsg, data || '');
        }

        // ===== CLEANUP =====

        _setupCleanup() {
            global.addEventListener('beforeunload', () => {
                if (this.isHost && this.firebase?.roomRef) {
                    try {
                        this.firebase.roomRef.remove();
                    } catch (e) {}
                }
            });

            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.isHost && this.firebase) {
                    this.firebase.updateHeartbeat();
                }
            });
        }

        _startHeartbeat() {
            if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = setInterval(() => {
                if (this.isHost && this.firebase?.roomRef) {
                    this.firebase.updateHeartbeat();
                }
            }, 30000);
        }

        _stopHeartbeat() {
            if (this._heartbeatInterval) {
                clearInterval(this._heartbeatInterval);
                this._heartbeatInterval = null;
            }
        }

        // ===== CONNECTION QUALITY / PING =====

        _startPingLoop() {
            if (this._pingInterval) clearInterval(this._pingInterval);

            this._pingInterval = setInterval(() => {
                this._sendPings();
            }, this.options.pingInterval);
        }

        _stopPingLoop() {
            if (this._pingInterval) {
                clearInterval(this._pingInterval);
                this._pingInterval = null;
            }
        }

        _sendPings() {
            const now = Date.now();
            const seq = ++this._pingSequence;

            this.peers.forEach((peer, peerId) => {
                if (peer.dataChannel?.readyState === 'open') {
                    // Initialize stats if needed
                    if (!this._peerStats.has(peerId)) {
                        this._peerStats.set(peerId, {
                            ping: 0,
                            quality: 'unknown',
                            pendingPings: new Map(),
                            pingHistory: []
                        });
                    }

                    const stats = this._peerStats.get(peerId);
                    stats.pendingPings.set(seq, now);

                    peer.dataChannel.send(JSON.stringify({
                        type: '_peared_ping',
                        data: { seq, time: now },
                        from: this.localPlayer?.id
                    }));
                }
            });
        }

        _handlePing(fromPeerId, data) {
            // Respond immediately with pong
            const peer = this.peers.get(fromPeerId);
            if (peer?.dataChannel?.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify({
                    type: '_peared_pong',
                    data: { seq: data.seq, time: data.time },
                    from: this.localPlayer?.id
                }));
            }
        }

        _handlePong(fromPeerId, data) {
            const stats = this._peerStats.get(fromPeerId);
            if (!stats) return;

            const sentTime = stats.pendingPings.get(data.seq);
            if (sentTime) {
                const rtt = Date.now() - sentTime;
                stats.pendingPings.delete(data.seq);

                // Update ping (rolling average)
                stats.pingHistory.push(rtt);
                if (stats.pingHistory.length > 10) {
                    stats.pingHistory.shift();
                }
                stats.ping = Math.round(
                    stats.pingHistory.reduce((a, b) => a + b, 0) / stats.pingHistory.length
                );

                // Update quality
                const oldQuality = stats.quality;
                if (stats.ping < 50) {
                    stats.quality = 'excellent';
                } else if (stats.ping < 100) {
                    stats.quality = 'good';
                } else if (stats.ping < 200) {
                    stats.quality = 'fair';
                } else {
                    stats.quality = 'poor';
                }

                if (oldQuality !== stats.quality) {
                    this.options.onConnectionQualityChange(fromPeerId, stats.quality, stats.ping);
                }
            }
        }

        /**
         * Get ping/quality stats for a peer
         * @param {string} peerId
         * @returns {{ ping: number, quality: string } | null}
         */
        getPeerStats(peerId) {
            const stats = this._peerStats.get(peerId);
            if (!stats) return null;
            return { ping: stats.ping, quality: stats.quality };
        }

        /**
         * Get stats for all connected peers
         * @returns {Map<string, { ping: number, quality: string }>}
         */
        getAllPeerStats() {
            const result = new Map();
            this._peerStats.forEach((stats, peerId) => {
                result.set(peerId, { ping: stats.ping, quality: stats.quality });
            });
            return result;
        }

        /**
         * Get average ping across all peers
         * @returns {number}
         */
        getAveragePing() {
            if (this._peerStats.size === 0) return 0;
            let total = 0;
            this._peerStats.forEach(stats => total += stats.ping);
            return Math.round(total / this._peerStats.size);
        }

        // ===== RECONNECTION =====

        async _attemptReconnect() {
            if (this._reconnecting) return;
            if (this._reconnectAttempts >= this.options.reconnectAttempts) {
                this._log('error', 'Max reconnection attempts reached');
                this._reconnecting = false;
                this._reconnectAttempts = 0;
                return;
            }

            this._reconnecting = true;
            this._reconnectAttempts++;

            this._log('info', `Reconnection attempt ${this._reconnectAttempts}/${this.options.reconnectAttempts}`);

            try {
                if (this._lastHostInfo && this.firebase) {
                    // Try to rejoin via Firebase
                    await this._joinViaFirebase(this._lastHostInfo.roomCode);
                    this._reconnecting = false;
                    this._reconnectAttempts = 0;
                    this._log('success', 'Reconnected successfully');
                } else {
                    throw new Error('No host info available for reconnection');
                }
            } catch (error) {
                this._log('warning', 'Reconnection failed', error.message);

                // Wait before next attempt
                await new Promise(resolve =>
                    setTimeout(resolve, this.options.reconnectDelay)
                );

                this._reconnecting = false;
                this._attemptReconnect();
            }
        }

        // ===== HOST MIGRATION =====

        _updateHostCandidates() {
            // Build ordered list of potential hosts (by join order, excluding current host)
            this._hostCandidates = Array.from(this.allPlayers.values())
                .filter(p => !p.isHost && p.id !== this.localPlayer?.id)
                .sort((a, b) => (a.joinOrder || 0) - (b.joinOrder || 0));
        }

        async _initiateHostMigration() {
            if (this._migrationInProgress) return;
            if (!this.options.enableHostMigration) {
                this._log('warning', 'Host migration disabled');
                return;
            }

            this._migrationInProgress = true;
            this._log('info', 'Initiating host migration...');

            // Am I the next host candidate?
            const nextHost = this._hostCandidates[0];

            if (nextHost && nextHost.id === this.localPlayer?.id) {
                this._log('success', 'Becoming new host');
                await this._becomeHost();
            } else if (nextHost) {
                this._log('info', `Waiting for ${nextHost.name} to become host`);
                // Wait for new host to establish connection
                setTimeout(() => {
                    if (this._migrationInProgress) {
                        this._log('warning', 'Host migration timeout, retrying...');
                        this._hostCandidates.shift();
                        this._migrationInProgress = false;
                        this._initiateHostMigration();
                    }
                }, 5000);
            } else {
                this._log('error', 'No host candidates available');
                this._migrationInProgress = false;
            }
        }

        async _becomeHost() {
            this.isHost = true;
            this.localPlayer.isHost = true;
            this.allPlayers.get(this.localPlayer.id).isHost = true;

            this._log('success', 'Now hosting as migrated host');

            // Create new room in Firebase
            if (this.firebase && this.firebase.isConnected()) {
                try {
                    const offerData = await this._createHostOffer();
                    this.roomCode = await this.firebase.createRoomWithOffer(
                        this.localPlayer.name,
                        true,
                        offerData
                    );
                    this._startHeartbeat();

                    // Listen for new connections
                    this.firebase.onAnswer(async (answerData) => {
                        const success = await this._processAnswer(answerData);
                        if (success) {
                            await this._refreshHostOffer();
                            this.firebase.updatePlayerCount(this.getPlayers().length);
                        }
                    });
                } catch (error) {
                    this._log('error', 'Failed to create room after migration', error.message);
                }
            }

            // Notify remaining peers about new host
            this.broadcast('_peared_host_migrated', {
                newHostId: this.localPlayer.id,
                roomCode: this.roomCode
            });

            // Get current game state and sync to all
            if (this.options.getState) {
                const gameState = this.options.getState();
                this.broadcast('_peared_state', { state: gameState });
            }

            this._migrationInProgress = false;
            this._startPingLoop();
            this._updateState();

            this.options.onHostMigration(this.localPlayer, 'became_host');
        }

        _handleHostMigrated(data) {
            this._log('info', `Host migrated to ${data.newHostId}`);

            // Update host status
            this.allPlayers.forEach(p => p.isHost = false);
            const newHost = this.allPlayers.get(data.newHostId);
            if (newHost) {
                newHost.isHost = true;
            }

            this._lastHostInfo = { roomCode: data.roomCode };
            this._migrationInProgress = false;

            this.options.onHostMigration(newHost, 'host_changed');
        }

        // ===== PUBLIC API =====

        host(playerName) {
            this.isHost = true;
            this.localPlayer = {
                id: this._generateId(),
                name: playerName || 'Host',
                color: this._generateColor(),
                isHost: true,
                joinOrder: 0
            };
            this.allPlayers.set(this.localPlayer.id, this.localPlayer);
            this.state = 'hosting';
            this._log('success', `Started hosting as "${this.localPlayer.name}"`);
            this._startPingLoop();
            this._updateState();
            this.options.onPlayerJoin(this.localPlayer);

            if (this.persistence) {
                this.saveIdentity({
                    name: this.localPlayer.name,
                    color: this.localPlayer.color
                });
            }

            return this.localPlayer;
        }

        getPlayers() {
            return Array.from(this.allPlayers.values());
        }

        send(type, data) {
            const message = JSON.stringify({ type, data, from: this.localPlayer?.id });

            if (this.isHost) {
                this.peers.forEach(peer => {
                    if (peer.dataChannel?.readyState === 'open') {
                        peer.dataChannel.send(message);
                    }
                });
            } else {
                const hostPeer = this.peers.values().next().value;
                if (hostPeer?.dataChannel?.readyState === 'open') {
                    hostPeer.dataChannel.send(message);
                }
            }
        }

        broadcast(type, data, excludeId = null, originalFrom = null) {
            if (!this.isHost) return;
            const senderId = originalFrom || this.localPlayer?.id;
            const message = JSON.stringify({ type, data, from: senderId });

            this.peers.forEach((peer, peerId) => {
                if (peerId !== excludeId && peer.dataChannel?.readyState === 'open') {
                    peer.dataChannel.send(message);
                }
            });
        }

        sendTo(peerId, type, data) {
            const peer = this.peers.get(peerId);
            if (peer?.dataChannel?.readyState === 'open') {
                const message = JSON.stringify({ type, data, from: this.localPlayer?.id });
                peer.dataChannel.send(message);
            }
        }

        sendUnreliable(type, data) {
            const message = JSON.stringify({ type, data, from: this.localPlayer?.id });

            if (this.isHost) {
                this.peers.forEach(peer => {
                    if (peer.unreliableChannel?.readyState === 'open') {
                        peer.unreliableChannel.send(message);
                    }
                });
            } else {
                const hostPeer = this.peers.values().next().value;
                if (hostPeer?.unreliableChannel?.readyState === 'open') {
                    hostPeer.unreliableChannel.send(message);
                }
            }
        }

        broadcastUnreliable(type, data, excludeId = null, originalFrom = null) {
            if (!this.isHost) return;

            const senderId = originalFrom || this.localPlayer?.id;
            const message = JSON.stringify({ type, data, from: senderId });

            this.peers.forEach((peer, peerId) => {
                if (peerId !== excludeId && peer.unreliableChannel?.readyState === 'open') {
                    peer.unreliableChannel.send(message);
                }
            });
        }

        getInterpolatedState(playerId) {
            return this.interpolator.getState(playerId);
        }

        pushStateForInterpolation(playerId, state) {
            this.interpolator.pushState(playerId, state);
        }

        close() {
            this.peers.forEach(peer => {
                peer.dataChannel?.close();
                peer.unreliableChannel?.close();
                peer.connection?.close();
            });
            this.peers.clear();
            this.pendingConnections.clear();
            this.allPlayers.clear();
            this.interpolator.clear();
            this._peerStats.clear();
            this.state = 'disconnected';
            this.isHost = false;
            this.localPlayer = null;
            this.roomCode = null;

            this._stopHeartbeat();
            this._stopPingLoop();
            this.stopAutoSave();
            this.disableVoice();

            if (this.firebase) {
                this.firebase.destroy();
            }

            this._updateState();
        }

        // ===== UI API =====

        showPopup() {
            if (this.ui) {
                this.ui.show();
            } else {
                console.warn('[Peared] UI not enabled. Initialize with { ui: true }');
            }
        }

        hidePopup() {
            if (this.ui) {
                this.ui.hide();
            }
        }

        _updateConnectedUI() {
            if (this.ui) {
                this.ui.updateConnectedList(this.getPlayers(), this.localPlayer?.id);
            }
        }

        // ===== VOICE CHAT API =====

        async enableVoice() {
            if (this.voiceEnabled) return true;

            try {
                this._log('info', 'Requesting microphone access...');
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    },
                    video: false
                });

                this.voiceEnabled = true;
                this._log('success', 'Microphone enabled');

                this.peers.forEach((peer, peerId) => {
                    this._addAudioToPeer(peer.connection, peerId);
                });

                return true;
            } catch (error) {
                this._log('error', 'Failed to access microphone', error.message);
                return false;
            }
        }

        disableVoice() {
            if (!this.voiceEnabled) return;

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }

            this.remoteAudios.forEach(audio => {
                audio.srcObject = null;
                audio.remove();
            });
            this.remoteAudios.clear();

            this.voiceEnabled = false;
            this._log('info', 'Voice chat disabled');
        }

        mute() {
            if (!this.localStream) return;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
            this.muted = true;
        }

        unmute() {
            if (!this.localStream) return;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
            });
            this.muted = false;
        }

        toggleMute() {
            if (this.muted) {
                this.unmute();
            } else {
                this.mute();
            }
            return this.muted;
        }

        setPlayerVolume(playerId, volume) {
            for (const [peerId, peer] of this.peers) {
                if (peer.player?.id === playerId) {
                    const audio = this.remoteAudios.get(peerId);
                    if (audio) {
                        audio.volume = Math.max(0, Math.min(1, volume));
                    }
                    break;
                }
            }
        }

        isVoiceEnabled() {
            return this.voiceEnabled;
        }

        isMuted() {
            return this.muted;
        }

        // ===== PERSISTENCE API =====

        async saveIdentity(identity) {
            if (!this.persistence) return false;
            try {
                await this.persistence.saveIdentity(identity);
                return true;
            } catch (error) {
                this._log('error', 'Failed to save identity', error.message);
                return false;
            }
        }

        async loadIdentity() {
            if (!this.persistence) return null;
            return this.persistence.loadIdentity();
        }

        async verifyPin(pin) {
            if (!this.persistence) return true;
            return this.persistence.verifyPin(pin);
        }

        async listWorlds() {
            if (!this.persistence) return [];
            return this.persistence.listWorlds();
        }

        async saveWorld(id, name, data, password = null) {
            if (!this.persistence) return null;
            try {
                return await this.persistence.saveWorld(id, name, data, password);
            } catch (error) {
                this._log('error', 'Failed to save world', error.message);
                return null;
            }
        }

        async loadWorld(id, password = null) {
            if (!this.persistence) return null;
            try {
                return await this.persistence.loadWorld(id, password);
            } catch (error) {
                this._log('error', 'Failed to load world', error.message);
                return null;
            }
        }

        async deleteWorld(id) {
            if (!this.persistence) return false;
            try {
                await this.persistence.deleteWorld(id);
                return true;
            } catch (error) {
                return false;
            }
        }

        async exportWorld(id, password = null) {
            if (!this.persistence) return null;
            return this.persistence.exportWorld(id, password);
        }

        async importWorld(exportString, newName = null) {
            if (!this.persistence) return null;
            try {
                return await this.persistence.importWorld(exportString, newName);
            } catch (error) {
                this._log('error', 'Failed to import world', error.message);
                return null;
            }
        }

        startAutoSave(getStateCallback, worldId, worldName) {
            if (!this.persistence || !this.options.autoSaveInterval) return;

            this.stopAutoSave();

            this._autoSaveInterval = setInterval(async () => {
                if (this.isHost) {
                    const state = getStateCallback();
                    if (state) {
                        await this.saveWorld(worldId, worldName, state);
                    }
                }
            }, this.options.autoSaveInterval);
        }

        stopAutoSave() {
            if (this._autoSaveInterval) {
                clearInterval(this._autoSaveInterval);
                this._autoSaveInterval = null;
            }
        }

        // ===== FIREBASE INTEGRATION =====

        async createRoom(playerName, isPublic = true) {
            if (!this.firebase) {
                throw new Error('Firebase not configured');
            }

            this.host(playerName);

            const offerData = await this._createHostOffer();
            this.roomCode = await this.firebase.createRoomWithOffer(playerName, isPublic, offerData);

            this._startHeartbeat();

            this.firebase.onAnswer(async (answerData) => {
                const success = await this._processAnswer(answerData);
                if (success) {
                    await this._refreshHostOffer();
                    this.firebase.updatePlayerCount(this.getPlayers().length);
                }
            });

            return this.roomCode;
        }

        async joinRoom(roomCode, playerName) {
            if (!this.firebase) {
                throw new Error('Firebase not configured');
            }

            const room = await this.firebase.joinRoom(roomCode);

            this.localPlayer = {
                id: this._generateId(),
                name: playerName || 'Player',
                color: this._generateColor(),
                isHost: false,
                joinOrder: Date.now()
            };
            this.allPlayers.set(this.localPlayer.id, this.localPlayer);

            this._lastHostInfo = { roomCode, hostName: room.host };

            const answerData = await this._createClientAnswerFromOffer(room.offer);
            await this.firebase.setAnswer(answerData);

            return room;
        }

        async getPublicRooms() {
            if (!this.firebase) return [];
            return this.firebase.getPublicRooms();
        }

        onRoomsUpdate(callback) {
            if (!this.firebase) return;
            this.firebase.onRoomsUpdate(callback);
        }

        async _joinViaFirebase(roomCode) {
            const room = await this.firebase.joinRoom(roomCode);
            const answerData = await this._createClientAnswerFromOffer(room.offer);
            await this.firebase.setAnswer(answerData);
        }

        async _refreshHostOffer() {
            const offerData = await this._createHostOffer();
            if (this.firebase?.roomRef) {
                await this.firebase.setOffer(offerData);
            }
        }

        // ===== PRIVATE: VOICE CHAT HELPERS =====

        _addAudioToPeer(connection, peerId) {
            if (!this.localStream) return;

            const existingSenders = connection.getSenders().filter(s => s.track?.kind === 'audio');
            if (existingSenders.length > 0) return;

            this.localStream.getAudioTracks().forEach(track => {
                connection.addTrack(track, this.localStream);
            });

            if (connection.signalingState === 'stable' && connection.connectionState === 'connected') {
                this._renegotiateConnection(connection, peerId);
            }
        }

        async _renegotiateConnection(connection, peerId) {
            try {
                const offer = await connection.createOffer();
                await connection.setLocalDescription(offer);

                const peer = this.peers.get(peerId);
                if (peer?.dataChannel?.readyState === 'open') {
                    peer.dataChannel.send(JSON.stringify({
                        type: '_peared_renegotiate',
                        data: { offer: { type: offer.type, sdp: offer.sdp } },
                        from: this.localPlayer?.id
                    }));
                }
            } catch (error) {
                this._log('error', 'Renegotiation failed', error.message);
            }
        }

        async _handleRenegotiateOffer(peerId, offerData) {
            const peer = this.peers.get(peerId);
            if (!peer) return;

            try {
                if (this.voiceEnabled && this.localStream) {
                    const existingSenders = peer.connection.getSenders().filter(s => s.track?.kind === 'audio');
                    if (existingSenders.length === 0) {
                        this.localStream.getAudioTracks().forEach(track => {
                            peer.connection.addTrack(track, this.localStream);
                        });
                    }
                }

                await peer.connection.setRemoteDescription(new RTCSessionDescription(offerData.offer));

                const answer = await peer.connection.createAnswer();
                await peer.connection.setLocalDescription(answer);

                if (peer.dataChannel?.readyState === 'open') {
                    peer.dataChannel.send(JSON.stringify({
                        type: '_peared_renegotiate_answer',
                        data: { answer: { type: answer.type, sdp: answer.sdp } },
                        from: this.localPlayer?.id
                    }));
                }
            } catch (error) {
                this._log('error', 'Failed to handle renegotiation offer', error.message);
            }
        }

        async _handleRenegotiateAnswer(peerId, answerData) {
            const peer = this.peers.get(peerId);
            if (!peer) return;

            try {
                await peer.connection.setRemoteDescription(new RTCSessionDescription(answerData.answer));
            } catch (error) {
                this._log('error', 'Failed to handle renegotiation answer', error.message);
            }
        }

        _handleRemoteTrack(event, peerId) {
            if (event.track.kind !== 'audio') return;

            let audio = this.remoteAudios.get(peerId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.autoplay = true;
                audio.playsInline = true;
                audio.style.display = 'none';
                document.body.appendChild(audio);
                this.remoteAudios.set(peerId, audio);
            }

            if (event.streams && event.streams[0]) {
                audio.srcObject = event.streams[0];
            } else {
                const stream = new MediaStream([event.track]);
                audio.srcObject = stream;
            }

            audio.play().catch(() => {
                const resumeAudio = () => {
                    audio.play().catch(() => {});
                    document.removeEventListener('click', resumeAudio);
                };
                document.addEventListener('click', resumeAudio);
            });
        }

        _cleanupPeerAudio(peerId) {
            const audio = this.remoteAudios.get(peerId);
            if (audio) {
                audio.srcObject = null;
                audio.remove();
                this.remoteAudios.delete(peerId);
            }
        }

        // ===== PRIVATE: CONNECTION MANAGEMENT =====

        async _createHostOffer() {
            const peerId = this._generateId();

            const connection = new RTCPeerConnection({ iceServers: this.options.iceServers });

            connection.ontrack = (event) => {
                this._handleRemoteTrack(event, peerId);
            };

            if (this.voiceEnabled && this.localStream) {
                this._addAudioToPeer(connection, peerId);
            }

            const dataChannel = connection.createDataChannel('peared');
            this._setupDataChannel(dataChannel, peerId);

            const unreliableChannel = connection.createDataChannel('peared-fast', {
                ordered: false,
                maxRetransmits: 0
            });
            this._setupUnreliableChannel(unreliableChannel, peerId);

            this.pendingConnections.set(peerId, { connection, dataChannel, unreliableChannel });

            const candidates = [];
            connection.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                }
            };

            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);

            await this._waitForIce(connection);

            const offerSdp = connection.localDescription;
            return {
                peerId,
                offer: { type: offerSdp.type, sdp: offerSdp.sdp },
                hostId: this.localPlayer.id,
                hostName: this.localPlayer.name,
                candidates: candidates.map(c => c.toJSON ? c.toJSON() : c)
            };
        }

        async _processAnswer(answerData) {
            const pending = this.pendingConnections.get(answerData.peerId);
            if (!pending) return false;

            try {
                await pending.connection.setRemoteDescription(new RTCSessionDescription(answerData.answer));

                if (answerData.candidates) {
                    for (const candidate of answerData.candidates) {
                        await pending.connection.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                }

                this.peers.set(answerData.peerId, pending);
                this.pendingConnections.delete(answerData.peerId);

                return true;
            } catch (error) {
                this._log('error', 'Error processing answer', error.message);
                return false;
            }
        }

        async _createClientAnswerFromOffer(offerData) {
            const connection = new RTCPeerConnection({ iceServers: this.options.iceServers });

            connection.ontrack = (event) => {
                this._handleRemoteTrack(event, offerData.hostId);
            };

            if (this.voiceEnabled && this.localStream) {
                this._addAudioToPeer(connection, offerData.hostId);
            }

            connection.ondatachannel = (event) => {
                const channel = event.channel;
                if (channel.label === 'peared') {
                    this._setupDataChannel(channel, offerData.hostId);
                } else if (channel.label === 'peared-fast') {
                    this._setupUnreliableChannel(channel, offerData.hostId);
                }
            };

            const candidates = [];
            connection.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                }
            };

            connection.onconnectionstatechange = () => {
                if (connection.connectionState === 'connected') {
                    this.state = 'connected';
                    this._startPingLoop();
                    this._updateState();
                } else if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
                    this._log('warning', 'Connection lost');
                    this.state = 'disconnected';
                    this._updateState();

                    // Attempt reconnection or host migration
                    if (this.options.enableHostMigration && this._hostCandidates.length > 0) {
                        this._initiateHostMigration();
                    } else if (this.options.reconnectAttempts > 0) {
                        this._attemptReconnect();
                    }

                    this.options.onPlayerLeave({ id: offerData.hostId });
                }
            };

            this.peers.set(offerData.hostId, {
                connection,
                dataChannel: null,
                unreliableChannel: null,
                player: { id: offerData.hostId, name: offerData.hostName, isHost: true }
            });

            await connection.setRemoteDescription(new RTCSessionDescription(offerData.offer));

            if (offerData.candidates) {
                for (const candidate of offerData.candidates) {
                    await connection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }

            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);

            await this._waitForIce(connection);

            const answerSdp = connection.localDescription;
            return {
                peerId: offerData.peerId,
                answer: { type: answerSdp.type, sdp: answerSdp.sdp },
                player: this.localPlayer,
                candidates: candidates.map(c => c.toJSON ? c.toJSON() : c)
            };
        }

        _setupDataChannel(dataChannel, peerId) {
            dataChannel.onopen = () => {
                this._log('success', `Data channel OPEN with peer`, { peerId });

                const peer = this.peers.get(peerId) || this.pendingConnections.get(peerId);
                if (peer) {
                    peer.dataChannel = dataChannel;

                    if (this.isHost) {
                        if (this.pendingConnections.has(peerId)) {
                            this.peers.set(peerId, peer);
                            this.pendingConnections.delete(peerId);
                        }
                    } else {
                        this.state = 'connected';
                        this._updateState();

                        const localState = this.options.getState ? this.options.getState() : null;
                        const myState = localState ? localState[this.localPlayer.id] : null;

                        dataChannel.send(JSON.stringify({
                            type: '_peared_join',
                            data: {
                                player: this.localPlayer,
                                initialState: myState
                            }
                        }));
                    }
                }
            };

            dataChannel.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this._handleMessage(peerId, message);
                } catch (e) {
                    this._log('error', 'Error parsing message', e.message);
                }
            };

            dataChannel.onclose = () => {
                this._log('warning', `Data channel CLOSED with peer`, { peerId });
                const peer = this.peers.get(peerId);
                if (peer?.player) {
                    this.allPlayers.delete(peer.player.id);
                    this.options.onPlayerLeave(peer.player);

                    if (this.isHost) {
                        this.broadcast('_peared_leave', { playerId: peer.player.id }, peerId);
                        this._updateHostCandidates();
                        this._updateConnectedUI();
                    } else if (peer.player.isHost) {
                        // Host disconnected - try migration
                        if (this.options.enableHostMigration) {
                            this._initiateHostMigration();
                        }
                    }
                }
                this._cleanupPeerAudio(peerId);
                this._peerStats.delete(peerId);
                this.peers.delete(peerId);
            };

            dataChannel.onerror = (error) => {
                this._log('error', 'Data channel error', error);
            };
        }

        _setupUnreliableChannel(channel, peerId) {
            channel.onopen = () => {
                const peer = this.peers.get(peerId) || this.pendingConnections.get(peerId);
                if (peer) {
                    peer.unreliableChannel = channel;
                }
            };

            channel.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (this.options.onUnreliableMessage) {
                        this.options.onUnreliableMessage(message.from, message.type, message.data);
                    } else {
                        this._handleUnreliableMessage(peerId, message);
                    }
                } catch (e) {}
            };

            channel.onclose = () => {};
            channel.onerror = () => {};
        }

        _handleUnreliableMessage(fromPeerId, message) {
            const { type, data, from } = message;

            if (this.isHost) {
                this.broadcastUnreliable(type, data, fromPeerId, from);
            }

            this.options.onMessage(from, type, data);
        }

        _handleMessage(fromPeerId, message) {
            const { type, data, from } = message;

            // Internal ping/pong
            if (type === '_peared_ping') {
                this._handlePing(fromPeerId, data);
                return;
            }

            if (type === '_peared_pong') {
                this._handlePong(fromPeerId, data);
                return;
            }

            // Internal Peared messages
            if (type === '_peared_join') {
                this.allPlayers.set(data.player.id, data.player);

                if (this.isHost) {
                    const peer = this.peers.get(fromPeerId);
                    if (peer) {
                        peer.player = data.player;
                    }

                    this.options.onPlayerJoin(data.player);
                    this._updateHostCandidates();

                    if (data.initialState) {
                        this.options.onStateSync({
                            [data.player.id]: data.initialState
                        });
                    }

                    this.sendTo(fromPeerId, '_peared_players', {
                        players: this.getPlayers()
                    });

                    this.broadcast('_peared_join', { player: data.player }, fromPeerId);

                    if (this.options.getState) {
                        const gameState = this.options.getState();
                        this.sendTo(fromPeerId, '_peared_state', { state: gameState });
                        this.broadcast('_peared_state', { state: gameState }, fromPeerId);
                    }

                    this._updateConnectedUI();
                } else {
                    this.options.onPlayerJoin(data.player);
                }
                return;
            }

            if (type === '_peared_players') {
                data.players.forEach(player => {
                    this.allPlayers.set(player.id, player);
                    if (player.id !== this.localPlayer?.id) {
                        this.options.onPlayerJoin(player);
                    }
                });
                this._updateHostCandidates();
                this._updateConnectedUI();
                return;
            }

            if (type === '_peared_state') {
                this.options.onStateSync(data.state);
                return;
            }

            if (type === '_peared_renegotiate') {
                this._handleRenegotiateOffer(fromPeerId, data);
                return;
            }

            if (type === '_peared_renegotiate_answer') {
                this._handleRenegotiateAnswer(fromPeerId, data);
                return;
            }

            if (type === '_peared_leave') {
                this.allPlayers.delete(data.playerId);
                this.interpolator.removePlayer(data.playerId);
                this._updateHostCandidates();
                this.options.onPlayerLeave({ id: data.playerId });
                this._updateConnectedUI();
                return;
            }

            if (type === '_peared_host_migrated') {
                this._handleHostMigrated(data);
                return;
            }

            // Game messages
            if (this.isHost) {
                this.broadcast(type, data, fromPeerId, from);
            }

            this.options.onMessage(from, type, data);
        }

        async _waitForIce(connection, timeout = 5000) {
            if (connection.iceGatheringState === 'complete') return;

            return new Promise((resolve) => {
                const timer = setTimeout(resolve, timeout);

                const check = () => {
                    if (connection.iceGatheringState === 'complete') {
                        clearTimeout(timer);
                        resolve();
                    }
                };

                connection.addEventListener('icegatheringstatechange', check);
            });
        }

        _updateState() {
            this.options.onStateChange(this.state, this.isHost);
        }

        // ===== PRIVATE: UTILITIES =====

        _generateId() {
            return Math.random().toString(36).substring(2, 12);
        }

        _generateColor() {
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e91e63', '#00bcd4'];
            return colors[Math.floor(Math.random() * colors.length)];
        }
    }

    // Export to global scope
    global.Peared = Peared;
    global.PearedUI = PearedUI;
    global.PearedPersistence = PearedPersistence;
    global.PearedInterpolator = Interpolator;
    global.PearedFirebaseSignaling = FirebaseSignaling;

})(typeof window !== 'undefined' ? window : global);
