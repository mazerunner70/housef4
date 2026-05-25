"""Extract DynamoDB single-table data into the ml-training Postgres database.

Always run inside the ml-engine container (Postgres is the `db` service):

    docker compose exec ml-engine python scripts/extract_data_to_db.py

Reads entity items from `DYNAMODB_TABLE_NAME` (default `housef4-local-table`).
DynamoDB Local from the repo root compose is at host.docker.internal:8000 by default
(see ml-training/docker-compose.yml). Leave DYNAMODB_ENDPOINT unset in .env to use AWS.
"""
import os
from decimal import Decimal

import boto3
import psycopg2
from psycopg2.extras import execute_values

POSTGRES_TABLES = (
    'ml_categorization_results',
    'pattern_feedback',
    'recurring_charge_patterns',
    'transactions',
    'accounts',
)

ENTITY_TYPES = (
    'TRANSACTION',
    'CLUSTER',
    'ACCOUNT',
    'TRANSACTION_FILE',
)


def _item_decimal(item, key, default='0'):
    """DynamoDB Numbers are Decimal; avoid float() so DECIMAL columns keep precision."""
    v = item.get(key)
    if v is None:
        return Decimal(default)
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _aws_region():
    return os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))


def _env_or(key, default):
    value = os.environ.get(key)
    return value if value else default


def _dynamodb_table_name():
    return _env_or('DYNAMODB_TABLE_NAME', 'housef4-local-table')


def _ml_user_id():
    return os.environ.get('ML_USER_ID') or None


def _dynamodb_resource():
    endpoint = os.environ.get('DYNAMODB_ENDPOINT')
    if endpoint:
        return boto3.resource(
            'dynamodb',
            region_name=_aws_region(),
            endpoint_url=endpoint,
            aws_access_key_id=_env_or('AWS_ACCESS_KEY_ID', 'local'),
            aws_secret_access_key=_env_or('AWS_SECRET_ACCESS_KEY', 'local'),
        )
    return boto3.resource('dynamodb', region_name=_aws_region())


def _user_id_from_item(item):
    user_id = item.get('user_id')
    if user_id:
        return str(user_id)
    pk = item.get('PK', '')
    if isinstance(pk, str) and pk.startswith('USER#'):
        return pk[5:]
    return None


def _matches_user(item, user_id):
    if not user_id:
        return True
    return _user_id_from_item(item) == user_id


def print_config():
    print("\n--- Loaded Environment Variables ---")
    print(f"AWS_REGION: {_aws_region()}")
    print(f"DYNAMODB_ENDPOINT: {os.environ.get('DYNAMODB_ENDPOINT') or '(AWS default)'}")
    print(f"DYNAMODB_TABLE_NAME: {_dynamodb_table_name()}")
    print(f"ML_USER_ID: {_ml_user_id() or '(all users)'}")
    print(f"DB_HOST: {os.environ.get('DB_HOST', 'db')}")
    print(f"DB_NAME: {os.environ.get('DB_NAME', 'recurring_charges_ml')}")
    print("------------------------------------\n")


def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'db'),
        port=os.environ.get('DB_PORT', '5432'),
        user=os.environ.get('DB_USER', 'ml_user'),
        password=os.environ.get('DB_PASSWORD', 'ml_password'),
        database=os.environ.get('DB_NAME', 'recurring_charges_ml'),
    )


def scan_table(table_name):
    table = _dynamodb_resource().Table(table_name)
    response = table.scan()
    items = response.get('Items', [])

    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response.get('Items', []))

    return items


def load_dynamodb_items():
    table_name = _dynamodb_table_name()
    print(f"Scanning DynamoDB table {table_name}...")
    items = scan_table(table_name)
    print(f"Loaded {len(items)} items from DynamoDB.\n")
    return items


def items_for_entity(all_items, entity_type, user_id=None):
    return [
        item
        for item in all_items
        if item.get('entity_type') == entity_type and _matches_user(item, user_id)
    ]


def print_dynamodb_counts(all_items):
    user_id = _ml_user_id()
    print("--- DynamoDB entity counts ---")
    print(f"Table: {_dynamodb_table_name()}")
    if user_id:
        print(f"User filter: {user_id}")
    for entity_type in ENTITY_TYPES:
        count = len(items_for_entity(all_items, entity_type, user_id))
        print(f"{entity_type.ljust(30)} : {count} items")
    print("--------------------------------\n")


def print_postgres_counts(conn, heading):
    print(heading)
    with conn.cursor() as cur:
        for table in POSTGRES_TABLES:
            cur.execute(f'SELECT COUNT(*) FROM {table}')
            print(f"{table.ljust(30)} : {cur.fetchone()[0]} rows")
    print("--------------------------------\n")


def ensure_varchar_id_columns(conn):
    """Upgrade legacy UUID id columns so txn_* / CL_* strings can be stored."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'transactions'
              AND column_name = 'transaction_id'
              AND udt_name = 'uuid'
            """
        )
        if cur.fetchone() is None:
            return

        print("Migrating PostgreSQL id columns from UUID to VARCHAR(255)...")
        cur.execute(
            """
            ALTER TABLE ml_categorization_results
              DROP CONSTRAINT IF EXISTS ml_categorization_results_transaction_id_fkey;
            ALTER TABLE pattern_feedback
              DROP CONSTRAINT IF EXISTS pattern_feedback_pattern_id_fkey;
            ALTER TABLE accounts ALTER COLUMN id TYPE VARCHAR(255);
            ALTER TABLE transactions ALTER COLUMN transaction_id TYPE VARCHAR(255);
            ALTER TABLE transactions ALTER COLUMN account_id TYPE VARCHAR(255);
            ALTER TABLE recurring_charge_patterns ALTER COLUMN pattern_id TYPE VARCHAR(255);
            ALTER TABLE pattern_feedback ALTER COLUMN feedback_id TYPE VARCHAR(255);
            ALTER TABLE pattern_feedback ALTER COLUMN pattern_id TYPE VARCHAR(255);
            ALTER TABLE pattern_feedback ALTER COLUMN transaction_id TYPE VARCHAR(255);
            ALTER TABLE ml_categorization_results ALTER COLUMN transaction_id TYPE VARCHAR(255);
            ALTER TABLE ml_categorization_results ALTER COLUMN predicted_pattern_id TYPE VARCHAR(255);
            ALTER TABLE pattern_feedback ADD CONSTRAINT pattern_feedback_pattern_id_fkey
              FOREIGN KEY (pattern_id) REFERENCES recurring_charge_patterns(pattern_id);
            ALTER TABLE ml_categorization_results ADD CONSTRAINT ml_categorization_results_transaction_id_fkey
              FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id);
            """
        )
    conn.commit()
    print("Schema migration complete.\n")


def clear_postgres_tables(conn):
    print_postgres_counts(conn, "--- PostgreSQL counts (before clear) ---")
    with conn.cursor() as cur:
        cur.execute(
            f"TRUNCATE {', '.join(POSTGRES_TABLES)} RESTART IDENTITY CASCADE"
        )
    conn.commit()
    print("Cleared PostgreSQL tables.\n")
    print_postgres_counts(conn, "--- PostgreSQL counts (after clear) ---")


def _transaction_file_account_map(all_items, user_id):
    account_by_file = {}
    for item in items_for_entity(all_items, 'TRANSACTION_FILE', user_id):
        file_id = item.get('id')
        account_id = item.get('account_id')
        if file_id and account_id:
            account_by_file[str(file_id)] = str(account_id)
    return account_by_file


def extract_transactions(conn, all_items):
    user_id = _ml_user_id()
    items = items_for_entity(all_items, 'TRANSACTION', user_id)
    print(f"Extracting {len(items)} TRANSACTION items...")
    if not items:
        return

    account_by_file = _transaction_file_account_map(all_items, user_id)
    records = []
    for item in items:
        transaction_id = item.get('id')
        if not transaction_id:
            continue
        file_id = item.get('transaction_file_id')
        records.append((
            str(transaction_id),
            _user_id_from_item(item),
            account_by_file.get(str(file_id)) if file_id else None,
            int(item.get('date', 0)),
            _item_decimal(item, 'amount'),
            item.get('raw_merchant', ''),
            item.get('cleaned_merchant', ''),
            item.get('currency', ''),
            item.get('status', ''),
            '',
            int(item.get('date', 0)),
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


def extract_clusters(conn, all_items):
    user_id = _ml_user_id()
    items = items_for_entity(all_items, 'CLUSTER', user_id)
    print(f"Extracting {len(items)} CLUSTER items into recurring_charge_patterns...")
    if not items:
        return

    records = []
    for item in items:
        cluster_id = item.get('cluster_id')
        if not cluster_id:
            continue
        samples = item.get('sample_merchants') or []
        if isinstance(samples, list):
            merchant_pattern = ', '.join(str(s) for s in samples[:5])
        else:
            merchant_pattern = str(samples)
        total_tx = int(item.get('total_transactions') or 0)
        total_amount = _item_decimal(item, 'total_amount', '0')
        amount_mean = total_amount / total_tx if total_tx else Decimal('0')
        pending_review = bool(item.get('pending_review'))
        records.append((
            str(cluster_id),
            _user_id_from_item(item),
            merchant_pattern,
            '',
            '',
            None,
            None,
            amount_mean,
            Decimal('0'),
            Decimal('0'),
            'PENDING_REVIEW' if pending_review else 'CLASSIFIED',
            not pending_review,
            0,
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
    print(f"Inserted {len(records)} cluster rows.")


def extract_accounts(conn, all_items):
    user_id = _ml_user_id()
    items = items_for_entity(all_items, 'ACCOUNT', user_id)
    print(f"Extracting {len(items)} ACCOUNT items...")
    if not items:
        return

    records = []
    for item in items:
        account_id = item.get('id')
        if not account_id:
            continue
        records.append((
            str(account_id),
            _user_id_from_item(item),
            item.get('name', ''),
            None,
        ))

    query = """
    INSERT INTO accounts (id, user_id, name, type)
    VALUES %s
    ON CONFLICT (id) DO NOTHING;
    """
    with conn.cursor() as cur:
        execute_values(cur, query, records)
    conn.commit()
    print(f"Inserted {len(records)} accounts.")


def main():
    print("Starting data extraction...")
    print_config()

    all_items = load_dynamodb_items()
    print_dynamodb_counts(all_items)

    conn = get_db_connection()
    try:
        ensure_varchar_id_columns(conn)
        clear_postgres_tables(conn)
        extract_transactions(conn, all_items)
        extract_clusters(conn, all_items)
        extract_accounts(conn, all_items)
        print_postgres_counts(conn, "--- PostgreSQL counts (after load) ---")
        print("Data extraction complete!")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
