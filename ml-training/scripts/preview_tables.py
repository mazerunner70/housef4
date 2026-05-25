"""Print the first few rows of each ml-training Postgres table.

Run inside the ml-engine container:

    docker compose exec ml-engine python scripts/preview_tables.py
    docker compose exec ml-engine python scripts/preview_tables.py --limit 3
"""
import argparse
import os

import pandas as pd
import psycopg2

TABLES = (
    'transactions',
    'accounts',
    'recurring_charge_patterns',
    'pattern_feedback',
    'ml_categorization_results',
)


def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'db'),
        port=os.environ.get('DB_PORT', '5432'),
        user=os.environ.get('DB_USER', 'ml_user'),
        password=os.environ.get('DB_PASSWORD', 'ml_password'),
        database=os.environ.get('DB_NAME', 'recurring_charges_ml'),
        connect_timeout=10,
    )


def preview_table(conn, table, limit):
    df = pd.read_sql(f'SELECT * FROM {table} LIMIT %s', conn, params=(limit,))
    print(f'\n=== {table} ({len(df)} row(s) shown) ===')
    if df.empty:
        print('(empty)')
        return
    # Avoid dumping huge embedding arrays across many lines
    if 'merchant_embedding' in df.columns:
        df = df.copy()
        df['merchant_embedding'] = df['merchant_embedding'].apply(
            lambda v: f'[{len(v)} dims]' if isinstance(v, list) and v else v,
        )
    print(df.to_string(index=False, max_colwidth=60))


def main():
    parser = argparse.ArgumentParser(description='Preview rows from ml-training Postgres tables')
    parser.add_argument(
        '--limit',
        type=int,
        default=int(os.environ.get('PREVIEW_LIMIT', '5')),
        help='Max rows per table (default: 5)',
    )
    args = parser.parse_args()

    conn = get_db_connection()
    try:
        print(f'--- Postgres preview (limit={args.limit} per table) ---')
        for table in TABLES:
            try:
                preview_table(conn, table, args.limit)
            except psycopg2.Error as err:
                conn.rollback()
                print(f'\n=== {table} ===')
                print(f'Error: {err}')
        print('\n--- done ---')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
