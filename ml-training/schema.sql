-- PostgreSQL schema for local ML experimentation environment
-- This closely mirrors the DynamoDB structures but flat for analytical queries

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    type VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    account_id UUID,
    date BIGINT, -- milliseconds since epoch
    amount DECIMAL,
    description TEXT,
    memo TEXT,
    currency VARCHAR(10),
    transaction_type VARCHAR(50),
    mcc_code VARCHAR(10), -- extracted if available
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS recurring_charge_patterns (
    pattern_id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    merchant_pattern VARCHAR(255),
    frequency VARCHAR(50),
    temporal_pattern_type VARCHAR(50),
    day_of_week INT,
    day_of_month INT,
    amount_mean DECIMAL,
    amount_std DECIMAL,
    confidence_score DECIMAL,
    status VARCHAR(50),
    active BOOLEAN,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS pattern_feedback (
    feedback_id UUID PRIMARY KEY,
    pattern_id UUID REFERENCES recurring_charge_patterns(pattern_id),
    user_id VARCHAR(255) NOT NULL,
    feedback_type VARCHAR(50),
    transaction_id UUID,
    timestamp BIGINT
);

-- Results table for storing ML engine outputs
CREATE TABLE IF NOT EXISTS ml_categorization_results (
    id SERIAL PRIMARY KEY,
    transaction_id UUID REFERENCES transactions(transaction_id),
    predicted_pattern_id UUID,
    predicted_merchant VARCHAR(255),
    confidence_score DECIMAL,
    is_anomaly BOOLEAN DEFAULT FALSE,
    run_timestamp BIGINT
);
