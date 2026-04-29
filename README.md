# 🕵️ EDGEMAFIA - Emergent Deception AI

## Pure JavaScript · Neural Networks · Meta-Learning · Free Tier

---

## 🌟 WHAT IS THIS?

**EdgeMafia** is a fully autonomous AI simulation of the social deduction game Mafia (Werewolf). 

Unlike traditional game AI that follows hardcoded rules, EdgeMafia agents **learn to lie, deceive, and adapt their strategies** based entirely on experience. Deception emerges naturally because it helps them win - not because a programmer told them to lie.

### 🔥 WORLD FIRSTS (to my knowledge)

| Achievement | Status |
|-------------|--------|
| Browser-based Mafia AI with emergent deception in pure JavaScript | ✅ YES |
| Emergent social deception running on free hosting (Render + GitHub Pages) | ✅ YES |
| Meta-learning + deception in <2000 lines of vanilla JS | ✅ YES |
| Real-time human nudging of AI personality during gameplay | ✅ YES |

---

## 🧠 EMERGENT BEHAVIORS

### 1. **Deception Emerges Organically**

Mafia agents are not programmed to lie. They learn that:
- Lying about a town member's identity helps eliminate enemies
- Protecting fellow mafia members improves survival odds
- Getting caught lying damages reputation and leads to lynching

**The result:** Agents develop individual "honesty scores" based on what worked for them.

### 2. **Reputation System**

Every agent tracks the trustworthiness of every other agent:
- Caught liars lose reputation
- Honest agents gain influence
- Reputation affects how others perceive their accusations

### 3. **Meta-Learning**

Agents adapt their learning parameters in real-time:
- **Learning rate** adjusts based on performance trends
- **Exploration rate** (epsilon-greedy) increases when losing
- **Strategy weights** evolve between trust-based, belief-based, and revenge-based voting

### 4. **Strategy Discovery**

Agents discover optimal strategies across games:
- Trust-based: Vote based on relationship trust
- Belief-based: Vote based on suspected mafia probability
- Revenge-based: Vote against those who attacked them

These weights are saved to Supabase and persist across game sessions.

### 5. **LSTM Memory**

Each agent maintains a 4-dimensional memory vector updated via recurrent neural network:
- Remembers past accusations
- Tracks consistency of other agents
- Learns temporal patterns in social dynamics

---

## 🎮 GAME MECHANICS

### Roles

| Role | Ability | Count |
|------|---------|-------|
| **Mafia** | Kill one player each night | ~1/6 of players |
| **Detective** | Investigate one player each night (reveals mafia/town) | 1-2 |
| **Doctor** | Save one player each night (70% success rate) | 1-2 |
| **Villager** | Vote during the day, no night action | Remaining |

### Game Loop


┌─────────┐ ┌─────────┐ ┌─────────┐
│ NIGHT │ ──► │ DAY │ ──► │ VOTE │ ──► Repeat
└─────────┘ └─────────┘ └─────────┘
│ │ │
▼ ▼ ▼
Mafia Kill Accusations Lynch Target
Doctor Save Lie Detection Update Trust
Detective Reputation Train Neural
Investigate Updates Networks

### Neural Architecture

Input Layer (14 neurons)
↓
Hidden Layer (64 neurons, ReLU)
↓
Output Layer (8 Q-values)
↓
Action Selection (epsilon-greedy with meta-learning)

Total Parameters: 1,472 (SimpleNN) + 322 (SocialNN) + 624 (MemoryRNN)
All trained via online RL + Adam optimizer


---

## 🎮 HUMAN INTERACTION

### Real-Time Nudging

You can modify any live agent's personality mid-game:

| Trait | Effect |
|-------|--------|
| **Aggression** | Increases willingness to kill/accuse |
| **Loyalty** | Increases trust toward allies |
| **Paranoia** | Increases suspicion of others |
| **Deceit** | Increases likelihood of lying |

Press +/- buttons or use gamepad (A=next cycle, X=nudge+)

### Controls

| Control | Action |
|---------|--------|
| **NEXT CYCLE** | Advance one night+day phase |
| **NEW GAME** | Start fresh with N agents |
| **Nudge +0.1/-0.1** | Modify selected agent trait |
| **Gamepad A** | Next cycle |
| **Gamepad X** | Nudge up on selected agent |

---

## 🏗️ ARCHITECTURE

### Technology Stack ($0 cost)

| Component | Technology |
|-----------|------------|
| Frontend | HTML5/CSS3/JavaScript (GitHub Pages) |
| Backend | Node.js + Express (Render Free Tier) |
| Database | PostgreSQL (Supabase Free Tier) |
| Neural Networks | Pure JavaScript (no TensorFlow/PyTorch) |
| Real-time | WebSockets |

### Neural Network Implementation

All networks written from scratch without external ML libraries:

```javascript
// SimpleNN: Policy network for lynch votes
class SimpleNN {
    forward(input) { /* 14→64→8 */ }
    train(input, action, target, lr) { /* Backprop + Adam */ }
}

// SocialNN: Relationship dynamics
class SocialNN {
    forward(input) { /* 8→32→2 */ }
    train(input, targetTrust, targetLiking, lr) { /* Social learning */ }
}

// MemoryRNN: Per-agent LSTM state
class MemoryRNN {
    step(agentId, context) { /* Recurrent memory update */ }
}

PERFORMANCE
Metric	Value
Neural net inference	<5ms per agent
Memory usage	~70MB (Render free tier)
Cold start	~50s (Render spins down)
Concurrent agents	20-100 (tested)
Training cycles	Unlimited (online RL)
🎯 RESEARCH POTENTIAL
This system could be extended for:

Human-AI collaboration studies - How do humans influence AI deception?

Emergent communication - Do agents develop consistent "tell" patterns?

Multi-agent meta-learning - Do strategies transfer across different role distributions?

Deception detection - Can another neural network learn to identify liars?

📝 LICENSE
MIT License - Free for academic and commercial use

🙏 ACKNOWLEDGMENTS
Built entirely by Aston Walker as an exploration of emergent social deception in minimal compute environments.

No LLMs, no GPUs, no TensorFlow. Just JavaScript, neural networks, and emergence.

⚡ QUICK START
Visit https://edgemafia.github.io/DeepSeekJavaEdgeMafia/

Wait for "Connected" status (green dot)

Click NEXT CYCLE repeatedly

Watch mafia agents learn to lie

Use Nudge buttons to manipulate personality in real-time

Observe strategy emergence over 20-50 cycles

"Deception is learned, not programmed."

— EdgeMafia AI
