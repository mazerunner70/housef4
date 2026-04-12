import os
import psycopg2

def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'db'),
        port=os.environ.get('DB_PORT', '5432'),
        user=os.environ.get('DB_USER', 'ml_user'),
        password=os.environ.get('DB_PASSWORD', 'ml_password'),
        database=os.environ.get('DB_NAME', 'recurring_charges_ml')
    )

def main():
    conn = get_db_connection()
    print("\n--- PostgreSQL Local Database Counts ---")
    try:
        with conn.cursor() as cur:
            tables = [
                'transactions', 
                'recurring_charge_patterns', 
                'pattern_feedback', 
                'ml_categorization_results'
            ]
            
            for table in tables:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table};")
                    count = cur.fetchone()[0]
                    print(f"{table.ljust(30)} : {count} rows")
                except psycopg2.Error as e:
                    print(f"{table.ljust(30)} : Error ({e})")
                    conn.rollback() # Reset transaction if table doesn't exist
                    
        print("----------------------------------------\n")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
