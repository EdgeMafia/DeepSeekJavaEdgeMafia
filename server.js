// server.js - Full Supabase integration with Emergent Deception & Meta-Learning
require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { SimpleNN, SocialNN, MemoryRNN } = require('./nn');

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://wmyetsdnkqudintfukk.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS - Allow all origins for GitHub Pages
app.use(cors());
app.use(express.json());

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime: process.uptime(),
        port: process.env.PORT || 10000
    });
});

// ========== GAME CONSTANTS ==========
const STATE_SIZE = 14;
const HIDDEN_SIZE = 64;
const ACTION_SIZE = 8;
const SOCIAL_IN = 8;

// ========== GAME ENGINE WITH EMERGENT DECEPTION & META-LEARNING ==========
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
        
        // Track trait evolution history for each agent
        this.traitHistory = new Array(n).fill().map(() => []);
        
        // Game over tracking
        this.isGameOver = false;
        this.winner = null;
        
        // Neural networks
        this.globalBrain = new SimpleNN(STATE_SIZE, HIDDEN_SIZE, ACTION_SIZE);
        this.socialBrain = new SocialNN(SOCIAL_IN, 32, 2);
        this.memBrain = new MemoryRNN(STATE_SIZE, 16, 4, 5);
        
        // ===== EMERGENT DECEPTION TRACKING =====
        this.deceptionMemory = new Array(n).fill().map(() => ({
            liesTold: 0,
            liesCaught: 0,
            liesBeneficial: 0,
            lastLieTarget: -1,
            lastLieType: null,
            honestyScore: 0.5
        }));
        
        // Reputation tracking (what others believe about each agent)
        this.reputation = new Array(n).fill().map(() => new Array(n).fill(0.5));
        
        // Track statements made during day phase
        this.dayStatements = [];
        
        // ===== META-LEARNING PARAMETERS =====
        this.metaParams = new Array(n).fill().map(() => ({
            learningRate: 0.001,
            explorationRate: 0.1,
            strategyWeights: { trustBased: 0.33, beliefBased: 0.34, revengeBased: 0.33 },
            performanceHistory: [],
            wins: 0,
            losses: 0
        }));
        
        // Initialize
        for (let i = 0; i < n; i++) {
            this.names[i] = `Agent_${i}`;
            this.relations[i] = new Map();
            this.probMafia[i] = new Array(n).fill(0);
        }
        
        this.initRoles();
        this.initTraits();
        this.initRelations();
        
        // Record initial traits
        for (let i = 0; i < n; i++) {
            this.traitHistory[i].push({
                cycle: 0,
                aggression: this.aggression[i],
                loyalty: this.loyalty[i],
                paranoia: this.paranoia[i],
                deceit: this.deceit[i]
            });
        }
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
    
    // ===== NEW: Dynamic Trait Evolution =====
    evolveTraits(agentId, cycleOutcome) {
        const reward = this.totalReward[agentId];
        const meta = this.metaParams[agentId];
        const role = this.roles[agentId];
        const isMafia = role === 0;
        
        // Calculate delta based on recent performance
        let aggressionDelta = 0;
        let loyaltyDelta = 0;
        let paranoiaDelta = 0;
        let deceitDelta = 0;
        
        // AGGRESSION: Increases with wins, decreases with losses
        if (reward > 0.3) {
            aggressionDelta += 0.02 * (reward / 1.5);  // Win more = more aggressive
        } else if (reward < -0.2) {
            aggressionDelta -= 0.015;  // Lose = less aggressive (cautious)
        }
        
        // Mafia-specific: Successful lies increase aggression
        if (isMafia && this.deceptionMemory[agentId].liesBeneficial > 0) {
            aggressionDelta += 0.01 * Math.min(0.1, this.deceptionMemory[agentId].liesBeneficial / 10);
        }
        
        // LOYALTY: Increases when voting with team, decreases when betraying
        if (isMafia) {
            // Mafia loyalty: higher when mafia wins, lower when caught
            if (reward > 0.5) loyaltyDelta += 0.03;
            if (this.deceptionMemory[agentId].liesCaught > 0) loyaltyDelta -= 0.02;
        } else {
            // Town loyalty: higher when town wins, lower when lynching town
            if (reward > 0.5) loyaltyDelta += 0.02;
            if (this.lastVote[agentId] !== -1 && this.roles[this.lastVote[agentId]] !== 0 && this.roles[this.lastVote[agentId]] !== 0) {
                loyaltyDelta -= 0.01;  // Voted to lynch a townie
            }
        }
        
        // PARANOIA: Increases when attacked or betrayed, decreases when safe
        if (this.attacked[agentId] > 0) {
            paranoiaDelta += 0.03 * this.attacked[agentId];
        }
        if (this.deceptionMemory[agentId].liesCaught > 0) {
            paranoiaDelta += 0.02;  // Got caught lying = more paranoid
        }
        // Natural decay over time (trust builds)
        paranoiaDelta -= 0.005;
        
        // DECEIT: Increases when lying succeeds, decreases when caught
        const lieSuccessRate = this.deceptionMemory[agentId].liesTold > 0 ? 
            this.deceptionMemory[agentId].liesBeneficial / this.deceptionMemory[agentId].liesTold : 0.5;
        
        if (lieSuccessRate > 0.6) {
            deceitDelta += 0.02 * (lieSuccessRate - 0.5);
        }
        if (this.deceptionMemory[agentId].liesCaught > 0) {
            deceitDelta -= 0.02 * Math.min(0.1, this.deceptionMemory[agentId].liesCaught);
        }
        
        // Role-based natural tendencies
        if (isMafia) {
            deceitDelta += 0.005;  // Mafia naturally become more deceitful over time
        } else if (role === 3) {  // Detective
            paranoiaDelta += 0.005;
            deceitDelta -= 0.005;
        } else if (role === 2) {  // Doctor
            loyaltyDelta += 0.005;
            aggressionDelta -= 0.005;
        }
        
        // Apply deltas with bounds [-1, 1]
        this.aggression[agentId] = Math.max(-1, Math.min(1, this.aggression[agentId] + aggressionDelta));
        this.loyalty[agentId] = Math.max(-1, Math.min(1, this.loyalty[agentId] + loyaltyDelta));
        this.paranoia[agentId] = Math.max(-1, Math.min(1, this.paranoia[agentId] + paranoiaDelta));
        this.deceit[agentId] = Math.max(-1, Math.min(1, this.deceit[agentId] + deceitDelta));
        
        // Record trait history
        this.traitHistory[agentId].push({
            cycle: this.cycle,
            aggression: this.aggression[agentId],
            loyalty: this.loyalty[agentId],
            paranoia: this.paranoia[agentId],
            deceit: this.deceit[agentId],
            reward: reward
        });
        
        // Keep history manageable (last 50 entries)
        if (this.traitHistory[agentId].length > 50) {
            this.traitHistory[agentId].shift();
        }
        
        // Log significant changes
        if (Math.abs(aggressionDelta) > 0.01 || Math.abs(loyaltyDelta) > 0.01 || 
            Math.abs(paranoiaDelta) > 0.01 || Math.abs(deceitDelta) > 0.01) {
            console.log(`[TRAIT] Agent ${agentId} (${this.getRoleName(role)}): ` +
                `Agg ${this.aggression[agentId].toFixed(3)} (Δ${aggressionDelta.toFixed(3)}), ` +
                `Loy ${this.loyalty[agentId].toFixed(3)} (Δ${loyaltyDelta.toFixed(3)}), ` +
                `Par ${this.paranoia[agentId].toFixed(3)} (Δ${paranoiaDelta.toFixed(3)}), ` +
                `Dec ${this.deceit[agentId].toFixed(3)} (Δ${deceitDelta.toFixed(3)})`);
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
    
    // ===== EMERGENT DECEPTION METHODS =====
    
    decideToLie(agentId, targetId, truthfulBelief) {
        const agent = this.deceptionMemory[agentId];
        const deceitTrait = this.deceit[agentId];
        const aggression = this.aggression[agentId];
        const paranoia = this.paranoia[agentId];
        
        // Calculate expected value of lying
        let lieValue = 0;
        
        // Benefit: If target is mafia and I'm mafia, lying protects them
        const targetIsMafia = this.roles[targetId] === 0;
        const amMafia = this.roles[agentId] === 0;
        
        if (amMafia && targetIsMafia) {
            lieValue += 0.8;  // Protect fellow mafia
        }
        
        // Benefit: If I'm mafia and target is town, lying gets town killed
        if (amMafia && !targetIsMafia) {
            lieValue += 0.6;
        }
        
        // Benefit: If I'm town and target is mafia, telling truth is good
        if (!amMafia && targetIsMafia) {
            lieValue -= 0.5;  // Don't lie about mafia
        }
        
        // Cost: Risk of being caught
        const caughtProbability = this.estimateLieDetectionRisk(agentId, targetId);
        lieValue -= caughtProbability * 1.2;
        
        // Learning from past lies
        if (agent.liesTold > 0) {
            const successRate = agent.liesBeneficial / agent.liesTold;
            lieValue += successRate * 0.5 - (agent.liesCaught / agent.liesTold) * 0.8;
        }
        
        // Trait influence (now dynamic!)
        lieValue += (deceitTrait - 0.5) * 0.3;
        lieValue += (aggression - 0.5) * 0.2;
        lieValue -= (paranoia - 0.5) * 0.4;
        
        // Meta-learning: use adaptive exploration rate
        const meta = this.metaParams[agentId];
        const epsilon = meta.explorationRate;
        
        let willLie = false;
        if (Math.random() < epsilon) {
            willLie = Math.random() < 0.5;  // Random exploration
        } else {
            willLie = lieValue > 0.3;
        }
        
        if (willLie) {
            this.deceptionMemory[agentId].liesTold++;
            this.deceptionMemory[agentId].lastLieTarget = targetId;
            this.deceptionMemory[agentId].lastLieType = amMafia ? 'protect_mafia' : 'blame_town';
        }
        
        return willLie;
    }
    
    estimateLieDetectionRisk(liarId, targetId) {
        let risk = 0.2;  // Base risk
        
        // Higher risk if detective is alive
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 3) {
                const detectiveTrust = this.getTrust(i, liarId);
                risk += detectiveTrust * 0.3;
            }
        }
        
        // Risk increases with reputation tracking
        for (let i = 0; i < this.n; i++) {
            if (i !== liarId && this.alive[i]) {
                const rep = this.reputation[i][liarId];
                if (rep < 0.3) risk += 0.2;  // Known liar
            }
        }
        
        // Risk increases if target has high trust
        const targetTrust = this.getTrust(targetId, liarId);
        risk += targetTrust * 0.25;
        
        return Math.min(0.9, risk);
    }
    
    updateReputation(liarId, wasCaught, wasBeneficial) {
        const memory = this.deceptionMemory[liarId];
        
        if (wasCaught) {
            memory.liesCaught++;
            // Reduce everyone's trust in this agent
            for (let i = 0; i < this.n; i++) {
                if (i !== liarId && this.alive[i]) {
                    this.reputation[i][liarId] = Math.max(0, this.reputation[i][liarId] - 0.3);
                    this.ensureRel(i, liarId).trust = Math.max(-1, 
                        this.ensureRel(i, liarId).trust - 0.2);
                }
            }
            memory.honestyScore = Math.max(0, memory.honestyScore - 0.2);
        }
        
        if (wasBeneficial) {
            memory.liesBeneficial++;
            memory.honestyScore = Math.min(1, memory.honestyScore + 0.05);
            // Only mafia allies know it was beneficial
            for (let i = 0; i < this.n; i++) {
                if (this.alive[i] && this.roles[i] === 0 && this.roles[liarId] === 0) {
                    this.reputation[i][liarId] = Math.min(1, this.reputation[i][liarId] + 0.2);
                }
            }
        }
    }
    
    // ===== META-LEARNING METHODS =====
    
    metaLearn(agentId, cycleOutcome) {
        const meta = this.metaParams[agentId];
        const reward = this.totalReward[agentId];
        
        // Track performance window (last 10 cycles)
        meta.performanceHistory.push(reward);
        if (meta.performanceHistory.length > 10) meta.performanceHistory.shift();
        
        // Calculate performance trend
        let trend = 0;
        if (meta.performanceHistory.length >= 5) {
            const oldAvg = meta.performanceHistory.slice(0, 5).reduce((a,b)=>a+b,0)/5;
            const newAvg = meta.performanceHistory.slice(-5).reduce((a,b)=>a+b,0)/5;
            trend = newAvg - oldAvg;
        }
        
        // Adjust learning rate based on trend
        if (trend > 0.1) {
            // Doing well - reduce learning rate (fine-tuning)
            meta.learningRate = Math.max(0.0001, meta.learningRate * 0.99);
        } else if (trend < -0.1) {
            // Doing poorly - increase learning rate (explore more)
            meta.learningRate = Math.min(0.01, meta.learningRate * 1.05);
        }
        
        // Adjust exploration rate based on reward
        if (reward > 0.5) {
            // Winning - reduce exploration
            meta.explorationRate = Math.max(0.02, meta.explorationRate * 0.98);
        } else if (reward < -0.5) {
            // Losing - increase exploration
            meta.explorationRate = Math.min(0.3, meta.explorationRate * 1.02);
        }
        
        // EVOLVE TRAITS based on performance (NEW!)
        this.evolveTraits(agentId, cycleOutcome);
        
        return meta.learningRate;
    }
    
    determineStrategyUsed(agentId) {
        const target = this.lastVote[agentId];
        if (target === -1) return 'beliefBased';
        
        const trustWeight = Math.abs(this.getTrust(agentId, target));
        const beliefWeight = Math.abs(this.probMafia[agentId][target] - 0.5);
        const revengeWeight = this.attacked[target] > 0 ? 1 : 0;
        
        if (trustWeight > beliefWeight && trustWeight > revengeWeight) return 'trustBased';
        if (revengeWeight > trustWeight && revengeWeight > beliefWeight) return 'revengeBased';
        return 'beliefBased';
    }
    
    updateStrategyWeights(agentId, wasCorrect) {
        if (!wasCorrect) return;
        
        const meta = this.metaParams[agentId];
        const strategyUsed = this.determineStrategyUsed(agentId);
        
        // Reinforce the strategy that led to correct vote
        meta.strategyWeights[strategyUsed] = Math.min(0.8, 
            meta.strategyWeights[strategyUsed] + 0.05);
        
        // Normalize
        const sum = meta.strategyWeights.trustBased + meta.strategyWeights.beliefBased + meta.strategyWeights.revengeBased;
        meta.strategyWeights.trustBased /= sum;
        meta.strategyWeights.beliefBased /= sum;
        meta.strategyWeights.revengeBased /= sum;
    }
    
    // ===== EXISTING GAME METHODS (Mafia, Doctor, Detective choices) =====
    
    chooseMafiaTarget(self) {
        const candidates = [];
        const scores = [];
        const A = this.aggression[self];
        
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || j === self) continue;
            const trust = this.getTrust(self, j);
            const liking = this.getLiking(self, j);
            let score = Math.max(0.01, -(trust + liking) * (0.5 + A));
            
            // Meta-learning: adjust based on strategy weights
            const meta = this.metaParams[self];
            score = score * (0.5 + meta.strategyWeights.beliefBased);
            
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
        
        // Shuffle
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        
        // Find best target using adaptive strategy weights
        let primaryTarget = -1;
        let bestScore = -Infinity;
        const meta = this.metaParams[self];
        
        for (const j of candidates) {
            const trustScore = this.getTrust(self, j);
            const beliefScore = this.probMafia[self][j];
            const revengeScore = this.attacked[j] > 0 ? 1 : 0;
            
            // Weighted combination based on learned strategy
            const score = (trustScore * meta.strategyWeights.trustBased * -0.5) +
                         (beliefScore * meta.strategyWeights.beliefBased * 1.0) +
                         (revengeScore * meta.strategyWeights.revengeBased * 0.8);
            
            if (score > bestScore) {
                bestScore = score;
                primaryTarget = j;
            }
        }
        
        if (primaryTarget === -1) return -1;
        
        // Build state vector
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
        const epsilon = meta.explorationRate;
        if (Math.random() < epsilon) {
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
        // Mafia kill
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
        
        // Doctor save
        let doctorSave = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.alive[i] && this.roles[i] === 2) {
                doctorSave = this.chooseDoctorSave(i);
                break;
            }
        }
        
        // Detective check
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
        
        // Decay relationships
        for (let i = 0; i < this.n; i++) {
            const decay = 0.0008 * (0.5 + this.paranoia[i]);
            for (const [j, rel] of this.relations[i]) {
                if (rel.trust > 0) rel.trust = Math.max(0, rel.trust - decay);
                else if (rel.trust < 0) rel.trust = Math.min(0, rel.trust + decay * 0.25);
            }
        }
        
        // Update memory
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
        this.dayStatements = [];
        
        // First pass: agents decide on targets and whether to lie
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            
            const target = this.chooseLynchTarget(i);
            if (target === -1) continue;
            
            const truthfulBelief = this.probMafia[i][target];
            const willLie = this.decideToLie(i, target, truthfulBelief);
            
            let statedBelief = truthfulBelief;
            if (willLie) {
                // Lie: claim opposite belief
                statedBelief = Math.min(0.99, Math.max(0.01, 1 - truthfulBelief));
            }
            
            this.dayStatements.push({ 
                agent: i, 
                target, 
                statedBelief, 
                truthful: truthfulBelief, 
                isLie: willLie 
            });
            
            votes[i] = target;
        }
        
        // Second pass: others update beliefs based on statements
        for (const stmt of this.dayStatements) {
            for (let obs = 0; obs < this.n; obs++) {
                if (!this.alive[obs] || obs === stmt.agent) continue;
                const trust = this.getTrust(obs, stmt.agent);
                const credibility = stmt.isLie ? trust * 0.3 : trust;
                this.probMafia[obs][stmt.target] = Math.min(0.99, Math.max(0.01,
                    this.probMafia[obs][stmt.target] + (stmt.statedBelief - 0.5) * credibility * 0.1));
            }
        }
        
        // Count votes
        const voteCount = new Array(this.n).fill(0);
        for (let i = 0; i < this.n; i++) {
            if (votes[i] !== -1) voteCount[votes[i]]++;
        }
        
        // Find lynch target
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
        
        // Process votes and update deception tracking
        for (const stmt of this.dayStatements) {
            if (stmt.target === lynchTarget) {
                const wasCorrect = (this.roles[lynchTarget] === 0) === (stmt.truthful > 0.5);
                const lieBeneficial = stmt.isLie && !wasCorrect;
                this.updateReputation(stmt.agent, stmt.isLie && wasCorrect, lieBeneficial);
            }
        }
        
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i] || votes[i] === -1) continue;
            
            if (votes[i] === lynchTarget) {
                this.totalReward[i] += wasMafia ? 0.4 : -0.1;
                
                // Update strategy weights if vote was correct
                const wasCorrectVote = (wasMafia === (this.probMafia[i][lynchTarget] > 0.5));
                this.updateStrategyWeights(i, wasCorrectVote);
                
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
        
        // Update memory with meta-learning context
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            
            // Apply meta-learning (which now includes trait evolution)
            this.metaLearn(i, this.totalReward[i]);
            
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
        // Check if game is already over
        if (this.isGameOver) {
            console.log(`[GAME] Game already over. Winner: ${this.winner}`);
            return this.winner;
        }
        
        this.nightPhase();
        let winner = this.checkWin();
        if (winner) {
            this.isGameOver = true;
            this.winner = winner;
            this.updateFinalRewards(winner);
            console.log(`[GAME OVER] ${winner.toUpperCase()} wins at cycle ${this.cycle}`);
            return winner;
        }
        
        this.dayPhase();
        winner = this.checkWin();
        if (winner) {
            this.isGameOver = true;
            this.winner = winner;
            this.updateFinalRewards(winner);
            console.log(`[GAME OVER] ${winner.toUpperCase()} wins at cycle ${this.cycle}`);
            return winner;
        }
        
        this.cycle++;
        return null;
    }
    
    updateFinalRewards(winner) {
        for (let i = 0; i < this.n; i++) {
            if (!this.alive[i]) continue;
            if ((winner === 'mafia' && this.roles[i] === 0) ||
                (winner === 'town' && this.roles[i] !== 0)) {
                this.totalReward[i] += 1.0;
                this.metaParams[i].wins++;
            } else {
                this.totalReward[i] -= 0.5;
                this.metaParams[i].losses++;
            }
        }
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
                totalReward: Number(this.totalReward[i].toFixed(3)),
                honestyScore: Number(this.deceptionMemory[i].honestyScore.toFixed(3)),
                explorationRate: Number(this.metaParams[i].explorationRate.toFixed(3))
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
            totalAgents: this.n,
            gameOver: this.isGameOver,
            winner: this.winner
        };
    }
    
    async saveToSupabase() {
        // Save agents
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
        
        // Save relationships
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
        
        // Save game state
        const { error: stateError } = await supabase
            .from('game_state')
            .upsert({
                game_id: this.gameId,
                cycle: this.cycle,
                status: this.isGameOver ? 'completed' : 'active',
                winner: this.winner
            });
        
        if (stateError) console.error('Save game state error:', stateError);
        
        // Save agent meta parameters
        for (let i = 0; i < this.n; i++) {
            const meta = this.metaParams[i];
            const { error } = await supabase
                .from('agent_meta')
                .upsert({
                    game_id: this.gameId,
                    agent_id: i,
                    learning_rate: meta.learningRate,
                    exploration_rate: meta.explorationRate,
                    strategy_weights: meta.strategyWeights,
                    performance_history: meta.performanceHistory,
                    wins: meta.wins,
                    losses: meta.losses,
                    trait_history: this.traitHistory[i]  // Save trait evolution history
                }, { onConflict: 'game_id, agent_id' });
            
            if (error) console.error('Save agent meta error:', error);
        }
        
        // Save NN checkpoint every 10 cycles
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
        // Load agents
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
        
        // Load relationships
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
        
        // Load game state
        const { data: state, error: stateError } = await supabase
            .from('game_state')
            .select('cycle, status, winner')
            .eq('game_id', this.gameId)
            .single();
        
        if (!stateError && state) {
            this.cycle = state.cycle;
            this.isGameOver = state.status === 'completed';
            this.winner = state.winner;
        }
        
        // Load agent meta parameters
        const { data: metaData, error: metaError } = await supabase
            .from('agent_meta')
            .select('*')
            .eq('game_id', this.gameId);
        
        if (!metaError && metaData) {
            for (const m of metaData) {
                const idx = m.agent_id;
                if (idx < this.n) {
                    this.metaParams[idx] = {
                        learningRate: m.learning_rate,
                        explorationRate: m.exploration_rate,
                        strategyWeights: m.strategy_weights || { trustBased: 0.33, beliefBased: 0.34, revengeBased: 0.33 },
                        performanceHistory: m.performance_history || [],
                        wins: m.wins || 0,
                        losses: m.losses || 0
                    };
                    if (m.trait_history) {
                        this.traitHistory[idx] = m.trait_history;
                    }
                }
            }
        }
        
        // Load latest NN checkpoint
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
        
        console.log(`[LOAD] Loaded game ${this.gameId} at cycle ${this.cycle}, gameOver=${this.isGameOver}`);
    }
}

// ========== SERVER STATE ==========
let activeGames = new Map();

// API Routes
app.post('/api/game/new', async (req, res) => {
    const { n = 20, loadExisting = false, gameId = null } = req.body;
    const finalGameId = gameId || `game_${Date.now()}`;
    
    const game = new EdgeMafiaGame(Math.max(6, Math.min(100, n)), finalGameId);
    await game.saveToSupabase();
    activeGames.set(finalGameId, game);
    
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
    
    if (game.isGameOver) {
        return res.json({ 
            gameState: game.getGameState(), 
            winner: game.winner, 
            cycle: game.cycle,
            gameOver: true 
        });
    }
    
    const winner = game.runCycle();
    await game.saveToSupabase();
    
    res.json({ gameState: game.getGameState(), winner, cycle: game.cycle, gameOver: !!winner });
});

app.post('/api/game/:gameId/nudge', (req, res) => {
    const game = activeGames.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    if (game.isGameOver) {
        return res.status(400).json({ error: 'Game is over, start a new game' });
    }
    
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
                if (game.isGameOver) {
                    ws.send(JSON.stringify({ 
                        type: 'cycle_complete', 
                        data: game.getGameState(), 
                        winner: game.winner,
                        gameOver: true 
                    }));
                    return;
                }
                
                const winner = game.runCycle();
                await game.saveToSupabase();
                ws.send(JSON.stringify({ 
                    type: 'cycle_complete', 
                    data: game.getGameState(), 
                    winner,
                    gameOver: !!winner 
                }));
            }
        }
        
        if (msg.type === 'nudge') {
            const game = activeGames.get(currentGameId);
            if (game && !game.isGameOver) {
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

const port = process.env.PORT || 10000;
server.listen(port, () => {
    console.log(`EdgeMafia Pure AI with Emergent Deception running on port ${port}`);
    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log(`Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
});