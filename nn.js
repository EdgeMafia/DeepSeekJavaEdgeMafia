// nn.js - Full neural network implementation, zero dependencies

// ========== SIMPLE NN (Policy Network: 14→64→8) ==========
class SimpleNN {
    constructor(inputSize=14, hiddenSize=64, outputSize=8) {
        this.inputSize = inputSize;
        this.hiddenSize = hiddenSize;
        this.outputSize = outputSize;
        
        // Xavier initialization
        this.W1 = this.xavierInit(inputSize, hiddenSize);
        this.b1 = new Array(hiddenSize).fill(0);
        this.W2 = this.xavierInit(hiddenSize, outputSize);
        this.b2 = new Array(outputSize).fill(0);
        
        // Adam optimizer state
        this.mW1 = new Array(this.W1.length).fill(0);
        this.vW1 = new Array(this.W1.length).fill(0);
        this.mW2 = new Array(this.W2.length).fill(0);
        this.vW2 = new Array(this.W2.length).fill(0);
        this.mb1 = new Array(hiddenSize).fill(0);
        this.vb1 = new Array(hiddenSize).fill(0);
        this.mb2 = new Array(outputSize).fill(0);
        this.vb2 = new Array(outputSize).fill(0);
        this.step = 0;
    }
    
    xavierInit(fanIn, fanOut) {
        const scale = Math.sqrt(2 / (fanIn + fanOut));
        const size = fanIn * fanOut;
        const weights = new Array(size);
        for (let i = 0; i < size; i++) {
            weights[i] = (Math.random() * 2 - 1) * scale;
        }
        return weights;
    }
    
    relu(x) { return Math.max(0, x); }
    reluDeriv(x) { return x > 0 ? 1 : 0; }
    
    forward(input) {
        const hidden = new Array(this.hiddenSize);
        const hiddenRaw = new Array(this.hiddenSize);
        
        // Hidden layer
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = this.b1[i];
            for (let j = 0; j < this.inputSize; j++) {
                sum += input[j] * this.W1[j * this.hiddenSize + i];
            }
            hiddenRaw[i] = sum;
            hidden[i] = this.relu(sum);
        }
        
        // Output layer (no activation - raw logits)
        const output = new Array(this.outputSize);
        for (let i = 0; i < this.outputSize; i++) {
            let sum = this.b2[i];
            for (let j = 0; j < this.hiddenSize; j++) {
                sum += hidden[j] * this.W2[j * this.outputSize + i];
            }
            output[i] = sum;
        }
        
        return { output, hidden, hiddenRaw };
    }
    
    train(input, action, target, lr=0.001) {
        this.step++;
        const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
        
        const { output, hidden, hiddenRaw } = this.forward(input);
        const error = target - output[action];
        const dOutput = error;
        
        // Gradients for output layer
        const dW2 = new Array(this.W2.length).fill(0);
        const db2 = new Array(this.outputSize).fill(0);
        for (let i = 0; i < this.outputSize; i++) {
            const grad = (i === action) ? dOutput : 0;
            db2[i] = grad;
            for (let j = 0; j < this.hiddenSize; j++) {
                dW2[j * this.outputSize + i] = hidden[j] * grad;
            }
        }
        
        // Gradients for hidden layer
        const dHidden = new Array(this.hiddenSize);
        for (let j = 0; j < this.hiddenSize; j++) {
            let sum = 0;
            for (let i = 0; i < this.outputSize; i++) {
                const grad = (i === action) ? dOutput : 0;
                sum += grad * this.W2[j * this.outputSize + i];
            }
            dHidden[j] = sum * this.reluDeriv(hiddenRaw[j]);
        }
        
        // Gradients for input layer
        const dW1 = new Array(this.W1.length).fill(0);
        const db1 = new Array(this.hiddenSize).fill(0);
        for (let i = 0; i < this.hiddenSize; i++) {
            db1[i] = dHidden[i];
            for (let j = 0; j < this.inputSize; j++) {
                dW1[j * this.hiddenSize + i] = input[j] * dHidden[i];
            }
        }
        
        // Adam update
        const adamUpdate = (params, m, v, dParams) => {
            for (let i = 0; i < params.length; i++) {
                m[i] = beta1 * m[i] + (1 - beta1) * dParams[i];
                v[i] = beta2 * v[i] + (1 - beta2) * dParams[i] * dParams[i];
                const mHat = m[i] / (1 - Math.pow(beta1, this.step));
                const vHat = v[i] / (1 - Math.pow(beta2, this.step));
                params[i] += lr * mHat / (Math.sqrt(vHat) + eps);
            }
        };
        
        adamUpdate(this.W2, this.mW2, this.vW2, dW2);
        adamUpdate(this.b2, this.mb2, this.vb2, db2);
        adamUpdate(this.W1, this.mW1, this.vW1, dW1);
        adamUpdate(this.b1, this.mb1, this.vb1, db1);
        
        return error;
    }
    
    // Batch scoring for day phase lynch votes
    scoreTargets(self, candidates, trustMap, probMafiaMap, paranoia) {
        let best = -1;
        let bestScore = -Infinity;
        for (const j of candidates) {
            const trust = trustMap[j] || 0;
            const prob = probMafiaMap[j] || 0;
            const score = prob * (1 + paranoia) - trust * 0.5;
            if (score > bestScore) {
                bestScore = score;
                best = j;
            }
        }
        return best;
    }
    
    // Serialization for save/load
    serialize() {
        return {
            W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2,
            mW1: this.mW1, vW1: this.vW1, mW2: this.mW2, vW2: this.vW2,
            mb1: this.mb1, vb1: this.vb1, mb2: this.mb2, vb2: this.vb2,
            step: this.step
        };
    }
    
    deserialize(data) {
        this.W1 = data.W1; this.b1 = data.b1; this.W2 = data.W2; this.b2 = data.b2;
        this.mW1 = data.mW1; this.vW1 = data.vW1; this.mW2 = data.mW2; this.vW2 = data.vW2;
        this.mb1 = data.mb1; this.vb1 = data.vb1; this.mb2 = data.mb2; this.vb2 = data.vb2;
        this.step = data.step;
    }
}


// ========== SOCIAL NN (Relationship Dynamics: 8→32→2) ==========
class SocialNN {
    constructor(inputSize=8, hiddenSize=32, outputSize=2) {
        this.inputSize = inputSize;
        this.hiddenSize = hiddenSize;
        this.outputSize = outputSize;
        
        this.W1 = this.xavierInit(inputSize, hiddenSize);
        this.b1 = new Array(hiddenSize).fill(0);
        this.W2 = this.xavierInit(hiddenSize, outputSize);
        this.b2 = new Array(outputSize).fill(0);
        
        this.mW1 = new Array(this.W1.length).fill(0);
        this.vW1 = new Array(this.W1.length).fill(0);
        this.mW2 = new Array(this.W2.length).fill(0);
        this.vW2 = new Array(this.W2.length).fill(0);
        this.mb1 = new Array(hiddenSize).fill(0);
        this.vb1 = new Array(hiddenSize).fill(0);
        this.mb2 = new Array(outputSize).fill(0);
        this.vb2 = new Array(outputSize).fill(0);
        this.step = 0;
    }
    
    xavierInit(fanIn, fanOut) {
        const scale = Math.sqrt(2 / (fanIn + fanOut));
        const size = fanIn * fanOut;
        const weights = new Array(size);
        for (let i = 0; i < size; i++) {
            weights[i] = (Math.random() * 2 - 1) * scale;
        }
        return weights;
    }
    
    relu(x) { return Math.max(0, x); }
    reluDeriv(x) { return x > 0 ? 1 : 0; }
    tanh(x) { return Math.tanh(x); }
    tanhDeriv(x) { return 1 - x * x; }
    
    forward(input) {
        const hidden = new Array(this.hiddenSize);
        const hiddenRaw = new Array(this.hiddenSize);
        
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = this.b1[i];
            for (let j = 0; j < this.inputSize; j++) {
                sum += input[j] * this.W1[j * this.hiddenSize + i];
            }
            hiddenRaw[i] = sum;
            hidden[i] = this.relu(sum);
        }
        
        let trustRaw = this.b2[0];
        let likingRaw = this.b2[1];
        for (let j = 0; j < this.hiddenSize; j++) {
            trustRaw += hidden[j] * this.W2[j * this.outputSize + 0];
            likingRaw += hidden[j] * this.W2[j * this.outputSize + 1];
        }
        
        return {
            trust: this.tanh(trustRaw),
            liking: this.tanh(likingRaw),
            trustRaw, likingRaw,
            hidden, hiddenRaw
        };
    }
    
    train(input, targetTrust, targetLiking, lr=0.001) {
        this.step++;
        const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
        
        const { trust, liking, trustRaw, likingRaw, hidden, hiddenRaw } = this.forward(input);
        
        const dTrust = (trust - targetTrust) * this.tanhDeriv(trust);
        const dLiking = (liking - targetLiking) * this.tanhDeriv(liking);
        
        const dW2 = new Array(this.W2.length).fill(0);
        const db2 = [dTrust, dLiking];
        for (let j = 0; j < this.hiddenSize; j++) {
            dW2[j * this.outputSize + 0] = hidden[j] * dTrust;
            dW2[j * this.outputSize + 1] = hidden[j] * dLiking;
        }
        
        const dHidden = new Array(this.hiddenSize);
        for (let j = 0; j < this.hiddenSize; j++) {
            let sum = dTrust * this.W2[j * this.outputSize + 0] +
                      dLiking * this.W2[j * this.outputSize + 1];
            dHidden[j] = sum * this.reluDeriv(hiddenRaw[j]);
        }
        
        const dW1 = new Array(this.W1.length).fill(0);
        const db1 = new Array(this.hiddenSize);
        for (let i = 0; i < this.hiddenSize; i++) {
            db1[i] = dHidden[i];
            for (let j = 0; j < this.inputSize; j++) {
                dW1[j * this.hiddenSize + i] = input[j] * dHidden[i];
            }
        }
        
        const adamUpdate = (params, m, v, dParams) => {
            for (let i = 0; i < params.length; i++) {
                m[i] = beta1 * m[i] + (1 - beta1) * dParams[i];
                v[i] = beta2 * v[i] + (1 - beta2) * dParams[i] * dParams[i];
                const mHat = m[i] / (1 - Math.pow(beta1, this.step));
                const vHat = v[i] / (1 - Math.pow(beta2, this.step));
                params[i] += lr * mHat / (Math.sqrt(vHat) + eps);
            }
        };
        
        adamUpdate(this.W2, this.mW2, this.vW2, dW2);
        adamUpdate(this.b2, this.mb2, this.vb2, db2);
        adamUpdate(this.W1, this.mW1, this.vW1, dW1);
        adamUpdate(this.b1, this.mb1, this.vb1, db1);
        
        return { trust, liking };
    }
    
    serialize() {
        return {
            W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2,
            mW1: this.mW1, vW1: this.vW1, mW2: this.mW2, vW2: this.vW2,
            mb1: this.mb1, vb1: this.vb1, mb2: this.mb2, vb2: this.vb2,
            step: this.step
        };
    }
    
    deserialize(data) {
        this.W1 = data.W1; this.b1 = data.b1; this.W2 = data.W2; this.b2 = data.b2;
        this.mW1 = data.mW1; this.vW1 = data.vW1; this.mW2 = data.mW2; this.vW2 = data.vW2;
        this.mb1 = data.mb1; this.vb1 = data.vb1; this.mb2 = data.mb2; this.vb2 = data.vb2;
        this.step = data.step;
    }
}


// ========== MEMORY RNN (Recurrent Memory: context→16→4) ==========
class MemoryRNN {
    constructor(stateSize=14, hiddenSize=16, memSize=4, contextExtra=5) {
        this.stateSize = stateSize;
        this.hiddenSize = hiddenSize;
        this.memSize = memSize;
        this.contextSize = stateSize + contextExtra;
        
        this.Wxh = this.xavierInit(this.contextSize, hiddenSize);
        this.Whh = this.xavierInit(hiddenSize, hiddenSize);
        this.Why = this.xavierInit(hiddenSize, memSize);
        this.bh = new Array(hiddenSize).fill(0);
        this.by = new Array(memSize).fill(0);
        
        // Per-agent state
        this.agents = new Map();
    }
    
    xavierInit(fanIn, fanOut) {
        const scale = Math.sqrt(2 / (fanIn + fanOut));
        const size = fanIn * fanOut;
        const weights = new Array(size);
        for (let i = 0; i < size; i++) {
            weights[i] = (Math.random() * 2 - 1) * scale;
        }
        return weights;
    }
    
    initAgent(agentId) {
        if (!this.agents.has(agentId)) {
            this.agents.set(agentId, {
                hidden: new Array(this.hiddenSize).fill(0),
                memory: new Array(this.memSize).fill(0)
            });
        }
    }
    
    getMemory(agentId) {
        this.initAgent(agentId);
        return [...this.agents.get(agentId).memory];
    }
    
    step(agentId, context) {
        this.initAgent(agentId);
        const agent = this.agents.get(agentId);
        const { hidden, memory } = agent;
        
        // New hidden: tanh(Wxh*context + Whh*hidden + bh)
        const newHidden = new Array(this.hiddenSize);
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = this.bh[i];
            for (let j = 0; j < this.contextSize; j++) {
                sum += context[j] * this.Wxh[j * this.hiddenSize + i];
            }
            for (let j = 0; j < this.hiddenSize; j++) {
                sum += hidden[j] * this.Whh[j * this.hiddenSize + i];
            }
            newHidden[i] = Math.tanh(sum);
        }
        
        // New memory: tanh(Why*newHidden + by)
        const newMemory = new Array(this.memSize);
        for (let i = 0; i < this.memSize; i++) {
            let sum = this.by[i];
            for (let j = 0; j < this.hiddenSize; j++) {
                sum += newHidden[j] * this.Why[j * this.memSize + i];
            }
            newMemory[i] = Math.tanh(sum);
        }
        
        agent.hidden = newHidden;
        agent.memory = newMemory;
        
        return newMemory;
    }
    
    resetAgent(agentId) {
        if (this.agents.has(agentId)) {
            const agent = this.agents.get(agentId);
            agent.hidden.fill(0);
            agent.memory.fill(0);
        }
    }
    
    serialize() {
        return {
            Wxh: this.Wxh, Whh: this.Whh, Why: this.Why,
            bh: this.bh, by: this.by,
            agents: Array.from(this.agents.entries())
        };
    }
    
    deserialize(data) {
        this.Wxh = data.Wxh; this.Whh = data.Whh; this.Why = data.Why;
        this.bh = data.bh; this.by = data.by;
        this.agents = new Map(data.agents);
    }
}

module.exports = { SimpleNN, SocialNN, MemoryRNN };