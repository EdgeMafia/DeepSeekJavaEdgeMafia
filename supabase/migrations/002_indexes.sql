-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

-- Game lookups
CREATE INDEX idx_agents_game_id ON agents(game_id);
CREATE INDEX idx_agents_alive ON agents(game_id, alive);
CREATE INDEX idx_agents_role ON agents(game_id, role);

-- Relationships queries
CREATE INDEX idx_relationships_game ON relationships(game_id);
CREATE INDEX idx_relationships_agent_a ON relationships(game_id, agent_a);
CREATE INDEX idx_relationships_agent_b ON relationships(game_id, agent_b);

-- History queries
CREATE INDEX idx_history_game_cycle ON game_history(game_id, cycle);
CREATE INDEX idx_history_event ON game_history(game_id, event_type);

-- Checkpoints
CREATE INDEX idx_checkpoints_game ON nn_checkpoints(game_id, cycle);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get alive agents for a game
CREATE OR REPLACE FUNCTION get_alive_agents(p_game_id VARCHAR)
RETURNS TABLE(agent_index INTEGER, name VARCHAR, role INTEGER, aggression FLOAT, loyalty FLOAT, paranoia FLOAT, deceit FLOAT, total_reward FLOAT) AS $$
BEGIN
    RETURN QUERY
    SELECT a.agent_index, a.name, a.role, a.aggression, a.loyalty, a.paranoia, a.deceit, a.total_reward
    FROM agents a
    WHERE a.game_id = p_game_id AND a.alive = TRUE
    ORDER BY a.agent_index;
END;
$$ LANGUAGE plpgsql;

-- Get trust matrix for a game
CREATE OR REPLACE FUNCTION get_trust_matrix(p_game_id VARCHAR)
RETURNS TABLE(agent_a INTEGER, agent_b INTEGER, trust FLOAT) AS $$
BEGIN
    RETURN QUERY
    SELECT r.agent_a, r.agent_b, r.trust
    FROM relationships r
    WHERE r.game_id = p_game_id;
END;
$$ LANGUAGE plpgsql;

-- Get game summary stats
CREATE OR REPLACE FUNCTION get_game_stats(p_game_id VARCHAR)
RETURNS TABLE(
    mafia_alive BIGINT,
    town_alive BIGINT,
    total_agents BIGINT,
    cycle INTEGER,
    status VARCHAR
) AS $$
DECLARE
    v_cycle INTEGER;
    v_status VARCHAR;
BEGIN
    SELECT gs.cycle, gs.status INTO v_cycle, v_status
    FROM game_state gs
    WHERE gs.game_id = p_game_id;
    
    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE role = 0 AND alive = TRUE) as mafia_alive,
        COUNT(*) FILTER (WHERE role != 0 AND alive = TRUE) as town_alive,
        COUNT(*) as total_agents,
        v_cycle,
        v_status;
END;
$$ LANGUAGE plpgsql;