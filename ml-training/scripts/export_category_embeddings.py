"""Emit MiniLM category description embeddings for the backend (JSON)."""
import json
from pathlib import Path

from sentence_transformers import SentenceTransformer

CATEGORY_MAP_V2 = {
    "Housing & Utilities": (
        "Essential housing mortgage rent council tax electricity gas water "
        "heating bills DIY repairs"
    ),
    "Insurance & Finance": (
        "Essential insurance premiums auto home health life bank fees loan "
        "repayments financial charges"
    ),
    "Telecom & Software": (
        "Fixed recurring telecom internet broadband mobile phone software "
        "productivity subscriptions"
    ),
    "Groceries": (
        "Essential groceries supermarket food shopping household supplies toiletries"
    ),
    "Transport & Car": (
        "Essential public transport trains buses commute car fuel petrol "
        "parking car maintenance"
    ),
    "Health & Care": (
        "Essential health pharmacy medical dental personal care therapy "
        "childcare petcare"
    ),
    "Dining Out": (
        "Discretionary eating out restaurants cafes coffee shops pubs bars "
        "social dining"
    ),
    "Takeaways & Delivery": (
        "Discretionary fast food takeaways convenient food delivery apps"
    ),
    "Shopping & Retail": (
        "Discretionary retail shopping clothing apparel electronics home "
        "upgrades hobbies gifts"
    ),
    "Entertainment & Leisure": (
        "Discretionary entertainment events cinema gym memberships media "
        "streaming tv video games"
    ),
    "Travel & Holidays": (
        "Discretionary travel tourism flights hotels vacations holidays leisure trips"
    ),
    "Savings & Investments": (
        "Wealth transfers savings accounts investments stocks crypto pensions"
    ),
    "Income": "Incoming money salary wage payroll dividends refunds cashback",
    "Cash & Unknown": (
        "Cash withdrawals ATM transfers to friends unknown expenses miscellaneous"
    ),
}

LABELS = list(CATEGORY_MAP_V2.keys())
DESCRIPTIONS = [CATEGORY_MAP_V2[k] for k in LABELS]

# With docker-compose, only `ml-training/` is mounted at /workspace — write here, then
# copy to `backend/src/services/import/categoryEmbeddings.json` on the host.
OUT = Path(__file__).resolve().parent.parent / "generated" / "categoryEmbeddings.json"


def main() -> None:
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    vectors = model.encode(DESCRIPTIONS, normalize_embeddings=True).tolist()
    payload = {
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "labels": LABELS,
        "vectors": vectors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload), encoding="utf-8")
    print(f"Wrote {OUT} ({len(vectors)} x {len(vectors[0])})")


if __name__ == "__main__":
    main()
