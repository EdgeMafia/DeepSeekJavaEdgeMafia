// server.js - Full Supabase integration with Render fixes
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { SimpleNN, SocialNN, MemoryRNN } = require('./nn');

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://wmyetsdnkqudintfukk.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS - Allow Render frontend
app.use(cors({
    origin: ['http://localhost:3000', 'https://edgemafia-neural.onrender.com', 'https://edgemafia-pure-ai.onrender.com'],
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime: process.uptime(),
        port: process.env.PORT || 3000
    });
});

// ========== GAME CONSTANTS ==========
const STATE_SIZE = 14;
const HIDDEN_SIZE = 64;
const ACTION_SIZE = 8;
const SOCIAL_IN = 8;

// ========== GAME ENGINE ==========
class EdgeMafiaGame {
    constructor(n, gameId) {
        this.n = n;
        this.gameId = gameId;
        this.cycle = 1;
        this.alive = new Array(n).fill(1);
        this.roles = new Array(n).fill(1);
        this.names = new Array(n);
        this.aggression = new Array(n);
        this.loyalty = new Array(n);
        this.paranoia = new Array(n);
        this.deceit = new Array(n);
        this.totalReward = new Array(n).fill(0);
        this.relations = new Array(n);
        this.probMafia = new Array(n);
        this.lastAction = new Array(n).fill(-1);
        this.lastVote = new Array(n).fill(-1);
        this.attacked = new Array(n).fill(0);
        this.lastState = new Array(n);
        this.episodes = new Array(n).fill().map(() => []);
        
        // Neural networks
        this.globalBrain = new SimpleNN(STATE_SIZE, HIDDEN_SIZE, ACTION_SIZE);
        this.socialBrain = new SocialNN(SOCIAL_IN, 32, 2);
        this.memBrain = new MemoryRNN(STATE_SIZE, 16, 4, 5);
        
        // Initialize
        for (let i = 0; i < n; i++) {
            this.names[i] = `Agent_${i}`;
            this.relations[i] = new Map();
            this.probMafia[i] = new Array(n).fill(0);
        }
        
        this.initRoles();
        this.initTraits();
        this.initRelations();
    }
    
    initRoles() {
        const mafiaCount = Math.max(1, Math.floor(this.n / 6));
        const doctorCount = this.n >= 7 ? 2 : 1;
        const detectiveCount = this.n >= 7 ? 2 : 1;
        
        const pool = [];
        for (let i = 0; i < mafiaCount; i++) pool.push(0);
        for (let i = 0; i < doctorCount; i++) pool.push(2);
        for (let i = 0; i < detectiveCount; i++) pool.push(3);
        while (pool.length < this.n) pool.push(1);
        
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        
        for (let i = 0; i < this.n; i++) {
            this.roles[i] = pool[i];
        }
    }
    
    initTraits() {
        const baseAgg = [0.7, 0.2, 0.3, 0.0];
        const spanAgg = [0.3, 0.4, 0.3, 0.2];
        const baseLoy = [0.4, 0.4, 0.6, 0.7];
        const spanLoy = [0.3, 0.4, 0.3, 0.3];
        const basePar = [0.4, 0.3, 0.7, 0.5];
        const spanPar = [0.4, 0.4, 0.3, 0.3];
        const baseDec = [0.7, 0.1, 0.3, 0.2];
        const spanDec = [0.3, 0.3, 0.3, 0.3];
        
        for (let i = 0; i < this.n; i++) {
            const role = this.roles[i];
            this.aggression[i] = baseAgg[role] + spanAgg[role] * Math.random();
            this.loyalty[i] = baseLoy[role] + spanLoy[role] * Math.random();
            this.paranoia[i] = basePar[role] + spanPar[role] * Math.random();
            this.deceit[i] = baseDec[role] + spanDec[role] * Math.random();
        }
    }
    
    initRelations() {
        const mafiaCount = this.roles.filter(r => r === 0).length;
        const baseProb = mafiaCount / Math.max(1, this.n - 1);
        for (let i = 0; i < this.n; i++) {
            for (let j = 0; j < this.n; j++) {
                if (i !== j) {
                    this.probMafia[i][j] = baseProb;
                }
            }
        }
        
        // Random initial trust connections
        for (let i = 0; i < this.n; i++) {
            const connections = [];
            for (let j = 0; j < this.n; j++) {
                if (j !== i) connections.push(j);
            }
            for (let k = connections.length - 1; k > 0; k--) {
                const r = Math.floor(Math.random() * (k + 1));
                [connections[k], connections[r]] = [connections[r], connections[k]];
            }
            const initConn = Math.min(10, connections.length);
            for (let k = 0; k < initConn; k++) {
                const j = connections[k];
                const trust = (Math.random() - 0.5) * 0.6;
                this.relations[i].set(j, {
                    trust: trust,
                    liking: trust * (0.7 + Math.random() * 0.6),
                    betrayal: 0,
                    consistency: 0,
                    knownMafia: false,
                    knownTown: false
                });
            }
        }
        
        // Mafia trust boost
        for (let i = 0; i < this.n; i++) {
            if (this.roles[i] !== 0) continue;
            for (let j = 0; j < this.n; j++) {
                if (i !== j && this.roles[j] === 0) {
                    const rel = this.relations[i].get(j);
                    if (rel) {
                        rel.trust = Math.min(1, rel.trust + 0.1);
                        rel.liking = Math.min(1, rel.liking + 0.05);
                    }
                }
            }
        }
    }
    
    getTrust(a, b) {
        return this.relations[a].get(b)?.trust || 0;
    }
    
    getLiking(a, b) {
        return this.relations[a].get(b)?.liking || 0;
    }
    
    ensureRel(a, b) {
        if (!this.relations[a].has(b)) {
            this.relations[a].set(b, {
                trust: 0, liking: 0, betrayal: 0, consistency: 0,
                knownMafia: false, knownTown: false
            });
        }
        return this.relations[a].get(b);
    }
    
    weightedChoice(items, weights) {
        let total = 0;
        for (const w of weights) if (w > 0) total += w;
        if (total <= 0) return items[Math.floor(Math.random() * items.length)];
        
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            const w = weights[i] > 0 ? weights[i] : 0;
            r -= w;
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }
    
    chooseMafiaTarget(self) {
        const candidates = [];
        const scores = [];
        const A = this.aggression[self];
        
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || j === self) continue;
            const trust = this.getTrust(self, j);
            const liking = this.getLiking(self, j);
            const score = Math.max(0.01, -(trust + liking) * (0.5 + A));
            candidates.push(j);
            scores.push(score);
        }
        
        if (candidates.length === 0) return -1;
        return this.weightedChoice(candidates, scores);
    }
    
    chooseDoctorSave(self) {
        const candidates = [];
        const scores = [];
        const L = this.loyalty[self];
        
        let detectiveId = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 3) detectiveId = i;
        }
        
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j]) continue;
            let score = 0.1;
            if (j === detectiveId) score += 0.7;
            if (this.getTrust(self, j) > 0.5 && this.getLiking(self, j) > 0.3) {
                score += 0.6 * L;
            }
            score += 0.2 * (this.getLiking(self, j) + 1) * 0.5;
            score += 0.3 * this.attacked[j];
            candidates.push(j);
            scores.push(Math.max(0.01, score));
        }
        
        return this.weightedChoice(candidates, scores);
    }
    
    chooseDetectiveCheck(self) {
        const candidates = [];
        const scores = [];
        const P = this.paranoia[self];
        
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || j === self) continue;
            const rel = this.relations[self].get(j);
            if (rel?.knownMafia || rel?.knownTown) continue;
            const score = Math.max(0.01, -this.getTrust(self, j) * (0.5 + P));
            candidates.push(j);
            scores.push(score);
        }
        
        if (candidates.length === 0) {
            for (let j = 0; j < this.n; j++) {
                if (!this.alive[j] || j === self) continue;
                candidates.push(j);
                scores.push(0.05);
            }
        }
        
        return this.weightedChoice(candidates, scores);
    }
    
    chooseLynchTarget(self) {
        const candidates = [];
        for (let j = 0; j < this.n; j++) {
            if (this.alive[j] && j !== self) candidates.push(j);
        }
        if (candidates.length === 0) return -1;
        
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        
        let primaryTarget = -1;
        let bestProb = -1;
        for (const j of candidates) {
            if (this.probMafia[self][j] > bestProb) {
                bestProb = this.probMafia[self][j];
                primaryTarget = j;
            }
        }
        if (primaryTarget === -1) return -1;
        
        const trust = this.getTrust(self, primaryTarget);
        const betrayal = this.relations[self].get(primaryTarget)?.betrayal || 0;
        const consistency = this.relations[self].get(primaryTarget)?.consistency || 0;
        const belief = Math.min(1, Math.max(0, this.probMafia[self][primaryTarget]));
        const detectiveFlag = (this.roles[self] === 3 && 
            this.relations[self].get(primaryTarget)?.knownMafia) ? 1 : 0;
        const P = (this.paranoia[self] + 1) / 2;
        const L = (this.loyalty[self] + 1) / 2;
        const D = (this.deceit[self] + 1) / 2;
        
        let avgBelief = 0;
        for (const j of candidates) avgBelief += this.probMafia[self][j];
        avgBelief /= candidates.length;
        
        const memory = this.memBrain.getMemory(self);
        
        const state = [
            (trust + 1) / 2,
            betrayal > 0 ? 1 : 0,
            consistency > 0 ? 1 : 0,
            belief,
            detectiveFlag,
            P, L, D,
            avgBelief,
            this.roles[self] === 0 ? 1 : 0,
            memory[0], memory[1], memory[2], memory[3]
        ];
        
        this.lastState[self] = state;
        this.episodes[self].push({ state: [...state], action: -1, reward: 0 });
        
        const { output } = this.globalBrain.forward(state);
        
        let action;
        if (Math.random() < 0.1) {
            action = Math.floor(Math.random() * (Math.min(ACTION_SIZE, candidates.length + 1)));
        } else {
            let bestQ = -Infinity;
            action = 0;
            for (let a = 0; a <= Math.min(ACTION_SIZE - 1, candidates.length); a++) {
                if (a < output.length && output[a] > bestQ) {
                    bestQ = output[a];
                    action = a;
                }
            }
        }
        
        this.lastAction[self] = action;
        if (this.episodes[self].length > 0) {
            this.episodes[self][this.episodes[self].length - 1].action = action;
        }
        
        if (action === 0) return -1;
        const idx = action - 1;
        if (idx >= candidates.length) return candidates[0];
        return candidates[idx];
    }
    
    nightPhase() {
        let mafiaKill = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 0) {
                mafiaKill = this.chooseMafiaTarget(i);
                break;
            }
        }
        
        if (mafiaKill === -1) {
            const aliveNonMafia = [];
            for (let i = 0; i < this.n; i++) {
                if (this.alive[i] && this.roles[i] !== 0) aliveNonMafia.push(i);
            }
            if (aliveNonMafia.length > 0) {
                mafiaKill = aliveNonMafia[Math.floor(Math.random() * aliveNonMafia.length)];
            }
        }
        
        let doctorSave = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 2) {
                doctorSave = this.chooseDoctorSave(i);
                break;
            }
        }
        
        let detectiveCheck = -1;
        let detectiveId = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 3) {
                detectiveCheck = this.chooseDetectiveCheck(i);
                detectiveId = i;
                break;
            }
        }
        
        const doctorEffective = Math.random() < 0.7;
        
        if (mafiaKill !== -1 && (!doctorEffective || mafiaKill !== doctorSave)) {
            this.alive[mafiaKill] = 0;
            this.attacked[mafiaKill]++;
            this.memBrain.resetAgent(mafiaKill);
            console.log(`[NIGHT] ${this.names[mafiaKill]} (${this.getRoleName(this.roles[mafiaKill])}) killed`);
        } else {
            console.log(`[NIGHT] No one died`);
        }
        
        if (detectiveCheck !== -1 && detectiveId !== -1) {
            const isMafia = this.roles[detectiveCheck] === 0;
            const rel = this.ensureRel(detectiveId, detectiveCheck);
            
            if (isMafia) {
                rel.knownMafia = true;
                this.paranoia[detectiveId] = Math.min(1, this.paranoia[detectiveId] + 0.1);
                rel.trust = Math.max(-1, rel.trust - 1);
                this.probMafia[detectiveId][detectiveCheck] = 0.95;
                console.log(`[NIGHT] Detective found MAFIA: ${this.names[detectiveCheck]}`);
            } else {
                rel.knownTown = true;
                rel.trust = Math.min(1, rel.trust + 1);
                this.probMafia[detectiveId][detectiveCheck] = 0.01;
                console.log(`[NIGHT] Detective confirmed TOWN: ${this.names[detectiveCheck]}`);
            }
        }
        
        for (let i = 0; i < this.n; i++) {
            const decay = 0.0008 * (0.5 + this.paranoia[i]);
            for (const [j, rel] of this.relations[i]) {
                if (rel.trust > 0) rel.trust = Math.max(0, rel.trust - decay);
                else if (rel.trust < 0) rel.trust = Math.min(0, rel.trust + decay * 0.25);
            }
        }
        
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            const ctx = new Array(STATE_SIZE + 5).fill(0);
            if (this.lastState[i] && this.lastState[i].length === STATE_SIZE) {
                for (let j = 0; j < STATE_SIZE; j++) ctx[j] = this.lastState[i][j];
            }
            ctx[STATE_SIZE] = this.lastAction[i] >= 0 ? this.lastAction[i] / 8 : 0;
            ctx[STATE_SIZE + 1] = mafiaKill !== -1 ? 1 : 0;
            ctx[STATE_SIZE + 4] = this.cycle / 100;
            this.memBrain.step(i, ctx);
        }
    }
    
    dayPhase() {
        const votes = new Array(this.n).fill(-1);
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i]) {
                votes[i] = this.chooseLynchTarget(i);
            }
        }
        
        const voteCount = new Array(this.n).fill(0);
        for (let i = 0; i < this.n; i++) {
            if (votes[i] !== -1) voteCount[votes[i]]++;
        }
        
        let lynchTarget = -1;
        let maxVotes = 0;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && voteCount[i] > maxVotes) {
                maxVotes = voteCount[i];
                lynchTarget = i;
            }
        }
        
        const majority = 2;
        
        if (lynchTarget === -1 || maxVotes < majority) {
            console.log(`[DAY] No consensus - no lynch`);
            for (let i = 0; i < this.n; i++) {
                if (!this.alive[i] || votes[i] === -1) continue;
                if (this.lastVote[i] === votes[i]) {
                    const rel = this.ensureRel(i, votes[i]);
                    rel.consistency++;
                    rel.trust = Math.min(1, rel.trust + 0.03);
                }
                this.lastVote[i] = votes[i];
            }
            return;
        }
        
        const wasMafia = this.roles[lynchTarget] === 0;
        console.log(`[DAY] ${this.names[lynchTarget]} (${this.getRoleName(this.roles[lynchTarget])}) lynched`);
        
        this.alive[lynchTarget] = 0;
        this.memBrain.resetAgent(lynchTarget);
        
        for (let i = 0; i < this.n; i++) {
            this.probMafia[i][lynchTarget] = 0;
        }
        
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i] || votes[i] === -1) continue;
            
            if (votes[i] === lynchTarget) {
                this.totalReward[i] += wasMafia ? 0.4 : -0.1;
                
                const delta = wasMafia ? 0.8 : -0.8;
                for (let j = 0; j < this.n; j++) {
                    if (this.alive[j] && j !== i) {
                        this.ensureRel(j, i).trust = Math.min(1, Math.max(-1, 
                            this.ensureRel(j, i).trust + delta));
                    }
                }
                
                const rel = this.ensureRel(i, lynchTarget);
                const input = [
                    rel.trust, rel.liking,
                    Math.min(1, Math.max(0, this.probMafia[i][lynchTarget])),
                    1 / 4, 1, wasMafia ? 1 : 0,
                    (this.aggression[i] + this.paranoia[i]) * 0.5,
                    (this.loyalty[lynchTarget] + this.deceit[lynchTarget]) * 0.5
                ];
                const targetTrust = wasMafia ? -0.5 : 0.3;
                const targetLiking = wasMafia ? -0.3 : 0.2;
                this.socialBrain.train(input, targetTrust, targetLiking, 0.001);
            }
            
            if (this.lastVote[i] === votes[i]) {
                const rel = this.ensureRel(i, votes[i]);
                rel.consistency++;
                rel.trust = Math.min(1, rel.trust + 0.05);
            }
            this.lastVote[i] = votes[i];
        }
        
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            const ctx = new Array(STATE_SIZE + 5).fill(0);
            if (this.lastState[i] && this.lastState[i].length === STATE_SIZE) {
                for (let j = 0; j < STATE_SIZE; j++) ctx[j] = this.lastState[i][j];
            }
            ctx[STATE_SIZE] = this.lastAction[i] >= 0 ? this.lastAction[i] / 8 : 0;
            let wasAccused = 0;
            for (let j = 0; j < this.n; j++) {
                if (this.alive[j] && votes[j] === i) { wasAccused = 1; break; }
            }
            ctx[STATE_SIZE + 2] = wasAccused;
            ctx[STATE_SIZE + 3] = (this.lastVote[i] === lynchTarget && wasMafia) ? 1 : 0;
            ctx[STATE_SIZE + 4] = this.cycle / 100;
            this.memBrain.step(i, ctx);
        }
    }
    
    checkWin() {
        let mafiaAlive = 0, townAlive = 0;
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            if (this.roles[i] === 0) mafiaAlive++;
            else townAlive++;
        }
        
        if (mafiaAlive === 0) return 'town';
        if (mafiaAlive >= townAlive) return 'mafia';
        return null;
    }
    
    runCycle() {
        this.nightPhase();
        let winner = this.checkWin();
        if (winner) return winner;
        
        this.dayPhase();
        winner = this.checkWin();
        if (winner) return winner;
        
        this.cycle++;
        return null;
    }
    
    getRoleName(role) {
        return ['Mafia', 'Villager', 'Doctor', 'Detective'][role];
    }
    
    getGameState() {
        const agents = [];
        for (let i = 0; i < this.n; i++) {
            agents.push({
                id: i,
                name: this.names[i],
                role: this.roles[i],
                roleName: this.getRoleName(this.roles[i]),
                alive: this.alive[i] === 1,
                aggression: Number(this.aggression[i].toFixed(3)),
                loyalty: Number(this.loyalty[i].toFixed(3)),
                paranoia: Number(this.paranoia[i].toFixed(3)),
                deceit: Number(this.deceit[i].toFixed(3)),
                totalReward: Number(this.totalReward[i].toFixed(3))
            });
        }
        
        let mafiaAlive = 0, townAlive = 0;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i]) {
                if (this.roles[i] === 0) mafiaAlive++;
                else townAlive++;
            }
        }
        
        return {
            cycle: this.cycle,
            agents,
            mafiaAlive,
            townAlive,
            gameId: this.gameId,
            totalAgents: this.n
        };
    }
    
    async saveToSupabase() {
        for (let i = 0; i < this.n; i++) {
            const { error } = await supabase
                .from('agents')
                .upsert({
                    game_id: this.gameId,
                    agent_index: i,
                    name: this.names[i],
                    role: this.roles[i],
                    alive: this.alive[i] === 1,
                    aggression: this.aggression[i],
                    loyalty: this.loyalty[i],
                    paranoia: this.paranoia[i],
                    deceit: this.deceit[i],
                    total_reward: this.totalReward[i],
                    last_action: this.lastAction[i],
                    last_vote: this.lastVote[i],
                    attacked: this.attacked[i]
                }, { onConflict: 'game_id, agent_index' });
            if (error) console.error('Save agent error:', error);
        }
        
        for (let i = 0; i < this.n; i++) {
            for (const [j, rel] of this.relations[i]) {
                if (i < j) {
                    const { error } = await supabase
                        .from('relationships')
                        .upsert({
                            game_id: this.gameId,
                            agent_a: i,
                            agent_b: j,
                            trust: rel.trust,
                            liking: rel.liking,
                            betrayal: rel.betrayal,
                            consistency: rel.consistency,
                            known_mafia: rel.knownMafia,
                            known_town: rel.knownTown
                        }, { onConflict: 'game_id, agent_a, agent_b' });
                    if (error) console.error('Save relationship error:', error);
                }
            }
        }
        
        const { error: stateError } = await supabase
            .from('game_state')
            .upsert({ game_id: this.gameId, cycle: this.cycle, status: 'active' });
        if (stateError) console.error('Save game state error:', stateError);
        
        if (this.cycle % 10 === 0) {
            const { error: nnError } = await supabase
                .from('nn_checkpoints')
                .insert({
                    game_id: this.gameId,
                    cycle: this.cycle,
                    simple_nn: this.globalBrain.serialize(),
                    social_nn: this.socialBrain.serialize(),
                    memory_rnn: this.memBrain.serialize()
                });
            if (nnError) console.error('Save NN checkpoint error:', nnError);
        }
    }
    
    async loadFromSupabase() {
        const { data: agents, error: agentsError } = await supabase
            .from('agents')
            .select('*')
            .eq('game_id', this.gameId)
            .order('agent_index');
        
        if (!agentsError && agents && agents.length > 0) {
            for (const a of agents) {
                const idx = a.agent_index;
                this.names[idx] = a.name;
                this.roles[idx] = a.role;
                this.alive[idx] = a.alive ? 1 : 0;
                this.aggression[idx] = a.aggression;
                this.loyalty[idx] = a.loyalty;
                this.paranoia[idx] = a.paranoia;
                this.deceit[idx] = a.deceit;
                this.totalReward[idx] = a.total_reward;
                this.lastAction[idx] = a.last_action;
                this.lastVote[idx] = a.last_vote;
                this.attacked[idx] = a.attacked;
            }
        }
        
        const { data: rels, error: relsError } = await supabase
            .from('relationships')
            .select('*')
            .eq('game_id', this.gameId);
        
        if (!relsError && rels) {
            for (const r of rels) {
                this.relations[r.agent_a].set(r.agent_b, {
                    trust: r.trust,
                    liking: r.liking,
                    betrayal: r.betrayal,
                    consistency: r.consistency,
                    knownMafia: r.known_mafia,
                    knownTown: r.known_town
                });
                this.relations[r.agent_b].set(r.agent_a, {
                    trust: r.trust,
                    liking: r.liking,
                    betrayal: r.betrayal,
                    consistency: r.consistency,
                    knownMafia: r.known_mafia,
                    knownTown: r.known_town
                });
            }
        }
        
        const { data: state, error: stateError } = await supabase
            .from('game_state')
            .select('cycle')
            .eq('game_id', this.gameId)
            .single();
        if (!stateError && state) this.cycle = state.cycle;
        
        const { data: checkpoint, error: cpError } = await supabase
            .from('nn_checkpoints')
            .select('simple_nn, social_nn, memory_rnn')
            .eq('game_id', this.gameId)
            .order('cycle', { ascending: false })
            .limit(1);
        
        if (!cpError && checkpoint && checkpoint.length > 0) {
            this.globalBrain.deserialize(checkpoint[0].simple_nn);
            this.socialBrain.deserialize(checkpoint[0].social_nn);
            this.memBrain.deserialize(checkpoint[0].memory_rnn);
        }
        
        console.log(`[LOAD] Loaded game ${this.gameId} at cycle ${this.cycle}`);
    }
}

// ========== SERVER STATE ==========
let activeGames = new Map();

// API Routes
app.post('/api/game/new', async (req, res) => {
    const { n = 20, loadExisting = false, gameId = null } = req.body;
    const finalGameId = gameId || `game_${Date.now()}`;
    
    let game = activeGames.get(finalGameId);
    
    if (!game && loadExisting) {
        game = new EdgeMafiaGame(Math.max(6, Math.min(100, n)), finalGameId);
        await game.loadFromSupabase();
        activeGames.set(finalGameId, game);
    } else if (!game) {
        game = new EdgeMafiaGame(Math.max(6, Math.min(100, n)), finalGameId);
        await game.saveToSupabase();
        activeGames.set(finalGameId, game);
    }
    
    res.json({ gameId: finalGameId, n: game.n, cycle: game.cycle });
});

app.get('/api/game/:gameId/state', (req, res) => {
    const game = activeGames.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game.getGameState());
});

app.post('/api/game/:gameId/cycle', async (req, res) => {
    const game = activeGames.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    const winner = game.runCycle();
    await game.saveToSupabase();
    
    res.json({ gameState: game.getGameState(), winner, cycle: game.cycle });
});

app.post('/api/game/:gameId/nudge', (req, res) => {
    const game = activeGames.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    const { agentId, trait, delta } = req.body;
    if (agentId < 0 || agentId >= game.n) {
        return res.status(400).json({ error: 'Invalid agent' });
    }
    
    if (!game.alive[agentId]) {
        return res.status(400).json({ error: 'Agent is dead' });
    }
    
    const traitMap = {
        aggression: () => game.aggression[agentId] = Math.max(-1, Math.min(1, game.aggression[agentId] + delta)),
        loyalty: () => game.loyalty[agentId] = Math.max(-1, Math.min(1, game.loyalty[agentId] + delta)),
        paranoia: () => game.paranoia[agentId] = Math.max(-1, Math.min(1, game.paranoia[agentId] + delta)),
        deceit: () => game.deceit[agentId] = Math.max(-1, Math.min(1, game.deceit[agentId] + delta))
    };
    
    if (traitMap[trait]) {
        traitMap[trait]();
        res.json({ success: true, agentId, trait, newValue: game[trait][agentId] });
    } else {
        res.status(400).json({ error: 'Invalid trait' });
    }
});

// WebSocket connections
wss.on('connection', (ws) => {
    let currentGameId = null;
    let interval = null;
    
    ws.on('message', async (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'join_game') {
            currentGameId = msg.gameId;
            let game = activeGames.get(currentGameId);
            
            if (!game && msg.createNew) {
                game = new EdgeMafiaGame(msg.n || 20, currentGameId);
                await game.saveToSupabase();
                activeGames.set(currentGameId, game);
            } else if (!game && msg.loadExisting) {
                game = new EdgeMafiaGame(msg.n || 20, currentGameId);
                await game.loadFromSupabase();
                activeGames.set(currentGameId, game);
            }
            
            if (game) {
                ws.send(JSON.stringify({ type: 'state', data: game.getGameState() }));
                
                if (interval) clearInterval(interval);
                interval = setInterval(() => {
                    if (game && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'state', data: game.getGameState() }));
                    }
                }, 3000);
            }
        }
        
        if (msg.type === 'next_cycle') {
            const game = activeGames.get(currentGameId);
            if (game) {
                const winner = game.runCycle();
                await game.saveToSupabase();
                ws.send(JSON.stringify({ type: 'cycle_complete', data: game.getGameState(), winner }));
            }
        }
        
        if (msg.type === 'nudge') {
            const game = activeGames.get(currentGameId);
            if (game) {
                const { agentId, trait, delta } = msg;
                if (game.alive[agentId]) {
                    game[trait][agentId] = Math.max(-1, Math.min(1, game[trait][agentId] + delta));
                    ws.send(JSON.stringify({ type: 'nudge_ack', agentId, trait, newValue: game[trait][agentId] }));
                }
            }
        }
    });
    
    ws.on('close', () => {
        if (interval) clearInterval(interval);
    });
});

// Use Render's assigned PORT (default 10000, but they override)
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`EdgeMafia Pure AI running on port ${port}`);
    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log(`Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
});