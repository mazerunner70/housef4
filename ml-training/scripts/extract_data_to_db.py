import os
import boto3
import psycopg2
from psycopg2.extras import execute_values

# Configuration for DynamoDB
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')))

# Table names from Environment variables
TRANSACTIONS_TABLE = os.environ.get('TRANSACTIONS_TABLE')
PATTERNS_TABLE = os.environ.get('RECURRING_CHARGE_PATTERNS_TABLE')
FEEDBACK_TABLE = os.environ.get('PATTERN_FEEDBACK_TABLE')
ACCOUNTS_TABLE = os.environ.get('ACCOUNTS_TABLE')

print("\n--- Loaded Environment Variables ---")
print(f"AWS_REGION: {os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))}")
print(f"TRANSACTIONS_TABLE: {TRANSACTIONS_TABLE}")
print(f"RECURRING_CHARGE_PATTERNS_TABLE: {PATTERNS_TABLE}")
print(f"PATTERN_FEEDBACK_TABLE: {FEEDBACK_TABLE}")
print(f"ACCOUNTS_TABLE: {ACCOUNTS_TABLE}")
print("------------------------------------\n")

def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'db'),
        port=os.environ.get('DB_PORT', '5432'),
        user=os.environ.get('DB_USER', 'ml_user'),
        password=os.environ.get('DB_PASSWORD', 'ml_password'),
        database=os.environ.get('DB_NAME', 'recurring_charges_ml')
    )

def scan_table(table_name):
    if not table_name:
        print(f"Table name environment variable not set, skipping...")
        return []
        
    table = dynamodb.Table(table_name)
    response = table.scan()
    items = response.get('Items', [])
    
    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response.get('Items', []))
        
    return items

def extract_transactions(conn):
    print(f"Extracting transactions from {TRANSACTIONS_TABLE}...")
    items = scan_table(TRANSACTIONS_TABLE)
    if not items:
        return
        
    records = []
    for item in items:
        records.append((
            str(item.get('transactionId')),
            item.get('userId'),
            str(item.get('accountId')) if item.get('accountId') else None,
            int(item.get('date', 0)),
            float(item.get('amount', 0)),
            item.get('description', ''),
            item.get('memo', ''),
            item.get('currency', ''),
            item.get('transactionType', ''),
            item.get('mcc_code', ''), # Typically extracted externally
            int(item.get('createdAt', 0))
        ))
        
    query = """
    INSERT INTO transactions 
    (transaction_id, user_id, account_id, date, amount, description, memo, currency, transaction_type, mcc_code, created_at)
    VALUES %s
    ON CONFLICT (transaction_id) DO NOTHING;
    """
    with conn.cursor() as cur:
        execute_values(cur, query, records)
    conn.commit()
    print(f"Inserted {len(records)} transactions.")

def extract_patterns(conn):
    print(f"Extracting patterns from {PATTERNS_TABLE}...")
    items = scan_table(PATTERNS_TABLE)
    if not items:
        return
        
    records = []
    for item in items:
        records.append((
            str(item.get('patternId')),
            item.get('userId'),
            item.get('merchantPattern', ''),
            item.get('frequency', ''),
            item.get('temporalPatternType', ''),
            item.get('dayOfWeek'),
            item.get('dayOfMonth'),
            float(item.get('amountMean', 0)),
            float(item.get('amountStd', 0) if item.get('amountStd') is not None else 0),
            float(item.get('confidenceScore', 0)),
            item.get('status', ''),
            str(item.get('active', '')).lower() == 'true',
            int(item.get('createdAt', 0))
        ))
        
    query = """
    INSERT INTO recurring_charge_patterns 
    (pattern_id, user_id, merchant_pattern, frequency, temporal_pattern_type, 
     day_of_week, day_of_month, amount_mean, amount_std, confidence_score, status, active, created_at)
    VALUES %s
    ON CONFLICT (pattern_id) DO NOTHING;
    """
    with conn.cursor() as cur:
        execute_values(cur, query, records)
    conn.commit()
    print(f"Inserted {len(records)} patterns.")

def extract_feedback(conn):
    print(f"Extracting feedback from {FEEDBACK_TABLE}...")
    items = scan_table(FEEDBACK_TABLE)
    if not items:
        return
        
    records = []
    for item in items:
        records.append((
            str(item.get('feedbackId')),
            str(item.get('patternId')) if item.get('patternId') else None,
            item.get('userId'),
            item.get('feedbackType', ''),
            str(item.get('transactionId')) if item.get('transactionId') else None,
            int(item.get('timestamp', 0))
        ))
        
    query = """
    INSERT INTO pattern_feedback 
    (feedback_id, pattern_id, user_id, feedback_type, transaction_id, timestamp)
    VALUES %s
    ON CONFLICT (feedback_id) DO NOTHING;
    """
    with conn.cursor() as cur:
        execute_values(cur, query, records)
    conn.commit()
    print(f"Inserted {len(records)} feedback items.")

def main():
    print("Starting data extraction...")
    conn = get_db_connection()
    try:
        extract_transactions(conn)
        extract_patterns(conn)
        extract_feedback(conn)
        print("Data extraction complete!")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
